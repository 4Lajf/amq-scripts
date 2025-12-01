// ==UserScript==
// @name         AMQ Plus Connector
// @namespace    http://tampermonkey.net/
// @version      1.0.14
// @description  Connect AMQ to AMQ+ quiz configurations for seamless quiz playing
// @author       AMQ+
// @match        https://animemusicquiz.com/*
// @match        https://*.animemusicquiz.com/*
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/refs/heads/main/amqPlusConnector.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/refs/heads/main/amqPlusConnector.user.js
// @grant        GM_xmlhttpRequest
// @connect      amqplus.moe
// @connect      localhost
// @connect      anilist.co
// ==/UserScript==

"use strict";

if (typeof Listener === "undefined") return;

let loadInterval = setInterval(() => {
  if ($("#loadingScreen").hasClass("hidden")) {
    clearInterval(loadInterval);
    setup();
  }
}, 500);

const API_BASE_URL = "https://amqplus.moe";
// const API_BASE_URL = "http://localhost:5173";
console.log("[AMQ+] Using API base URL:", API_BASE_URL);

// Settings state
let amqPlusEnabled = true;
let songSourceMessagesEnabled = true;
let liveNodeSongSelectionMode = 'default';
let amqPlusCreditsSent = false;
let amqQuizLikesStorage = null;
let amqPlayerListSettings = {}; // Global per-player settings for Live Node (platform:username -> settings)

// Quiz state
let currentQuizData = null;
let currentQuizId = null;
let currentQuizInfo = null;
let selectedCustomQuizId = null;
let selectedCustomQuizName = null;
let lastLoadedQuizId = null;
let lastLoadedQuizSave = null;

// UI state
let isWaitingForQuizList = false;
let quizListAttempts = 0;
let pendingQuizData = null;
let pendingExportData = null;
let pendingExportFilename = null;

// Player list and song tracking state
let cachedPlayerLists = null;
let songSourceMap = null;
let currentSongNumber = 0;

// Training mode state
let isTrainingMode = false; // Flag to prevent start button hijacking during training
let trainingState = {
  isAuthenticated: false,
  authToken: null,
  userId: null,
  username: null,
  userQuizzes: [],
  newSongPercentage: 30,
  urlLoadedQuizId: null,
  urlLoadedQuizName: null,
  urlLoadedQuizSongCount: null,
  currentSession: {
    sessionId: null,
    quizId: null,
    quizName: null,
    playlist: [],
    currentIndex: 0,
    startTime: null,
    correctCount: 0,
    incorrectCount: 0,
    totalRated: 0
  },
  pendingSync: [], // Offline queue
  lastSyncTime: null,
  syncInProgress: false
};

let trainingSyncTimeout = null;
const TRAINING_SYNC_DEBOUNCE = 500; // 500ms debounce for sync

function loadSettings() {
  const saved = localStorage.getItem("amqPlusConnector");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      amqPlusEnabled = data.enabled ?? true;
      songSourceMessagesEnabled = data.songSourceMessagesEnabled ?? true;
      liveNodeSongSelectionMode = data.liveNodeSongSelectionMode ?? 'default';
      console.log("[AMQ+] Settings loaded from localStorage:", data);
    } catch (e) {
      console.error("[AMQ+] Failed to load settings:", e);
    }
  }

  try {
    const likedQuizzes = localStorage.getItem("amqPlusLikedQuizzes");
    amqQuizLikesStorage = likedQuizzes ? JSON.parse(likedQuizzes) : {};
    console.log("[AMQ+] Loaded liked quizzes from localStorage:", amqQuizLikesStorage);
  } catch (e) {
    console.error("[AMQ+] Failed to load liked quizzes:", e);
    amqQuizLikesStorage = {};
  }

  // Load player list settings (global per-player for Live Node)
  try {
    const playerSettings = localStorage.getItem("amqPlusPlayerListSettings");
    amqPlayerListSettings = playerSettings ? JSON.parse(playerSettings) : {};
    console.log("[AMQ+] Loaded player list settings from localStorage:", Object.keys(amqPlayerListSettings).length, "players");
  } catch (e) {
    console.error("[AMQ+] Failed to load player list settings:", e);
    amqPlayerListSettings = {};
  }

  // Load training settings
  loadTrainingSettings();
}

function loadTrainingSettings() {
  try {
    const token = localStorage.getItem("amqPlusTrainingToken");
    if (token) {
      trainingState.authToken = token;
      console.log("[AMQ+ Training] Loaded token from localStorage");
    }

    const savedState = localStorage.getItem("amqPlusTrainingState");
    if (savedState) {
      const state = JSON.parse(savedState);
      if (state.currentSession && state.currentSession.sessionId) {
        trainingState.currentSession = state.currentSession;
        console.log("[AMQ+ Training] Restored session from localStorage");
      }
      // Load new song percentage if saved
      if (state.newSongPercentage !== undefined) {
        trainingState.newSongPercentage = state.newSongPercentage;
      }
      // Load URL-loaded quiz info if saved
      if (state.urlLoadedQuizId) {
        trainingState.urlLoadedQuizId = state.urlLoadedQuizId;
        trainingState.urlLoadedQuizName = state.urlLoadedQuizName;
        trainingState.urlLoadedQuizSongCount = state.urlLoadedQuizSongCount;
        console.log("[AMQ+ Training] Restored URL-loaded quiz:", state.urlLoadedQuizName);
      }
      console.log("[AMQ+ Training] Loaded new song percentage:", trainingState.newSongPercentage, "%");
    }

    const pendingSync = localStorage.getItem("amqPlusTrainingSyncQueue");
    if (pendingSync) {
      trainingState.pendingSync = JSON.parse(pendingSync);
      console.log("[AMQ+ Training] Loaded pending sync queue:", trainingState.pendingSync.length);
    }
  } catch (e) {
    console.error("[AMQ+ Training] Failed to load training settings:", e);
  }
}

function saveTrainingSettings() {
  try {
    if (trainingState.authToken) {
      localStorage.setItem("amqPlusTrainingToken", trainingState.authToken);
    }

    // Save state including new song percentage and URL-loaded quiz
    const stateToSave = {
      newSongPercentage: trainingState.newSongPercentage,
      urlLoadedQuizId: trainingState.urlLoadedQuizId,
      urlLoadedQuizName: trainingState.urlLoadedQuizName,
      urlLoadedQuizSongCount: trainingState.urlLoadedQuizSongCount
    };

    if (trainingState.currentSession && trainingState.currentSession.sessionId) {
      stateToSave.currentSession = trainingState.currentSession;
    }

    localStorage.setItem("amqPlusTrainingState", JSON.stringify(stateToSave));

    if (trainingState.pendingSync.length > 0) {
      localStorage.setItem("amqPlusTrainingSyncQueue", JSON.stringify(trainingState.pendingSync));
    }
  } catch (e) {
    console.error("[AMQ+ Training] Failed to save training settings:", e);
  }
}

function saveSettings() {
  localStorage.setItem("amqPlusConnector", JSON.stringify({
    enabled: amqPlusEnabled,
    songSourceMessagesEnabled: songSourceMessagesEnabled,
    liveNodeSongSelectionMode: liveNodeSongSelectionMode
  }));
}

/**
 * Get the storage key for a player's settings
 * @param {string} platform - 'anilist' or 'mal'
 * @param {string} username - Player username
 * @returns {string} Storage key
 */
function getPlayerSettingsKey(platform, username) {
  return `${platform}:${username.toLowerCase()}`;
}

/**
 * Get saved settings for a player
 * @param {string} platform - 'anilist' or 'mal'
 * @param {string} username - Player username
 * @returns {Object|null} Saved settings or null if not found
 */
function getSavedPlayerSettings(platform, username) {
  const key = getPlayerSettingsKey(platform, username);
  return amqPlayerListSettings[key] || null;
}

/**
 * Save settings for a player entry
 * @param {Object} entry - Player entry with platform, username, selectedLists, songPercentage
 */
function savePlayerSettingsForEntry(entry) {
  if (!entry || !entry.platform || !entry.username) return;

  const key = getPlayerSettingsKey(entry.platform, entry.username);
  amqPlayerListSettings[key] = {
    selectedLists: entry.selectedLists ? { ...entry.selectedLists } : null,
    songPercentage: entry.songPercentage ? { ...entry.songPercentage } : null
  };

  try {
    localStorage.setItem("amqPlusPlayerListSettings", JSON.stringify(amqPlayerListSettings));
    console.log("[AMQ+] Saved settings for player:", entry.username, "(", entry.platform, ")");
  } catch (e) {
    console.error("[AMQ+] Failed to save player list settings:", e);
  }
}

/**
 * Apply saved settings to a player entry if they exist
 * @param {Object} entry - Player entry to apply settings to
 * @returns {Object} Entry with applied settings
 */
function applyPlayerSettingsToEntry(entry) {
  if (!entry || !entry.platform || !entry.username) return entry;

  const savedSettings = getSavedPlayerSettings(entry.platform, entry.username);
  if (savedSettings) {
    console.log("[AMQ+] Applying saved settings for player:", entry.username, "(", entry.platform, ")");
    if (savedSettings.selectedLists) {
      entry.selectedLists = { ...savedSettings.selectedLists };
    }
    if (savedSettings.songPercentage) {
      entry.songPercentage = { ...savedSettings.songPercentage };
    }
  }

  return entry;
}

function sendSystemMessage(message) {
  if (gameChat && gameChat.systemMessage) {
    setTimeout(() => { gameChat.systemMessage(String(message)) }, 1);
  } else {
    console.log("[AMQ+] System message:", message);
  }
}

function sendGlobalChatMessage(message) {
  socket.sendCommand({
    type: "lobby",
    command: "game chat message",
    data: { msg: String(message), teamMessage: false }
  });
}

/**
 * Helper to make API requests with consistent error handling
 * @param {Object} config - Request configuration
 * @param {string} config.url - API endpoint URL
 * @param {string} config.method - HTTP method (GET, POST, etc.)
 * @param {Object} [config.data] - Request payload
 * @param {Function} [config.onSuccess] - Success callback
 * @param {Function} [config.onError] - Error callback
 * @param {string} [config.successMessage] - Optional success message for system chat
 * @param {string} [config.errorPrefix] - Prefix for error messages
 * @returns {Promise} Promise that resolves with response data
 */
function makeApiRequest({ url, method = 'GET', data = null, onSuccess = null, onError = null, successMessage = null, errorPrefix = 'API Error' }) {
  return new Promise((resolve, reject) => {
    const requestConfig = {
      method: method,
      url: url,
      headers: data ? { "Content-Type": "application/json" } : undefined,
      data: data ? JSON.stringify(data) : undefined,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const responseData = JSON.parse(response.responseText);

            // Check for success:false in response
            if (responseData.success === false) {
              const errorMsg = responseData.error || responseData.message || "Unknown error";
              console.error(`[AMQ+] ${errorPrefix}:`, errorMsg);
              if (onError) onError(errorMsg, responseData);
              reject(new Error(errorMsg));
              return;
            }

            if (successMessage) sendSystemMessage(successMessage);
            if (onSuccess) onSuccess(responseData);
            resolve(responseData);
          } catch (e) {
            const error = "Failed to parse response";
            console.error(`[AMQ+] ${errorPrefix}:`, e);
            if (onError) onError(error, null);
            reject(new Error(error));
          }
        } else {
          // Handle HTTP errors
          let errorMsg = "Unknown error";
          try {
            const errorData = JSON.parse(response.responseText);
            errorMsg = errorData.error || errorData.message || errorData.userMessage || `HTTP ${response.status}`;
          } catch (e) {
            errorMsg = `HTTP ${response.status}: ${response.statusText || 'Request failed'}`;
          }
          console.error(`[AMQ+] ${errorPrefix}:`, errorMsg);
          if (onError) onError(errorMsg, null);
          reject(new Error(errorMsg));
        }
      },
      onerror: function (error) {
        const errorMsg = "Connection error. Please check your network.";
        console.error(`[AMQ+] ${errorPrefix}:`, error);
        if (onError) onError(errorMsg, null);
        reject(new Error(errorMsg));
      }
    };

    GM_xmlhttpRequest(requestConfig);
  });
}

function setup() {
  console.log("[AMQ+] Starting setup...");
  loadSettings();
  createUI();
  setupListeners();
  hijackStartButton();
  setupQuizSavedModalObserver();
  setupQuizCreatorExportButton();
  setupSocketCommandInterceptor();
  setupGameChatFilter();
  console.log("[AMQ+] Setup complete! Enabled:", amqPlusEnabled);
}

function setupSocketCommandInterceptor() {
  if (!socket._amqPlusCommandHijacked) {
    const originalSendCommand = socket.sendCommand.bind(socket);
    socket.sendCommand = function (command) {
      if (command.command === "update custom quiz like state" && command.type === "quizCreator") {
        console.log("[AMQ+] Intercepted like state command:", command);

        if (currentQuizInfo && currentQuizInfo.name && currentQuizInfo.name.startsWith("AMQ+")) {
          const likeState = command.data?.likeState || 0;
          console.log("[AMQ+] Sending like state to AMQ+ API instead of AMQ server for quiz:", currentQuizInfo.name);
          sendQuizLikeByIdentifiers(currentQuizInfo, likeState);
          return;
        }
      }
      return originalSendCommand.call(this, command);
    };
    socket._amqPlusCommandHijacked = true;
    console.log("[AMQ+] Socket command interceptor set up for AMQ+ quizzes");
  }
}

function setupGameChatFilter() {
  // Wait for gameChat to be available
  const checkGameChat = setInterval(() => {
    if (typeof gameChat !== 'undefined' && gameChat && gameChat.systemMessage) {
      clearInterval(checkGameChat);

      // Only override once
      if (gameChat._amqPlusSystemMessageHijacked) {
        return;
      }

      const originalSystemMessage = gameChat.systemMessage.bind(gameChat);

      gameChat.systemMessage = function (message) {
        console.log("[AMQ+ Training] System message received:", message);

        // Check if training mode is active
        const isTrainingActive = trainingState.currentSession &&
          trainingState.currentSession.sessionId &&
          isTrainingMode;

        console.log("[AMQ+ Training] Training active:", isTrainingActive);

        // Filter pause/unpause messages during training mode
        if (isTrainingActive) {
          const messageStr = String(message);
          if (messageStr.includes("has paused the game") || messageStr.includes("has unpaused the game")) {
            console.log("[AMQ+ Training] 🚫 Blocked pause/unpause system message:", messageStr);
            return; // Don't call the original function
          }
        }

        // Call original for all other messages
        return originalSystemMessage.call(this, message);
      };

      gameChat._amqPlusSystemMessageHijacked = true;
      console.log("[AMQ+] Game chat system message filter set up");
    }
  }, 500);

  // Stop checking after 30 seconds
  setTimeout(() => {
    clearInterval(checkGameChat);
  }, 30000);
}

function setupQuizSavedModalObserver() {
  const observer = new MutationObserver((mutations) => {
    const savedModal = document.querySelector(".swal2-popup.swal2-show");
    if (savedModal) {
      const title = savedModal.querySelector(".swal2-title");
      if (title && (title.textContent === "Quiz Saved" || title.textContent === "Save Failed")) {
        setTimeout(() => {
          const okButton = savedModal.querySelector(".swal2-confirm");
          if (okButton) {
            okButton.click();
          }
        }, 50);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function createTrainingModalHTML() {
  return `
    <div class="modal fade" id="amqPlusTrainingModal" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document" style="width: 700px; max-width: 90%;">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title">AMQ+ Training Mode</h4>
            <button id="trainingLogoutBtn" class="btn btn-sm btn-danger" style="position: absolute; right: 40px; top: 8px; padding: 4px 8px; font-size: 11px; display: none;">
              <i class="fa fa-sign-out"></i> Logout
            </button>
          </div>
          <div class="modal-body">
            <!-- Authentication Tab -->
            <div id="trainingAuthTab" style="display: block;">
              <div style="padding: 15px;">
                <div style="text-align: center; margin-bottom: 20px;">
                  <i class="fa fa-key" style="font-size: 48px; color: #6366f1; margin-bottom: 15px; display: block;"></i>
                  <h4 style="margin-bottom: 10px; font-weight: bold;">Connect Your AMQ+ Account</h4>
                  <p style="color: rgba(255,255,255,0.7); margin-bottom: 0;">Enter your training token to sync your progress</p>
                </div>

                <div id="trainingAuthStatus" style="margin-bottom: 15px;"></div>

                <div class="form-group">
                  <label for="trainingTokenField">Training Token:</label>
                  <input type="text" id="trainingTokenField" class="form-control" placeholder="Paste your 64-character token here"
                         style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 8px 12px; font-family: monospace; text-align: center; font-size: 12px;"
                         maxlength="64">
                  <small class="form-text text-muted">
                    Get your token from AMQ+ Training page
                  </small>
                </div>

                <style>
                  #trainingTokenField:focus {
                    background-color: #16213e !important;
                    border-color: #4a5568 !important;
                    color: #fff !important;
                    outline: none;
                    box-shadow: 0 0 0 2px rgba(74, 85, 104, 0.3);
                  }
                  #trainingTokenField::placeholder {
                    color: #718096;
                  }
                  .trainingRatingBtn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                    opacity: 0.9;
                  }
                  .trainingRatingBtn:active {
                    transform: translateY(0);
                  }
                </style>

                <div style="text-align: center; margin-bottom: 15px;">
                  <button id="trainingLinkBtn" class="btn btn-primary" style="background-color: #6366f1; border-color: #6366f1; padding: 8px 24px;">
                    <i class="fa fa-link"></i> Link Account
                  </button>
                </div>

                <div style="padding: 15px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748;">
                  <div style="font-weight: bold; margin-bottom: 12px; color: #fff; font-size: 14px;">
                    <i class="fa fa-info-circle"></i> How to get your token:
                  </div>
                  <ol style="margin: 0; padding-left: 20px; color: rgba(255,255,255,0.8); font-size: 13px; line-height: 1.6;">
                    <li>Visit <a href="https://amqplus.moe/training" target="_blank" rel="noopener noreferrer" style="color: #6366f1; text-decoration: underline; font-weight: bold;">amqplus.moe/training</a></li>
                    <li>Click <strong>"Generate Token"</strong></li>
                    <li>Copy and paste it here</li>
                    <li>Your progress will sync automatically!</li>
                  </ol>
                </div>
              </div>
            </div>

            <!-- Quiz Selection Tab -->
            <div id="trainingQuizTab" style="display: none;">
              <div style="padding: 15px;">
                <!-- Training Mode Toggle -->
                <div class="form-group" style="margin-bottom: 20px;">
                  <label style="display: flex; align-items: center; cursor: pointer;">
                    <div class="customCheckbox" style="margin-right: 10px;">
                      <input type="checkbox" id="trainingModeToggle">
                      <label for="trainingModeToggle">
                        <i class="fa fa-check" aria-hidden="true"></i>
                      </label>
                    </div>
                    <span style="font-size: 16px; font-weight: bold;">Enable Training Mode</span>
                  </label>
                  <small class="form-text text-muted">
                    When enabled, training features like rating buttons will be active during quiz sessions
                  </small>
                </div>

                <h4 style="margin-bottom: 15px; font-weight: bold;">Select a Quiz to Practice</h4>

                <!-- Play from URL Section -->
                <div style="margin-bottom: 15px; padding: 12px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 8px; border: 1px solid #2d3748;">
                  <!-- URL Input (shown by default) -->
                  <div id="trainingUrlInputSection">
                    <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-size: 13px; font-weight: bold;">
                      <i class="fa fa-link"></i> Play from URL
                    </label>
                    <div style="display: flex; gap: 8px;">
                      <input type="text" id="trainingUrlInput" class="form-control" placeholder="https://amqplus.moe/play/..."
                             style="flex: 1; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 8px 12px; font-size: 12px;">
                      <button id="trainingLoadFromUrlBtn" class="btn btn-primary" style="background-color: #6366f1; border-color: #6366f1; padding: 8px 16px; white-space: nowrap;">
                        <i class="fa fa-arrow-right"></i> Load
                      </button>
                    </div>
                    <div id="trainingUrlError" style="display: none; margin-top: 8px; padding: 6px 8px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 4px; color: #ef4444; font-size: 11px;">
                    </div>
                  </div>

                  <!-- Quiz Details (shown when quiz is loaded from URL) -->
                  <div id="trainingUrlQuizDetails" style="display: none;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                      <label style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: bold;">
                        <i class="fa fa-link"></i> Loaded from URL
                      </label>
                      <button id="trainingChangeUrlBtn" class="btn btn-sm" style="background-color: #4a5568; border-color: #4a5568; color: #fff; padding: 4px 10px; font-size: 11px;">
                        <i class="fa fa-edit"></i> Change
                      </button>
                    </div>
                    <div style="padding: 12px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px;">
                      <h5 id="trainingUrlQuizName" style="margin: 0 0 10px 0; color: #fff; font-weight: bold;"></h5>
                      <div id="trainingUrlQuizStats"></div>
                    </div>
                  </div>
                </div>

                <div style="text-align: center; margin-bottom: 15px; color: rgba(255,255,255,0.5); font-size: 12px;">— OR —</div>

                <div id="trainingQuizList" style="max-height: 400px; overflow-y: auto;"></div>

                <!-- Import from Old Script Section -->
                <div style="margin-top: 20px; padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;">
                  <div id="trainingImportToggle" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                    <span style="color: rgba(255,255,255,0.7); font-size: 12px;">
                      <i class="fa fa-chevron-right" id="trainingImportChevron" style="margin-right: 6px; transition: transform 0.2s;"></i>
                      Import from old training mode script
                    </span>
                  </div>
                  <div id="trainingImportContent" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                      <select id="trainingImportProfileSelect" class="form-control" style="flex: 1; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; font-size: 11px;">
                        <option value="">Select profile to import...</option>
                      </select>
                      <button id="trainingImportBtn" class="btn btn-default" style="background-color: #4a5568; border-color: #4a5568; color: #fff; padding: 5px 12px; font-size: 11px; white-space: nowrap;">
                        <i class="fa fa-upload"></i> Import
                      </button>
                    </div>
                    <div id="trainingImportStatus" style="margin-top: 8px; display: none;"></div>
                  </div>
                </div>

                <div style="margin-top: 20px; padding: 15px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748;">
                  <label style="display: block; margin-bottom: 12px; color: #fff; font-size: 14px; font-weight: bold;">Session Settings:</label>

                  <div style="display: flex; align-items: flex-end; gap: 20px;">
                    <div style="flex: 1;">
                      <!-- Basic Settings -->
                      <div style="display: flex; gap: 15px; align-items: flex-end;">
                        <div style="min-width: 150px;">
                          <label style="display: block; margin-bottom: 5px; color: rgba(255,255,255,0.9); font-size: 13px; white-space: nowrap;">Max Songs:</label>
                          <input type="number" id="trainingSessionLength" class="form-control" value="20" min="5" max="100"
                                 style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 6px 10px; width: 100px;">
                        </div>

                        <button id="trainingAdvancedToggle" type="button" style="background-color: #2d3748; border: 1px solid #4a5568; color: #e2e8f0; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 12px; height: 34px;">
                          <i class="fa fa-cog"></i> Advanced
                        </button>
                      </div>

                      <!-- Advanced Settings (Hidden by default) -->
                      <div id="trainingAdvancedSettings" style="display: none; margin-top: 15px; padding: 12px; background-color: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid #2d3748;">
                        <div style="margin-bottom: 10px; color: rgba(255,255,255,0.7); font-size: 12px;">
                          <i class="fa fa-info-circle"></i> Manual song distribution (leave blank for auto)
                        </div>
                        
                        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-clock" style="color: #f59e0b;"></i> Due Songs:
                            </label>
                            <input type="number" id="trainingDueCount" class="form-control" placeholder="Auto" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>

                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-star" style="color: #a78bfa;"></i> New Songs:
                            </label>
                            <input type="number" id="trainingNewCount" class="form-control" placeholder="Auto" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>

                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-refresh" style="color: #60a5fa;"></i> Revision Songs:
                            </label>
                            <input type="number" id="trainingRevisionCount" class="form-control" placeholder="Auto" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>
                        </div>

                        <div style="margin-top: 10px; font-size: 11px; color: rgba(255,255,255,0.6);">
                          <i class="fa fa-lightbulb"></i> Tip: Set specific counts or leave blank for automatic FSRS-based distribution
                        </div>
                      </div>
                    </div>

                    <button id="trainingStartBtn" class="btn btn-success" style="background-color: #10b981; border-color: #10b981; padding: 8px 24px; white-space: nowrap; flex-shrink: 0;">
                      <i class="fa fa-play"></i> Start Training
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Active Session Tab -->
            <div id="trainingSessionTab" style="display: none;">
              <div style="padding: 15px;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 15px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748; margin-bottom: 15px;">
                  <h4 style="margin: 0 0 10px 0; font-weight: bold;" id="trainingSessionQuizName">Quiz Name</h4>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <span style="font-size: 24px; font-weight: bold; color: #6366f1;" id="trainingSessionProgress">0% accuracy (0/0)</span>
                      <span style="opacity: 0.9; margin-left: 10px;">songs</span>
                    </div>
                    <div style="text-align: right;">
                      <div style="margin-bottom: 4px;"><i class="fa fa-check-circle" style="color: #10b981;"></i> <span id="trainingSessionCorrect">0</span> correct</div>
                      <div><i class="fa fa-times-circle" style="color: #ef4444;"></i> <span id="trainingSessionIncorrect">0</span> incorrect</div>
                    </div>
                  </div>
                </div>

                <div id="trainingCurrentSong" style="padding: 15px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 8px; border: 1px solid #2d3748; margin-bottom: 15px;">
                  <p style="color: rgba(255,255,255,0.7); margin: 0;">Waiting for quiz to start...</p>
                </div>

                <div id="trainingRatingSection" style="display: none; padding: 15px; background: linear-gradient(135deg, rgba(255, 193, 7, 0.2) 0%, rgba(255, 193, 7, 0.1) 100%); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px; margin-bottom: 15px;">
                  <h5 style="margin-top: 0; margin-bottom: 15px; color: #ffc107; font-weight: bold; text-align: center;">
                    <i class="fa fa-star"></i> Rate Your Performance
                  </h5>
                  <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="trainingRatingBtn btn" data-rating="1" style="flex: 1; background: #dc3545; color: white; border: none; padding: 15px 10px; font-weight: bold; transition: all 0.2s;">
                      <i class="fa fa-times" style="font-size: 20px; display: block; margin-bottom: 5px;"></i>
                      Again<br><small style="opacity: 0.9; font-size: 11px;">Forgot</small>
                    </button>
                    <button class="trainingRatingBtn btn" data-rating="2" style="flex: 1; background: #ffc107; color: white; border: none; padding: 15px 10px; font-weight: bold; transition: all 0.2s;">
                      <i class="fa fa-meh" style="font-size: 20px; display: block; margin-bottom: 5px;"></i>
                      Hard<br><small style="opacity: 0.9; font-size: 11px;">Difficult</small>
                    </button>
                    <button class="trainingRatingBtn btn" data-rating="3" style="flex: 1; background: #10b981; color: white; border: none; padding: 15px 10px; font-weight: bold; transition: all 0.2s;">
                      <i class="fa fa-check" style="font-size: 20px; display: block; margin-bottom: 5px;"></i>
                      Good<br><small style="opacity: 0.9; font-size: 11px;">Recalled</small>
                    </button>
                    <button class="trainingRatingBtn btn" data-rating="4" style="flex: 1; background: #6366f1; color: white; border: none; padding: 15px 10px; font-weight: bold; transition: all 0.2s;">
                      <i class="fa fa-star" style="font-size: 20px; display: block; margin-bottom: 5px;"></i>
                      Easy<br><small style="opacity: 0.9; font-size: 11px;">Perfect</small>
                    </button>
                  </div>
                  <p style="text-align: center; margin: 12px 0 0 0; color: rgba(255,255,255,0.8); font-size: 12px;">
                    <i class="fa fa-lightbulb"></i> Choose how well you remembered the song
                  </p>
                </div>

                <div style="text-align: center;">
                  <button id="trainingEndBtn" class="btn btn-danger" style="padding: 8px 24px;">
                    <i class="fa fa-stop"></i> End Session
                  </button>
                </div>

                <div id="trainingSyncStatus" style="margin-top: 15px; padding: 10px; background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.5); border-radius: 4px; display: none; color: #10b981;">
                  <i class="fa fa-check-circle"></i> <span>Progress synced successfully</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createModalHTML() {
  return `
        <div class="modal fade" id="amqPlusModal" tabindex="-1" role="dialog">
            <div class="modal-dialog" role="document" style="width: 600px">
                <div class="modal-content">
                    <div class="modal-header">
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                        <h4 class="modal-title">AMQ+ Settings</h4>
                    </div>
                    <div class="modal-body">
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <div class="customCheckbox" style="margin-right: 10px;">
                                    <input type="checkbox" id="amqPlusEnableToggle" ${amqPlusEnabled ? 'checked' : ''}>
                                    <label for="amqPlusEnableToggle">
                                        <i class="fa fa-check" aria-hidden="true"></i>
                                    </label>
                                </div>
                                <span style="font-size: 16px; font-weight: bold;">Enable AMQ+ Mode</span>
                            </label>
                            <small class="form-text text-muted">
                                When enabled, AMQ+ will automatically fetch and apply quizzes when starting a game
                            </small>
                        </div>

                        <div class="form-group">
                            <label for="amqPlusUrlInput">Enter AMQ+ Play URL:</label>
                            <input type="text" class="form-control" id="amqPlusUrlInput"
                                   placeholder="https://amqplus.com/play/quiz_id"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 8px 12px;">
                            <small class="form-text text-muted">
                                Paste the play link from AMQ+ website
                            </small>
                        </div>

                        <style>
                            #amqPlusUrlInput:focus {
                                background-color: #16213e !important;
                                border-color: #4a5568 !important;
                                color: #fff !important;
                                outline: none;
                                box-shadow: 0 0 0 2px rgba(74, 85, 104, 0.3);
                            }
                            #amqPlusUrlInput::placeholder {
                                color: #718096;
                            }
                        </style>

                        <div id="amqPlusPlayerListsConfig" style="margin-top: 15px; padding: 15px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748;">
                            <div style="font-weight: bold; margin-bottom: 12px; color: #fff; font-size: 14px; display: flex; align-items: center; justify-content: space-between;">
                                <span>Configure Player Lists & Percentages</span>
                                <div style="display: flex; gap: 8px;">
                                    <button type="button" class="btn btn-sm btn-primary" id="amqPlusSyncBtn" style="background-color: #6366f1; border-color: #6366f1; color: #fff; padding: 4px 12px; font-size: 11px;">
                                        <i class="fa fa-sync" style="margin-right: 4px;"></i>Sync Now
                                    </button>
                                    <button type="button" class="btn btn-sm" id="amqPlusRandomPreset" style="background-color: #4a5568; border-color: #4a5568; color: #fff; padding: 4px 12px; font-size: 11px;">Random</button>
                                    <button type="button" class="btn btn-sm" id="amqPlusEqualPreset" style="background-color: #4a5568; border-color: #4a5568; color: #fff; padding: 4px 12px; font-size: 11px;">Equal</button>
                                </div>
                            </div>

                            <div id="amqPlusPlayerListsConfigContent" style="max-height: 400px; overflow-y: auto;">
                                <div style="color: rgba(255,255,255,0.6); padding: 20px; text-align: center;">
                                    <div style="margin-bottom: 12px; padding: 10px; background-color: rgba(255, 193, 7, 0.2); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 4px; color: #ffc107; font-size: 12px;">
                                        <strong>Note:</strong> This feature will only work if the quiz has a Live Node in it.
                                    </div>
                                    No player lists fetched yet. Click "Sync Now" to gather player lists from the lobby.
                                </div>
                            </div>

                            <div id="amqPlusPercentageError" style="display: none; margin-top: 8px; padding: 8px; background-color: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 4px; color: #ff6b6b; font-size: 12px;">
                            </div>

                            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <label style="display: block; margin-bottom: 8px; color: #fff; font-size: 13px; font-weight: bold;">List Distribution Mode:</label>
                                <select id="amqPlusSongSelectionMode" style="width: 100%; padding: 6px 10px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;" title="Controls how songs are prioritized during selection">
                                    <option value="default" title="Random: Songs are selected randomly without prioritizing based on list overlap">Random</option>
                                    <option value="many-lists" title="All Shared: Prioritizes songs that appear on the most user lists (songs everyone knows)">All Shared</option>
                                    <option value="few-lists" title="No Shared: Prioritizes songs that appear on the fewest user lists (unique/rare songs)">No Shared</option>
                                </select>
                                <small style="display: block; margin-top: 6px; color: rgba(255,255,255,0.6); font-size: 11px;">
                                    Controls how songs are prioritized during selection. "Random" maintains current behavior. "All Shared" prioritizes songs that appear on the most user lists (songs everyone knows). "No Shared" prioritizes songs that appear on the fewest user lists (unique/rare songs).
                                </small>
                            </div>
                        </div>

                        <div class="form-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #dee2e6;">
                            <label style="font-weight: bold; margin-bottom: 10px; display: block;">Available Commands:</label>
                            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 12px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748; font-size: 12px; font-family: monospace;">
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus toggle</strong> - Enable/disable AMQ+ mode</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus reload</strong> - Reload current quiz</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus sync</strong> - Sync player lists manually</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus info</strong> - Display quiz metadata in chat</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus sources</strong> - Toggle song source messages</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus [url]</strong> - Fetch quiz from URL</div>
                                <div style="margin-top: 10px; margin-bottom: 6px; color: #10b981; font-weight: bold;">Player List Commands (Live Node):</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/add [status...]</strong> - Add list statuses</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/remove [status...]</strong> - Remove list statuses</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/list</strong> - Show your enabled lists</div>
                                <div style="color: #e2e8f0;"><strong style="color: #fff;">/listhelp</strong> - Show list commands help</div>
                            </div>
                        </div>

                        <div id="amqPlusLoadingSpinner" style="display: none; text-align: center;">
                            <i class="fa fa-spinner fa-spin fa-3x"></i>
                            <p id="amqPlusStatusMessage">Loading quiz from AMQ+...</p>
                        </div>
                        <div id="amqPlusError" class="alert alert-danger" style="display: none;"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="amqPlusFetchBtn">Fetch Quiz</button>
                        <button type="button" class="btn btn-success" id="amqPlusChangeLinkBtn" style="display: none;">Change Link</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function createUI() {
  console.log("[AMQ+] Creating UI elements...");

  if ($("#amqPlusToggle").length > 0) {
    console.log("[AMQ+] Toggle button already exists, skipping creation");
    return;
  }

  // Add AMQ+ button
  $("#lobbyPage .topMenuBar").append(`<div id="amqPlusToggle" class="clickAble topMenuButton topMenuMediumButton"><h3>AMQ+</h3></div>`);
  $("#amqPlusToggle").click(() => {
    console.log("[AMQ+] AMQ+ button clicked, opening modal");
    $("#amqPlusModal").modal("show");
  });

  // Add Training button
  $("#lobbyPage .topMenuBar").append(`<div id="amqPlusTrainingToggle" class="clickAble topMenuButton topMenuMediumButton"><h3>Training</h3></div>`);
  $("#amqPlusTrainingToggle").click(() => {
    console.log("[AMQ+ Training] Training button clicked, opening modal");

    // Reset training mode checkbox to unchecked when opening modal
    $("#trainingModeToggle").prop("checked", false);
    isTrainingMode = false;

    $("#amqPlusTrainingModal").modal("show");

    // Refresh stats for all quizzes when opening the modal
    if (trainingState.isAuthenticated && trainingState.authToken) {
      console.log("[AMQ+ Training] Refreshing stats for all quizzes...");
      refreshAllQuizStats();
    }

    // Show/hide logout button based on auth state
    if (trainingState.isAuthenticated) {
      $("#trainingLogoutBtn").show();
      // Restore URL quiz display if saved
      restoreUrlQuizDisplay();
    } else {
      $("#trainingLogoutBtn").hide();
    }
    if (trainingState.authToken && !trainingState.isAuthenticated) {
      // Try to validate token on open
      validateTrainingToken();
    }
  });

  updateToggleButton();
  applyStyles();

  const modal = $(createModalHTML());
  const trainingModal = $(createTrainingModalHTML());
  const gameContainer = $("#gameContainer");
  if (gameContainer.length > 0) {
    if ($("#amqPlusModal").length === 0) {
      gameContainer.append(modal);
      console.log("[AMQ+] Modal appended to gameContainer");
      attachModalHandlers();
    } else {
      console.log("[AMQ+] Modal already exists, skipping creation");
      attachModalHandlers();
    }

    if ($("#amqPlusTrainingModal").length === 0) {
      gameContainer.append(trainingModal);
      console.log("[AMQ+ Training] Training modal appended to gameContainer");
      attachTrainingModalHandlers();
    } else {
      console.log("[AMQ+ Training] Training modal already exists");
      attachTrainingModalHandlers();
    }
  } else {
    console.warn("[AMQ+] GameContainer not found, appending to body as fallback");
    if ($("#amqPlusModal").length === 0) {
      $("body").append(modal);
      attachModalHandlers();
    } else {
      attachModalHandlers();
    }

    if ($("#amqPlusTrainingModal").length === 0) {
      $("body").append(trainingModal);
      attachTrainingModalHandlers();
    } else {
      attachTrainingModalHandlers();
    }
  }
}

function attachModalHandlers() {
  $("#amqPlusFetchBtn").off("click").click(() => {
    fetchQuizFromUrl();
  });

  $("#amqPlusChangeLinkBtn").off("click").click(() => {
    $("#amqPlusUrlInput").prop("disabled", false);
    $("#amqPlusFetchBtn").show();
    $("#amqPlusChangeLinkBtn").hide();
  });

  $("#amqPlusUrlInput").off("keypress").keypress((e) => {
    if (e.which === 13) {
      fetchQuizFromUrl();
    }
  });


  $("#amqPlusEnableToggle").off("change").change(function () {
    amqPlusEnabled = $(this).is(":checked");
    saveSettings();
    updateToggleButton();
    if (amqPlusEnabled) {
      sendSystemMessage("AMQ+ mode enabled");
    } else {
      sendSystemMessage("AMQ+ mode disabled");
    }
  });

  $("#amqPlusModal").off("show.bs.modal").on("show.bs.modal", function () {
    $("#amqPlusEnableToggle").prop("checked", amqPlusEnabled);
    $("#amqPlusSongSelectionMode").val(liveNodeSongSelectionMode);
    if (!isWaitingForQuizList && !pendingQuizData) {
      updateModalStatus(null);
      $("#amqPlusError").hide();
    }
    updatePlayerListsConfigUI();
  });

  $("#amqPlusModal").off("hide.bs.modal").on("hide.bs.modal", function (e) {
    if (cachedPlayerLists && cachedPlayerLists.length > 0) {
      if (!validatePercentages()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
    }
  });

  $("#amqPlusModal").find('.close, [data-dismiss="modal"]').off("click").on("click", function (e) {
    if (cachedPlayerLists && cachedPlayerLists.length > 0) {
      if (!validatePercentages()) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  });

  $("#amqPlusSyncBtn").off("click").click(() => {
    handleManualSync();
  });

  $("#amqPlusRandomPreset").off("click").click(() => {
    applyRandomPreset();
  });

  $("#amqPlusEqualPreset").off("click").click(() => {
    applyEqualPreset();
  });

  $("#amqPlusSongSelectionMode").off("change").on("change", function () {
    liveNodeSongSelectionMode = $(this).val();
    saveSettings();
  });
}

function updateToggleButton() {
  console.log("[AMQ+] Updating toggle button, enabled:", amqPlusEnabled);
  if (amqPlusEnabled) {
    $("#amqPlusToggle").css({
      "background-color": "rgba(46, 125, 50, 1)",
      "border": "1px solid rgba(46, 125, 50, 1)"
    });
    console.log("[AMQ+] Toggle button color set to subtle green");
  } else {
    $("#amqPlusToggle").css({
      "background-color": "",
      "border": ""
    });
    console.log("[AMQ+] Toggle button color reset");
  }
  if ($("#amqPlusEnableToggle").length > 0) {
    $("#amqPlusEnableToggle").prop("checked", amqPlusEnabled);
  }
}

function applyStyles() {
  $("#amqPlusStyle").remove();
  let style = document.createElement("style");
  style.type = "text/css";
  style.id = "amqPlusStyle";
  let text = `
        #amqPlusToggle {
            position: absolute;
            right: calc(50% + 120px);
            width: 80px;
        }
        #amqPlusTrainingToggle {
            position: absolute;
            left: calc(50% + 120px);
            width: 80px;
        }
        .amqPlusCustomLikeButton {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 8px 16px;
            margin-top: 8px;
            border-radius: 6px;
            cursor: pointer;
            user-select: none;
            transition: all 0.3s ease;
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%);
            border: 2px solid rgba(255, 255, 255, 0.2);
            font-size: 14px;
            font-weight: 600;
            pointer-events: auto;
            position: relative;
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            max-width: 100%;
            box-sizing: border-box;
        }
        .amqPlusCustomLikeButton:hover {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.1) 100%);
            border-color: rgba(255, 255, 255, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .amqPlusCustomLikeButton.amqPlusLiked {
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.3) 0%, rgba(76, 175, 80, 0.2) 100%);
            border-color: #4CAF50;
            color: #4CAF50;
            box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
        }
        .amqPlusCustomLikeButton.amqPlusLiked:hover {
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.4) 0%, rgba(76, 175, 80, 0.3) 100%);
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
        }
        .amqPlusCustomLikeButton i {
            font-size: 16px;
            transition: transform 0.3s ease;
        }
        .amqPlusCustomLikeButton:hover i {
            transform: scale(1.2) rotate(5deg);
        }
        .amqPlusCustomLikeButton.amqPlusLiked i {
            color: #4CAF50;
        }
        .amqPlusCustomLikeButton .amqPlusLikeText {
            font-weight: 600;
            letter-spacing: 0.5px;
        }
    `;
  style.appendChild(document.createTextNode(text));
  document.head.appendChild(style);
}

function extractQuizIdFromUrl(url) {
  console.log("[AMQ+] Extracting quiz ID from URL:", url);
  try {
    const match = url.match(/\/play\/([^/?]+)/);
    const quizId = match ? match[1] : null;
    console.log("[AMQ+] Extracted quiz ID:", quizId);
    return quizId;
  } catch (e) {
    console.error("[AMQ+] Error extracting quiz ID:", e);
    return null;
  }
}

function fetchQuizFromUrl() {
  console.log("[AMQ+] Fetch button clicked");

  if (!validatePercentages()) {
    showError("Please fix percentage validation errors before fetching quiz.");
    return;
  }

  const url = $("#amqPlusUrlInput").val().trim();
  console.log("[AMQ+] Input URL:", url);

  if (!url) {
    console.warn("[AMQ+] No URL provided");
    showError("Please enter a URL");
    return;
  }

  const quizId = extractQuizIdFromUrl(url);
  if (!quizId) {
    console.warn("[AMQ+] Invalid URL format:", url);
    showError("Invalid URL format. Expected format: https://amqplus.com/play/[quizId]");
    return;
  }

  console.log("[AMQ+] Starting fetch for quiz ID:", quizId);

  let liveNodeData = null;
  if (cachedPlayerLists && cachedPlayerLists.length > 0) {
    console.log("[AMQ+] Using cached player lists for initial fetch");
    const configuredEntries = getConfiguredPlayerLists();
    liveNodeData = {
      useEntirePool: false,
      userEntries: configuredEntries,
      songSelectionMode: liveNodeSongSelectionMode
    };
  }

  fetchQuiz(quizId, liveNodeData).then(() => {
    if (!liveNodeData) {
      checkQuizForLiveNode(quizId);
    }
  });
}

function checkAndHandleLiveNode(quizId, options = {}) {
  const { isReRoll = false, skipAutoReady = null, originalFireMainButtonEvent = null } = options;
  const apiUrl = `${API_BASE_URL}/play/${quizId}`;

  GM_xmlhttpRequest({
    method: "GET",
    url: apiUrl,
    onload: function (response) {
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.success === false) {
            if (isReRoll) {
              fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
            }
            return;
          }

          const configData = data.configuration_data || data.configurationData;
          if (configData && configData.nodes) {
            const hasLiveNode = configData.nodes.some(n => n.data?.id === 'live-node');
            if (hasLiveNode) {
              const logPrefix = isReRoll ? "re-roll" : "";
              console.log(`[AMQ+] Quiz has Live Node, fetching player lists${logPrefix ? ' for ' + logPrefix : ''}`);

              if (cachedPlayerLists && cachedPlayerLists.length > 0) {
                console.log(`[AMQ+] Using cached player lists${logPrefix ? ' for ' + logPrefix : ''}`);

                if (isReRoll) {
                  const configuredEntries = getConfiguredPlayerLists();
                  const liveNodeData = {
                    useEntirePool: false,
                    userEntries: configuredEntries,
                    songSelectionMode: liveNodeSongSelectionMode
                  };
                  fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent);
                } else {
                  usePlayerLists(cachedPlayerLists, quizId);
                }
              } else {
                gatherPlayerLists().then(userEntries => {
                  cachedPlayerLists = userEntries;
                  applyRandomPreset();

                  if (isReRoll) {
                    const configuredEntries = getConfiguredPlayerLists();
                    const liveNodeData = {
                      useEntirePool: false,
                      userEntries: configuredEntries,
                      songSelectionMode: liveNodeSongSelectionMode
                    };
                    fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent);
                  } else {
                    usePlayerLists(userEntries, quizId);
                  }
                }).catch(error => {
                  console.error(`[AMQ+] Error gathering player lists${logPrefix ? ' for ' + logPrefix : ''}:`, error);
                  if (isReRoll) {
                    sendSystemMessage("Failed to gather player lists, re-rolling without live data...");
                    fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
                  } else {
                    showError("Failed to gather player lists: " + error.message);
                  }
                });
              }
            } else if (isReRoll) {
              fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
            }
          } else if (isReRoll) {
            fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
          }
        } catch (e) {
          console.error("[AMQ+] Failed to check quiz for live node:", e);
          if (isReRoll) {
            fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
          }
        }
      } else if (isReRoll) {
        fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error checking quiz for live node:", error);
      if (isReRoll) {
        fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
      }
    }
  });
}

function checkQuizForLiveNode(quizId) {
  checkAndHandleLiveNode(quizId, { isReRoll: false });
}

function checkQuizForLiveNodeForReRoll(quizId, skipAutoReady, originalFireMainButtonEvent) {
  checkAndHandleLiveNode(quizId, { isReRoll: true, skipAutoReady, originalFireMainButtonEvent });
}

function handleManualAdd() {
  console.log("[AMQ+] Manual add button clicked");

  // Prompt for username
  const username = prompt("Enter player username:");
  if (!username || username.trim() === '' || username.trim() === '-') {
    if (username && username.trim() === '-') {
      sendSystemMessage("Cannot add user with username '-' (no list provided)");
    }
    return;
  }

  // Prompt for platform
  const platform = prompt("Enter platform (anilist or MAL):", "anilist");
  if (!platform) {
    return;
  }

  const platformLower = platform.toLowerCase();
  let normalizedPlatform = null;

  // Accept "anilist", "MAL", or "mal"
  if (platformLower === 'anilist') {
    normalizedPlatform = 'anilist';
  } else if (platformLower === 'mal' || platformLower === 'myanimelist') {
    normalizedPlatform = 'mal';
  } else {
    sendSystemMessage("Invalid platform. Please enter 'anilist' or 'MAL'");
    return;
  }

  // Check if user already exists
  if (cachedPlayerLists) {
    const existingUser = cachedPlayerLists.find(entry =>
      entry.username.toLowerCase() === username.trim().toLowerCase() &&
      entry.platform === normalizedPlatform
    );
    if (existingUser) {
      sendSystemMessage(`User ${username} (${normalizedPlatform}) already exists in the list.`);
      return;
    }
  }

  // Create a new player entry with defaults
  let newEntry = {
    id: `manual_${Date.now()}`,
    username: username.trim(),
    platform: normalizedPlatform,
    songPercentage: {
      random: false,
      value: 100,
      min: 0,
      max: 100
    },
    selectedLists: {
      completed: true,
      watching: false,
      planning: false,
      on_hold: false,
      dropped: false
    }
  };

  // Apply saved settings if they exist for this player
  newEntry = applyPlayerSettingsToEntry(newEntry);

  // Initialize cachedPlayerLists if it doesn't exist
  if (!cachedPlayerLists) {
    cachedPlayerLists = [];
  }

  // Add the new entry to cachedPlayerLists
  cachedPlayerLists.push(newEntry);

  // Save the initial settings to localStorage
  savePlayerSettingsForEntry(newEntry);

  // Update the UI
  updatePlayerListsConfigUI();

  sendSystemMessage(`Manually added ${username} (${normalizedPlatform})`);
  console.log("[AMQ+] Manually added player:", newEntry);
}

function handleManualRemove() {
  console.log("[AMQ+] Manual remove button clicked");

  if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
    sendSystemMessage("No players in the list to remove.");
    return;
  }

  // Prompt for username
  const username = prompt("Enter player username to remove:");
  if (!username || username.trim() === '') {
    return;
  }

  // Find and remove the user
  const initialLength = cachedPlayerLists.length;
  cachedPlayerLists = cachedPlayerLists.filter(entry =>
    entry.username.toLowerCase() !== username.trim().toLowerCase()
  );

  const removedCount = initialLength - cachedPlayerLists.length;

  if (removedCount === 0) {
    sendSystemMessage(`User ${username} not found in the list.`);
    return;
  }

  // Update the UI
  updatePlayerListsConfigUI();

  sendSystemMessage(`Removed ${removedCount} entry/entries for ${username}`);
  console.log("[AMQ+] Manually removed player:", username);
}

function handleManualSync() {
  console.log("[AMQ+] Manual sync button clicked");

  const syncBtn = $("#amqPlusSyncBtn");
  syncBtn.prop("disabled", true);
  syncBtn.css({
    "opacity": "0.5",
    "cursor": "not-allowed"
  });

  gatherPlayerLists().then(userEntries => {
    if (userEntries.length === 0) {
      syncBtn.prop("disabled", false);
      syncBtn.css({
        "opacity": "1",
        "cursor": "pointer"
      });
      sendSystemMessage("No player lists found in lobby.");
      return;
    }

    cachedPlayerLists = userEntries;
    updatePlayerListsConfigUI();
    applyRandomPreset();

    syncBtn.prop("disabled", false);
    syncBtn.css({
      "opacity": "1",
      "cursor": "pointer"
    });

    // Check for Kitsu platform or no-list entries and send warnings
    const hasKitsuOrNoList = userEntries.some(entry => {
      const username = entry.username ? entry.username.trim() : '';
      return entry.platform === 'kitsu' || username === '-' || username === '';
    });

    if (hasKitsuOrNoList) {
      userEntries.forEach((entry, idx) => {
        const username = entry.username ? entry.username.trim() : '';
        const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx}`;
        if (entry.platform === 'kitsu') {
          sendSystemMessage(`Warning: ${prefix} has a Kitsu list - Kitsu platform is not implemented yet`);
        } else if (username === '-' || username === '') {
          sendSystemMessage(`Warning: ${prefix} has no list provided - this will be ignored`);
        }
      });
    }

    // Filter out entries with no list (username === '-' or empty) from sync stats
    // This should already be filtered when gathering, but double-check for safety
    const validEntries = userEntries.filter(entry => {
      const username = entry.username ? entry.username.trim() : '';
      return username !== '' && username !== '-';
    });

    const listMessage = validEntries.map((entry, idx) => {
      const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx + 1}`;
      const statuses = [];
      if (entry.selectedLists?.completed) statuses.push('Completed');
      if (entry.selectedLists?.watching) statuses.push('Watching');
      if (entry.selectedLists?.planning) statuses.push('Planning');
      if (entry.selectedLists?.on_hold) statuses.push('On Hold');
      if (entry.selectedLists?.dropped) statuses.push('Dropped');
      return `${prefix}: ${entry.username} (${entry.platform}) - ${statuses.join(', ')}`;
    }).join(' | ');

    sendSystemMessage(`Synced ${validEntries.length} player list${validEntries.length !== 1 ? 's' : ''}: ${listMessage}`);
  }).catch(error => {
    console.error("[AMQ+] Error gathering player lists:", error);
    syncBtn.prop("disabled", false);
    syncBtn.css({
      "opacity": "1",
      "cursor": "pointer"
    });
    sendSystemMessage("Failed to gather player lists: " + error.message);
  });
}

function createPlayerEntryHTML(entry, idx) {
  const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx}`;
  const hasPercentage = entry.songPercentage !== null && entry.songPercentage !== undefined;
  const isRandom = hasPercentage && entry.songPercentage.random === true;
  const value = hasPercentage ? (isRandom ? null : entry.songPercentage.value) : null;
  const min = hasPercentage && isRandom ? entry.songPercentage.min : null;
  const max = hasPercentage && isRandom ? entry.songPercentage.max : null;

  const selectedLists = entry.selectedLists || {
    completed: true,
    watching: true,
    planning: false,
    on_hold: false,
    dropped: false
  };

  return `
            <div class="amqPlusPlayerEntry" data-entry-idx="${idx}" style="margin-bottom: 12px; padding: 10px; background-color: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-weight: bold; color: #fff; font-size: 13px;">${prefix}: ${entry.username} (${entry.platform})</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="btn btn-sm btn-danger amqPlusRemoveEntryBtn" data-entry-idx="${idx}" data-username="${entry.username}" style="background-color: #dc3545; border-color: #dc3545; color: #fff; padding: 2px 8px; font-size: 10px; line-height: 1.2;">
                            <i class="fa fa-times" style="margin-right: 2px;"></i>Remove
                        </button>
                        <div style="display: flex; align-items: center;">
                            <div class="customCheckbox" style="margin-right: 6px;">
                                <input type="checkbox" class="amqPlusUseRandom" id="amqPlusUseRandom${idx}" data-entry-idx="${idx}" ${isRandom ? 'checked' : ''}>
                                <label for="amqPlusUseRandom${idx}"><i class="fa fa-check" aria-hidden="true"></i></label>
                            </div>
                            <span style="font-size: 12px; color: #e2e8f0;">Random Range</span>
                        </div>
                    </div>
                </div>
                <div style="margin-bottom: 8px; padding: 8px; background-color: rgba(255,255,255,0.02); border-radius: 4px;">
                    <div style="font-size: 11px; color: #e2e8f0; margin-bottom: 4px;">List Statuses:</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <div class="customCheckbox" style="display: inline-block;">
                            <input type="checkbox" class="amqPlusListStatus" id="amqPlusListStatus${idx}_completed" data-entry-idx="${idx}" data-status="completed" ${selectedLists.completed ? 'checked' : ''}>
                            <label for="amqPlusListStatus${idx}_completed"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 11px; color: #e2e8f0; margin-right: 8px;">Completed</span>

                        <div class="customCheckbox" style="display: inline-block;">
                            <input type="checkbox" class="amqPlusListStatus" id="amqPlusListStatus${idx}_watching" data-entry-idx="${idx}" data-status="watching" ${selectedLists.watching ? 'checked' : ''}>
                            <label for="amqPlusListStatus${idx}_watching"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 11px; color: #e2e8f0; margin-right: 8px;">Watching</span>

                        <div class="customCheckbox" style="display: inline-block;">
                            <input type="checkbox" class="amqPlusListStatus" id="amqPlusListStatus${idx}_planning" data-entry-idx="${idx}" data-status="planning" ${selectedLists.planning ? 'checked' : ''}>
                            <label for="amqPlusListStatus${idx}_planning"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 11px; color: #e2e8f0; margin-right: 8px;">Planning</span>

                        <div class="customCheckbox" style="display: inline-block;">
                            <input type="checkbox" class="amqPlusListStatus" id="amqPlusListStatus${idx}_on_hold" data-entry-idx="${idx}" data-status="on_hold" ${selectedLists.on_hold ? 'checked' : ''}>
                            <label for="amqPlusListStatus${idx}_on_hold"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 11px; color: #e2e8f0; margin-right: 8px;">On Hold</span>

                        <div class="customCheckbox" style="display: inline-block;">
                            <input type="checkbox" class="amqPlusListStatus" id="amqPlusListStatus${idx}_dropped" data-entry-idx="${idx}" data-status="dropped" ${selectedLists.dropped ? 'checked' : ''}>
                            <label for="amqPlusListStatus${idx}_dropped"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 11px; color: #e2e8f0;">Dropped</span>
                    </div>
                </div>
                <div class="amqPlusPercentageControls" data-entry-idx="${idx}" style="display: flex; align-items: center; gap: 8px;">
                    ${isRandom ? `
                        <input type="number" class="form-control amqPlusPercentageMin" data-entry-idx="${idx}" value="${min || 0}" min="0" max="100" style="width: 80px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
                        <input type="range" class="amqPlusPercentageSliderMin" data-entry-idx="${idx}" value="${min || 0}" min="0" max="100" style="width: 120px; flex: 1;">
                        <span style="color: #e2e8f0;">-</span>
                        <input type="range" class="amqPlusPercentageSliderMax" data-entry-idx="${idx}" value="${max || 100}" min="0" max="100" style="width: 120px; flex: 1;">
                        <input type="number" class="form-control amqPlusPercentageMax" data-entry-idx="${idx}" value="${max || 100}" min="0" max="100" style="width: 80px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
                        <span style="color: #e2e8f0;">%</span>
                    ` : `
                        <input type="range" class="amqPlusPercentageSlider" data-entry-idx="${idx}" value="${value || 0}" min="0" max="100" style="width: 200px; flex: 1;">
                        <input type="number" class="form-control amqPlusPercentageValue" data-entry-idx="${idx}" value="${value || ''}" min="0" max="100" style="width: 100px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
                        <span style="color: #e2e8f0;">%</span>
                    `}
                </div>
            </div>
        `;
}

function updatePlayerListsConfigUI() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
    $("#amqPlusPlayerListsConfigContent").html('<div style="color: rgba(255,255,255,0.6); padding: 20px; text-align: center;"><div style="margin-bottom: 12px; padding: 10px; background-color: rgba(255, 193, 7, 0.2); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 4px; color: #ffc107; font-size: 12px;"><strong>Note:</strong> This feature will only work if the quiz has a Live Node in it.</div>No player lists fetched yet. Click "Sync Now" to gather player lists from the lobby.</div>');
    return;
  }

  $("#amqPlusPlayerListsConfig").show();

  const html = cachedPlayerLists.map((entry, idx) => createPlayerEntryHTML(entry, idx)).join('');

  // Add Manual Add button at the end of the list
  const manualAddButton = `
    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
      <button type="button" class="btn btn-sm btn-success" id="amqPlusManualAddBtnInline" style="background-color: #10b981; border-color: #10b981; color: #fff; padding: 6px 16px; font-size: 12px; width: 100%;">
        <i class="fa fa-plus" style="margin-right: 6px;"></i>Add Player Manually
      </button>
    </div>
  `;

  $("#amqPlusPlayerListsConfigContent").html(html + manualAddButton);

  // Attach remove entry button handlers
  $('.amqPlusRemoveEntryBtn').off('click').on('click', function () {
    const idx = $(this).data('entry-idx');
    const username = $(this).data('username');
    if (confirm(`Remove ${username} from the list?`)) {
      if (cachedPlayerLists && cachedPlayerLists[idx]) {
        cachedPlayerLists.splice(idx, 1);
        updatePlayerListsConfigUI();
        sendSystemMessage(`Removed ${username} from the list`);
      }
    }
  });

  // Attach inline Manual Add button handler
  $("#amqPlusManualAddBtnInline").off('click').on('click', function () {
    handleManualAdd();
  });

  $('.amqPlusUseRandom').off('change').on('change', function () {
    const idx = $(this).data('entry-idx');
    updatePercentageControls(idx);
    validatePercentages();
    // Save the random mode change to localStorage
    if (cachedPlayerLists && cachedPlayerLists[idx]) {
      const isRandom = $(this).is(':checked');
      cachedPlayerLists[idx].songPercentage = isRandom
        ? { random: true, min: 0, max: 100 }
        : { random: false, value: 0 };
      savePlayerSettingsForEntry(cachedPlayerLists[idx]);
    }
  });

  $('.amqPlusListStatus').off('change').on('change', function () {
    const idx = $(this).data('entry-idx');
    const status = $(this).data('status');
    const checked = $(this).is(':checked');

    if (cachedPlayerLists && cachedPlayerLists[idx]) {
      if (!cachedPlayerLists[idx].selectedLists) {
        cachedPlayerLists[idx].selectedLists = {};
      }
      cachedPlayerLists[idx].selectedLists[status] = checked;
      // Save settings to localStorage for this player
      savePlayerSettingsForEntry(cachedPlayerLists[idx]);
    }
  });

  attachPercentageHandlers();
  validatePercentages();
}

function attachPercentageHandlers() {
  // Helper function to save percentage settings for a player
  function savePercentageSettingsForIdx(idx) {
    if (!cachedPlayerLists || !cachedPlayerLists[idx]) return;

    const isRandom = $(`.amqPlusUseRandom[data-entry-idx="${idx}"]`).is(':checked');
    const entry = cachedPlayerLists[idx];

    if (isRandom) {
      const min = parseFloat($(`.amqPlusPercentageMin[data-entry-idx="${idx}"]`).val()) || 0;
      const max = parseFloat($(`.amqPlusPercentageMax[data-entry-idx="${idx}"]`).val()) || 100;
      entry.songPercentage = { random: true, min, max };
    } else {
      const value = $(`.amqPlusPercentageValue[data-entry-idx="${idx}"]`).val();
      if (value === '' || value === null) {
        entry.songPercentage = null;
      } else {
        entry.songPercentage = { random: false, value: parseFloat(value) || 0 };
      }
    }

    // Save to localStorage
    savePlayerSettingsForEntry(entry);
  }

  $('.amqPlusPercentageValue, .amqPlusPercentageMin, .amqPlusPercentageMax').off('input').on('input', function () {
    const idx = $(this).data('entry-idx');
    const val = parseFloat($(this).val()) || 0;
    if ($(this).hasClass('amqPlusPercentageValue')) {
      $(`.amqPlusPercentageSlider[data-entry-idx="${idx}"]`).val(val);
    } else if ($(this).hasClass('amqPlusPercentageMin')) {
      $(`.amqPlusPercentageSliderMin[data-entry-idx="${idx}"]`).val(val);
    } else if ($(this).hasClass('amqPlusPercentageMax')) {
      $(`.amqPlusPercentageSliderMax[data-entry-idx="${idx}"]`).val(val);
    }
    validatePercentages();
    // Save settings after a short debounce
    savePercentageSettingsForIdx(idx);
  });

  $('.amqPlusPercentageSlider, .amqPlusPercentageSliderMin, .amqPlusPercentageSliderMax').off('input').on('input', function () {
    const idx = $(this).data('entry-idx');
    const val = parseFloat($(this).val()) || 0;
    if ($(this).hasClass('amqPlusPercentageSlider')) {
      $(`.amqPlusPercentageValue[data-entry-idx="${idx}"]`).val(val);
    } else if ($(this).hasClass('amqPlusPercentageSliderMin')) {
      $(`.amqPlusPercentageMin[data-entry-idx="${idx}"]`).val(val);
    } else if ($(this).hasClass('amqPlusPercentageSliderMax')) {
      $(`.amqPlusPercentageMax[data-entry-idx="${idx}"]`).val(val);
    }
    validatePercentages();
    // Save settings after a short debounce
    savePercentageSettingsForIdx(idx);
  });
}

function updatePercentageControls(idx) {
  const isRandom = $(`.amqPlusUseRandom[data-entry-idx="${idx}"]`).is(':checked');
  const controls = $(`.amqPlusPercentageControls[data-entry-idx="${idx}"]`);

  if (isRandom) {
    const currentValue = parseFloat($(`.amqPlusPercentageValue[data-entry-idx="${idx}"]`).val()) || 0;
    controls.html(`
            <input type="number" class="form-control amqPlusPercentageMin" data-entry-idx="${idx}" value="0" min="0" max="100" style="width: 80px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
            <input type="range" class="amqPlusPercentageSliderMin" data-entry-idx="${idx}" value="0" min="0" max="100" style="width: 120px; flex: 1;">
            <span style="color: #e2e8f0;">-</span>
            <input type="range" class="amqPlusPercentageSliderMax" data-entry-idx="${idx}" value="100" min="0" max="100" style="width: 120px; flex: 1;">
            <input type="number" class="form-control amqPlusPercentageMax" data-entry-idx="${idx}" value="100" min="0" max="100" style="width: 80px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
            <span style="color: #e2e8f0;">%</span>
        `);
  } else {
    controls.html(`
            <input type="range" class="amqPlusPercentageSlider" data-entry-idx="${idx}" value="0" min="0" max="100" style="width: 200px; flex: 1;">
            <input type="number" class="form-control amqPlusPercentageValue" data-entry-idx="${idx}" value="" min="0" max="100" style="width: 100px; padding: 4px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
            <span style="color: #e2e8f0;">%</span>
        `);
  }

  attachPercentageHandlers();
}

function validatePercentages() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
    $("#amqPlusPercentageError").hide();
    return true;
  }

  const entries = [];
  let hasAnyPercentage = false;

  for (let i = 0; i < cachedPlayerLists.length; i++) {
    const isRandom = $(`.amqPlusUseRandom[data-entry-idx="${i}"]`).is(':checked');

    if (isRandom) {
      const min = parseFloat($(`.amqPlusPercentageMin[data-entry-idx="${i}"]`).val()) || 0;
      const max = parseFloat($(`.amqPlusPercentageMax[data-entry-idx="${i}"]`).val()) || 100;

      if (isNaN(min) || isNaN(max) || min < 0 || max > 100 || min > max) {
        $("#amqPlusPercentageError").show().text(`Invalid range for entry ${i + 1}: min must be <= max, and both must be 0-100`);
        return false;
      }

      entries.push({ min, max, isRange: true });
      hasAnyPercentage = true;
    } else {
      const value = $(`.amqPlusPercentageValue[data-entry-idx="${i}"]`).val();
      if (value !== '' && value !== null) {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0 || numValue > 100) {
          $("#amqPlusPercentageError").show().text(`Invalid percentage for entry ${i + 1}: must be 0-100`);
          return false;
        }
        entries.push({ value: numValue, isRange: false });
        hasAnyPercentage = true;
      }
    }
  }

  if (!hasAnyPercentage) {
    $("#amqPlusPercentageError").hide();
    return true;
  }

  const staticSum = entries.filter(e => !e.isRange).reduce((sum, e) => sum + e.value, 0);
  const rangeMins = entries.filter(e => e.isRange).map(e => e.min);
  const rangeMaxs = entries.filter(e => e.isRange).map(e => e.max);
  const minSum = rangeMins.reduce((sum, min) => sum + min, 0);
  const maxSum = rangeMaxs.reduce((sum, max) => sum + max, 0);

  if (entries.every(e => !e.isRange)) {
    if (Math.abs(staticSum - 100) > 0.01) {
      $("#amqPlusPercentageError").show().text(`Sum of percentages must equal 100% (currently ${staticSum.toFixed(1)}%)`);
      return false;
    }
  } else if (entries.every(e => e.isRange)) {
    if (minSum > 100 || maxSum < 100) {
      $("#amqPlusPercentageError").show().text(`Ranges must allow for a total of 100% (min sum: ${minSum}%, max sum: ${maxSum}%)`);
      return false;
    }
  } else {
    const totalMinPossible = staticSum + minSum;
    const totalMaxPossible = staticSum + maxSum;
    if (totalMinPossible > 100 || totalMaxPossible < 100) {
      $("#amqPlusPercentageError").show().text(`Combined percentages must allow for 100% (range: ${totalMinPossible.toFixed(1)}% - ${totalMaxPossible.toFixed(1)}%)`);
      return false;
    }
  }

  $("#amqPlusPercentageError").hide();
  return true;
}

function applyRandomPreset() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) return;

  const count = cachedPlayerLists.length;
  const perEntry = Math.floor(100 / count);
  const remainder = 100 % count;

  cachedPlayerLists.forEach((entry, idx) => {
    entry.songPercentage = {
      random: true,
      min: 0,
      max: 100
    };
    // Save settings to localStorage
    savePlayerSettingsForEntry(entry);
  });

  updatePlayerListsConfigUI();
}

function applyEqualPreset() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) return;

  const count = cachedPlayerLists.length;
  const perEntry = Math.floor(100 / count);
  const remainder = 100 % count;

  cachedPlayerLists.forEach((entry, idx) => {
    const value = perEntry + (idx < remainder ? 1 : 0);
    entry.songPercentage = {
      random: false,
      value: value
    };
    // Save settings to localStorage
    savePlayerSettingsForEntry(entry);
  });

  updatePlayerListsConfigUI();
}

function getConfiguredPlayerLists() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) return cachedPlayerLists;

  const configured = cachedPlayerLists.map((entry, idx) => {
    const isRandom = $(`.amqPlusUseRandom[data-entry-idx="${idx}"]`).is(':checked');

    const selectedLists = {
      completed: $(`.amqPlusListStatus[data-entry-idx="${idx}"][data-status="completed"]`).is(':checked'),
      watching: $(`.amqPlusListStatus[data-entry-idx="${idx}"][data-status="watching"]`).is(':checked'),
      planning: $(`.amqPlusListStatus[data-entry-idx="${idx}"][data-status="planning"]`).is(':checked'),
      on_hold: $(`.amqPlusListStatus[data-entry-idx="${idx}"][data-status="on_hold"]`).is(':checked'),
      dropped: $(`.amqPlusListStatus[data-entry-idx="${idx}"][data-status="dropped"]`).is(':checked')
    };

    if (isRandom) {
      const min = parseFloat($(`.amqPlusPercentageMin[data-entry-idx="${idx}"]`).val()) || 0;
      const max = parseFloat($(`.amqPlusPercentageMax[data-entry-idx="${idx}"]`).val()) || 100;
      return {
        ...entry,
        selectedLists: selectedLists,
        songPercentage: {
          random: true,
          min: min,
          max: max
        }
      };
    } else {
      const value = $(`.amqPlusPercentageValue[data-entry-idx="${idx}"]`).val();
      if (value === '' || value === null) {
        return {
          ...entry,
          selectedLists: selectedLists,
          songPercentage: null
        };
      }
      return {
        ...entry,
        selectedLists: selectedLists,
        songPercentage: {
          random: false,
          value: parseFloat(value) || 0
        }
      };
    }
  });

  return configured;
}

function usePlayerLists(userEntries, quizId) {
  const configuredEntries = userEntries === cachedPlayerLists ? getConfiguredPlayerLists() : userEntries;

  // Filter out entries with no list (username === '-' or empty) before sending to server
  // This prevents creating buckets for users whose lists failed to fetch
  const validEntriesForServer = configuredEntries.filter(entry => {
    const username = entry.username ? entry.username.trim() : '';
    return username !== '' && username !== '-';
  });

  const liveNodeData = {
    useEntirePool: false,
    userEntries: validEntriesForServer,
    songSelectionMode: liveNodeSongSelectionMode
  };

  // Check for Kitsu platform or no-list entries and send warnings
  const hasKitsuOrNoList = configuredEntries.some(entry => {
    const username = entry.username ? entry.username.trim() : '';
    return entry.platform === 'kitsu' || username === '-' || username === '';
  });

  if (hasKitsuOrNoList) {
    configuredEntries.forEach((entry, idx) => {
      const username = entry.username ? entry.username.trim() : '';
      const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx + 1}`;
      if (entry.platform === 'kitsu') {
        sendSystemMessage(`Warning: ${prefix} has a Kitsu list - Kitsu platform is not implemented yet`);
      } else if (username === '-' || username === '') {
        sendSystemMessage(`Warning: ${prefix} has no list provided - this will be ignored`);
      }
    });
  }

  // Filter out entries with no list (username === '-' or empty) from sync stats
  const validEntries = configuredEntries.filter(entry => {
    const username = entry.username ? entry.username.trim() : '';
    return username !== '' && username !== '-';
  });

  const listMessage = validEntries.map((entry, idx) => {
    const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx + 1}`;
    const statuses = [];
    if (entry.selectedLists?.completed) statuses.push('Completed');
    if (entry.selectedLists?.watching) statuses.push('Watching');
    if (entry.selectedLists?.planning) statuses.push('Planning');
    if (entry.selectedLists?.on_hold) statuses.push('On Hold');
    if (entry.selectedLists?.dropped) statuses.push('Dropped');
    const statusStr = statuses.length > 0 ? ` [${statuses.join(', ')}]` : '';
    const percentageStr = entry.songPercentage ?
      (entry.songPercentage.random ?
        `(${entry.songPercentage.min}-${entry.songPercentage.max}%)` :
        `(${entry.songPercentage.value}%)`) :
      '';
    return `${prefix}: ${entry.username} (${entry.platform})${statusStr}${percentageStr}`;
  }).join(' | ');

  sendSystemMessage(`Synced ${validEntries.length} player list${validEntries.length !== 1 ? 's' : ''}: ${listMessage}`);

  console.log("[AMQ+] Sending player lists to quiz");
  fetchQuiz(quizId, liveNodeData);
}

function fetchQuiz(quizId, liveNodeData = null) {
  return new Promise((resolve, reject) => {
    console.log("[AMQ+] Fetching quiz data for ID:", quizId);
    $("#amqPlusError").hide();
    $("#amqPlusFetchBtn").prop("disabled", true);

    updateModalStatus("Fetching quiz from AMQ+...");

    const apiUrl = `${API_BASE_URL}/play/${quizId}`;
    console.log("[AMQ+] API URL:", apiUrl);

    const requestConfig = {
      method: liveNodeData ? "POST" : "GET",
      url: apiUrl,
      onload: function (response) {
        console.log("[AMQ+] Server response status:", response.status);
        console.log("[AMQ+] Server response text:", response.responseText);

        $("#amqPlusFetchBtn").prop("disabled", false);

        if (response.status === 200) {
          try {
            const data = JSON.parse(response.responseText);
            console.log("[AMQ+] Parsed quiz data:", data);

            if (data.success === false) {
              const errorMessage = data.userMessage || data.message || "Unknown error occurred";
              console.error("[AMQ+] API returned error:", errorMessage);
              showError(errorMessage);
              return;
            }

            handleQuizData(data, quizId);
            resolve(data);
          } catch (e) {
            console.error("[AMQ+] Failed to parse quiz data:", e);
            $("#amqPlusFetchBtn").prop("disabled", false);
            showError("Failed to parse quiz data: " + e.message);
            reject(e);
          }
        } else if (response.status === 422 || response.status === 400) {
          try {
            const errorData = JSON.parse(response.responseText);
            const errorMessage = errorData.userMessage || errorData.message || `Failed to fetch quiz: ${response.status} ${response.statusText}`;
            console.error("[AMQ+] API error response:", errorMessage);
            $("#amqPlusFetchBtn").prop("disabled", false);
            showError(errorMessage);
            reject(new Error(errorMessage));
          } catch (e) {
            console.error("[AMQ+] Server error:", response.status, response.statusText);
            $("#amqPlusFetchBtn").prop("disabled", false);
            showError(`Failed to fetch quiz: ${response.status} ${response.statusText}`);
            reject(new Error(`Failed to fetch quiz: ${response.status}`));
          }
        } else {
          console.error("[AMQ+] Server error:", response.status, response.statusText);
          $("#amqPlusFetchBtn").prop("disabled", false);
          showError(`Failed to fetch quiz: ${response.status} ${response.statusText}`);
          reject(new Error(`Failed to fetch quiz: ${response.status}`));
        }
      },
      onerror: function (error) {
        console.error("[AMQ+] Network error during fetch:", error);
        $("#amqPlusFetchBtn").prop("disabled", false);
        showError("Network error. Make sure AMQ+ server is running.");
        reject(error);
      }
    };

    if (liveNodeData) {
      requestConfig.headers = {
        "Content-Type": "application/json"
      };
      requestConfig.data = JSON.stringify({ liveNodeData: liveNodeData });
    }

    GM_xmlhttpRequest(requestConfig);
  });
}

function handleQuizData(data, quizId) {
  console.log("[AMQ+] Handling quiz data for quiz ID:", quizId);
  currentQuizData = data;
  currentQuizId = quizId;

  // Log the full command received from server
  console.log("[AMQ+] Full command received from server:", JSON.stringify(data.command, null, 2));

  const quizSave = data.command.data.quizSave;
  const ruleBlock = quizSave.ruleBlocks[0];
  const songCount = ruleBlock.songCount;
  const guessTime = ruleBlock.guessTime.guessTime;
  const extraGuessTime = ruleBlock.guessTime.extraGuessTime;
  const sampleRange = ruleBlock.samplePoint.samplePoint;
  const playbackSpeed = ruleBlock.playBackSpeed.playBackSpeed;

  const quizTitle = quizSave.name.startsWith("AMQ+ ")
    ? quizSave.name.substring(5)
    : quizSave.name;

  console.log("[AMQ+] Quiz title:", quizTitle);
  console.log("[AMQ+] Number of songs:", songCount);
  console.log("[AMQ+] Quiz settings:", { guessTime, extraGuessTime, sampleRange, playbackSpeed });

  // Build song source map from quiz data if source metadata is available
  buildSongSourceMap(data, quizSave);

  if (songCount === 0) {
    console.error("[AMQ+] Quiz has 0 songs, cannot save");
    updateModalStatus(null);
    showError("Cannot save quiz: The quiz has 0 songs. AMQ requires at least 1 song to save a quiz.");
    $("#amqPlusFetchBtn").prop("disabled", false);
    return;
  }

  updateModalStatus("Saving quiz to AMQ...");

  $("#amqPlusUrlInput").prop("disabled", true);
  $("#amqPlusFetchBtn").hide();
  $("#amqPlusChangeLinkBtn").show();

  console.log("[AMQ+] UI updated, now creating/updating quiz...");
  createOrUpdateQuiz(data);
}

function buildSongSourceMap(data, quizSave) {
  songSourceMap = new Map();
  currentSongNumber = 0;

  // Extract annSongIds from quizSave blocks to filter songSourceMap
  const quizAnnSongIds = new Set();
  if (quizSave && quizSave.ruleBlocks && Array.isArray(quizSave.ruleBlocks)) {
    quizSave.ruleBlocks.forEach(ruleBlock => {
      if (ruleBlock.blocks && Array.isArray(ruleBlock.blocks)) {
        ruleBlock.blocks.forEach(block => {
          if (block.annSongId) {
            quizAnnSongIds.add(block.annSongId);
          }
        });
      }
    });
  }

  // Check if we have songSourceMap directly from the API response (preferred)
  if (data.songSourceMap && Array.isArray(data.songSourceMap)) {
    console.log("[AMQ+] Building song source map from API songSourceMap");

    // Create a map of annSongId to source info, filtered to only include songs in the quiz
    let filteredCount = 0;
    data.songSourceMap.forEach(entry => {
      if (entry.annSongId) {
        // Only add if song is in the quiz (or if quiz blocks aren't available yet)
        if (quizAnnSongIds.size === 0 || quizAnnSongIds.has(entry.annSongId)) {
          songSourceMap.set(entry.annSongId, {
            sourceInfo: entry.sourceInfo || 'Unknown source',
            nodeId: entry.nodeId,
            username: entry.username
          });
        } else {
          filteredCount++;
        }
      }
    });
    if (filteredCount > 0) {
      console.log(`[AMQ+] Filtered out ${filteredCount} songSourceMap entries not in quiz (${quizAnnSongIds.size} songs in quiz)`);
    }
  } else if (data.songsBySource && Array.isArray(data.songsBySource)) {
    // Fallback: build from songsBySource if songSourceMap not available
    console.log("[AMQ+] Building song source map from songsBySource (fallback)");

    // Create a map of annSongId to source info
    data.songsBySource.forEach(source => {
      if (source.songs && Array.isArray(source.songs)) {
        source.songs.forEach(song => {
          if (song.annSongId) {
            songSourceMap.set(song.annSongId, {
              sourceInfo: source.listInfo || 'Unknown source',
              nodeId: source.nodeId,
              username: extractUsernameFromSourceInfo(source.listInfo)
            });
          }
        });
      }
    });
  } else if (cachedPlayerLists && cachedPlayerLists.length > 0) {
    // Try to match songs to players by checking quiz save blocks
    console.log("[AMQ+] Attempting to match songs to player lists");
    const ruleBlock = quizSave.ruleBlocks && quizSave.ruleBlocks[0];
    if (ruleBlock && ruleBlock.blocks && Array.isArray(ruleBlock.blocks)) {
      ruleBlock.blocks.forEach((block, index) => {
        if (block.annSongId) {
          // Default to "Random" if we can't determine source
          songSourceMap.set(block.annSongId, {
            sourceInfo: 'Random',
            nodeId: null,
            username: null
          });
        }
      });
    }
  }

  console.log("[AMQ+] Built song source map with", songSourceMap.size, "entries");
}

function extractUsernameFromSourceInfo(sourceInfo) {
  if (!sourceInfo) return null;

  // Extract username from patterns like "Live Node - PlayerName" or "Batch User List - PlayerName"
  // Match everything after "- " until end of string or opening parenthesis
  const match = sourceInfo.match(/- ([^\(]+?)(?:\s*\(|$)/);
  if (match) {
    return match[1].trim();
  }

  // Try pattern like "Saved list: Grupowa Wishlista" or "User list: username"
  // Match everything after ": " until end of string
  const match2 = sourceInfo.match(/:\s*(.+)$/);
  if (match2) {
    return match2[1].trim();
  }

  return null;
}

function formatSourceInfo(sourceInfo) {
  if (!sourceInfo) return { icon: '❓', text: 'Unknown source', nodeId: null };

  // Only treat as Random if the sourceInfo text itself indicates it's random
  if (sourceInfo.sourceInfo === 'Random' || sourceInfo.sourceInfo === 'Unknown source') {
    return { icon: '🎲', text: 'Random', nodeId: sourceInfo.nodeId || null };
  }

  // Transform source info to show player name
  let displayText = sourceInfo.sourceInfo || sourceInfo.username || 'Unknown';

  // Transform "Live Node - PlayerName" to "from list - PlayerName"
  if (displayText.includes('Live Node - ')) {
    const playerName = displayText.replace(/Live Node - /, '');
    displayText = `from list - ${playerName}`;
  } else if (sourceInfo.username) {
    // If we have a username but no formatted sourceInfo, use it
    displayText = `from list - ${sourceInfo.username}`;
  }

  return {
    icon: '👤',
    text: displayText,
    fullInfo: sourceInfo.sourceInfo || displayText,
    nodeId: sourceInfo.nodeId || null
  };
}

function displayAllSongSources(quizSave) {
  if (!songSourceMap || songSourceMap.size === 0) {
    console.log("[AMQ+] No song source map available to display");
    return;
  }

  if (!songSourceMessagesEnabled) {
    console.log("[AMQ+] Song source messages disabled, skipping display");
    return;
  }

  const ruleBlock = quizSave?.ruleBlocks?.[0];
  if (!ruleBlock || !ruleBlock.blocks || !Array.isArray(ruleBlock.blocks)) {
    console.log("[AMQ+] No quiz blocks found to display sources");
    return;
  }

  console.log("[AMQ+] Displaying source info for all songs in quiz...");

  const sourceMessages = [];
  ruleBlock.blocks.forEach((block, index) => {
    if (block.annSongId && songSourceMap.has(block.annSongId)) {
      const sourceInfo = songSourceMap.get(block.annSongId);
      const formatted = formatSourceInfo(sourceInfo);
      const songNumber = index + 1;

      sourceMessages.push(`Song ${songNumber}: ${formatted.icon} ${formatted.text}`);
    } else if (block.annSongId) {
      const songNumber = index + 1;
      sourceMessages.push(`Song ${songNumber}: 🎲 Random`);
    }
  });

  if (sourceMessages.length > 0) {
    console.log("[AMQ+] Song sources:", sourceMessages);

    // Send messages in batches to avoid flooding chat
    const batchSize = 5;
    for (let i = 0; i < sourceMessages.length; i += batchSize) {
      const batch = sourceMessages.slice(i, i + batchSize);
      setTimeout(() => {
        batch.forEach(msg => {
          sendSystemMessage(msg);
        });
      }, i * 200);
    }
  } else {
    console.log("[AMQ+] No songs with source info found");
  }
}

function updateModalStatus(status, nextActions) {
  const spinnerEl = $("#amqPlusLoadingSpinner");
  const statusMessageEl = $("#amqPlusStatusMessage");

  if (status) {
    let message = status;
    if (nextActions) {
      message += ` - ${nextActions}`;
    }
    statusMessageEl.text(message);
    spinnerEl.show();
  } else {
    spinnerEl.hide();
  }
}

function showError(message) {
  console.error("[AMQ+] Error:", message);
  updateModalStatus(null);
  $("#amqPlusError").text(message).show();
}

function createOrUpdateQuiz(data) {
  const quizTitle = data.command.data.quizSave.name.startsWith("AMQ+ ")
    ? data.command.data.quizSave.name.substring(5)
    : data.command.data.quizSave.name;
  console.log("[AMQ+] Creating or updating quiz with title:", quizTitle);

  // Log the full command received from server
  console.log("[AMQ+] Full command received from server:", JSON.stringify(data.command, null, 2));

  pendingQuizData = data;

  console.log("[AMQ+] Requesting quiz list from server...");
  isWaitingForQuizList = true;
  quizListAttempts = 0;
  requestQuizList();
}

function requestQuizList() {
  quizListAttempts++;
  console.log("[AMQ+] Sending quiz list request, attempt:", quizListAttempts);
  socket.sendCommand({
    command: "load builder quizzes",
    type: "quizCreator"
  });

  if (quizListAttempts < 5) {
    setTimeout(() => {
      if (isWaitingForQuizList) {
        console.log("[AMQ+] No response received, retrying...");
        requestQuizList();
      }
    }, 2000);
  } else {
    isWaitingForQuizList = false;
    console.error("[AMQ+] Failed to get quiz list after 5 attempts");
    showError("Failed to load quiz list after multiple attempts");
  }
}

function handleQuizListResponse(payload) {
  console.log("[AMQ+] Received quiz list response:", payload);

  if (!isWaitingForQuizList) {
    console.log("[AMQ+] Ignoring quiz list response (not waiting)");
    return;
  }

  isWaitingForQuizList = false;
  const quizzes = payload.data?.quizzes || payload.quizzes || [];

  console.log("[AMQ+] Total quizzes in list:", quizzes.length);
  console.log("[AMQ+] Quiz names:", quizzes.map(q => q.name));

  // Find existing quiz by exact name match
  // Training quizzes now use standard "AMQ+ " prefix format
  const quizName = pendingQuizData?.command?.data?.quizSave?.name;
  let existingQuiz = null;
  if (quizName) {
    existingQuiz = quizzes.find(q => q.name === quizName);
  }

  if (existingQuiz) {
    console.log("[AMQ+] Found existing quiz:", existingQuiz.name, "ID:", existingQuiz.customQuizId);
    saveQuiz(pendingQuizData, existingQuiz.customQuizId);
  } else {
    console.log("[AMQ+] No existing quiz found, creating new one");
    saveQuiz(pendingQuizData, null);
  }

  pendingQuizData = null;
}

function saveQuiz(data, quizId) {
  console.log("[AMQ+] Saving quiz, existing quiz ID:", quizId);
  console.log("[AMQ+] Using pre-formatted command from server");

  const command = JSON.parse(JSON.stringify(data.command));
  const quizName = command.data.quizSave.name;

  if (quizId !== null) {
    command.data.quizId = quizId;
    console.log("[AMQ+] Updating existing quiz with ID:", quizId);
  } else {
    console.log("[AMQ+] Creating new quiz (quizId: null)");
  }

  console.log("[AMQ+] Quiz name:", quizName);
  console.log("[AMQ+] Song blocks count:", command.data.quizSave.ruleBlocks[0].blocks.length);
  console.log("[AMQ+] Full command to send to AMQ:", JSON.stringify(command, null, 2));

  // Temporarily unbind AMQ's quiz save listener to prevent errors when quiz creator UI isn't open
  // AMQ's customQuizCreator.quizSaveListener tries to access modal data that doesn't exist
  // when we save directly without opening the quiz creator UI
  let amqListenerUnbound = false;
  try {
    if (typeof customQuizCreator !== 'undefined' && customQuizCreator.quizSaveListener) {
      customQuizCreator.quizSaveListener.unbindListener();
      amqListenerUnbound = true;
      console.log("[AMQ+] Temporarily unbound AMQ quiz save listener");
    }
  } catch (e) {
    console.warn("[AMQ+] Could not unbind AMQ quiz save listener:", e);
  }

  socket.sendCommand(command);

  console.log("[AMQ+] Save quiz command sent");

  // Rebind AMQ's listener after a short delay to allow our listener to handle the response first
  if (amqListenerUnbound) {
    setTimeout(() => {
      try {
        if (typeof customQuizCreator !== 'undefined' && customQuizCreator.quizSaveListener) {
          customQuizCreator.quizSaveListener.bindListener();
          console.log("[AMQ+] Rebound AMQ quiz save listener");
        }
      } catch (e) {
        console.warn("[AMQ+] Could not rebind AMQ quiz save listener:", e);
      }
    }, 2000);
  }
}

function applyQuizToLobby(quizId, quizName) {
  console.log("[AMQ+] Applying quiz to lobby, quiz ID:", quizId, "quiz name:", quizName);

  console.log("[AMQ+] Sending community mode command...");
  const communityModeCommand = {
    type: "lobby",
    command: "change game settings",
    data: {
      settingChanges: {},
      communityMode: true
    }
  };
  console.log("[AMQ+] Full community mode command:", JSON.stringify(communityModeCommand, null, 2));
  socket.sendCommand(communityModeCommand);

  setTimeout(() => {
    console.log("[AMQ+] Sending select custom quiz command, quiz ID:", quizId);
    const selectQuizCommand = {
      command: "select custom quiz",
      type: "lobby",
      data: {
        quizId: quizId
      }
    };
    console.log("[AMQ+] Full select quiz command:", JSON.stringify(selectQuizCommand, null, 2));
    socket.sendCommand(selectQuizCommand);

    updateModalStatus("Quiz applied - Click 'Start' button to begin");
    console.log("[AMQ+] Quiz applied");
    setTimeout(() => {
      $("#amqPlusModal").modal("hide");
    }, 100);
  }, 500);
}

// Valid list statuses for player list commands
const VALID_LIST_STATUSES = ['completed', 'watching', 'planning', 'on-hold', 'dropped', 'paused'];
const STATUS_ALIASES = {
  'complete': 'completed',
  'watch': 'watching',
  'plan': 'planning',
  'onhold': 'on-hold',
  'on_hold': 'on-hold',
  'drop': 'dropped',
  'pause': 'paused',
  'paused': 'on-hold' // Map paused to on-hold since that's the actual status name
};

// Map display names to internal status keys
const STATUS_TO_KEY = {
  'completed': 'completed',
  'watching': 'watching',
  'planning': 'planning',
  'on-hold': 'on_hold',
  'dropped': 'dropped'
};

/**
 * Handle player list management commands from any player
 * Commands can be sent by any player, but only the host processes them and responds
 */
function handlePlayerListCommand(message, sender) {
  // Don't process if not a command
  if (!message.startsWith('/')) {
    return;
  }

  const msgLower = message.toLowerCase().trim();

  // Check if it's a list management command
  if (!msgLower.startsWith('/add') && !msgLower.startsWith('/remove') &&
    !msgLower.startsWith('/list') && !msgLower.startsWith('/listhelp')) {
    return;
  }

  // Only the host processes commands and responds
  // Other players can send commands (they appear in chat), but only host's client processes them
  if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
    return;
  }

  console.log(`[AMQ+] Processing list command from ${sender}: ${message}`);

  const parts = message.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).map(arg => arg.toLowerCase());

  // Check if Live Node is configured
  const isLiveNodeConfigured = cachedPlayerLists && cachedPlayerLists.length > 0;

  // Handle different commands
  if (command === '/listhelp') {
    handleListHelpCommand(sender, isLiveNodeConfigured);
  } else if (command === '/list') {
    handleListShowCommand(sender, isLiveNodeConfigured);
  } else if (command === '/add') {
    handleListAddCommand(sender, args, isLiveNodeConfigured);
  } else if (command === '/remove') {
    handleListRemoveCommand(sender, args, isLiveNodeConfigured);
  }
}

/**
 * Show help information for list commands
 */
function handleListHelpCommand(sender, isLiveNodeConfigured) {
  const helpMessages = [
    `@${sender}: Player List Commands Help`,
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "/ add [status...] - Add list statuses",
    "/ remove [status...] - Remove list statuses",
    "/ list - Show your enabled lists",
    "/ listhelp - Show this help",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "Valid statuses: completed, watching, planning, on-hold, dropped",
    "Example: / add completed watching",
    "Example: / remove dropped"
  ];

  if (!isLiveNodeConfigured) {
    helpMessages.push("━━━━━━━━━━━━━━━━━━━━━━━━");
    helpMessages.push("⚠️ Note: Live Node is not configured yet. Host needs to sync player lists first.");
  }

  helpMessages.forEach((msg, index) => {
    setTimeout(() => sendGlobalChatMessage(msg), 100 * index);
  });
}

/**
 * Show current enabled lists for a player
 */
function handleListShowCommand(sender, isLiveNodeConfigured) {
  if (!isLiveNodeConfigured) {
    sendGlobalChatMessage(`@${sender}: ⚠️ Live Node is not configured yet. Host needs to sync player lists first. Use /listhelp for more info.`);
    return;
  }

  const playerEntry = findPlayerInCache(sender);

  if (!playerEntry) {
    sendGlobalChatMessage(`@${sender}: You are not in the current Live Node configuration. Ask the host to sync or add you manually.`);
    return;
  }

  const enabledLists = [];
  if (playerEntry.selectedLists) {
    if (playerEntry.selectedLists.completed) enabledLists.push('Completed');
    if (playerEntry.selectedLists.watching) enabledLists.push('Watching');
    if (playerEntry.selectedLists.planning) enabledLists.push('Planning');
    if (playerEntry.selectedLists.on_hold) enabledLists.push('On-Hold');
    if (playerEntry.selectedLists.dropped) enabledLists.push('Dropped');
  }

  if (enabledLists.length === 0) {
    sendGlobalChatMessage(`@${sender}: No lists enabled (songs will be selected from entire pool)`);
  } else {
    sendGlobalChatMessage(`@${sender}: Enabled lists: ${enabledLists.join(', ')}`);
  }
}

/**
 * Add list statuses for a player
 */
function handleListAddCommand(sender, args, isLiveNodeConfigured) {
  if (args.length === 0) {
    sendGlobalChatMessage(`@${sender}: Usage: /add [status...]. Valid: completed, watching, planning, on-hold, dropped. Use /listhelp for more info.`);
    return;
  }

  if (!isLiveNodeConfigured) {
    sendGlobalChatMessage(`@${sender}: ⚠️ Live Node is not configured yet. Host needs to sync player lists first. Use /listhelp for more info.`);
    return;
  }

  const playerEntry = findPlayerInCache(sender);

  if (!playerEntry) {
    sendGlobalChatMessage(`@${sender}: You are not in the current Live Node configuration. Ask the host to sync or add you manually.`);
    return;
  }

  const { validStatuses, invalidStatuses } = parseStatuses(args);

  if (invalidStatuses.length > 0) {
    sendGlobalChatMessage(`@${sender}: Invalid status(es): ${invalidStatuses.join(', ')}. Valid: completed, watching, planning, on-hold, dropped`);
    return;
  }

  if (validStatuses.length === 0) {
    sendGlobalChatMessage(`@${sender}: No valid statuses provided. Use /listhelp for more info.`);
    return;
  }

  // Add the statuses
  const addedStatuses = [];
  validStatuses.forEach(status => {
    const key = STATUS_TO_KEY[status];
    if (!playerEntry.selectedLists[key]) {
      playerEntry.selectedLists[key] = true;
      addedStatuses.push(capitalizeFirst(status.replace('-', '-')));
    }
  });

  if (addedStatuses.length === 0) {
    sendGlobalChatMessage(`@${sender}: All specified lists were already enabled.`);
  } else {
    sendGlobalChatMessage(`@${sender}: Added lists: ${addedStatuses.join(', ')}`);
    // Save settings to localStorage
    savePlayerSettingsForEntry(playerEntry);
    updatePlayerListsConfigUI();
  }
}

/**
 * Remove list statuses for a player
 */
function handleListRemoveCommand(sender, args, isLiveNodeConfigured) {
  if (args.length === 0) {
    sendGlobalChatMessage(`@${sender}: Usage: /remove [status...]. Valid: completed, watching, planning, on-hold, dropped. Use /listhelp for more info.`);
    return;
  }

  if (!isLiveNodeConfigured) {
    sendGlobalChatMessage(`@${sender}: ⚠️ Live Node is not configured yet. Host needs to sync player lists first. Use /listhelp for more info.`);
    return;
  }

  const playerEntry = findPlayerInCache(sender);

  if (!playerEntry) {
    sendGlobalChatMessage(`@${sender}: You are not in the current Live Node configuration. Ask the host to sync or add you manually.`);
    return;
  }

  const { validStatuses, invalidStatuses } = parseStatuses(args);

  if (invalidStatuses.length > 0) {
    sendGlobalChatMessage(`@${sender}: Invalid status(es): ${invalidStatuses.join(', ')}. Valid: completed, watching, planning, on-hold, dropped`);
    return;
  }

  if (validStatuses.length === 0) {
    sendGlobalChatMessage(`@${sender}: No valid statuses provided. Use /listhelp for more info.`);
    return;
  }

  // Remove the statuses
  const removedStatuses = [];
  validStatuses.forEach(status => {
    const key = STATUS_TO_KEY[status];
    if (playerEntry.selectedLists[key]) {
      playerEntry.selectedLists[key] = false;
      removedStatuses.push(capitalizeFirst(status.replace('-', '-')));
    }
  });

  if (removedStatuses.length === 0) {
    sendGlobalChatMessage(`@${sender}: All specified lists were already disabled.`);
  } else {
    sendGlobalChatMessage(`@${sender}: Removed lists: ${removedStatuses.join(', ')}`);
    // Save settings to localStorage
    savePlayerSettingsForEntry(playerEntry);
    updatePlayerListsConfigUI();
  }
}

/**
 * Find a player in the cached player lists by name
 */
function findPlayerInCache(playerName) {
  if (!cachedPlayerLists) return null;

  // Try to find by exact username match
  let player = cachedPlayerLists.find(entry => entry.username === playerName);

  // If not found and playerName is selfName, try to find by id containing 'self'
  if (!player && playerName === selfName) {
    player = cachedPlayerLists.find(entry => entry.id && entry.id.includes('self'));
  }

  return player;
}

/**
 * Parse and validate status arguments
 */
function parseStatuses(args) {
  const validStatuses = [];
  const invalidStatuses = [];

  args.forEach(arg => {
    const normalized = arg.toLowerCase().trim();

    // Check if it's already a valid status
    if (VALID_LIST_STATUSES.includes(normalized)) {
      const finalStatus = normalized === 'paused' ? 'on-hold' : normalized;
      if (!validStatuses.includes(finalStatus)) {
        validStatuses.push(finalStatus);
      }
    }
    // Check if it's an alias
    else if (STATUS_ALIASES[normalized]) {
      const finalStatus = STATUS_ALIASES[normalized];
      if (!validStatuses.includes(finalStatus)) {
        validStatuses.push(finalStatus);
      }
    }
    // Invalid status
    else {
      invalidStatuses.push(arg);
    }
  });

  return { validStatuses, invalidStatuses };
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function handleChatCommand(msg) {
  console.log("[AMQ+] Chat message from self:", msg);

  if (!msg.startsWith("/amqplus")) {
    // Also check for player list commands from self
    handlePlayerListCommand(msg, selfName);
    return;
  }

  console.log("[AMQ+] AMQ+ command detected");
  const parts = msg.split(" ");

  if (parts[1] === "toggle") {
    console.log("[AMQ+] Toggle command received");
    amqPlusEnabled = !amqPlusEnabled;
    saveSettings();
    updateToggleButton();
    sendSystemMessage("AMQ+ mode " + (amqPlusEnabled ? "enabled" : "disabled"));
  } else if (parts[1] === "reload" && currentQuizId) {
    console.log("[AMQ+] Reload command received, quiz ID:", currentQuizId);
    fetchQuiz(currentQuizId);
  } else if (parts[1] === "sync") {
    console.log("[AMQ+] Sync command received");
    handleSyncCommand();
  } else if (parts[1] === "info" || parts[1] === "metadata") {
    console.log("[AMQ+] Info/Metadata command received");
    handleMetadataCommand();
  } else if (parts[1] === "sources") {
    console.log("[AMQ+] Sources command received");
    songSourceMessagesEnabled = !songSourceMessagesEnabled;
    saveSettings();
    sendSystemMessage("Song source messages " + (songSourceMessagesEnabled ? "enabled" : "disabled"));
  } else if (parts.length > 1) {
    const url = parts.slice(1).join(" ");
    console.log("[AMQ+] URL command received:", url);
    const quizId = extractQuizIdFromUrl(url);
    if (quizId) {
      fetchQuiz(quizId);
    } else {
      sendSystemMessage("Invalid AMQ+ URL");
    }
  }
}

function setupListeners() {
  console.log("[AMQ+] Setting up event listeners...");

  new Listener("load custom quiz", (payload) => {
    console.log("[AMQ+] Load custom quiz event received:", payload);
    const quizId = payload.quizId || payload.data?.quizId;
    const quizSave = payload.quizSave || payload.data?.quizSave;

    if (quizId !== undefined && quizSave !== undefined) {
      lastLoadedQuizId = quizId;
      lastLoadedQuizSave = quizSave;
      console.log("[AMQ+] Stored quiz data for export - Quiz ID:", lastLoadedQuizId);
      updateExportButtonVisibility();

      // Try to rebuild song source map if this is an AMQ+ quiz
      if (quizSave.name && quizSave.name.startsWith("AMQ+") && currentQuizId) {
        console.log("[AMQ+] AMQ+ quiz loaded, attempting to rebuild song source map");
        // Fetch fresh data to get source information
        fetchQuiz(currentQuizId).then(data => {
          if (data) {
            buildSongSourceMap(data, quizSave);
            // Display source info for all songs
            displayAllSongSources(quizSave);
          }
        }).catch(err => {
          console.error("[AMQ+] Failed to rebuild song source map:", err);
        });
      }
    }
  }).bindListener();

  new Listener("quiz display custom quiz", (payload) => {
    console.log("[AMQ+] Quiz display custom quiz event received:", payload);
    const quizDesc = payload.data?.quizDescription || payload.quizDescription;
    if (quizDesc) {
      console.log("[AMQ+] Quiz description object:", quizDesc);
      console.log("[AMQ+] Quiz name:", quizDesc.name);
      console.log("[AMQ+] Quiz description:", quizDesc.description);
      console.log("[AMQ+] Quiz creatorName:", quizDesc.creatorName);

      if (quizDesc.name && quizDesc.name.startsWith("AMQ+")) {
        const cleanName = quizDesc.name.startsWith("AMQ+ ") ? quizDesc.name.substring(5) : quizDesc.name;
        currentQuizInfo = {
          name: cleanName,
          description: quizDesc.description || null,
          creatorUsername: quizDesc.creatorName || null
        };
        console.log("[AMQ+] Stored quiz info for AMQ+ quiz:", currentQuizInfo);
      } else {
        console.log("[AMQ+] Quiz name does not start with 'AMQ+', not storing quiz info. Name:", quizDesc.name);
        currentQuizInfo = null;
      }
    } else {
      console.warn("[AMQ+] No quiz description found in payload");
      currentQuizInfo = null;
    }
  }).bindListener();

  new Listener("quiz end result", (payload) => {
    console.log("[AMQ+] Quiz end result event received:", payload);
    console.log("[AMQ+] Current quiz info:", currentQuizInfo);
    console.log("[AMQ+] Selected custom quiz name:", selectedCustomQuizName);

    let quizInfoToUse = currentQuizInfo;

    if (!quizInfoToUse && selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+")) {
      console.log("[AMQ+] Creating quiz info from selectedCustomQuizName as fallback");
      const cleanName = selectedCustomQuizName.startsWith("AMQ+ ") ? selectedCustomQuizName.substring(5) : selectedCustomQuizName;
      quizInfoToUse = {
        name: cleanName,
        description: null,
        creatorUsername: null
      };
    }

    if (quizInfoToUse && quizInfoToUse.name) {
      const originalName = selectedCustomQuizName || (currentQuizInfo ? `AMQ+ ${currentQuizInfo.name}` : '');
      if (originalName.startsWith("AMQ+")) {
        console.log("[AMQ+] Recording play for AMQ+ quiz:", quizInfoToUse.name);
        sendQuizPlayByIdentifiers(quizInfoToUse);
        setTimeout(() => {
          createCustomLikeButton(quizInfoToUse);
        }, 500);
      } else {
        console.log("[AMQ+] Not an AMQ+ quiz, skipping play tracking");
      }
    } else {
      console.log("[AMQ+] Quiz info not available, skipping play tracking");
    }
  }).bindListener();

  new Listener("custom quiz selected", (payload) => {
    console.log("[AMQ+] Custom quiz selected event received:", payload);
    const quizDesc = payload.data?.quizDescription || payload.quizDescription;
    if (quizDesc) {
      selectedCustomQuizId = quizDesc.customQuizId;
      selectedCustomQuizName = quizDesc.name;
      console.log("[AMQ+] Custom quiz selected:", selectedCustomQuizName, "ID:", selectedCustomQuizId);
      console.log("[AMQ+] Full quiz description:", quizDesc);

      if (quizDesc.name && quizDesc.name.startsWith("AMQ+")) {
        const cleanName = quizDesc.name.startsWith("AMQ+ ") ? quizDesc.name.substring(5) : quizDesc.name;
        currentQuizInfo = {
          name: cleanName,
          description: quizDesc.description || null,
          creatorUsername: quizDesc.creatorName || null
        };
        console.log("[AMQ+] Stored quiz info from 'custom quiz selected' event:", currentQuizInfo);
      } else {
        currentQuizInfo = null;
      }

      if (!selectedCustomQuizName.startsWith("AMQ+")) {
        amqPlusCreditsSent = false;
      }
    } else {
      console.warn("[AMQ+] Custom quiz selected event missing quizDescription:", payload);
      currentQuizInfo = null;
    }
  }).bindListener();

  new Listener("load builder quizzes", (payload) => {
    console.log("[AMQ+] Quiz list loaded event received");
    handleQuizListResponse(payload);
  }).bindListener();

  new Listener("save custom quiz", (payload) => {
    console.log("[AMQ+] Save custom quiz response received:", payload);

    if (payload.success) {
      const newQuizId = payload.quizId;
      const quizName = payload.quizSave?.name || currentQuizData?.command?.data?.quizSave?.name || "Unknown Quiz";
      console.log("[AMQ+] Quiz saved successfully with ID:", newQuizId);

      // Rebuild songSourceMap from the actual saved quiz to ensure it matches what AMQ saved
      if (payload.quizSave && currentQuizData && currentQuizData.songSourceMap) {
        console.log("[AMQ+] Rebuilding songSourceMap from saved quiz");
        buildSongSourceMap({
          songSourceMap: currentQuizData.songSourceMap,
          command: { data: { quizSave: payload.quizSave } }
        }, payload.quizSave);
      }

      updateModalStatus("Quiz saved successfully - Applying to lobby...");

      setTimeout(() => {
        const savedModal = document.querySelector(".swal2-popup.swal2-show");
        if (savedModal) {
          const title = savedModal.querySelector(".swal2-title");
          if (title && title.textContent === "Quiz Saved") {
            const okButton = savedModal.querySelector(".swal2-confirm");
            if (okButton) {
              okButton.click();
            }
          }
        }
      }, 100);

      amqPlusCreditsSent = false;

      // Only auto-apply quiz to lobby if not in training mode
      // Training mode sessions handle quiz application themselves
      if (!isTrainingMode) {
        applyQuizToLobby(newQuizId, quizName);
      }
    } else {
      console.error("[AMQ+] Save quiz command failed:", payload);
      updateModalStatus(null);
      messageDisplayer.displayMessage("Quiz Save Failed", "The quiz failed to save. This is likely due to insufficient community quiz slots (need at least 1). Please delete an old quiz and try again.");
    }
  }).bindListener();

  new Listener("Game Starting", (payload) => {
    if (amqPlusEnabled && selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+") && !amqPlusCreditsSent) {
      console.log("[AMQ+] Game starting, sending AMQ+ credits message");
      setTimeout(() => {
        socket.sendCommand({
          type: "lobby",
          command: "game chat message",
          data: { msg: "This quiz was created in https://amqplus.moe/", teamMessage: false }
        });
        amqPlusCreditsSent = true;
      }, 500);

      // Only send play count if user is the host
      if (typeof lobby !== 'undefined' && lobby.isHost && currentQuizInfo && currentQuizInfo.name && currentQuizInfo.description && currentQuizInfo.creatorUsername) {
        // Count players in lobby (from payload)
        const playerCount = payload && payload.players ? payload.players.length : 1;
        console.log(`[AMQ+] Host detected, sending play count for ${playerCount} player(s)`);
        sendQuizPlayByIdentifiers(currentQuizInfo, playerCount);
      } else if (typeof lobby !== 'undefined' && !lobby.isHost) {
        console.log("[AMQ+] Not the host, skipping play count");
      }
    }
    // Reset song tracking (preserve songSourceMap - it's built from quiz data and needed during game)
    currentSongNumber = 0;
  }).bindListener();

  new Listener("play next song", (payload) => {
    if (payload && payload.songNumber) {
      currentSongNumber = payload.songNumber;
      console.log("[AMQ+] Current song number:", currentSongNumber);
    }
  }).bindListener();

  new Listener("answer results", (data) => {
    if (!amqPlusEnabled || !selectedCustomQuizName || !selectedCustomQuizName.startsWith("AMQ+")) {
      return;
    }

    if (!songSourceMessagesEnabled) {
      return;
    }

    if (!songSourceMap || songSourceMap.size === 0) {
      return;
    }

    // Try to get annSongId from the current song
    let annSongId = null;

    // First, try to get from quiz.songList using currentSongNumber
    if (typeof quiz !== 'undefined' && quiz.songList && typeof currentSongNumber !== 'undefined' && currentSongNumber > 0) {
      try {
        // Try to access the song from the quiz's song list
        if (quiz.songOrder && quiz.songOrder[currentSongNumber] !== undefined) {
          const songIndex = quiz.songOrder[currentSongNumber];
          if (songIndex !== undefined && quiz.songList[songIndex]) {
            const song = quiz.songList[songIndex];
            annSongId = song.annSongId || song.annId || null;
          }
        }
      } catch (e) {
        console.error("[AMQ+] Error accessing song from quiz:", e);
      }
    }

    // Alternative: try to get from quizSave blocks if available
    if (!annSongId && currentQuizData && currentQuizData.command && currentQuizData.command.data) {
      try {
        const quizSave = currentQuizData.command.data.quizSave;
        if (quizSave && quizSave.ruleBlocks && quizSave.ruleBlocks[0]) {
          const ruleBlock = quizSave.ruleBlocks[0];
          if (ruleBlock.blocks && Array.isArray(ruleBlock.blocks) && currentSongNumber > 0) {
            const blockIndex = currentSongNumber - 1; // blocks are 0-indexed
            if (blockIndex >= 0 && blockIndex < ruleBlock.blocks.length) {
              const block = ruleBlock.blocks[blockIndex];
              annSongId = block.annSongId || null;
            }
          }
        }
      } catch (e) {
        console.error("[AMQ+] Error accessing song from quizSave:", e);
      }
    }

    if (annSongId && songSourceMap.has(annSongId)) {
      const sourceInfo = songSourceMap.get(annSongId);
      const formatted = formatSourceInfo(sourceInfo);

      console.log("[AMQ+] Song source:", `${formatted.icon} ${formatted.text}`, "for annSongId:", annSongId);

      setTimeout(() => {
        socket.sendCommand({
          type: "lobby",
          command: "game chat message",
          data: { msg: `${formatted.icon} Song source: ${formatted.text}`, teamMessage: false }
        });
      }, 500);
    } else if (annSongId) {
      // Song found but no source info - default to Random
      console.log("[AMQ+] Song annSongId:", annSongId, "but no source mapping found, defaulting to Random");
      setTimeout(() => {
        socket.sendCommand({
          type: "lobby",
          command: "game chat message",
          data: { msg: '🎲 Song source: Random', teamMessage: false }
        });
      }, 500);
    } else {
      // Couldn't determine annSongId
      console.log("[AMQ+] Could not determine annSongId for current song", currentSongNumber);
    }
  }).bindListener();

  new Listener("game chat update", (payload) => {
    for (let message of payload.messages) {
      if (message.sender === selfName) {
        handleChatCommand(message.message.toLowerCase());
      } else {
        // Handle player list commands from other players (host only)
        handlePlayerListCommand(message.message, message.sender);
      }
    }
  }).bindListener();

  new Listener("Game Chat Message", (payload) => {
    if (payload.sender === selfName) {
      handleChatCommand(payload.message.toLowerCase());
    } else {
      // Handle player list commands from other players (host only)
      handlePlayerListCommand(payload.message, payload.sender);
    }
  }).bindListener();

  console.log("[AMQ+] Event listeners set up complete");
}

function fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent) {
  const requestConfig = {
    method: liveNodeData ? "POST" : "GET",
    url: `${API_BASE_URL}/play/${quizId}`,
    onload: function (response) {
      console.log("[AMQ+] Re-roll response status:", response.status);
      console.log("[AMQ+] Re-roll response:", response.responseText);

      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          console.log("[AMQ+] Re-roll data parsed successfully");

          if (data.success === false) {
            const errorMessage = data.userMessage || data.message || "Unknown error occurred";
            console.error("[AMQ+] API returned error during re-roll:", errorMessage);
            sendSystemMessage("Failed to re-roll quiz: " + errorMessage);
            showError(errorMessage);
            originalFireMainButtonEvent(skipAutoReady);
            return;
          }

          // Update currentQuizData with the re-roll response data
          currentQuizData = data;
          buildSongSourceMap(data, data.command.data.quizSave);
          saveQuiz(data, selectedCustomQuizId);

          setTimeout(() => {
            console.log("[AMQ+] Re-roll complete, starting game...");
            sendSystemMessage("Quiz updated! Starting game...");
            originalFireMainButtonEvent(skipAutoReady);
          }, 1500);
        } catch (e) {
          console.error("[AMQ+] Failed to parse re-roll data:", e);
          sendSystemMessage("Failed to re-roll quiz: " + e.message);
          originalFireMainButtonEvent(skipAutoReady);
        }
      } else if (response.status === 422 || response.status === 400) {
        try {
          const errorData = JSON.parse(response.responseText);
          const errorMessage = errorData.userMessage || errorData.message || `Failed to re-roll quiz: ${response.status}`;
          console.error("[AMQ+] API error during re-roll:", errorMessage);
          sendSystemMessage("Failed to re-roll quiz: " + errorMessage);
          showError(errorMessage);
        } catch (e) {
          console.error("[AMQ+] Re-roll fetch failed with status:", response.status);
          sendSystemMessage("Failed to re-roll quiz, starting anyway...");
        }
        originalFireMainButtonEvent(skipAutoReady);
      } else {
        console.error("[AMQ+] Re-roll fetch failed with status:", response.status);
        sendSystemMessage("Failed to re-roll quiz, starting anyway...");
        originalFireMainButtonEvent(skipAutoReady);
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Network error during re-roll:", error);
      sendSystemMessage("Network error during re-roll, starting anyway...");
      originalFireMainButtonEvent(skipAutoReady);
    }
  };

  if (liveNodeData) {
    requestConfig.headers = {
      "Content-Type": "application/json"
    };
    requestConfig.data = JSON.stringify({ liveNodeData: liveNodeData });
  }

  GM_xmlhttpRequest(requestConfig);
}

function hijackStartButton() {
  console.log("[AMQ+] Hijacking start button...");
  const originalFireMainButtonEvent = lobby.fireMainButtonEvent.bind(lobby);

  lobby.fireMainButtonEvent = function (skipAutoReady) {
    console.log("[AMQ+] fireMainButtonEvent called, AMQ+ enabled:", amqPlusEnabled, "skipAutoReady:", skipAutoReady, "isTrainingMode:", isTrainingMode);

    const startButton = $("#lbStartButton");
    const buttonText = startButton.find("h1").text().trim();

    if (buttonText !== "Start") {
      console.log("[AMQ+] Button text is not 'Start' (is '" + buttonText + "'), proceeding normally");
      originalFireMainButtonEvent(skipAutoReady);
      return;
    }

    // Don't hijack if in training mode - let it start normally
    if (isTrainingMode) {
      console.log("[AMQ+] Training mode active, proceeding with normal start");
      originalFireMainButtonEvent(skipAutoReady);
      return;
    }

    if (amqPlusEnabled) {
      console.log("[AMQ+] AMQ+ mode is enabled, checking selected quiz...");
      if (selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+")) {
        console.log("[AMQ+] AMQ+ quiz selected:", selectedCustomQuizName);
        if (currentQuizId) {
          console.log("[AMQ+] Current quiz ID available, starting re-roll...");
          sendSystemMessage("Re-rolling quiz...");

          if (cachedPlayerLists && cachedPlayerLists.length > 0) {
            console.log("[AMQ+] Using cached player lists for re-roll");
            const configuredEntries = getConfiguredPlayerLists();
            const liveNodeData = {
              useEntirePool: false,
              userEntries: configuredEntries,
              songSelectionMode: liveNodeSongSelectionMode
            };
            fetchQuizForReRoll(currentQuizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent);
          } else {
            checkQuizForLiveNodeForReRoll(currentQuizId, skipAutoReady, originalFireMainButtonEvent);
          }
        } else {
          console.log("[AMQ+] No quiz ID stored, proceeding to start");
          originalFireMainButtonEvent(skipAutoReady);
        }
      } else {
        console.log("[AMQ+] No AMQ+ quiz selected, showing modal");
        $("#amqPlusModal").modal("show");
      }
    } else {
      console.log("[AMQ+] AMQ+ mode not enabled, calling original function");
      originalFireMainButtonEvent(skipAutoReady);
    }
  };

  console.log("[AMQ+] Start button hijack complete");
}

function setupQuizCreatorExportButton() {
  console.log("[AMQ+] Setting up quiz creator export button...");

  function addExportButtonIfNeeded() {
    const saveButton = $("#cqcQuizCreatorSaveButton");
    if (saveButton.length > 0 && $("#amqPlusExportButton").length === 0) {
      const exportButton = saveButton.clone();
      exportButton.attr("id", "amqPlusExportButton");
      exportButton.find("i").removeClass("fa-floppy-o").addClass("fa-download");
      exportButton.find("div").text("Export");
      exportButton.off("click");
      exportButton.click(() => {
        exportQuizToAMQPlus();
      });

      saveButton.after(exportButton);
      updateExportButtonVisibility();

      console.log("[AMQ+] Export button added to quiz creator");
    }
  }

  const checkInterval = setInterval(() => {
    addExportButtonIfNeeded();
  }, 500);

  setTimeout(() => {
    clearInterval(checkInterval);
  }, 30000);

  addExportButtonIfNeeded();
}

function updateExportButtonVisibility() {
  const exportButton = $("#amqPlusExportButton");
  exportButton.toggle(lastLoadedQuizSave !== null);
}

function exportQuizToAMQPlus() {
  console.log("[AMQ+] Exporting quiz to AMQ+ format...");

  if (!lastLoadedQuizSave) {
    console.error("[AMQ+] No quiz data available for export");
    messageDisplayer.displayMessage("Export Failed", "No quiz loaded. Please load a quiz first.");
    return;
  }

  try {
    const exportData = convertQuizToAMQExportFormat(lastLoadedQuizSave);
    const filename = `amq-quiz-export-${lastLoadedQuizSave.name || "quiz"}-${Date.now()}.json`;

    pendingExportData = exportData;
    pendingExportFilename = filename;

    console.log("[AMQ+] Quiz exported successfully, showing download dialog");
    messageDisplayer.displayMessage(
      "Export Successful",
      `Quiz "${lastLoadedQuizSave.name || "Unknown"}" exported successfully!<br><br>` +
      `To import this quiz:<br>` +
      `1. Go to https://amqplus.moe/songlist/create<br>` +
      `2. Scroll to "Provider Import" section<br>` +
      `3. Select "AMQ Official Export" as provider type<br>` +
      `4. Click "Choose File" and select the downloaded JSON file<br>` +
      `5. Click "Add All Provider Songs" to import the songs`
    );

    setTimeout(() => {
      replaceOkButtonWithDownload();
    }, 100);
  } catch (error) {
    console.error("[AMQ+] Export failed:", error);
    messageDisplayer.displayMessage("Export Failed", `Failed to export quiz: ${error.message}`);
  }
}

function replaceOkButtonWithDownload() {
  const modal = document.querySelector(".swal2-popup.swal2-show");
  if (!modal) {
    console.log("[AMQ+] Modal not found, retrying...");
    setTimeout(() => replaceOkButtonWithDownload(), 100);
    return;
  }

  const contentArea = modal.querySelector(".swal2-html-container");
  if (contentArea) {
    const messageHtml = `Quiz "${lastLoadedQuizSave.name || "Unknown"}" exported successfully!<br><br>` +
      `To import this quiz:<br>` +
      `1. Go to https://amqplus.moe/songlist/create<br>` +
      `2. Scroll to "Provider Import" section<br>` +
      `3. Select "AMQ Official Export" as provider type<br>` +
      `4. Click "Choose File" and select the downloaded JSON file<br>` +
      `5. Click "Add All Provider Songs" to import the songs`;
    contentArea.innerHTML = messageHtml;
  }

  const okButton = modal.querySelector(".swal2-confirm");
  if (okButton && okButton.textContent.trim() === "OK") {
    okButton.textContent = "Download";

    $(okButton).off("click").on("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (pendingExportData && pendingExportFilename) {
        const blob = new Blob([JSON.stringify(pendingExportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = pendingExportFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        pendingExportData = null;
        pendingExportFilename = null;

        if (window.Swal && window.Swal.close) {
          window.Swal.close();
        } else {
          $(okButton).closest(".swal2-popup").remove();
          $(".swal2-backdrop-show").remove();
        }
      }
    });

    console.log("[AMQ+] OK button replaced with Download button");
  } else {
    console.log("[AMQ+] OK button not found or already replaced, retrying...");
    setTimeout(() => replaceOkButtonWithDownload(), 100);
  }
}

function convertQuizToAMQExportFormat(quizSave) {
  console.log("[AMQ+] Converting quiz to AMQ export format");

  const songs = [];

  if (quizSave.ruleBlocks && Array.isArray(quizSave.ruleBlocks)) {
    for (const ruleBlock of quizSave.ruleBlocks) {
      if (ruleBlock.blocks && Array.isArray(ruleBlock.blocks)) {
        for (const block of ruleBlock.blocks) {
          if (block.annSongId) {
            const sampleRange = block.samplePoint?.samplePoint || ruleBlock.samplePoint?.samplePoint || [0, 100];
            const guessTime = block.guessTime?.guessTime || ruleBlock.guessTime?.guessTime || 30;
            const extraGuessTime = block.guessTime?.extraGuessTime || ruleBlock.guessTime?.extraGuessTime || 0;

            const song = {
              annSongId: block.annSongId,
              startPoint: sampleRange[0],
              sampleEnd: sampleRange[1],
              guessTime: guessTime,
              extraGuessTime: extraGuessTime
            };

            songs.push(song);
          }
        }
      }
    }
  }

  const exportData = {
    roomName: quizSave.name || "AMQ Community Quiz",
    startTime: Date.now(),
    songs: songs,
    metadata: {
      quizId: lastLoadedQuizId,
      quizName: quizSave.name,
      description: quizSave.description || "",
      tags: quizSave.tags || [],
      exportedFrom: "AMQ Community Quiz Creator",
      exportFormat: "amq-export"
    }
  };

  console.log("[AMQ+] Converted quiz to export format:", exportData);
  console.log("[AMQ+] Total songs in export:", songs.length);

  return exportData;
}

function getOwnListInfo() {
  const malUsername = $("#malUserNameInput").val()?.trim();
  const anilistUsername = $("#aniListUserNameInput").val()?.trim();
  const kitsuUsername = $("#kitsuUserNameInput").val()?.trim();

  if (malUsername) {
    return { platform: 'mal', username: malUsername };
  } else if (anilistUsername) {
    return { platform: 'anilist', username: anilistUsername };
  } else if (kitsuUsername) {
    return { platform: 'kitsu', username: kitsuUsername };
  }

  return null;
}

function extractUsernameFromProfileStats(statsRow) {
  const valueContainer = statsRow.find('.ppStatsValueContainer .ppStatsValue');
  if (valueContainer.length > 0) {
    const link = valueContainer.find('a');
    if (link.length > 0) {
      return link.text().trim();
    }
    return valueContainer.text().trim();
  }
  return null;
}

function getPlatformFromStatsName(statsName) {
  const nameLower = statsName.toLowerCase();
  if (nameLower.includes('anilist')) {
    return 'anilist';
  } else if (nameLower.includes('mal') || nameLower.includes('myanimelist')) {
    return 'mal';
  } else if (nameLower.includes('kitsu')) {
    return 'kitsu';
  }
  return null;
}

function readPlayerListFromProfile() {
  const profileContainer = $('.playerProfileContainer.floatingContainer:visible');
  if (profileContainer.length === 0) {
    console.log("[AMQ+] No profile popup visible");
    return null;
  }

  const statsRows = profileContainer.find('.ppStatsRow.list');
  console.log("[AMQ+] Found stats rows:", statsRows.length);

  let malInfo = null;
  let anilistInfo = null;
  let kitsuInfo = null;

  statsRows.each(function () {
    const statsName = $(this).find('.ppStatsName').text().trim();
    const platform = getPlatformFromStatsName(statsName);
    const username = extractUsernameFromProfileStats($(this));

    if (platform && username) {
      console.log(`[AMQ+] Found ${platform} username: ${username}`);
      if (platform === 'mal') {
        malInfo = { platform: 'mal', username: username };
      } else if (platform === 'anilist') {
        anilistInfo = { platform: 'anilist', username: username };
      } else if (platform === 'kitsu') {
        kitsuInfo = { platform: 'kitsu', username: username };
      }
    }
  });

  if (malInfo) return malInfo;
  if (anilistInfo) return anilistInfo;
  if (kitsuInfo) return kitsuInfo;

  return null;
}

async function gatherPlayerLists() {
  const userEntries = [];
  const defaultStatuses = {
    completed: true,
    watching: true,
    planning: false,
    on_hold: false,
    dropped: false
  };

  const ownListInfo = getOwnListInfo();
  if (ownListInfo && ownListInfo.username && ownListInfo.username.trim() !== '-' && ownListInfo.username.trim() !== '') {
    let entry = {
      id: `user-self-${Date.now()}`,
      platform: ownListInfo.platform,
      username: ownListInfo.username,
      selectedLists: { ...defaultStatuses },
      songPercentage: null
    };
    // Apply saved settings if they exist
    entry = applyPlayerSettingsToEntry(entry);
    userEntries.push(entry);
    console.log("[AMQ+] Added own list:", ownListInfo);
  } else if (ownListInfo && ownListInfo.username === '-') {
    console.log("[AMQ+] Skipped own list - username is '-' (no list provided)");
  }

  const lobbyAvatarRows = $('#lobbyAvatarContainer .lobbyAvatarRow');
  console.log("[AMQ+] Found lobby avatar rows:", lobbyAvatarRows.length);

  const profileIcons = [];
  lobbyAvatarRows.each(function () {
    const avatars = $(this).find('.lobbyAvatar:not(.isSelf)');
    avatars.each(function () {
      const profileIcon = $(this).find('.playerCommandProfileIcon');
      if (profileIcon.length > 0) {
        profileIcons.push(profileIcon[0]);
      }
    });
  });

  console.log("[AMQ+] Found profile icons to process:", profileIcons.length);

  for (let i = 0; i < profileIcons.length; i++) {
    const icon = profileIcons[i];

    try {
      // Close any existing profile popup first
      const existingProfile = $('.playerProfileContainer.floatingContainer:visible');
      if (existingProfile.length > 0) {
        const existingClose = existingProfile.find('.close');
        if (existingClose.length > 0) {
          existingClose[0].click();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // Use native click instead of jQuery to avoid context issues
      icon.click();

      // Wait for profile to load
      await new Promise(resolve => setTimeout(resolve, 600));

      const listInfo = readPlayerListFromProfile();
      if (listInfo && listInfo.username && listInfo.username.trim() !== '-' && listInfo.username.trim() !== '') {
        let entry = {
          id: `user-${i}-${Date.now()}`,
          platform: listInfo.platform,
          username: listInfo.username,
          selectedLists: { ...defaultStatuses },
          songPercentage: null
        };
        // Apply saved settings if they exist
        entry = applyPlayerSettingsToEntry(entry);
        userEntries.push(entry);
        console.log(`[AMQ+] Added player ${i + 1} list:`, listInfo);
      } else {
        if (listInfo && listInfo.username === '-') {
          console.log(`[AMQ+] Skipped player ${i + 1} - username is "-" (no list provided)`);
        } else {
          console.log(`[AMQ+] No list info found for player ${i + 1}`);
        }
      }

      // Close profile
      const profileContainer = $('.playerProfileContainer.floatingContainer:visible');
      if (profileContainer.length > 0) {
        const closeButton = profileContainer.find('.close');
        if (closeButton.length > 0) {
          closeButton[0].click();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      // Extra delay between players
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`[AMQ+] Error processing player ${i + 1}:`, error);
      // Try to close any open profile and continue
      const profileContainer = $('.playerProfileContainer.floatingContainer:visible');
      if (profileContainer.length > 0) {
        const closeButton = profileContainer.find('.close');
        if (closeButton.length > 0) {
          closeButton[0].click();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      // Continue to next player
      continue;
    }
  }

  console.log("[AMQ+] Total player lists gathered:", userEntries.length);
  cachedPlayerLists = userEntries;
  return userEntries;
}

function sendQuizPlayByIdentifiers(quizInfo, playCount = 1) {
  console.log(`[AMQ+] Sending ${playCount} play(s) to API for quiz:`, quizInfo.name);
  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/quiz-configurations/stats`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      name: quizInfo.name,
      description: quizInfo.description,
      creatorUsername: quizInfo.creatorUsername,
      playCount: playCount
    }),
    onload: function (response) {
      if (response.status === 200) {
        console.log(`[AMQ+] ${playCount} play(s) recorded successfully`);
      } else {
        let errorMessage = "Failed to record play";
        let errorDetails = null;
        try {
          const errorData = JSON.parse(response.responseText);
          if (errorData.message) {
            errorMessage = errorData.message;
          }
          if (errorData.details) {
            errorDetails = errorData.details;
          }
        } catch (e) {
          errorMessage = response.responseText || `HTTP ${response.status}: Failed to record play`;
        }
        if (errorDetails) {
          console.error("[AMQ+] Failed to record play:", response.status, errorMessage, "-", errorDetails);
        } else {
          console.error("[AMQ+] Failed to record play:", response.status, errorMessage);
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error sending play:", error);
    }
  });
}

function getQuizStorageKey(quizInfo) {
  return `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;
}

function getStoredLikeState(quizInfo) {
  const storageKey = getQuizStorageKey(quizInfo);
  return amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;
}

function createCustomLikeButton(quizInfo) {
  console.log("[AMQ+] Creating custom like button...");

  const quizEntry = document.querySelector('.cqsQuizEntry');
  if (!quizEntry) {
    console.log("[AMQ+] Quiz entry not found, retrying...");
    setTimeout(() => createCustomLikeButton(quizInfo), 500);
    return;
  }

  if (document.getElementById('amqPlusCustomLikeButton')) {
    console.log("[AMQ+] Custom like button already exists, updating state");
    updateCustomLikeButtonState(quizInfo);
    return;
  }

  const statsContainer = quizEntry.querySelector('.cqsQuizEntryStatsContainer');
  if (!statsContainer) {
    console.log("[AMQ+] Stats container not found, retrying...");
    setTimeout(() => createCustomLikeButton(quizInfo), 500);
    return;
  }

  if (!quizInfo || !quizInfo.name) {
    console.log("[AMQ+] Not an AMQ+ quiz, skipping custom like button. Quiz info:", quizInfo);
    return;
  }

  const isAMQPlusQuiz = selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+");
  if (!isAMQPlusQuiz) {
    console.log("[AMQ+] Not an AMQ+ quiz, skipping custom like button");
    return;
  }

  console.log("[AMQ+] Creating custom like button for AMQ+ quiz:", quizInfo.name);

  const currentLikeState = getStoredLikeState(quizInfo);
  const likeButton = document.createElement('div');
  likeButton.id = 'amqPlusCustomLikeButton';
  likeButton.className = 'amqPlusCustomLikeButton clickAble';

  if (currentLikeState === 1) {
    likeButton.classList.add('amqPlusLiked');
  }

  const icon = document.createElement('i');
  icon.className = currentLikeState === 1 ? 'fa fa-thumbs-up' : 'fa fa-thumbs-o-up';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'amqPlusLikeText';
  text.textContent = currentLikeState === 1 ? 'Liked' : 'Like';

  likeButton.appendChild(icon);
  likeButton.appendChild(text);

  function handleLikeClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    console.log("[AMQ+] Custom like button clicked");

    const storedState = getStoredLikeState(quizInfo);
    const newLikeState = storedState === 1 ? 0 : 1;

    updateCustomLikeButtonUI(likeButton, newLikeState);
    sendQuizLikeByIdentifiers(quizInfo, newLikeState);
  }

  likeButton.onclick = handleLikeClick;
  likeButton.addEventListener('click', handleLikeClick, true);

  statsContainer.parentNode.insertBefore(likeButton, statsContainer.nextSibling);

  console.log("[AMQ+] Custom like button inserted into DOM, element:", likeButton);
  console.log("[AMQ+] Button onclick handler:", likeButton.onclick);

  console.log("[AMQ+] Custom like button created successfully");
}

function updateCustomLikeButtonUI(likeButton, likeState) {
  if (!likeButton) return;

  const icon = likeButton.querySelector('i');
  const text = likeButton.querySelector('.amqPlusLikeText');

  if (likeState === 1) {
    likeButton.classList.add('amqPlusLiked');
    if (icon) {
      icon.classList.remove('fa-thumbs-o-up');
      icon.classList.add('fa-thumbs-up');
    }
    if (text) text.textContent = 'Liked';
  } else {
    likeButton.classList.remove('amqPlusLiked');
    if (icon) {
      icon.classList.remove('fa-thumbs-up');
      icon.classList.add('fa-thumbs-o-up');
    }
    if (text) text.textContent = 'Like';
  }
}

function updateCustomLikeButtonState(quizInfo) {
  const likeButton = document.getElementById('amqPlusCustomLikeButton');
  if (!likeButton || !quizInfo) return;

  const currentLikeState = getStoredLikeState(quizInfo);
  updateCustomLikeButtonUI(likeButton, currentLikeState);
}

function sendQuizLikeByIdentifiers(quizInfo, likeState) {
  console.log("[AMQ+] Sending like state to API for quiz:", quizInfo.name, "likeState:", likeState);

  const storageKey = getQuizStorageKey(quizInfo);

  if (!amqQuizLikesStorage) {
    amqQuizLikesStorage = {};
  }

  if (likeState === 1) {
    amqQuizLikesStorage[storageKey] = { likeState: 1, timestamp: Date.now() };
  } else if (likeState === -1) {
    amqQuizLikesStorage[storageKey] = { likeState: -1, timestamp: Date.now() };
  } else {
    delete amqQuizLikesStorage[storageKey];
  }

  try {
    localStorage.setItem("amqPlusLikedQuizzes", JSON.stringify(amqQuizLikesStorage));
    console.log("[AMQ+] Updated liked quizzes in localStorage");
  } catch (e) {
    console.error("[AMQ+] Failed to save liked quizzes to localStorage:", e);
  }

  GM_xmlhttpRequest({
    method: "PATCH",
    url: `${API_BASE_URL}/api/quiz-configurations/stats`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      likeState: likeState,
      name: quizInfo.name,
      description: quizInfo.description,
      creatorUsername: quizInfo.creatorUsername
    }),
    onload: function (response) {
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          console.log("[AMQ+] Like state updated successfully, new likes:", data.likes);

          const likeCountSpan = document.querySelector('.cqsQuizEntryLikes');
          if (likeCountSpan) {
            likeCountSpan.textContent = data.likes || 0;
          }
          const customLikeButton = document.getElementById('amqPlusCustomLikeButton');
          if (customLikeButton) {
            updateCustomLikeButtonUI(customLikeButton, likeState);
          }
        } catch (e) {
          console.error("[AMQ+] Failed to parse response:", e);
        }
      } else {
        let errorMessage = "Failed to update like state";
        let errorDetails = null;
        try {
          const errorData = JSON.parse(response.responseText);
          if (errorData.message) {
            errorMessage = errorData.message;
          }
          if (errorData.details) {
            errorDetails = errorData.details;
          }
        } catch (e) {
          errorMessage = response.responseText || `HTTP ${response.status}: Failed to update like state`;
        }
        if (errorDetails) {
          console.error("[AMQ+] Failed to update like state:", response.status, errorMessage, "-", errorDetails);
        } else {
          console.error("[AMQ+] Failed to update like state:", response.status, errorMessage);
        }

        const customLikeButton = document.getElementById('amqPlusCustomLikeButton');
        if (customLikeButton) {
          const storedState = getStoredLikeState(quizInfo);
          updateCustomLikeButtonUI(customLikeButton, storedState);
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error sending like state:", error);
      const customLikeButton = document.getElementById('amqPlusCustomLikeButton');
      if (customLikeButton) {
        const storedState = getStoredLikeState(quizInfo);
        updateCustomLikeButtonUI(customLikeButton, storedState);
      }
    }
  });
}


function handleSyncCommand() {
  if (!currentQuizId) {
    sendSystemMessage("No quiz loaded. Please fetch a quiz first.");
    return;
  }

  const syncBtn = $("#amqPlusSyncBtn");
  if (syncBtn.length > 0) {
    syncBtn.prop("disabled", true);
    syncBtn.css({
      "opacity": "0.5",
      "cursor": "not-allowed"
    });
  }

  if (cachedPlayerLists && cachedPlayerLists.length > 0) {
    console.log("[AMQ+] Using cached player lists for sync");
    const configuredEntries = getConfiguredPlayerLists();
    usePlayerLists(configuredEntries, currentQuizId);
    if (syncBtn.length > 0) {
      syncBtn.prop("disabled", false);
      syncBtn.css({
        "opacity": "1",
        "cursor": "pointer"
      });
    }
  } else {
    gatherPlayerLists().then(userEntries => {
      if (userEntries.length === 0) {
        sendSystemMessage("No player lists found in lobby.");
        if (syncBtn.length > 0) {
          syncBtn.prop("disabled", false);
          syncBtn.css({
            "opacity": "1",
            "cursor": "pointer"
          });
        }
        return;
      }
      cachedPlayerLists = userEntries;
      applyRandomPreset();
      updatePlayerListsConfigUI();
      const configuredEntries = getConfiguredPlayerLists();
      usePlayerLists(configuredEntries, currentQuizId);
      if (syncBtn.length > 0) {
        syncBtn.prop("disabled", false);
        syncBtn.css({
          "opacity": "1",
          "cursor": "pointer"
        });
      }
    }).catch(error => {
      console.error("[AMQ+] Error gathering player lists:", error);
      sendSystemMessage("Failed to gather player lists: " + error.message);
      if (syncBtn.length > 0) {
        syncBtn.prop("disabled", false);
        syncBtn.css({
          "opacity": "1",
          "cursor": "pointer"
        });
      }
    });
  }
}

function handleMetadataCommand() {
  if (!currentQuizInfo || !currentQuizInfo.name) {
    sendSystemMessage("No AMQ+ quiz selected. Please select an AMQ+ quiz first.");
    return;
  }

  const apiUrl = `${API_BASE_URL}/api/quiz-configurations/metadata?name=${encodeURIComponent(currentQuizInfo.name)}&description=${encodeURIComponent(currentQuizInfo.description || '')}&creatorUsername=${encodeURIComponent(currentQuizInfo.creatorUsername || '')}`;

  GM_xmlhttpRequest({
    method: "GET",
    url: apiUrl,
    onload: function (response) {
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.success && data.quiz) {
            sendQuizMetadataAsMessages(data.quiz);
          } else {
            sendSystemMessage("Failed to fetch quiz metadata: " + (data.message || "Unknown error"));
          }
        } catch (e) {
          console.error("[AMQ+] Failed to parse metadata response:", e);
          sendSystemMessage("Failed to parse quiz metadata response");
        }
      } else {
        try {
          const errorData = JSON.parse(response.responseText);
          sendSystemMessage("Failed to fetch quiz metadata: " + (errorData.message || `HTTP ${response.status}`));
        } catch (e) {
          sendSystemMessage("Failed to fetch quiz metadata: HTTP " + response.status);
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error fetching quiz metadata:", error);
      sendSystemMessage("Network error while fetching quiz metadata. Make sure AMQ+ server is running.");
    }
  });
}

function formatMetadataWithCountOrPercentage(label, icon, data) {
  if (!data?.enabled) return null;

  // Always display the count, which is now the allocated value
  if (data.count !== undefined) {
    return `${icon} ${label} ${data.count}`;
  }

  // Fallback for older metadata formats or if count is missing
  if (data.minCount !== undefined && data.maxCount !== undefined) {
    return `${icon} ${label} ${data.minCount}-${data.maxCount}`;
  } else {
    const percent = data.percentage || 0;
    if (data.random) {
      return `${icon} ${label} ${percent}% (${data.minPercentage || 0}-${data.maxPercentage || 0})`;
    }
    return `${icon} ${label} ${percent}%`;
  }
}

function formatSongTypeMetadata(label, icon, data) {
  if (!data?.enabled) return null;

  // Always display the count, which is now the allocated value
  if (data.count !== undefined) {
    return `${icon} ${label} ${data.count}`;
  }

  // Fallback for older metadata formats or if count is missing
  if (data.minCount !== undefined && data.maxCount !== undefined) {
    return `${icon} ${label} ${data.minCount}-${data.maxCount}`;
  } else {
    const percent = data.percentage || 0;
    if (data.random) {
      return `${icon} ${label} ${percent}% (${data.minPercentage || 0}-${data.maxPercentage || 0})`;
    }
    return `${icon} ${label} ${percent}%`;
  }
}

function sendQuizMetadataAsMessages(quiz) {
  const messages = [];
  if (quiz.quiz_metadata) {
    const meta = quiz.quiz_metadata;

    if (meta.estimatedSongs) {
      if (meta.estimatedSongs.min === 'unknown') {
        messages.push(`🎶 Songs: Unknown`);
      } else if (meta.estimatedSongs.min === meta.estimatedSongs.max) {
        messages.push(`🎶 Songs: ${meta.estimatedSongs.min}`);
      } else {
        messages.push(`🎶 Songs: ${meta.estimatedSongs.min}-${meta.estimatedSongs.max}`);
      }
    }

    // Add guess time information
    if (meta.guessTime) {
      const gt = meta.guessTime.guessTime;
      const egt = meta.guessTime.extraGuessTime;
      let guessTimeMsg = '⏱️ Guess Time: ';

      if (gt.useRange) {
        guessTimeMsg += `${gt.min}-${gt.max}s`;
      } else {
        guessTimeMsg += `${gt.staticValue}s`;
      }

      // Add extra guess time if present and non-zero
      if (egt && ((egt.useRange && (egt.min > 0 || egt.max > 0)) || (!egt.useRange && egt.staticValue > 0))) {
        guessTimeMsg += ' + ';
        if (egt.useRange) {
          guessTimeMsg += `${egt.min}-${egt.max}s`;
        } else {
          guessTimeMsg += `${egt.staticValue}s`;
        }
      }

      messages.push(guessTimeMsg);
    }

    if (meta.songTypes) {
      const songTypeFormatters = [
        { data: meta.songTypes.openings, label: 'OP', icon: '🎵' },
        { data: meta.songTypes.endings, label: 'ED', icon: '🎵' },
        { data: meta.songTypes.inserts, label: 'IN', icon: '🎵' }
      ];

      songTypeFormatters.forEach(formatter => {
        const msg = formatMetadataWithCountOrPercentage(formatter.label, formatter.icon, formatter.data);
        if (msg) messages.push(msg);
      });
    }

    if (meta.difficulty) {
      if (meta.difficulty.mode === 'basic') {
        const difficultyLevels = [
          { data: meta.difficulty.levels.easy, label: 'Easy' },
          { data: meta.difficulty.levels.medium, label: 'Medium' },
          { data: meta.difficulty.levels.hard, label: 'Hard' }
        ];

        difficultyLevels.forEach(({ data, label }) => {
          const formatted = formatMetadataWithCountOrPercentage(label, '⭐', data);
          if (formatted) messages.push(formatted);
        });
      } else if (meta.difficulty.mode === 'advanced') {
        if (meta.difficulty.ranges && meta.difficulty.ranges.length > 0) {
          meta.difficulty.ranges.forEach(range => {
            messages.push(`⭐ ${range.from}-${range.to} (${range.count})`);
          });
        }
      }
    }

    if (meta.songSelection) {
      const randomMsg = formatMetadataWithCountOrPercentage('Random', '🎲', meta.songSelection.random);
      if (randomMsg) messages.push(randomMsg);
      const watchedMsg = formatMetadataWithCountOrPercentage('Watched', '👁️', meta.songSelection.watched);
      if (watchedMsg) messages.push(watchedMsg);
    }

    // Advanced difficulty ranges
    if (meta.difficulty && meta.difficulty.mode === 'advanced' && meta.difficulty.ranges) {
      meta.difficulty.ranges.forEach(range => {
        messages.push(`⭐ ${range.from}-${range.to} (${range.count})`);
      });
    }

    if (messages.length > 0) {
      messages.forEach((msg, index) => {
        setTimeout(() => sendSystemMessage(msg), 100 * (index + 1));
      });
    } else {
      sendSystemMessage("No quiz metadata available for this configuration.");
    }
  } else {
    sendSystemMessage("No detailed quiz metadata available.");
  }
}

// ============================================
// TRAINING MODE FUNCTIONS
// ============================================

// Note: Training mode is now controlled by the checkbox in the training modal
// No automatic detection based on quiz characteristics

// Note: Pause/unpause system messages are now filtered at the source via setupGameChatFilter()
// which overrides gameChat.systemMessage() to block these messages during training mode

function attachTrainingModalHandlers() {
  // Training mode toggle checkbox handler
  $("#trainingModeToggle").off("change").on("change", function () {
    isTrainingMode = $(this).is(":checked");
    console.log("[AMQ+ Training] Training mode", isTrainingMode ? "enabled" : "disabled");
  });

  // Initialize checkbox state (unchecked by default)
  $("#trainingModeToggle").prop("checked", false);
  isTrainingMode = false;

  $("#trainingLinkBtn").off("click").on("click", () => {
    const token = $("#trainingTokenField").val().trim();
    if (!token || token.length !== 64) {
      showTrainingStatus("Please enter a valid 64-character token", "error");
      return;
    }
    trainingState.authToken = token;
    validateTrainingToken();
  });

  $("#trainingLogoutBtn").off("click").on("click", () => {
    unlinkTrainingAccount();
  });

  $("#trainingImportToggle").off("click").on("click", () => {
    const content = $("#trainingImportContent");
    const chevron = $("#trainingImportChevron");
    if (content.is(":visible")) {
      content.slideUp(200);
      chevron.css("transform", "rotate(0deg)");
    } else {
      content.slideDown(200);
      chevron.css("transform", "rotate(90deg)");
    }
  });

  $("#trainingImportBtn").off("click").on("click", () => {
    importOldTrainingData();
  });

  // Handle loading from URL
  $("#trainingLoadFromUrlBtn").off("click").on("click", () => {
    loadTrainingFromUrl();
  });

  // Allow pressing Enter in URL input to load
  $("#trainingUrlInput").off("keypress").on("keypress", function (e) {
    if (e.which === 13) {
      loadTrainingFromUrl();
    }
  });

  // Handle change URL button
  $("#trainingChangeUrlBtn").off("click").on("click", () => {
    resetUrlQuizSelection();
  });

  // Toggle advanced settings
  $("#trainingAdvancedToggle").off("click").on("click", () => {
    const advancedSettings = $("#trainingAdvancedSettings");
    const isVisible = advancedSettings.is(":visible");

    if (isVisible) {
      advancedSettings.slideUp(200);
      $("#trainingAdvancedToggle").html('<i class="fa fa-cog"></i> Advanced');
    } else {
      advancedSettings.slideDown(200);
      $("#trainingAdvancedToggle").html('<i class="fa fa-cog"></i> Hide Advanced');
    }
  });

  $("#trainingStartBtn").off("click").on("click", () => {
    // Check if a quiz was loaded from URL
    let selectedQuizId = trainingState.urlLoadedQuizId;

    // If no URL quiz, check if a quiz card was selected
    if (!selectedQuizId) {
      const selectedCard = $("#trainingQuizList .training-quiz-card.selected");
      selectedQuizId = selectedCard.data("quiz-id");
    }

    console.log("[AMQ+ Training] Start button clicked, selectedQuizId:", selectedQuizId);

    if (!selectedQuizId) {
      alert("Please select a quiz to practice or load one from URL");
      return;
    }

    // Read basic settings
    const sessionLength = parseInt($("#trainingSessionLength").val()) || 20;

    // Validate session length
    if (sessionLength < 5 || sessionLength > 100) {
      alert("Session length must be between 5 and 100 songs");
      return;
    }

    // Check if advanced mode is enabled
    const advancedSettings = $("#trainingAdvancedSettings");
    const isAdvancedMode = advancedSettings.is(":visible");

    let settingsConfig;

    if (isAdvancedMode) {
      // Read manual settings
      const dueCount = $("#trainingDueCount").val();
      const newCount = $("#trainingNewCount").val();
      const revisionCount = $("#trainingRevisionCount").val();

      // Build config with manual values (null means auto)
      settingsConfig = {
        mode: 'manual',
        dueCount: dueCount ? parseInt(dueCount) : null,
        newCount: newCount ? parseInt(newCount) : null,
        revisionCount: revisionCount ? parseInt(revisionCount) : null
      };

      console.log("[AMQ+ Training] Starting with manual settings:", settingsConfig);
    } else {
      // Use automatic FSRS-based distribution (70% due, 30% new)
      settingsConfig = {
        mode: 'auto',
        dueSongPercentage: 70
      };

      console.log("[AMQ+ Training] Starting with auto settings (70% due, 30% new)");
    }

    saveTrainingSettings();

    // Show loading state
    const startBtn = $("#trainingStartBtn");
    const originalHtml = startBtn.html();
    startBtn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Starting...');

    console.log("[AMQ+ Training] Starting session with quizId:", selectedQuizId, "sessionLength:", sessionLength);
    startTrainingSession(selectedQuizId, sessionLength, settingsConfig);
  });

  $("#trainingEndBtn").off("click").on("click", () => {
    if (confirm("Are you sure you want to end this training session?")) {
      endTrainingSession();
    }
  });

  $(".trainingRatingBtn").off("click").on("click", function () {
    const rating = parseInt($(this).data("rating"));
    submitTrainingRating(rating);
  });

  // Handle quiz card selection - use event delegation that works with dynamically added cards
  $(document).off("click", ".training-quiz-card").on("click", ".training-quiz-card", function (e) {
    e.stopPropagation();
    $(".training-quiz-card").removeClass("selected");
    $(this).addClass("selected");
    console.log("[AMQ+ Training] Quiz selected:", $(this).data("quiz-id"));

    // Reset URL selection when a quiz card is selected
    resetUrlQuizSelection();
  });
}

function showTrainingStatus(message, type = "info") {
  const statusDiv = $("#trainingAuthStatus");
  const colors = {
    info: "#0dcaf0",
    success: "#28a745",
    error: "#dc3545",
    warning: "#ffc107"
  };

  statusDiv.html(`
    <div style="padding: 12px; background: ${colors[type]}15; border-left: 4px solid ${colors[type]}; border-radius: 4px;">
      <strong style="color: ${colors[type]};">${message}</strong>
    </div>
  `);
}

function validateTrainingToken() {
  if (!trainingState.authToken) {
    showTrainingStatus("No token found", "error");
    return;
  }

  showTrainingStatus("Validating token...", "info");

  makeApiRequest({
    url: `${API_BASE_URL}/api/training/token/validate`,
    method: 'POST',
    data: { token: trainingState.authToken },
    errorPrefix: 'Token Validation',
    onSuccess: (data) => {
      trainingState.isAuthenticated = true;
      trainingState.userId = data.userId;
      trainingState.username = data.username;
      trainingState.userQuizzes = data.quizzes || [];

      saveTrainingSettings();

      showTrainingStatus(`✓ Connected as ${data.username}`, "success");
      $("#trainingTokenField").prop("disabled", true);
      $("#trainingLinkBtn").hide();
      $("#trainingLogoutBtn").show();

      // Switch to quiz selection tab
      setTimeout(() => {
        $("#trainingAuthTab").hide();
        $("#trainingQuizTab").show();
        loadTrainingQuizzes();

        // Restore saved new song percentage
        $("#trainingNewPercentage").val(trainingState.newSongPercentage);

        // Restore URL quiz display if saved
        restoreUrlQuizDisplay();
      }, 1000);

      // Process any pending sync queue
      if (trainingState.pendingSync.length > 0) {
        processTrainingSyncQueue();
      }
    },
    onError: (errorMsg) => {
      showTrainingStatus(errorMsg, "error");
      trainingState.isAuthenticated = false;
      $("#trainingLogoutBtn").hide();
    }
  });
}

function unlinkTrainingAccount() {
  if (confirm("Are you sure you want to unlink your training account?")) {
    trainingState.isAuthenticated = false;
    trainingState.authToken = null;
    trainingState.userId = null;
    trainingState.username = null;
    trainingState.userQuizzes = [];

    localStorage.removeItem("amqPlusTrainingToken");
    localStorage.removeItem("amqPlusTrainingState");

    $("#trainingTokenField").val("").prop("disabled", false);
    $("#trainingLinkBtn").show();
    $("#trainingLogoutBtn").hide();
    $("#trainingQuizTab").hide();
    $("#trainingSessionTab").hide();
    $("#trainingAuthTab").show();

    showTrainingStatus("Account unlinked successfully", "success");
  }
}

/**
 * Refresh stats for all quizzes - uses same mechanism as initial load
 */
function refreshAllQuizStats() {
  if (!trainingState.authToken) {
    console.log("[AMQ+ Training] No auth token, cannot refresh stats");
    return;
  }

  console.log("[AMQ+ Training] Refreshing all quiz stats via token validation...");

  makeApiRequest({
    url: `${API_BASE_URL}/api/training/token/validate`,
    method: 'POST',
    data: { token: trainingState.authToken },
    errorPrefix: 'Refresh Stats',
    onSuccess: (data) => {
      console.log("[AMQ+ Training] Stats refreshed successfully");
      console.log("[AMQ+ Training] Received", data.quizzes?.length || 0, "quizzes with updated stats");

      // Update the quiz list with fresh data
      trainingState.userQuizzes = data.quizzes || [];

      // Log stats for each quiz
      trainingState.userQuizzes.forEach(quiz => {
        console.log(`[AMQ+ Training] ${quiz.name}: dueToday=${quiz.stats?.dueToday || 0}, accuracy=${quiz.stats?.accuracy || 0}%`);
      });

      // Reload the quiz list display
      loadTrainingQuizzes();
    },
    onError: (errorMsg) => {
      console.error("[AMQ+ Training] Failed to refresh stats:", errorMsg);
    }
  });
}

function loadTrainingQuizzes() {
  const quizListDiv = $("#trainingQuizList");

  if (!trainingState.userQuizzes || trainingState.userQuizzes.length === 0) {
    quizListDiv.html(`
      <div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.6);">
        <i class="fa fa-inbox" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5; display: block;"></i>
        <p>No quizzes found. Create some quizzes on AMQ+ website first!</p>
      </div>
    `);
    return;
  }

  // Populate profile dropdown
  scanOldTrainingProfiles();

  let html = "";
  console.log("[AMQ+ Training] Rendering quiz list, userQuizzes count:", trainingState.userQuizzes.length);

  trainingState.userQuizzes.forEach((quiz, index) => {
    const stats = quiz.stats || {};
    const hasTrainingData = stats.totalAttempts > 0;

    console.log(`[AMQ+ Training] Quiz ${index + 1} - ${quiz.name}:`, {
      id: quiz.id,
      hasStats: !!quiz.stats,
      totalAttempts: stats.totalAttempts,
      accuracy: stats.accuracy,
      last10Success: stats.last10Success,
      last10Total: stats.last10Total,
      dueToday: stats.dueToday
    });

    // Use accuracy from API (calculated from last 10 attempts per song, matching website)
    const accuracy = hasTrainingData ? (stats.accuracy || 0) : 0;
    const last10Success = stats.last10Success || 0;
    const last10Total = stats.last10Total || 0;
    const dueToday = stats.dueToday || 0;
    const dueColor = dueToday > 10 ? "#ef4444" : dueToday > 5 ? "#ffc107" : "#10b981";

    html += `
      <div class="training-quiz-card" data-quiz-id="${quiz.id}" style="
        padding: 15px;
        margin-bottom: 10px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #2d3748;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      " onmouseover="this.style.borderColor='#6366f1'; this.style.boxShadow='0 4px 8px rgba(99, 102, 241, 0.3)'"
         onmouseout="if(!this.classList.contains('selected')) { this.style.borderColor='#2d3748'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.2)'; }">
        <h5 style="margin: 0 0 10px 0; color: #fff; font-weight: bold;">${quiz.name}</h5>
        ${hasTrainingData ? `
        <div style="display: flex; gap: 20px; font-size: 13px; color: rgba(255,255,255,0.8);">
          <div title="Accuracy from last 10 attempts per song">
            <i class="fa fa-chart-line"></i> ${accuracy}% accuracy
            <small style="display: block; font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px;">
              (${last10Success}/${last10Total}) last 10 per song
            </small>
          </div>
          <div style="color: ${dueColor}; font-weight: bold;">
            <i class="fa fa-clock"></i> ${dueToday} due today
          </div>
        </div>
        ` : `
        <div style="font-size: 12px; color: rgba(255,255,255,0.5); font-style: italic;">
          No training data yet. Start a session to begin tracking progress!
        </div>
        `}
      </div>
    `;
  });

  quizListDiv.html(html);

  // Add selected style - darker selection color
  if (!$("#trainingQuizCardStyles").length) {
    $("<style id='trainingQuizCardStyles'>")
      .text(".training-quiz-card.selected { border-color: #4f46e5 !important; background: linear-gradient(135deg, #4338ca 0%, #312e81 100%) !important; box-shadow: 0 4px 12px rgba(67, 56, 202, 0.6) !important; }")
      .appendTo("head");
  }
}


function resetUrlQuizSelection() {
  console.log("[AMQ+ Training] Resetting URL quiz selection");
  trainingState.urlLoadedQuizId = null;
  trainingState.urlLoadedQuizName = null;
  trainingState.urlLoadedQuizSongCount = null;
  saveTrainingSettings(); // Save the reset state

  $("#trainingUrlInputSection").show();
  $("#trainingUrlQuizDetails").hide();
  $("#trainingUrlInput").val("");
  $("#trainingUrlError").hide();
}

/**
 * Fetch training stats for a quiz and display them
 * @param {string} quizId - Quiz ID to fetch stats for
 * @param {string} quizName - Quiz name for display
 */
function fetchQuizStatsAndDisplay(quizId, quizName) {
  if (!trainingState.authToken) {
    // Not authenticated, just show no data message
    $("#trainingUrlQuizStats").html(getQuizStatsHTML(quizId));
    $("#trainingUrlInputSection").hide();
    $("#trainingUrlQuizDetails").show();
    $(".training-quiz-card").removeClass("selected");
    return;
  }

  // Fetch stats from server
  makeApiRequest({
    url: `${API_BASE_URL}/api/training/quiz/${quizId}/stats`,
    method: 'POST',
    data: { token: trainingState.authToken },
    errorPrefix: 'Fetch Quiz Stats',
    onSuccess: (data) => {
      console.log("[AMQ+ Training] ===== API RESPONSE START =====");
      console.log("[AMQ+ Training] Fetched stats for quiz:", quizId);
      console.log("[AMQ+ Training] Full API response:", JSON.stringify(data, null, 2));

      if (data.stats) {
        console.log("[AMQ+ Training] Stats breakdown:");
        console.log("  - totalAttempts:", data.stats.totalAttempts);
        console.log("  - totalSuccess:", data.stats.totalSuccess);
        console.log("  - accuracy:", data.stats.accuracy);
        console.log("  - last10Success:", data.stats.last10Success);
        console.log("  - last10Total:", data.stats.last10Total);
        console.log("  - dueToday:", data.stats.dueToday);
        console.log("  - averageDifficulty:", data.stats.averageDifficulty);
        console.log("  - masteryDistribution:", data.stats.masteryDistribution);
      }
      console.log("[AMQ+ Training] ===== API RESPONSE END =====");

      // Add quiz to user's quiz list if it has stats
      if (data.stats && data.stats.totalAttempts > 0) {
        const quizData = {
          id: quizId,
          name: quizName,
          stats: data.stats
        };

        // Check if already exists
        const existingIndex = trainingState.userQuizzes.findIndex(q => q.id === quizId);
        if (existingIndex >= 0) {
          // Update existing
          trainingState.userQuizzes[existingIndex] = quizData;
          console.log("[AMQ+ Training] Updated existing quiz in list at index:", existingIndex);
        } else {
          // Add new
          trainingState.userQuizzes.push(quizData);
          console.log("[AMQ+ Training] Added new quiz to list, total quizzes:", trainingState.userQuizzes.length);
        }

        console.log("[AMQ+ Training] Current userQuizzes state:", trainingState.userQuizzes);
      }

      // Display stats
      $("#trainingUrlQuizStats").html(getQuizStatsHTML(quizId));
      $("#trainingUrlInputSection").hide();
      $("#trainingUrlQuizDetails").show();
      $(".training-quiz-card").removeClass("selected");
    },
    onError: (errorMsg) => {
      console.log("[AMQ+ Training] No stats found for quiz or error:", errorMsg);
      // Show no data message
      $("#trainingUrlQuizStats").html(getQuizStatsHTML(quizId));
      $("#trainingUrlInputSection").hide();
      $("#trainingUrlQuizDetails").show();
      $(".training-quiz-card").removeClass("selected");
    }
  });
}

/**
 * Helper function to get training stats HTML for a quiz
 * @param {string} quizId - Quiz ID to look up stats for
 * @returns {string} HTML string with stats or no data message
 */
function getQuizStatsHTML(quizId) {
  // Try to find the quiz in user's private quizzes
  const quiz = trainingState.userQuizzes.find(q => q.id === quizId);

  console.log("[AMQ+ Training] getQuizStatsHTML - quizId:", quizId);
  console.log("[AMQ+ Training] getQuizStatsHTML - found quiz:", quiz);

  if (!quiz || !quiz.stats) {
    console.log("[AMQ+ Training] getQuizStatsHTML - no quiz or stats found");
    return `
      <div style="font-size: 12px; color: rgba(255,255,255,0.5); font-style: italic;">
        No training data yet. Start a session to begin tracking progress!
      </div>
    `;
  }

  const stats = quiz.stats;
  const hasTrainingData = stats.totalAttempts > 0;

  console.log("[AMQ+ Training] getQuizStatsHTML - stats:", stats);
  console.log("[AMQ+ Training] getQuizStatsHTML - hasTrainingData:", hasTrainingData);

  if (!hasTrainingData) {
    console.log("[AMQ+ Training] getQuizStatsHTML - no training data (totalAttempts = 0)");
    return `
      <div style="font-size: 12px; color: rgba(255,255,255,0.5); font-style: italic;">
        No training data yet. Start a session to begin tracking progress!
      </div>
    `;
  }

  // Use accuracy from API (calculated from last 10 attempts per song, matching website)
  const accuracy = stats.accuracy || 0;
  const last10Success = stats.last10Success || 0;
  const last10Total = stats.last10Total || 0;
  const dueToday = stats.dueToday || 0;
  const dueColor = dueToday > 10 ? "#ef4444" : dueToday > 5 ? "#ffc107" : "#10b981";

  console.log("[AMQ+ Training] getQuizStatsHTML - Display values:");
  console.log("  accuracy:", accuracy);
  console.log("  last10Success:", last10Success);
  console.log("  last10Total:", last10Total);
  console.log("  dueToday:", dueToday);

  return `
    <div style="display: flex; gap: 20px; font-size: 13px; color: rgba(255,255,255,0.8);">
      <div title="Accuracy from last 10 attempts per song">
        <i class="fa fa-chart-line"></i> ${accuracy}% accuracy
        <small style="display: block; font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px;">
          (${last10Success}/${last10Total}) last 10 per song
        </small>
      </div>
      <div style="color: ${dueColor}; font-weight: bold;">
        <i class="fa fa-clock"></i> ${dueToday} due today
      </div>
    </div>
  `;
}

function restoreUrlQuizDisplay() {
  // Restore URL quiz display if there's a saved URL quiz
  if (trainingState.urlLoadedQuizId && trainingState.urlLoadedQuizName) {
    console.log("[AMQ+ Training] Restoring URL quiz display:", trainingState.urlLoadedQuizName);
    $("#trainingUrlQuizName").text(trainingState.urlLoadedQuizName);

    // Update stats display
    $("#trainingUrlQuizStats").html(getQuizStatsHTML(trainingState.urlLoadedQuizId));

    $("#trainingUrlInputSection").hide();
    $("#trainingUrlQuizDetails").show();
  } else {
    $("#trainingUrlInputSection").show();
    $("#trainingUrlQuizDetails").hide();
  }
}

function loadTrainingFromUrl() {
  const urlInput = $("#trainingUrlInput").val().trim();
  const errorDiv = $("#trainingUrlError");

  console.log("[AMQ+ Training] Loading from URL:", urlInput);

  if (!urlInput) {
    errorDiv.html('<i class="fa fa-exclamation-triangle"></i> Please enter a URL or quiz ID').show();
    return;
  }

  // Parse quiz ID/token from various formats:
  // - Full URL: https://amqplus.moe/play/abc123 (could be quiz ID or play token)
  // - Path: /play/abc123
  // - Just the ID/token: abc123
  let identifier = null;

  try {
    // Try to parse as URL
    if (urlInput.includes('/')) {
      const match = urlInput.match(/\/play\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        identifier = match[1];
      }
    } else {
      // Assume it's just the quiz ID or token
      identifier = urlInput;
    }

    if (!identifier) {
      throw new Error("Could not extract identifier from URL");
    }

    console.log("[AMQ+ Training] Parsed identifier:", identifier);

    // Clear error and disable button
    errorDiv.hide();
    const loadBtn = $("#trainingLoadFromUrlBtn");
    loadBtn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Loading...');

    // Determine if this is a play token (contains hyphens) or a quiz ID
    const isPlayToken = identifier.includes('-');
    const apiUrl = isPlayToken
      ? `${API_BASE_URL}/api/quiz/play/${identifier}`
      : `${API_BASE_URL}/api/quiz/${identifier}`;

    console.log("[AMQ+ Training] Fetching quiz info from:", apiUrl, isPlayToken ? "(play token)" : "(quiz ID)");

    // Fetch quiz details from server using helper
    makeApiRequest({
      url: apiUrl,
      method: 'GET',
      errorPrefix: 'Training URL Load',
      onSuccess: (quizData) => {
        console.log("[AMQ+ Training] Quiz loaded:", quizData);

        // Store quiz info in training state (use actual quiz ID from response if it's a token)
        const quizId = quizData.id || identifier;
        trainingState.urlLoadedQuizId = quizId;
        trainingState.urlLoadedQuizName = quizData.name;
        trainingState.urlLoadedQuizSongCount = quizData.songCount || 0;
        saveTrainingSettings(); // Save URL quiz info

        // Update UI to show quiz details
        $("#trainingUrlQuizName").text(quizData.name);

        // Check if quiz exists in user's private quizzes
        const existingQuiz = trainingState.userQuizzes.find(q => q.id === quizId);

        if (existingQuiz) {
          // Quiz already in list, show stats
          console.log("[AMQ+ Training] Quiz found in private quizzes, showing existing stats");
          $("#trainingUrlQuizStats").html(getQuizStatsHTML(quizId));
          $("#trainingUrlInputSection").hide();
          $("#trainingUrlQuizDetails").show();
          $(".training-quiz-card").removeClass("selected");
        } else {
          // Quiz not in list, fetch stats from server
          console.log("[AMQ+ Training] Quiz not in list, fetching stats from server");
          fetchQuizStatsAndDisplay(quizId, quizData.name);
        }

        console.log("[AMQ+ Training] Quiz details displayed for:", quizData.name, "(ID:", quizId + ")");
      },
      onError: (errorMsg) => {
        errorDiv.html('<i class="fa fa-exclamation-triangle"></i> ' + errorMsg).show();
      }
    }).finally(() => {
      loadBtn.prop("disabled", false).html('<i class="fa fa-arrow-right"></i> Load');
    });

  } catch (error) {
    console.error("[AMQ+ Training] Error parsing URL:", error);
    errorDiv.html('<i class="fa fa-exclamation-triangle"></i> Invalid URL format. Use format: https://amqplus.com/play/token-or-id').show();
    const loadBtn = $("#trainingLoadFromUrlBtn");
    loadBtn.prop("disabled", false).html('<i class="fa fa-arrow-right"></i> Load');
    return;
  }
}

// Store the previous auto skip replay state to restore after training
let savedAutoSkipReplayState = null;

function startTrainingSession(quizId, sessionLength, settingsConfig) {
  showTrainingStatus("Starting training session...", "info");
  // Check the training mode checkbox and update flag
  $("#trainingModeToggle").prop("checked", true);
  isTrainingMode = true; // Set flag to prevent hijacking

  // Disable auto skip replay during training mode
  // Save the current state first
  if (typeof options !== 'undefined' && options.$AUTO_VOTE_REPLAY) {
    savedAutoSkipReplayState = options.$AUTO_VOTE_REPLAY.prop("checked");
    if (savedAutoSkipReplayState) {
      console.log("[AMQ+ Training] Disabling auto skip replay for training mode");
      options.$AUTO_VOTE_REPLAY.prop("checked", false);
      options.updateAutoVoteSkipReplay();
    }
  }

  // Build API request based on mode
  const requestData = {
    token: trainingState.authToken,
    quizId: quizId,
    sessionLength: sessionLength
  };

  // Add configuration based on mode
  if (settingsConfig.mode === 'manual') {
    requestData.mode = 'manual';
    requestData.dueCount = settingsConfig.dueCount;
    requestData.newCount = settingsConfig.newCount;
    requestData.revisionCount = settingsConfig.revisionCount;
  } else {
    requestData.mode = 'auto';
    requestData.dueSongPercentage = settingsConfig.dueSongPercentage || 70;
  }

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/session/start`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify(requestData),
    onload: function (response) {
      // Reset button states
      const startBtn = $("#trainingStartBtn");
      startBtn.prop("disabled", false).html('<i class="fa fa-play"></i> Start Training');

      const loadBtn = $("#trainingLoadFromUrlBtn");
      loadBtn.prop("disabled", false).html('<i class="fa fa-arrow-right"></i> Load');

      if (response.status === 200) {
        const data = JSON.parse(response.responseText);

        // Use playlist metadata from server (includes proper songKey format)
        console.log("[AMQ+ Training] Received playlist metadata:", data.playlist);

        trainingState.currentSession = {
          sessionId: data.sessionId,
          quizId: quizId,
          quizName: data.quizName,
          playlist: data.playlist, // Use server's playlist metadata with proper songKey format
          currentIndex: 0,
          startTime: Date.now(),
          correctCount: 0,
          incorrectCount: 0,
          totalRated: 0 // Only count songs that were actually rated (not skipped)
        };

        saveTrainingSettings();

        // Display warnings if any
        if (data.warnings && data.warnings.length > 0) {
          console.log("[AMQ+ Training] Warnings from API:", data.warnings);
          data.warnings.forEach(warning => {
            sendSystemMessage("⚠️ Training: " + warning);
          });
        }

        // Display composition info
        if (data.composition) {
          const comp = data.composition;
          const poolSize = data.available?.totalPoolSize || 'unknown';
          let compositionMsg = `🎵 Session: ${comp.due} already played (${comp.duePercentage}%), ${comp.new} new (${comp.newPercentage}%)`;
          if (comp.revision > 0) {
            compositionMsg += `, ${comp.revision} revision (${comp.revisionPercentage}%)`;
          }
          compositionMsg += ` | Pool size: ${poolSize}`;
          sendSystemMessage(compositionMsg);
        }

        // Use the command object directly from the API response
        console.log("[AMQ+ Training] Command received from server");
        console.log("[AMQ+ Training] Full command from server:", JSON.stringify(data.command, null, 2));
        const quizName = data.command.data.quizSave.name;

        // Close modal
        $("#amqPlusTrainingModal").modal("hide");
        sendSystemMessage(`Creating training quiz: ${data.quizName} (${data.totalSongs} songs)...`);

        // Use existing createOrUpdateQuiz function with the server-provided command
        createOrUpdateQuiz({ command: data.command });

        // Set up one-time listener for quiz save completion to apply and start training quiz
        const quizSavedListener = new Listener("save custom quiz", (payload) => {
          if (payload.success) {
            const savedQuizName = payload.quizSave?.name || quizName;
            if (savedQuizName === quizName) {
              console.log("[AMQ+ Training] Training quiz saved, applying to lobby...");
              quizSavedListener.unbindListener();

              const newQuizId = payload.quizId;
              applyQuizToLobby(newQuizId, quizName);

              // Set up listener for quiz selection to auto-start
              const quizSelectedListener = new Listener("custom quiz selected", (selectPayload) => {
                const selectedQuizName = selectPayload.quizName || selectPayload.data?.quizName || selectPayload.quizDescription?.name;
                if (selectedQuizName === quizName) {
                  console.log("[AMQ+ Training] Training quiz selected, starting game...");
                  quizSelectedListener.unbindListener();

                  setTimeout(() => {
                    console.log("[AMQ+ Training] Starting game automatically...");
                    if (typeof lobby.fireMainButtonEvent === 'function') {
                      lobby.fireMainButtonEvent(false);
                    } else if (typeof startQuiz === 'function') {
                      startQuiz();
                    }

                    sendSystemMessage(`Training quiz started: ${quizName}`);
                    // Keep training mode enabled during session
                  }, 500);
                }
              });
              quizSelectedListener.bindListener();
            }
          }
        });
        quizSavedListener.bindListener();

        console.log("[AMQ+ Training] Session started:", data);
      } else {
        // Uncheck training mode on error
        $("#trainingModeToggle").prop("checked", false);
        isTrainingMode = false; // Reset flag on error
        const errorData = JSON.parse(response.responseText);
        showTrainingStatus(errorData.error || "Failed to start session. Please try again.", "error");
      }
    },
    onerror: function () {
      // Uncheck training mode on error
      $("#trainingModeToggle").prop("checked", false);
      isTrainingMode = false; // Reset flag on error
      // Reset button states on error
      const startBtn = $("#trainingStartBtn");
      startBtn.prop("disabled", false).html('<i class="fa fa-play"></i> Start Training');

      const loadBtn = $("#trainingLoadFromUrlBtn");
      loadBtn.prop("disabled", false).html('<i class="fa fa-arrow-right"></i> Load');

      showTrainingStatus("Connection error. Please try again.", "error");
    }
  });
}

function endTrainingSession() {
  if (!trainingState.currentSession.sessionId) return;

  // Uncheck training mode checkbox
  $("#trainingModeToggle").prop("checked", false);
  isTrainingMode = false;

  // Restore auto skip replay state if it was previously enabled
  if (savedAutoSkipReplayState !== null && typeof options !== 'undefined' && options.$AUTO_VOTE_REPLAY) {
    if (savedAutoSkipReplayState) {
      console.log("[AMQ+ Training] Restoring auto skip replay state");
      options.$AUTO_VOTE_REPLAY.prop("checked", true);
      options.updateAutoVoteSkipReplay();
    }
    savedAutoSkipReplayState = null;
  }

  // Hide and remove rating UI if it exists
  $("#trainingRatingContainer").fadeOut(300, function () {
    $(this).remove();
  });
  $("#trainingRatingSection").fadeOut(300);

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/session/${trainingState.currentSession.sessionId}/complete`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken
    }),
    onload: function (response) {
      if (response.status === 200) {
        const data = JSON.parse(response.responseText);
        const summary = data.summary;

        sendSystemMessage(
          `Training session completed! ` +
          `${summary.correctSongs}/${summary.totalSongs} correct (${summary.accuracy}%) ` +
          `in ${summary.durationMinutes} minutes`
        );

        // Clear session
        trainingState.currentSession = {
          sessionId: null,
          quizId: null,
          quizName: null,
          playlist: [],
          currentIndex: 0,
          startTime: null,
          correctCount: 0,
          incorrectCount: 0,
          totalRated: 0
        };

        localStorage.removeItem("amqPlusTrainingState");

        // Reset UI
        $("#trainingSessionTab").hide();
        $("#trainingQuizTab").show();
      }
    },
    onerror: function (error) {
      console.error("[AMQ+ Training] Error ending session:", error);
    }
  });
}

function reportSongProgress(annSongId, rating, success, answerDetails = {}) {
  if (!trainingState.currentSession.sessionId || !trainingState.authToken) {
    console.warn("[AMQ+ Training] Cannot report progress: no active session");
    return;
  }

  const syncData = {
    sessionId: trainingState.currentSession.sessionId,
    annSongId: annSongId, // Primary identifier for database storage
    rating: rating,
    success: success,
    timestamp: new Date().toISOString(),
    userAnswer: answerDetails.userAnswer || null,
    correctAnswer: answerDetails.correctAnswer || null
  };

  console.log("[AMQ+ Training] Reporting progress to server:", {
    annSongId: annSongId,
    rating: rating,
    success: success,
    sessionId: trainingState.currentSession.sessionId,
    userAnswer: syncData.userAnswer,
    correctAnswer: syncData.correctAnswer
  });

  // Send immediately instead of debouncing
  sendProgressToServer(syncData);
}

function sendProgressToServer(syncData) {
  console.log("[AMQ+ Training] Sending progress request to server:", syncData);

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/session/${syncData.sessionId}/progress`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken,
      annSongId: syncData.annSongId,
      rating: syncData.rating,
      success: syncData.success,
      userAnswer: syncData.userAnswer,
      correctAnswer: syncData.correctAnswer
    }),
    onload: function (response) {
      console.log("[AMQ+ Training] Progress request response:", response.status, response.responseText);
      if (response.status === 200) {
        try {
          const responseData = JSON.parse(response.responseText);
          if (responseData.success === false) {
            const errorMsg = responseData.error || "Unknown error";
            console.error("[AMQ+ Training] ✗ Server returned error:", errorMsg);
            sendSystemMessage(`⚠️ Training error: ${errorMsg}`);
            // Add to queue for retry
            trainingState.pendingSync.push(syncData);
            saveTrainingSettings();
            processTrainingSyncQueue();
          } else {
            console.log("[AMQ+ Training] ✓ Progress successfully sent to server");
          }
        } catch (e) {
          console.log("[AMQ+ Training] ✓ Progress successfully sent to server");
        }
      } else {
        let errorMsg = "Unknown error";
        try {
          const errorData = JSON.parse(response.responseText);
          errorMsg = errorData.error || errorData.message || errorMsg;
          console.log("[AMQ+ Training] DEBUG ERROR:", JSON.stringify(errorData, null, 2));
        } catch (e) {
          errorMsg = `HTTP ${response.status}`;
          console.log("[AMQ+ Training] DEBUG ERROR BODY:", response.responseText);
        }
        console.error("[AMQ+ Training] ✗ Progress request failed:", response.status, errorMsg);
        sendSystemMessage(`⚠️ Training error: ${errorMsg}`);
        // Add to queue for retry if it's not a 4xx error (which usually means invalid data)
        if (response.status >= 500 || response.status === 0) {
          trainingState.pendingSync.push(syncData);
          saveTrainingSettings();
          processTrainingSyncQueue();
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+ Training] ✗ Progress request error:", error);
      // Add to queue for retry
      trainingState.pendingSync.push(syncData);
      saveTrainingSettings();
      processTrainingSyncQueue();
    }
  });
}

function processTrainingSyncQueue() {
  if (trainingState.syncInProgress || trainingState.pendingSync.length === 0) {
    return;
  }

  trainingState.syncInProgress = true;
  const syncItem = trainingState.pendingSync[0];

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/session/${syncItem.sessionId}/progress`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken,
      songKey: syncItem.songKey,
      rating: syncItem.rating,
      success: syncItem.success,
      userAnswer: syncItem.userAnswer,
      correctAnswer: syncItem.correctAnswer
    }),
    onload: function (response) {
      if (response.status === 200) {
        // Remove from queue
        trainingState.pendingSync.shift();
        saveTrainingSettings();

        // Show sync success briefly
        $("#trainingSyncStatus").fadeIn(300).delay(2000).fadeOut(300);

        // Process next item
        trainingState.syncInProgress = false;
        if (trainingState.pendingSync.length > 0) {
          processTrainingSyncQueue();
        }
      } else {
        console.error("[AMQ+ Training] Sync failed:", response.status);
        trainingState.syncInProgress = false;
      }
    },
    onerror: function (error) {
      console.error("[AMQ+ Training] Sync error:", error);
      trainingState.syncInProgress = false;

      // Retry later
      setTimeout(() => {
        if (trainingState.pendingSync.length > 0) {
          processTrainingSyncQueue();
        }
      }, 5000);
    }
  });
}

function updateTrainingAccuracy() {
  if (!trainingState.currentSession || !trainingState.currentSession.sessionId) return;

  const correctCount = trainingState.currentSession.correctCount || 0;
  const totalRated = trainingState.currentSession.totalRated || 0; // Only count rated songs, not skipped

  let accuracyText;
  if (totalRated === 0) {
    accuracyText = "0% accuracy (0/0)";
  } else {
    const accuracy = Math.round((correctCount / totalRated) * 100);
    accuracyText = `${accuracy}% accuracy (${correctCount}/${totalRated})`;
  }

  $("#trainingSessionProgress").text(accuracyText);
}

function submitTrainingRating(rating) {
  if (!trainingState.currentSession.sessionId) return;

  const currentSong = trainingState.currentSession.playlist[trainingState.currentSession.currentIndex];
  if (!currentSong) {
    console.warn("[AMQ+ Training] No current song found");
    return;
  }

  const annSongId = currentSong.annSongId; // AMQ song ID - primary identifier
  const success = rating >= 3; // Good or Easy counts as success

  console.log("[AMQ+ Training] Submitting rating:", {
    rating: rating,
    annSongId: annSongId,
    success: success
  });

  // Get extra answer details if available
  const answerDetails = trainingState.lastAnswerDetails || {};
  console.log("[AMQ+ Training] Answer details:", answerDetails);
  // Clear them after use so they don't leak to next song
  trainingState.lastAnswerDetails = null;

  // Update counters
  trainingState.currentSession.totalRated++; // Increment total rated count
  if (success) {
    trainingState.currentSession.correctCount++;
  } else {
    trainingState.currentSession.incorrectCount++;
  }

  // Report to server immediately
  reportSongProgress(annSongId, rating, success, answerDetails);

  // Update UI
  $("#trainingSessionCorrect").text(trainingState.currentSession.correctCount);
  $("#trainingSessionIncorrect").text(trainingState.currentSession.incorrectCount);

  // Move to next song
  trainingState.currentSession.currentIndex++;

  // Update accuracy display
  updateTrainingAccuracy();

  // Hide rating section (both modal and video container versions)
  $("#trainingRatingSection").fadeOut(300);
  $("#trainingRatingContainer").fadeOut(300);

  // Send skip vote to advance to next phase now that user has rated
  socket.sendCommand({
    type: "quiz",
    command: "skip vote",
    data: { skipVote: true }
  });
  console.log("[AMQ+ Training] Rating submitted, skip vote sent to advance");

  // Check if session is complete
  if (trainingState.currentSession.currentIndex >= trainingState.currentSession.playlist.length) {
    setTimeout(() => {
      endTrainingSession();
    }, 1000);
  }
}

function skipTrainingRating() {
  if (!trainingState.currentSession.sessionId) return;

  const currentSong = trainingState.currentSession.playlist[trainingState.currentSession.currentIndex];
  const songKey = currentSong.songKey;

  // Try to get song name from AMQ quiz data if available by matching annSongId
  let songName = "Unknown";
  if (typeof quiz !== 'undefined' && quiz.songList) {
    try {
      const matchingSong = quiz.songList.find(s => String(s.annSongId) === String(songKey) || String(s.annId) === String(songKey));
      if (matchingSong) {
        songName = matchingSong.songName || "Unknown";
      }
    } catch (e) {
      console.warn("[AMQ+ Training] Error finding song name:", e);
    }
  }

  console.log("[AMQ+ Training] Skipping rating for song:", songName || "unknown");
  console.log("[AMQ+ Training] No progress will be sent to server for this song");

  // Move to next song without reporting
  // Note: totalRated is NOT incremented for skipped songs
  trainingState.currentSession.currentIndex++;

  // Update accuracy display (skipped songs don't affect accuracy)
  updateTrainingAccuracy();

  // Hide rating section (both modal and video container versions)
  $("#trainingRatingSection").fadeOut(300);
  $("#trainingRatingContainer").fadeOut(300);

  // Send skip vote to advance to next phase now that user has skipped rating
  socket.sendCommand({
    type: "quiz",
    command: "skip vote",
    data: { skipVote: true }
  });
  console.log("[AMQ+ Training] Rating skipped, skip vote sent to advance");

  // Check if session is complete
  if (trainingState.currentSession.currentIndex >= trainingState.currentSession.playlist.length) {
    setTimeout(() => {
      endTrainingSession();
    }, 1000);
  }
}

// Setup player answer listener to capture text
let trainingPlayerAnswerListener = new Listener("player answers", (payload) => {
  if (!isTrainingMode) return;

  try {
    const myPlayerId = typeof quiz !== 'undefined' ? quiz.myPlayerId : null;
    console.log("[AMQ+ Training] Player answers received, myPlayerId:", myPlayerId);
    if (myPlayerId !== null && payload.answers) {
      const myAnswer = payload.answers.find(a => a.gamePlayerId === myPlayerId);
      if (myAnswer) {
        trainingState.pendingAnswer = {
          gamePlayerId: myAnswer.gamePlayerId,
          answer: myAnswer.answer
        };
        console.log("[AMQ+ Training] Captured pending answer:", trainingState.pendingAnswer);
      } else {
        console.warn("[AMQ+ Training] My answer not found in payload");
      }
    }
  } catch (e) {
    console.warn("[AMQ+ Training] Error capturing player answer:", e);
  }
});
trainingPlayerAnswerListener.bindListener();

// Setup answer result listener for training mode
let trainingAnswerListener = new Listener("answer results", (result) => {
  if (!trainingState.currentSession || !trainingState.currentSession.sessionId) {
    console.log("[AMQ+ Training] No active training session, skipping rating UI");
    return;
  }

  // Only show rating UI if training mode is enabled via checkbox
  if (!isTrainingMode) {
    console.log("[AMQ+ Training] Training mode disabled, skipping rating UI");
    return;
  }

  console.log("[AMQ+ Training] Answer results received, showing rating UI");

  // Merge previously captured answer from "player answers" with result data
  try {
    const myPlayerId = typeof quiz !== 'undefined' ? quiz.myPlayerId : null;
    let userAnswer = null;
    let wasCorrect = false;
    let correctAnswer = null;

    // 1. Get user answer text (captured from "player answers" listener)
    if (trainingState.pendingAnswer && trainingState.pendingAnswer.gamePlayerId === myPlayerId) {
      userAnswer = trainingState.pendingAnswer.answer;
      // Clear pending answer
      trainingState.pendingAnswer = null;
    }

    // 2. Get correctness from "answer results"
    if (myPlayerId !== null && result.players) {
      const myPlayerResult = result.players.find(p => p.gamePlayerId === myPlayerId);
      if (myPlayerResult) {
        wasCorrect = myPlayerResult.correct;
      }
    }

    // 3. Get correct answer info
    if (result.songInfo) {
      correctAnswer = result.songInfo.animeNames ? (result.songInfo.animeNames.english || result.songInfo.animeNames.romaji) : null;
    }

    trainingState.lastAnswerDetails = {
      userAnswer,
      correctAnswer,
      wasCorrect
    };
    console.log("[AMQ+ Training] Captured answer details:", trainingState.lastAnswerDetails);

  } catch (e) {
    console.warn("[AMQ+ Training] Error extracting answer details:", e);
    trainingState.lastAnswerDetails = {};
  }

  // Ensure rating section exists in the video container
  let ratingContainer = $("#trainingRatingContainer");

  const videoContainer = $("#qpVideoContainerInner");
  if (videoContainer.length === 0) {
    console.error("[AMQ+ Training] Video container not found");
    return;
  }

  // Create Rating Buttons (Transient/Fadable)
  if (ratingContainer.length === 0) {
    const ratingHTML = `
      <div id="trainingRatingContainer" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; display: none; pointer-events: auto;">
        <div style="display: flex; gap: 8px; justify-content: center; align-items: center; background: rgba(0, 0, 0, 0.7); padding: 12px 16px; border-radius: 8px; backdrop-filter: blur(4px);">
          <button class="trainingRatingBtn btn" data-rating="1" style="min-width: 60px; padding: 8px 12px; background: #dc3545; color: white; border: none; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;">
            <i class="fa fa-times" style="font-size: 14px; display: block; margin-bottom: 2px;"></i>
            Again
          </button>
          <button class="trainingRatingBtn btn" data-rating="2" style="min-width: 60px; padding: 8px 12px; background: #ffc107; color: white; border: none; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;">
            <i class="fa fa-exclamation-triangle" style="font-size: 14px; display: block; margin-bottom: 2px;"></i>
            Hard
          </button>
          <button class="trainingRatingBtn btn" data-rating="3" style="min-width: 60px; padding: 8px 12px; background: #10b981; color: white; border: none; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;">
            <i class="fa fa-check" style="font-size: 14px; display: block; margin-bottom: 2px;"></i>
            Good
          </button>
          <button class="trainingRatingBtn btn" data-rating="4" style="min-width: 60px; padding: 8px 12px; background: #6366f1; color: white; border: none; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; transition: opacity 0.2s;">
            <i class="fa fa-star" style="font-size: 14px; display: block; margin-bottom: 2px;"></i>
            Easy
          </button>
          <button class="trainingSkipBtn btn" data-skip="true" style="min-width: 50px; padding: 8px 12px; background: #6c757d; color: white; border: none; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; transition: opacity 0.2s; margin-left: 4px;">
            <i class="fa fa-forward" style="font-size: 14px; display: block; margin-bottom: 2px;"></i>
            Skip
          </button>
        </div>
      </div>
    `;
    videoContainer.append(ratingHTML);
    ratingContainer = $("#trainingRatingContainer");

    // Re-attach click handlers for dynamically created buttons
    $(".trainingRatingBtn").off("click").on("click", function () {
      const rating = parseInt($(this).data("rating"));
      submitTrainingRating(rating);
    });

    // Skip button handler - requires double-click to prevent accidental skips
    $(".trainingSkipBtn").off("dblclick").on("dblclick", function () {
      skipTrainingRating();
    });

    // Add hover effects
    $(".trainingRatingBtn, .trainingSkipBtn").hover(
      function () { $(this).css("opacity", "0.8"); },
      function () { $(this).css("opacity", "1"); }
    );
  }

  // Show rating buttons - skip vote will be sent when user clicks a rating
  ratingContainer.fadeIn(300);
  console.log("[AMQ+ Training] Rating buttons shown, waiting for user input");
});

trainingAnswerListener.bindListener();

// Listen for "quiz skipping to next phase" command from server to hide rating buttons
// Set up socket listener once the socket is available
function setupTrainingSocketListener() {
  if (typeof socket === 'undefined' || !socket._socket) {
    console.log("[AMQ+ Training] Socket not available yet, retrying in 1s...");
    setTimeout(setupTrainingSocketListener, 1000);
    return;
  }

  console.log("[AMQ+ Training] Setting up socket command listener");
  socket._socket.on("command", (payload) => {
    if (!isTrainingMode) return;

    // Check for quiz skipping to next phase (handle possible typos in server message)
    if (payload && (
      payload.command === "quiz skipping to next phase" ||
      payload.command === "quiz skpping to next phase"
    )) {
      console.log("[AMQ+ Training] Quiz skipping to next phase detected, hiding rating buttons");
      // Immediately hide rating buttons since we're moving to next round
      $("#trainingRatingSection").fadeOut(100);
      $("#trainingRatingContainer").fadeOut(100);
    }
  });
  console.log("[AMQ+ Training] Socket command listener registered");
}

// Initialize the socket listener
setupTrainingSocketListener();

// ============================================
// IMPORT OLD TRAINING DATA
// ============================================

function scanOldTrainingProfiles() {
  let foundProfiles = [];

  // Check if cslProfiles exists to get the list of profiles
  try {
    const profilesData = localStorage.getItem('cslProfiles');
    if (profilesData) {
      const profiles = JSON.parse(profilesData);
      if (Array.isArray(profiles) && profiles.length > 0) {
        foundProfiles = profiles;
      }
    }
  } catch (e) {
    console.warn('[AMQ+ Training] Error parsing cslProfiles:', e);
  }

  // If no profiles found, check for default
  if (foundProfiles.length === 0) {
    const defaultData = localStorage.getItem('spacedRepetitionData_default');
    if (defaultData) {
      foundProfiles = ['default'];
    }
  }

  // Populate dropdown with song counts (one profile at a time)
  const profileSelect = $("#trainingImportProfileSelect");
  if (foundProfiles.length === 0) {
    profileSelect.html('<option value="">No training data found</option>');
  } else {
    let html = '<option value="">Select profile to import...</option>';
    foundProfiles.forEach(profile => {
      try {
        const data = localStorage.getItem(`spacedRepetitionData_${profile}`);
        if (data) {
          const parsed = JSON.parse(data);
          const songCount = Object.keys(parsed).length;
          html += `<option value="${profile}">${profile} (${songCount} songs)</option>`;
        }
      } catch (e) {
        console.warn(`Error reading profile ${profile}:`, e);
      }
    });
    profileSelect.html(html);
  }
}

function getOldTrainingData(specificProfile = null) {
  const oldData = {};
  let foundProfiles = [];

  // First, check if cslProfiles exists to get the list of profiles
  try {
    const profilesData = localStorage.getItem('cslProfiles');
    if (profilesData) {
      const profiles = JSON.parse(profilesData);
      if (Array.isArray(profiles) && profiles.length > 0) {
        foundProfiles = profiles;
        console.log(`[AMQ+ Training] Found profiles: ${profiles.join(', ')}`);
      }
    }
  } catch (e) {
    console.warn('[AMQ+ Training] Error parsing cslProfiles:', e);
  }

  // Use only the specific profile requested
  if (specificProfile) {
    foundProfiles = [specificProfile];
  } else {
    // If no profiles found, try common default names
    if (foundProfiles.length === 0) {
      foundProfiles = ['default'];
    }
  }

  // Try to load data from each profile
  for (const profile of foundProfiles) {
    const key = `spacedRepetitionData_${profile}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate it has the expected structure
        if (typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          const firstKey = Object.keys(parsed)[0];
          const firstValue = parsed[firstKey];
          // Check for amqTrainingMode.js properties
          if (firstValue && typeof firstValue === 'object' &&
            ('efactor' in firstValue || 'successCount' in firstValue || 'lastFiveTries' in firstValue)) {
            console.log(`[AMQ+ Training] Found training data in profile: ${profile} (${Object.keys(parsed).length} songs)`);

            // Convert the data to the format expected by the import API
            // The old format uses songKey as "${artist}_${songName}"
            // We need to keep this format and add any missing fields
            for (const [songKey, songData] of Object.entries(parsed)) {
              oldData[songKey] = {
                efactor: songData.efactor || 2.5,
                successCount: songData.successCount || 0,
                failureCount: songData.failureCount || 0,
                successStreak: songData.successStreak || 0,
                failureStreak: songData.failureStreak || 0,
                date: songData.date || Date.now(),
                lastReviewDate: songData.lastReviewDate || songData.date || Date.now(),
                lastFiveTries: songData.lastFiveTries || [],
                // Note: interval is calculated from weight/efactor in old script
                // We approximate it from the data we have
                interval: songData.weight ? Math.max(1, Math.round(songData.weight / 100)) : 1
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[AMQ+ Training] Error parsing localStorage key ${key}:`, e);
    }
  }

  return oldData;
}

function showImportStatus(message, type = "info") {
  const statusDiv = $("#trainingImportStatus");
  const colors = {
    info: "#0dcaf0",
    success: "#28a745",
    error: "#dc3545",
    warning: "#ffc107"
  };

  statusDiv.html(`
    <div style="padding: 10px; background: ${colors[type]}15; border-left: 4px solid ${colors[type]}; border-radius: 4px;">
      <strong style="color: ${colors[type]};">${message}</strong>
    </div>
  `).show();
}

function importOldTrainingData() {
  const selectedProfile = $("#trainingImportProfileSelect").val();

  if (!selectedProfile) {
    showImportStatus("Please select a profile to import", "error");
    return;
  }

  if (!trainingState.authToken) {
    showImportStatus("Please link your account first", "error");
    return;
  }

  // Get old training data from localStorage
  const oldData = getOldTrainingData(selectedProfile);

  if (!oldData || Object.keys(oldData).length === 0) {
    showImportStatus("No training data found for this profile", "warning");
    return;
  }

  const songCount = Object.keys(oldData).length;
  if (!confirm(`Import ${songCount} songs from profile "${selectedProfile}"?\n\nThis will create a new quiz with the imported training data.`)) {
    return;
  }

  showImportStatus(`Creating quiz and importing ${songCount} songs...`, "info");

  // Disable button during import
  $("#trainingImportBtn").prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');

  // First, create the quiz with the profile name
  const quizName = `Imported: ${selectedProfile}`;

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/import-with-quiz`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken,
      localStorageData: oldData,
      quizName: quizName
    }),
    onload: function (response) {
      // Re-enable button
      $("#trainingImportBtn").prop("disabled", false).html('<i class="fa fa-upload"></i> Import');

      if (response.status === 200) {
        const data = JSON.parse(response.responseText);
        showImportStatus(`✓ Created quiz "${data.quizName}" with ${data.imported} songs!`, "success");

        // Reload quizzes to show the new quiz
        setTimeout(() => {
          validateTrainingToken(); // This will refresh the quiz list
          // Collapse the import section
          $("#trainingImportContent").slideUp(200);
          $("#trainingImportChevron").css("transform", "rotate(0deg)");
        }, 2000);
      } else {
        try {
          const errorData = JSON.parse(response.responseText);
          showImportStatus(`Import failed: ${errorData.error || 'Unknown error'}`, "error");
        } catch (e) {
          showImportStatus(`Import failed: HTTP ${response.status}`, "error");
        }
      }
    },
    onerror: function () {
      $("#trainingImportBtn").prop("disabled", false).html('<i class="fa fa-upload"></i> Import');
      showImportStatus("Connection error. Please try again.", "error");
    }
  });
}

console.log("[AMQ+ Training] Training mode initialized");


