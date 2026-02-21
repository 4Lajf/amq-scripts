// ==UserScript==
// @name         AMQ Plus Connector
// @namespace    http://tampermonkey.net/
// @version      1.2.1
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

/**
 * Check if script should be disabled based on game mode
 * Disables script in Jam, Ranked, or Themed mode
 */
function shouldDisableScript() {
  // Check if we're in a restricted game mode
  if (typeof lobby !== 'undefined' && lobby.inLobby && lobby.settings) {
    const gameMode = lobby.settings.gameMode;
    if (gameMode === "Jam" || gameMode === "Ranked" || gameMode === "Themed") {
      return true;
    }
  }

  if (typeof quiz !== 'undefined' && quiz.inQuiz && quiz.gameMode) {
    const gameMode = quiz.gameMode;
    if (gameMode === "Jam" || gameMode === "Ranked" || gameMode === "Themed") {
      return true;
    }
  }

  return false;
}

// Settings state
let amqPlusEnabled = false; // Always start disabled on page refresh
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
  dueSongPercentage: 70,
  revisionSongPercentage: 0,
  urlLoadedQuizId: null,
  urlLoadedQuizToken: null, // Store play token for URL-loaded quizzes
  urlLoadedQuizName: null,
  urlLoadedQuizSongCount: null,
  selectedQuizId: null,
  selectedQuizToken: null,
  requireDoubleClick: false, // Require double-click for rating buttons
  isSubmittingRating: false, // Prevent double-click/multiple rapid clicks on rating buttons
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

// ========================================
// 1v1 Duel Mode State
// ========================================
let duelModeEnabled = false; // Flag to indicate duel mode is active
let duelState = {
  roster: [], // Frozen player roster at game start (player names)
  rosterMap: {}, // Map of player name -> { username, platform, hasAnimeForSong: {} }
  indexToName: {}, // Map of index -> player name (for compact messaging)
  nameToIndex: {}, // Map of player name -> index (for compact messaging)
  pendingMappingParts: {}, // For multi-part mapping assembly: { total: N, parts: { 1: "...", 2: "..." } }
  roundRobinSchedule: [], // Pre-generated round-robin schedule: Array of rounds, each round is Array of pairs [playerA, playerB]
  usedRounds: [], // Indices of rounds already used
  currentRound: 0, // Current song/round number
  currentPairings: {}, // Map of playerName -> opponentName for current song
  myTarget: null, // Current player's opponent name
  wins: {}, // Map of playerName -> win count
  headToHead: {}, // Map of playerA -> { playerB -> wins }
  songOverlapMap: null, // Per-song overlap data: Map of annSongId -> { hasAnimeUsernames: [] }
  isHost: false, // Whether current player is the host
  BYE: '__BYE__' // Sentinel value for bye rounds
};

// Debug toggle for duel mode messages
let duelDebugEnabled = false;

// Toggle for duel result messages (wins/losses/ties)
let duelResultMessagesEnabled = true;

// Quick Sync / Basic Settings Mode state
let basicSettingsMode = false; // Track if Quick Sync basic mode is active

// Quiz re-roll prevention flag
let quizFetchedBeforeGameStart = false; // Track if quiz was already fetched before game starts
let roomSettingsQuizToken = null; // Store current temp quiz token
let roomSettingsHijacked = false; // Track if Room Settings has been hijacked
let isApplyingRoomSettingsQuiz = false; // Prevents infinite loop when applying quiz
let amqPlusHostModalTab = 'settings'; // Track active tab in AMQ+ Advanced mode: 'settings' | 'loadQuiz'
let isUpdatingAdvancedModeUI = false; // Prevents infinite loop in MutationObserver
let advancedModeUIUpdateTimeout = null; // Debounce timer for observer updates

function loadSettings() {
  // Always start with AMQ+ disabled on page refresh (don't restore enabled state)
  amqPlusEnabled = false;

  const saved = localStorage.getItem("amqPlusConnector");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      // Don't load amqPlusEnabled - always start disabled
      songSourceMessagesEnabled = data.songSourceMessagesEnabled ?? true;
      liveNodeSongSelectionMode = data.liveNodeSongSelectionMode ?? 'default';
      basicSettingsMode = data.basicSettingsMode ?? false;
      console.log("[AMQ+] Settings loaded from localStorage (AMQ+ always starts disabled):", data);
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
      if (state.dueSongPercentage !== undefined) {
        trainingState.dueSongPercentage = state.dueSongPercentage;
      }
      if (state.revisionSongPercentage !== undefined) {
        trainingState.revisionSongPercentage = state.revisionSongPercentage;
      }
      // Load URL-loaded quiz info if saved
      if (state.urlLoadedQuizId) {
        trainingState.urlLoadedQuizId = state.urlLoadedQuizId;
        trainingState.urlLoadedQuizToken = state.urlLoadedQuizToken;
        trainingState.urlLoadedQuizName = state.urlLoadedQuizName;
        trainingState.urlLoadedQuizSongCount = state.urlLoadedQuizSongCount;
        console.log("[AMQ+ Training] Restored URL-loaded quiz:", state.urlLoadedQuizName);
      }

      // Load selected quiz if saved
      if (state.selectedQuizId) {
        trainingState.selectedQuizId = state.selectedQuizId;
        trainingState.selectedQuizToken = state.selectedQuizToken;
        console.log("[AMQ+ Training] Restored selected quiz ID:", state.selectedQuizId);
      }
      // Load double-click preference if saved
      if (state.requireDoubleClick !== undefined) {
        trainingState.requireDoubleClick = state.requireDoubleClick;
        console.log("[AMQ+ Training] Loaded double-click mode:", trainingState.requireDoubleClick);
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
      dueSongPercentage: trainingState.dueSongPercentage,
      revisionSongPercentage: trainingState.revisionSongPercentage,
      urlLoadedQuizId: trainingState.urlLoadedQuizId,
      urlLoadedQuizToken: trainingState.urlLoadedQuizToken,
      urlLoadedQuizName: trainingState.urlLoadedQuizName,
      urlLoadedQuizSongCount: trainingState.urlLoadedQuizSongCount,
      selectedQuizId: trainingState.selectedQuizId,
      selectedQuizToken: trainingState.selectedQuizToken,
      requireDoubleClick: trainingState.requireDoubleClick
    };

    if (trainingState.currentSession && trainingState.currentSession.sessionId) {
      stateToSave.currentSession = trainingState.currentSession;
    }

    localStorage.setItem("amqPlusTrainingState", JSON.stringify(stateToSave));

    if (trainingState.pendingSync.length > 0) {
      localStorage.setItem("amqPlusTrainingSyncQueue", JSON.stringify(trainingState.pendingSync));
    } else {
      localStorage.removeItem("amqPlusTrainingSyncQueue");
    }
  } catch (e) {
    console.error("[AMQ+ Training] Failed to save training settings:", e);
  }
}

function saveSettings() {
  localStorage.setItem("amqPlusConnector", JSON.stringify({
    // Don't save enabled state - always starts disabled on page refresh
    songSourceMessagesEnabled: songSourceMessagesEnabled,
    liveNodeSongSelectionMode: liveNodeSongSelectionMode,
    basicSettingsMode: basicSettingsMode
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

  // Setup Room Settings hijacking when entering lobby
  setupRoomSettingsHijackOnLobbyEnter();
  setupBasicModeUIObserver();

  console.log("[AMQ+] Setup complete! Enabled:", amqPlusEnabled);
}

/**
 * Setup listener to hijack Room Settings when entering lobby
 */
function setupRoomSettingsHijackOnLobbyEnter() {
  // Hijack when joining lobby
  new Listener("Join Game", (data) => {
    console.log("[AMQ+] Joined lobby, setting up Room Settings hijacking...");
    setTimeout(() => {
      if (shouldDisableScript()) {
        console.log("[AMQ+] Script disabled: Jam, Ranked, or Themed mode detected");
        return;
      }
      if (amqPlusEnabled) {
        hijackRoomSettings();
      }
    }, 500);
  }).bindListener();

  // Also try to hijack when new player joins (ensures button exists)
  new Listener("New Player", (data) => {
    if (shouldDisableScript()) {
      return;
    }
    if (amqPlusEnabled) {
      hijackRoomSettings();

      // Send welcome message to new player with @mention
      setTimeout(() => {
        const playerName = data.name || data.username || (typeof data === 'string' ? data : null);
        if (playerName && typeof lobby !== 'undefined' && lobby.inLobby && lobby.isHost) {
          const isLiveNodeConfigured = cachedPlayerLists && cachedPlayerLists.length > 0;
          // Send a personalized message to the new player
          sendGlobalChatMessage(`@${playerName}: Welcome! You can change what Anime is taken from your list using the "/ listhelp" command for more info (no space).`);
        }
      }, 1000);
    }
  }).bindListener();
}

/**
 * Update the AMQ Settings UI for Basic Mode
 * Replaces "Empty" text in Genres and Tags with an informational message
 */
function updateBasicModeSettingsUI() {
  const message = "This feature is not available in Basic Mode, switch to Advanced or turn AMQ+ off.";
  const css = {
    "opacity": "1",
    "color": "white",
    "font-size": "14px",
    "text-align": "center",
    "padding": "10px"
  };

  const updateElement = (selector) => {
    const el = $(selector);
    if (!el.length) return;

    if (amqPlusEnabled && basicSettingsMode) {
      // If not already modified or text is different
      if (!el.data("amq-plus-modified") || el.text() !== message) {
        if (!el.data("original-text")) {
          el.data("original-text", el.text()); // Save original text
        }
        el.text(message);
        el.css(css);
        el.data("amq-plus-modified", true);
      }
    } else {
      // Revert if modified
      if (el.data("amq-plus-modified")) {
        const originalText = el.data("original-text") || "Empty";
        el.text(originalText);
        el.css({
          "opacity": "",
          "color": "",
          "font-size": "",
          "text-align": "",
          "padding": ""
        });
        el.removeData("amq-plus-modified");
      }
    }
  };

  updateElement("#mhGenreFilter .filterEmptyText");
  updateElement("#mhTagFilter .filterEmptyText");
}

/**
 * Render the AMQ+ host modal view based on the active tab
 * Applies visibility rules for Settings vs Load Quiz tabs
 */
function renderAmqPlusHostModalView() {
  const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;
  if (!isAdvancedMode) {
    return;
  }

  // Prevent infinite loops
  if (isUpdatingAdvancedModeUI) {
    return;
  }
  isUpdatingAdvancedModeUI = true;

  try {
    if (amqPlusHostModalTab === 'settings') {
      // === SETTINGS TAB: Apply trimmed view ===

      // Hide entire Anime section (contains Genre, Tags, Vintage, etc.)
      $("#mhAnimeSettings").hide();

      // === MODIFY QUIZ SETTINGS ===
      // Show Quiz section but hide most content, only keep Modifiers
      $("#mhQuizSettings").show();
      // Hide the category header
      $("#mhQuizSettings .mhSettingCategoryContainer").hide();
      // Hide Guess Time row
      $("#mhQuizGuessTimeContainer").closest(".row").hide();
      // Hide Sample Point and Playback Speed row
      $("#mhSamplePointSpecificContainer").closest(".row").hide();
      $("#mhSamplePointRangeContainer").closest(".row").hide();
      // Hide Song Difficulty and Song Popularity row
      $("#mhSongDiffContainer").closest(".row").hide();

      // === MODIFY MODE SETTINGS ===
      // Show Mode Settings but hide specific elements
      $("#mhModeSettings").show();
      // Hide the category header
      $("#mhModeSettings .mhSettingCategoryContainer").hide();
      // Hide Game Mode selector
      $("#mhGameModeSelector").hide();
      // Hide Community Score container (we'll show the regular Scoring instead)
      $("#mhCommunityScoreContainer").hide();
      // Hide Show Selection row
      $(".row:has(#mhShowSelectionSlider)").hide();
      // Hide Lives
      $("#mhLifeContainer").hide();
      // Hide Boss mode settings
      $("#mhBossModeContainer").hide();
      // Hide Battle Royale settings
      $("#mhQuizBattleRoyaleSettingRow").hide();

      // Show Scoring and Answering
      $(".row:has(#mhScoringSlider)").show();
      $(".row:has(#mhAnsweringSlider)").show();

      // === MODIFY GENERAL SETTINGS ===
      // Show only: Room Name, Private Room, Number of Players, Team Size
      // Hide: Song Selection, Song Types, Watched/Unwatched sliders, Song Categories
      $("#mhSongSelectionOuterContainer").hide();
      $("#mnSongTypeStandardContainer").hide();
      $("#mhSongSelectionCustomContainer").hide();
      $("#mhSongTypeCustomContainer").hide();
      $("#mhWatchedDisitributionContainer").hide();
      // Hide Number of Songs (managed by AMQ+)
      $("#mhNumberOfSongsContainer").hide();

      // Hide Song Categories
      $("label:contains('Song Categories')").closest(".row").hide();

      // === MODIFY MODIFIERS ===
      // Remove: Duplicate Shows, Dub Songs, Full Song Range completely
      // Hide: Rebroadcast Songs
      $("#mhDuplicateShows").closest("div").remove();
      $("#mhRebroadcastSongs").closest("div.largeCheckbox").hide();
      $("#mhDubSongs").closest("div").remove();
      $("#mhFullSongRange").closest("div").remove();

      // === SHOW INFO MESSAGE ===
      if (!$("#amqPlusAdvancedModeInfo").length) {
        const infoMessage = $(`
        <div id="amqPlusAdvancedModeInfo" style="
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(99, 102, 241, 0.1) 100%);
          border: 1px solid rgba(99, 102, 241, 0.5);
          border-radius: 8px;
          padding: 15px;
          margin: 15px 0;
          text-align: center;
          color: white;
        ">
          <i class="fa fa-info-circle" style="font-size: 20px; margin-right: 8px; color: #6366f1;"></i>
          <span style="font-size: 14px;">
            Manage the rest of the settings in the <strong style="color: #6366f1;">AMQ+ App</strong>.
          </span>
        </div>
      `);

        // Insert after General Settings
        $("#mhGeneralSettings").after(infoMessage);
      } else {
        // Update existing message text
        $("#amqPlusAdvancedModeInfo span").html('Manage the rest of the settings in the <strong style="color: #6366f1;">AMQ+ App</strong>.');
        $("#amqPlusAdvancedModeInfo").show();
      }

      // Hide the quick select container (Mode/General/Quiz/Anime buttons)
      $("#mhQuickSelectContainer").hide();

      // Hide the swap mode button
      $("#mhSwapModeButtonContainer").hide();

    }
    // Note: Load Quiz tab opens the AMQ+ modal directly, no rendering needed here
  } finally {
    // Reset flag after update completes
    setTimeout(() => {
      isUpdatingAdvancedModeUI = false;
    }, 100);
  }
}

/**
 * Update the AMQ Settings UI for Advanced Mode
 * Handles tab injection and delegates rendering to renderAmqPlusHostModalView()
 */
function updateAdvancedModeSettingsUI() {
  // Prevent infinite loops
  if (isUpdatingAdvancedModeUI) {
    return;
  }

  const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;
  const tabContainer = $(".tabContainer.quizBuilderHidden");
  const quickTab = $("#mhQuickTab");
  const advancedTab = $("#mhAdvancedTab");

  if (!tabContainer.length) {
    return;
  }

  // Set flag before proceeding
  isUpdatingAdvancedModeUI = true;

  try {
    if (isAdvancedMode) {
      // === TAB INJECTION + STATE MANAGEMENT ===
      // Check if we've already modified the tabs
      if (!$("#amqPlusSettingsTab").length) {
        // Hide original tabs
        quickTab.hide();
        advancedTab.hide();

        // Create new "Settings" tab
        const settingsTab = $(`
        <div id="amqPlusSettingsTab" class="tab clickAble selected">
          <h5>Settings</h5>
        </div>
      `);

        // Create new "Load Quiz" tab
        const loadQuizTab = $(`
        <div id="amqPlusLoadQuizTab" class="tab clickAble">
          <h5>Load Quiz</h5>
        </div>
      `);

        // Insert after advanced tab (before the .right container)
        advancedTab.after(loadQuizTab);
        advancedTab.after(settingsTab);

        // Ensure modal is in advanced mode when tabs are created
        // Use setTimeout to avoid triggering observer during DOM manipulation
        setTimeout(() => {
          if (typeof hostModal !== 'undefined' && hostModal.changeView) {
            hostModal.changeView('advanced');
          }
        }, 100);

        // Handle tab switching
        settingsTab.off("click").on("click", function () {
          if (isUpdatingAdvancedModeUI) return; // Prevent clicks during updates

          $(this).addClass("selected");
          $("#amqPlusLoadQuizTab").removeClass("selected");
          amqPlusHostModalTab = 'settings';

          // Ensure modal is in advanced mode and hide load container
          if (typeof hostModal !== 'undefined') {
            if (hostModal.changeView) {
              hostModal.changeView('advanced');
            }
            if (hostModal.hideLoadContainer) {
              hostModal.hideLoadContainer();
            }
          }

          // Use setTimeout to allow DOM to settle before rendering
          setTimeout(() => {
            renderAmqPlusHostModalView();
          }, 100);
        });

        loadQuizTab.off("click").on("click", function () {
          if (isUpdatingAdvancedModeUI) return; // Prevent clicks during updates

          // Close the Room Settings modal by clicking the Exit button
          $('button[data-dismiss="modal"][data-i18n="game_settings.buttons.exit"]').click();

          // Open the AMQ+ configuration modal after a short delay
          setTimeout(() => {
            // Remove any leftover modal backdrops and modal-open class
            $(".modal-backdrop").remove();
            $("body").removeClass("modal-open").css("padding-right", "");

            // Show the AMQ+ modal
            $("#amqPlusModal").modal("show");

            // Ensure modal-open class is applied and scrolling works
            setTimeout(() => {
              $("body").addClass("modal-open");
            }, 50);
          }, 200);
        });

        // Initialize to Settings tab
        amqPlusHostModalTab = 'settings';
      } else {
        // Sync tab state with actual selected tab
        const settingsTabSelected = $("#amqPlusSettingsTab").hasClass("selected");
        const loadQuizTabSelected = $("#amqPlusLoadQuizTab").hasClass("selected");

        if (loadQuizTabSelected) {
          amqPlusHostModalTab = 'loadQuiz';
        } else {
          amqPlusHostModalTab = 'settings';
        }
      }

      // Render the view based on active tab
      renderAmqPlusHostModalView();

    } else {
      // === REVERT ALL CHANGES ===
      // Reset tab state
      amqPlusHostModalTab = 'settings';

      // Show original tabs
      quickTab.show();
      advancedTab.show();

      // Remove custom tabs
      $("#amqPlusSettingsTab").remove();
      $("#amqPlusLoadQuizTab").remove();

      // Show all hidden sections
      $("#mhAnimeSettings").show();
      $("#mhQuizSettings").show();
      $("#mhModeSettings").show();

      // Show Quiz Settings elements
      $("#mhQuizSettings .mhSettingCategoryContainer").show();
      $("#mhQuizGuessTimeContainer").closest(".row").show();
      $("#mhSamplePointSpecificContainer").closest(".row").show();
      $("#mhSamplePointRangeContainer").closest(".row").show();
      $("#mhSongDiffContainer").closest(".row").show();

      // Show Mode Settings elements
      $("#mhModeSettings .mhSettingCategoryContainer").show();
      $("#mhCommunityScoreContainer").show();

      // Show hidden elements in General Settings
      $("#mhSongSelectionOuterContainer").show();
      $("#mnSongTypeStandardContainer").show();
      $("#mhSongSelectionCustomContainer").show();
      $("#mhSongTypeCustomContainer").show();
      $("#mhWatchedDisitributionContainer").show();
      $("#mhNumberOfSongsContainer").show();
      $("label:contains('Song Categories')").closest(".row").show();

      // Show hidden elements in Mode Settings
      $("#mhGameModeSelector").show();
      $(".row:has(#mhShowSelectionSlider)").show();
      $(".row:has(#mhScoringSlider)").show();
      $(".row:has(#mhAnsweringSlider)").show();
      $("#mhLifeContainer").show();
      $("#mhBossModeContainer").show();
      $("#mhQuizBattleRoyaleSettingRow").show();

      // Show hidden modifiers
      $("#mhDuplicateShows").closest("div").show();
      $("#mhRebroadcastSongs").closest("div.largeCheckbox").show();
      $("#mhDubSongs").closest("div").show();
      $("#mhFullSongRange").closest("div").show();

      // Remove info message
      $("#amqPlusAdvancedModeInfo").remove();

      // Show quick select and swap mode
      $("#mhQuickSelectContainer").show();
      $("#mhSwapModeButtonContainer").show();
    }
  } finally {
    // Reset flag after update completes
    setTimeout(() => {
      isUpdatingAdvancedModeUI = false;
    }, 100);
  }
}

/**
 * Setup observer for AMQ Settings UI changes
 */
function setupBasicModeUIObserver() {
  const observer = new MutationObserver((mutations) => {
    // Skip if we're already updating to prevent infinite loops
    if (isUpdatingAdvancedModeUI) return;

    // Check if relevant elements exist in the mutations or in the DOM
    const genreEmpty = document.querySelector("#mhGenreFilter .filterEmptyText");
    const tagEmpty = document.querySelector("#mhTagFilter .filterEmptyText");
    const tabContainer = document.querySelector(".tabContainer.quizBuilderHidden");

    if (genreEmpty || tagEmpty) {
      updateBasicModeSettingsUI();
    }

    // Debounce advanced mode UI updates to prevent excessive calls
    if (tabContainer) {
      // Clear existing timeout
      if (advancedModeUIUpdateTimeout) {
        clearTimeout(advancedModeUIUpdateTimeout);
      }

      // Set new timeout with debounce
      advancedModeUIUpdateTimeout = setTimeout(() => {
        if (!isUpdatingAdvancedModeUI) {
          updateAdvancedModeSettingsUI();

          // When modal opens in Advanced mode, ensure Settings tab is selected
          const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;
          if (isAdvancedMode) {
            const settingsTab = $("#amqPlusSettingsTab");
            const loadQuizTab = $("#amqPlusLoadQuizTab");

            if (settingsTab.length && loadQuizTab.length && !settingsTab.hasClass("selected")) {
              amqPlusHostModalTab = 'settings';
              settingsTab.addClass("selected");
              loadQuizTab.removeClass("selected");

              if (typeof hostModal !== 'undefined' && hostModal.hideLoadContainer) {
                hostModal.hideLoadContainer();
              }

              renderAmqPlusHostModalView();
            }
          }
        }
        advancedModeUIUpdateTimeout = null;
      }, 200);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden"]
  });
}

function setupSocketCommandInterceptor() {
  if (!socket._amqPlusCommandHijacked) {
    const originalSendCommand = socket.sendCommand.bind(socket);
    socket.sendCommand = function (command) {
      // Disable script in restricted modes (Jam, Ranked, Themed)
      if (shouldDisableScript()) {
        return originalSendCommand.call(this, command);
      }

      // Intercept like state command for AMQ+ quizzes
      if (command.command === "update custom quiz like state" && command.type === "quizCreator") {
        console.log("[AMQ+] Intercepted like state command:", command);

        if (currentQuizInfo && currentQuizInfo.name && currentQuizInfo.name.startsWith("AMQ+")) {
          const likeState = command.data?.likeState || 0;
          console.log("[AMQ+] Sending like state to AMQ+ API instead of AMQ server for quiz:", currentQuizInfo.name);
          sendQuizLikeByIdentifiers(currentQuizInfo, likeState);
          return;
        }
      }

      // Intercept "change game settings" command when in basic settings mode
      // IMPORTANT: Must also check amqPlusEnabled to avoid interfering when AMQ+ is disabled
      if (command.command === "change game settings" && command.type === "lobby" && amqPlusEnabled && basicSettingsMode) {
        console.log("[AMQ+] Intercepted change game settings in basic mode:", command);

        // Skip if this is just a community mode toggle (no actual settings changes)
        // This prevents infinite loop when applying the quiz triggers another settings change
        const isOnlyCommunityModeChange = command.data &&
          command.data.communityMode !== undefined &&
          (!command.data.settingChanges || Object.keys(command.data.settingChanges).length === 0);

        if (isOnlyCommunityModeChange) {
          console.log("[AMQ+] Skipping quiz creation - this is just a community mode toggle");
          return originalSendCommand.call(this, command);
        }

        // Skip if we're currently applying a quiz (prevents infinite loop)
        if (isApplyingRoomSettingsQuiz) {
          console.log("[AMQ+] Skipping quiz creation - currently applying a quiz");
          return originalSendCommand.call(this, command);
        }

        // Check if we have player lists configured
        if (cachedPlayerLists && cachedPlayerLists.length > 0) {
          // Reset quiz fetched flag when settings change - new settings require new quiz
          quizFetchedBeforeGameStart = false;
          console.log("[AMQ+] Settings changed, reset quiz fetched flag - will fetch new quiz");

          // First, let the command go through to AMQ so lobby.settings gets updated
          const result = originalSendCommand.call(this, command);

          // After a short delay, read the updated lobby.settings and create the quiz
          setTimeout(() => {
            const updatedSettings = typeof lobby !== 'undefined' && lobby.settings ? lobby.settings : null;

            if (!updatedSettings) {
              console.log("[AMQ+] Could not read updated lobby.settings");
              return;
            }

            console.log("[AMQ+] Read updated lobby.settings after change:", updatedSettings);

            // Validate watchedDistribution (1=Random, 2=Weighted, 3=Equal)
            if (updatedSettings.watchedDistribution === 2) {
              sendSystemMessage("⚠️ Weighted Watched Distribution mode is not supported by AMQ+. Please use Random or Equal mode.");
              return;
            }

            // Create room settings quiz via API using the updated settings
            handleRoomSettingsQuizCreation(updatedSettings);
          }, 100); // Small delay to let AMQ process the settings change

          return result;
        } else {
          console.log("[AMQ+] No player lists available, proceeding with normal command");
        }
      }

      return originalSendCommand.call(this, command);
    };
    socket._amqPlusCommandHijacked = true;
    console.log("[AMQ+] Socket command interceptor set up for AMQ+ quizzes");
  }
}

/**
 * Handle room settings quiz creation via AMQ+ API
 * Note: The original "change game settings" command has already been sent to AMQ,
 * so lobby.settings contains the updated values. This function creates an AMQ+ quiz
 * from those settings.
 * Settings changes should always trigger a new quiz fetch (re-roll prevention only applies when Start button is clicked)
 */
function handleRoomSettingsQuizCreation(roomSettings) {
  console.log("[AMQ+] Creating room settings quiz from updated lobby.settings...");
  console.log("[AMQ+] Room settings:", JSON.stringify(roomSettings, null, 2));
  sendSystemMessage("Creating AMQ+ quiz from room settings...");

  // Check watchedDistribution mode and apply appropriate preset
  // watchedDistribution: 1=Random, 2=Weighted (not supported), 3=Equal
  if (roomSettings.watchedDistribution !== undefined) {
    const watchedDistribution = roomSettings.watchedDistribution;
    console.log("[AMQ+] watchedDistribution:", watchedDistribution);

    // Ensure cachedPlayerLists is populated before applying presets
    if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
      console.warn("[AMQ+] No cached player lists available, cannot apply song selection preset");
    } else {
      if (watchedDistribution === 2) {
        // Weighted/Mix mode - not supported
        sendSystemMessage("⚠️ Weighted (Mix) song selection mode is not supported. Please use Random or Watched (Equal) mode.");
        return;
      } else if (watchedDistribution === 3) {
        // Equal mode - apply equal preset
        console.log("[AMQ+] Applying Equal preset for watchedDistribution=3 (Equal)");
        applyEqualPreset();
        sendSystemMessage("📊 Song Selection: Equal distribution across all player lists");
      } else if (watchedDistribution === 1) {
        // Random mode - apply random preset
        console.log("[AMQ+] Applying Random preset for watchedDistribution=1 (Random)");
        applyRandomPreset();
        sendSystemMessage("🎲 Song Selection: Random from all player lists");
      }
    }
  } else {
    // No watchedDistribution in room settings - apply random as default
    console.log("[AMQ+] No watchedDistribution found in room settings, applying Random preset as default");
    if (cachedPlayerLists && cachedPlayerLists.length > 0) {
      applyRandomPreset();
    }
  }

  // Get configured player lists (after preset has been applied)
  const configuredLists = getConfiguredPlayerLists();

  // Filter out invalid entries
  const validLists = configuredLists.filter(entry => {
    const username = entry.username ? entry.username.trim() : '';
    return username !== '' && username !== '-' && entry.platform !== 'kitsu';
  });

  if (validLists.length === 0) {
    sendSystemMessage("⚠️ No valid player lists available. Please add players with linked anime lists.");
    return;
  }

  // Prepare request body with the updated room settings
  const requestBody = {
    roomSettings: roomSettings,
    playerLists: validLists
  };

  console.log("[AMQ+] Sending room settings to API:", requestBody);

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/room-settings-quiz`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify(requestBody),
    onload: function (response) {
      console.log("[AMQ+] Room settings quiz API response:", response.status, response.responseText);

      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.success && data.playToken) {
            console.log("[AMQ+] Room settings quiz created successfully:", data);
            roomSettingsQuizToken = data.playToken;

            // Now fetch the quiz using the play token
            fetchAndApplyRoomSettingsQuiz(data.playToken);
          } else {
            console.error("[AMQ+] Room settings quiz creation failed:", data);
            sendSystemMessage("⚠️ Failed to create quiz: " + (data.message || "Unknown error"));
          }
        } catch (e) {
          console.error("[AMQ+] Failed to parse API response:", e);
          sendSystemMessage("⚠️ Failed to create quiz: Parse error");
        }
      } else if (response.status === 400) {
        try {
          const errorData = JSON.parse(response.responseText);
          sendSystemMessage("⚠️ " + (errorData.message || "Invalid settings"));
        } catch (e) {
          sendSystemMessage("⚠️ Invalid settings provided");
        }
      } else {
        console.error("[AMQ+] Room settings quiz API error:", response.status, response.statusText);
        sendSystemMessage("⚠️ Failed to create quiz: Server error");
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Room settings quiz API network error:", error);
      sendSystemMessage("⚠️ Failed to create quiz: Network error");
    }
  });
}

/**
 * Fetch and apply room settings quiz
 * Note: Settings have already been applied to AMQ. This fetches the quiz songs
 * and saves the quiz to the user's community quizzes.
 */
function fetchAndApplyRoomSettingsQuiz(playToken) {
  console.log("[AMQ+] Fetching room settings quiz...");

  // Get configured player lists for live node data
  const configuredLists = getConfiguredPlayerLists();
  const validLists = configuredLists.filter(entry => {
    const username = entry.username ? entry.username.trim() : '';
    return username !== '' && username !== '-' && entry.platform !== 'kitsu';
  });

  const liveNodeData = {
    useEntirePool: false,
    userEntries: validLists,
    songSelectionMode: basicSettingsMode ? 'default' : liveNodeSongSelectionMode
  };

  const requestBody = {
    liveNodeData: liveNodeData,
    roomId: lobby?.gameId ? String(lobby.gameId) : null
  };

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/play/${playToken}`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify(requestBody),
    onload: function (response) {
      console.log("[AMQ+] Fetch quiz response:", response.status);

      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);

          if (data.command) {
            console.log("[AMQ+] Quiz command received, saving to AMQ...");
            console.log("[AMQ+ DEBUG] Full API response keys:", Object.keys(data));
            console.log("[AMQ+ DEBUG] songOverlapMap in response:", data.songOverlapMap ? `Array with ${data.songOverlapMap.length} entries` : 'NOT PRESENT');

            // Check if any songs were generated
            const songCount = data.command.data?.quizSave?.ruleBlocks?.[0]?.blocks?.length || 0;

            if (songCount === 0) {
              console.warn("[AMQ+] No songs generated for quiz!");
              sendSystemMessage("⚠️ No songs were generated! Your filter settings may be too restrictive. Try adjusting the room settings.");
              return;
            }

            console.log(`[AMQ+] Quiz has ${songCount} songs`);
            currentQuizData = data;
            currentQuizId = playToken;

            // Build song source map
            if (data.songSourceMap) {
              buildSongSourceMap(data, data.command.data.quizSave);
            }

            // Build song overlap map for duel mode
            console.log("[AMQ+ Duel DEBUG] fetchAndApplyRoomSettingsQuiz: duelModeEnabled =", duelModeEnabled, ", data.songOverlapMap =", data.songOverlapMap);
            if (duelModeEnabled && data.songOverlapMap) {
              console.log("[AMQ+ Duel] Building song overlap map from room settings quiz response");
              buildSongOverlapMap(data.songOverlapMap, data.command.data.quizSave);
            }

            // Save the quiz to AMQ and then apply it
            createOrUpdateQuiz(data);
          } else {
            console.error("[AMQ+] No command in response:", data);
            sendSystemMessage("⚠️ Failed to generate quiz songs");
          }
        } catch (e) {
          console.error("[AMQ+] Failed to parse quiz response:", e);
          sendSystemMessage("⚠️ Failed to fetch quiz: Parse error");
        }
      } else {
        console.error("[AMQ+] Failed to fetch quiz:", response.status);
        sendSystemMessage("⚠️ Failed to fetch quiz from server");
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Fetch quiz network error:", error);
      sendSystemMessage("⚠️ Failed to fetch quiz: Network error");
    }
  });
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

                <!-- Double-Click Mode Toggle -->
                <div class="form-group" style="margin-bottom: 20px;">
                  <label style="display: flex; align-items: center; cursor: pointer;">
                    <div class="customCheckbox" style="margin-right: 10px;">
                      <input type="checkbox" id="trainingDoubleClickToggle">
                      <label for="trainingDoubleClickToggle">
                        <i class="fa fa-check" aria-hidden="true"></i>
                      </label>
                    </div>
                    <span style="font-size: 14px;">Require Double-Click for Rating Buttons</span>
                  </label>
                  <small class="form-text text-muted">
                    When enabled, all rating buttons (Good/Bad/Easy/Hard/Skip) require double-click to prevent accidental ratings
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

                <!-- JSON Import Section -->
                <div style="margin-top: 15px; padding: 10px 12px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa fa-file-code-o" style="color: #6366f1; font-size: 16px;"></i>
                    <div>
                      <div style="color: #fff; font-size: 13px; font-weight: bold;">Import from JSON</div>
                      <div style="color: rgba(255,255,255,0.6); font-size: 11px;">Import songs from a JSON file</div>
                    </div>
                  </div>
                  <button id="trainingJsonImportBtn" class="btn btn-sm btn-primary" style="background-color: #6366f1; border-color: #6366f1; padding: 5px 15px; font-size: 12px; font-weight: bold;">
                    <i class="fa fa-upload"></i> Import
                  </button>
                </div>

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
                          <i class="fa fa-info-circle"></i> Manual song distribution percentages
                        </div>

                        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-clock" style="color: #f59e0b;"></i> Due Songs %:
                            </label>
                            <input type="number" id="trainingDuePercentage" class="form-control" value="70" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>

                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-star" style="color: #a78bfa;"></i> New Songs %:
                            </label>
                            <input type="number" id="trainingNewPercentage" class="form-control" value="30" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>

                          <div style="flex: 1; min-width: 140px;">
                            <label style="display: block; margin-bottom: 4px; color: rgba(255,255,255,0.9); font-size: 12px;">
                              <i class="fa fa-refresh" style="color: #60a5fa;"></i> Revision Songs %:
                            </label>
                            <input type="number" id="trainingRevisionPercentage" class="form-control" value="0" min="0" max="100"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 5px 8px; width: 100%; font-size: 13px;">
                          </div>
                        </div>

                        <div style="margin-top: 10px; font-size: 11px; color: rgba(255,255,255,0.6);">
                          <i class="fa fa-lightbulb"></i> Tip: These percentages are applied to the total song count.
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

function createJsonImportInstructionsModalHTML() {
  const baseUrl = API_BASE_URL;
  return `
    <div class="modal fade" id="amqPlusJsonImportInstructionsModal" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document" style="width: 550px; max-width: 95%;">
        <div class="modal-content" style="background-color: #1a1a2e; color: #e2e8f0; border: 1px solid #4a5568;">
          <div class="modal-header" style="border-bottom: 1px solid #2d3748; padding: 15px 20px;">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="color: #fff; opacity: 0.8;">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title" style="font-weight: bold; color: #fff;">
              <i class="fa fa-info-circle" style="color: #6366f1; margin-right: 8px;"></i>
              JSON Import Moved
            </h4>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <p style="margin-bottom: 20px; font-size: 14px; line-height: 1.5;">
              The JSON import feature has been moved to the AMQ+ website to provide a better experience and more features.
            </p>
            
            <div style="background: rgba(99, 102, 241, 0.1); border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.3); padding: 15px; margin-bottom: 20px;">
              <h5 style="color: #fff; font-weight: bold; margin-top: 0; margin-bottom: 15px; font-size: 15px;">Steps to import:</h5>
              <ol style="padding-left: 20px; margin: 0; font-size: 13px; line-height: 1.8;">
                <li>Go to <a href="${baseUrl}/songlist/create" target="_blank" style="color: #6366f1; text-decoration: underline; font-weight: bold;">${baseUrl}/songlist/create</a></li>
                <li>Scroll to <strong>"Provider Import"</strong> section and upload your JSON file (format will be auto-detected)</li>
                <li>Go to <a href="${baseUrl}/quizzes" target="_blank" style="color: #6366f1; text-decoration: underline; font-weight: bold;">${baseUrl}/quizzes</a> and click <strong>"Create Quiz"</strong></li>
                <li>In the <strong>"Song List"</strong> node settings, set the source to <strong>"Saved Lists"</strong></li>
                <li>Select your imported list from the dropdown</li>
                <li><i class="fa fa-lightbulb-o" style="color: #f59e0b;"></i> <strong>Tip:</strong> Optionally check <strong>"Use the entire pool"</strong> to prevent the app from filtering your list (insert songs are off by default for example).</li>
              </ol>
            </div>

            <div style="text-align: center;">
              <button class="btn btn-primary" data-dismiss="modal" style="background-color: #6366f1; border-color: #6366f1; padding: 8px 30px; font-weight: bold;">
                Got it!
              </button>
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
            <div class="modal-dialog" role="document" style="width: 600px; max-width: 95%;">
                <div class="modal-content" style="background-color: #1a1a2e; color: #e2e8f0; border: 1px solid #4a5568;">
                    <div class="modal-header" style="border-bottom: 1px solid #2d3748; padding: 15px 20px;">
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="color: #fff; opacity: 0.8;">
                            <span aria-hidden="true">&times;</span>
                        </button>
                        <h4 class="modal-title" style="font-weight: bold; color: #fff;">
                            <i class="fa fa-cog" style="color: #6366f1; margin-right: 8px;"></i>
                            AMQ+ Configuration
                        </h4>
                    </div>
                    <div class="modal-body" style="padding: 20px; max-height: 60vh; overflow-y: auto;">
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <div class="customCheckbox" style="margin-right: 10px;">
                                    <input type="checkbox" id="amqPlusEnableToggle" ${amqPlusEnabled ? 'checked' : ''}>
                                    <label for="amqPlusEnableToggle">
                                        <i class="fa fa-check" aria-hidden="true"></i>
                                    </label>
                                </div>
                                <span style="font-size: 16px; font-weight: bold; color: #fff;">Enable AMQ+ Mode</span>
                            </label>
                            <small style="color: rgba(255,255,255,0.6); font-size: 12px;">
                                When enabled, AMQ+ will automatically fetch and apply quizzes when starting a game
                            </small>
                        </div>

                        <div class="form-group">
                            <label for="amqPlusUrlInput" style="color: #fff; font-weight: bold;">Enter AMQ+ Play URL:</label>
                            <input type="text" class="form-control" id="amqPlusUrlInput"
                                   placeholder="https://amqplus.com/play/quiz_id"
                                   style="background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; padding: 8px 12px;">
                            <small style="color: rgba(255,255,255,0.6); font-size: 12px;">
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

                        <div class="form-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                            <label style="font-weight: bold; margin-bottom: 10px; display: block; color: #fff;">Available Commands:</label>
                            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 12px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); border: 1px solid #2d3748; font-size: 12px; font-family: monospace;">
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus toggle</strong> - Enable/disable AMQ+ mode</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus reload</strong> - Reload current quiz</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus sync</strong> - Sync player lists manually</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus info</strong> - Display quiz metadata in chat</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus sources</strong> - Toggle song source messages</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus distribution</strong> (or <strong style="color: #fff;">/amqplus dist</strong>) - Toggle song distribution output</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/amqplus [url]</strong> - Fetch quiz from URL</div>
                                <div style="margin-top: 10px; margin-bottom: 6px; color: #10b981; font-weight: bold;">Player List Commands (Live Node):</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/add [status...]</strong> - Add list statuses</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/remove [status...]</strong> - Remove list statuses</div>
                                <div style="margin-bottom: 6px; color: #e2e8f0;"><strong style="color: #fff;">/list</strong> - Show your enabled lists</div>
                                <div style="color: #e2e8f0;"><strong style="color: #fff;">/listhelp</strong> - Show list commands help</div>
                            </div>
                        </div>

                        <div id="amqPlusLoadingSpinner" style="display: none; text-align: center; padding: 30px; color: #e2e8f0;">
                            <i class="fa fa-spinner fa-spin fa-3x" style="color: #6366f1;"></i>
                            <p id="amqPlusStatusMessage" style="margin-top: 15px; color: #e2e8f0;">Loading quiz from AMQ+...</p>
                        </div>
                        <div id="amqPlusError" style="display: none; margin-top: 15px; padding: 12px; background-color: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 8px; color: #ef4444;"></div>
                    </div>
                    <div class="modal-footer" style="border-top: 1px solid #2d3748; padding: 15px 20px;">
                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="amqPlusFetchBtn">Fetch Quiz</button>
                        <button type="button" class="btn btn-success" id="amqPlusChangeLinkBtn" style="display: none;">Change Link</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function createHubModalHTML() {
  return `
        <div class="modal fade" id="amqPlusHubModal" tabindex="-1" role="dialog">
            <div class="modal-dialog" role="document" style="width: 800px;">
                <div class="modal-content">
                    <div class="modal-header">
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                        <h2 class="modal-title">AMQ+ Hub</h2>
                    </div>
                    <div class="modal-body" style="display: flex; justify-content: space-around; gap: 20px; padding: 30px;">
                        <!-- Standard Mode -->
                        <div id="amqPlusHubStandard" class="gmsModeContainer clickAble" style="flex: 1; position: relative;">
                             <img class="gmsModeImage" src="https://cdn.animemusicquiz.com/v1/ui/game-categories/250px/multiplayer.webp">
                             <div class="gmsModeDescription">
                                 Play with friends using AMQ+ features.
                             </div>
                             <div class="gmsModeName">
                                 Standard
                             </div>
                             <div class="amqPlusHubOverlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); flex-direction: column; justify-content: center; align-items: center; gap: 10px; border-radius: 10px; z-index: 10;">
                                 <button class="btn btn-primary amqPlusHubBasicBtn" style="width: 80%;">Basic</button>
                                 <button class="btn btn-default amqPlusHubAdvancedBtn" style="width: 80%;">Custom Config</button>
                                 <button class="btn btn-sm btn-danger amqPlusHubBackBtn" style="margin-top: 10px;">Back</button>
                             </div>
                        </div>

                        <!-- 1v1 Duel Mode -->
                        <div id="amqPlusHubDuel" class="gmsModeContainer clickAble" style="flex: 1; position: relative;">
                             <img class="gmsModeImage" src="https://cdn.animemusicquiz.com/v1/ui/game-categories/250px/solo.webp">
                             <div class="gmsModeDescription">
                                 Round Robin head-to-head battles with everyone in the lobby.
                             </div>
                             <div class="gmsModeName">
                                 1v1 Duel
                             </div>
                             <div class="amqPlusHubOverlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); flex-direction: column; justify-content: center; align-items: center; gap: 10px; border-radius: 10px; z-index: 10;">
                                 <button class="btn btn-primary amqPlusHubBasicBtn" style="width: 80%;">Basic</button>
                                 <button class="btn btn-default amqPlusHubAdvancedBtn" style="width: 80%;">Custom Config</button>
                                 <button class="btn btn-sm btn-danger amqPlusHubBackBtn" style="margin-top: 10px;">Back</button>
                             </div>
                        </div>

                        <!-- Training Mode -->
                        <div id="amqPlusHubTraining" class="gmsModeContainer clickAble" style="flex: 1;" data-dismiss="modal">
                             <img class="gmsModeImage" src="https://cdn.animemusicquiz.com/v1/ui/game-categories/250px/nexus.webp">
                             <div class="gmsModeDescription">
                                 Practice specific shows or lists with spaced repetition.
                             </div>
                             <div class="gmsModeName">
                                 Training
                             </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <div style="float: left;">
                             <button type="button" class="btn btn-danger" id="amqPlusHubDisableBtn">Disable AMQ+</button>
                        </div>
                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
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

  // Add AMQ+ button (Hub entry)
  $("#lobbyPage .topMenuBar").append(`<div id="amqPlusToggle" class="clickAble topMenuButton topMenuMediumButton"><h3>AMQ+</h3></div>`);
  $("#amqPlusToggle").click(() => {
    console.log("[AMQ+] AMQ+ button clicked");

    // Only allow host to open AMQ+ hub
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      return;
    }

    console.log("[AMQ+] Opening Hub (user is host or not in lobby)");
    $("#amqPlusHubModal").modal("show");
  });

  updateToggleButton();
  applyStyles();

  const hubModal = $(createHubModalHTML());
  const modal = $(createModalHTML());
  const trainingModal = $(createTrainingModalHTML());
  const instructionsModal = $(createJsonImportInstructionsModalHTML());

  const gameContainer = $("#gameContainer");
  const targetContainer = gameContainer.length > 0 ? gameContainer : $("body");

  // Append Hub Modal
  if ($("#amqPlusHubModal").length === 0) {
    targetContainer.append(hubModal);
    console.log("[AMQ+] Hub modal appended");
    attachHubHandlers();
  }

  if ($("#amqPlusModal").length === 0) {
    targetContainer.append(modal);
    console.log("[AMQ+] Settings modal appended");
    attachModalHandlers();
  }

  if ($("#amqPlusTrainingModal").length === 0) {
    targetContainer.append(trainingModal);
    console.log("[AMQ+ Training] Training modal appended");
    attachTrainingModalHandlers();
  }

  if ($("#amqPlusJsonImportInstructionsModal").length === 0) {
    targetContainer.append(instructionsModal);
  }
}

function attachHubHandlers() {
  // Helper to safely switch modals while preserving scroll
  function switchModal(fromSelector, toSelector) {
    // Wait for hidden event to show next modal
    $(fromSelector).one('hidden.bs.modal', function () {
      $(toSelector).modal('show');
      // Re-apply modal-open class to body after a short delay to ensure scrollbar works
      // Bootstrap sometimes removes it when the first modal closes
      setTimeout(() => {
        if (!$('body').hasClass('modal-open')) {
          $('body').addClass('modal-open');
        }
      }, 100);
    }).modal('hide');
  }

  // Training Mode
  $("#amqPlusHubTraining").click(() => {
    console.log("[AMQ+ Hub] Training selected");

    // Existing Training Logic
    $("#trainingModeToggle").prop("checked", false);
    isTrainingMode = false;

    if (trainingState.isAuthenticated && trainingState.authToken) {
      refreshAllQuizStats();
    }

    if (trainingState.isAuthenticated) {
      $("#trainingLogoutBtn").show();
      restoreUrlQuizDisplay();
    } else {
      $("#trainingLogoutBtn").hide();
    }
    if (trainingState.authToken && !trainingState.isAuthenticated) {
      validateTrainingToken();
    }

    switchModal("#amqPlusHubModal", "#amqPlusTrainingModal");
  });

  // Standard Mode - Show Overlay
  $("#amqPlusHubStandard").click(function (e) {
    if ($(e.target).closest('.amqPlusHubOverlay').length) return; // Ignore clicks inside overlay
    $(".amqPlusHubOverlay").hide(); // Hide others
    $(this).find(".amqPlusHubOverlay").css("display", "flex");
  });

  // 1v1 Duel Mode - Show Overlay
  $("#amqPlusHubDuel").click(function (e) {
    if ($(e.target).closest('.amqPlusHubOverlay').length) return; // Ignore clicks inside overlay
    $(".amqPlusHubOverlay").hide(); // Hide others
    $(this).find(".amqPlusHubOverlay").css("display", "flex");
  });

  // Back Buttons in Overlay
  $(document).on('click', '.amqPlusHubBackBtn', function (e) {
    e.stopPropagation();
    $(".amqPlusHubOverlay").hide();
  });

  // Use event delegation for overlay buttons to ensure they work correctly
  // Check which parent container (Standard or Duel) the button is in
  $(document).on('click', '.amqPlusHubBasicBtn', function (e) {
    e.stopPropagation();

    // Only host can enable AMQ+
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      $("#amqPlusHubModal").modal("hide");
      return;
    }

    const $parent = $(this).closest('.gmsModeContainer');
    const isDuelMode = $parent.attr('id') === 'amqPlusHubDuel';

    $("#amqPlusHubModal").modal("hide");

    if (isDuelMode) {
      console.log("[AMQ+ Hub] 1v1 Duel Quick Sync selected");

      // Enable duel mode
      duelModeEnabled = true;
      resetDuelState();

      // Logic for Basic Mode with Duel
      amqPlusEnabled = true;
      basicSettingsMode = true;
      saveSettings();
      updateToggleButton();
      updateBasicModeSettingsUI();
      updateAdvancedModeSettingsUI();
      updateUsersListsButtonVisibility();

      // Hijack Room Settings if not already done
      if (!roomSettingsHijacked) {
        hijackRoomSettings();
      }

      // Trigger Sync to gather player lists
      gatherPlayerLists().then(userEntries => {
        if (userEntries.length === 0) {
          sendSystemMessage("⚠️ No player lists found in lobby.");
          return;
        }
        cachedPlayerLists = userEntries;
        updatePlayerListsConfigUI();
        checkAndWarnUserLists();

        // Format player names for display
        const playerNames = userEntries.map(entry => {
          // Prefer AMQ username if available, otherwise use anime list username
          return entry.amqUsername || entry.username || 'Unknown';
        }).join(', ');

        sendSystemMessage(`🎯 1v1 Duel Mode enabled: ${userEntries.length} player(s) synced (${playerNames}). Round Robin pairings will be assigned each song.`);

        // Generate quiz from current room settings
        setTimeout(() => {
          if (typeof lobby !== "undefined" && lobby.settings) {
            console.log("[AMQ+ Hub] Generating quiz from current room settings after Duel Quick Sync...");
            handleRoomSettingsQuizCreation(lobby.settings);
          } else {
            console.warn("[AMQ+ Hub] lobby.settings not available, quiz generation skipped");
          }
        }, 500);
      }).catch(error => {
        console.error("[AMQ+] Error gathering player lists:", error);
        sendSystemMessage("⚠️ Failed to gather player lists: " + error.message);
      });
    } else {
      console.log("[AMQ+ Hub] Standard Quick Sync selected");

      // Disable duel mode if it was enabled
      duelModeEnabled = false;
      resetDuelState();

      // Logic for Basic Mode
      amqPlusEnabled = true;
      basicSettingsMode = true;
      saveSettings();
      updateToggleButton();
      updateBasicModeSettingsUI();
      updateAdvancedModeSettingsUI();
      updateUsersListsButtonVisibility();

      // Hijack Room Settings if not already done
      if (!roomSettingsHijacked) {
        hijackRoomSettings();
      }

      // Trigger Sync to gather player lists
      gatherPlayerLists().then(userEntries => {
        if (userEntries.length === 0) {
          sendSystemMessage("⚠️ No player lists found in lobby.");
          return;
        }
        cachedPlayerLists = userEntries;
        updatePlayerListsConfigUI();
        checkAndWarnUserLists();

        // Format player names for display
        const playerNames = userEntries.map(entry => {
          // Prefer AMQ username if available, otherwise use anime list username
          return entry.amqUsername || entry.username || 'Unknown';
        }).join(', ');

        sendSystemMessage(`AMQ+ Quick Sync enabled: ${userEntries.length} player(s) synced (${playerNames}). Configure settings via Room Settings. Manage user's lists in the Users' Lists button nearby.`);

        setTimeout(() => {
          if (typeof lobby !== "undefined" && lobby.settings) {
            console.log("[AMQ+ Hub] Generating quiz from current room settings after Quick Sync...");
            handleRoomSettingsQuizCreation(lobby.settings);
          } else {
            console.warn("[AMQ+ Hub] lobby.settings not available, quiz generation skipped");
          }
        }, 500);
      }).catch(error => {
        console.error("[AMQ+] Error gathering player lists:", error);
        sendSystemMessage("⚠️ Failed to gather player lists: " + error.message);
      });
    }
  });

  // Advanced (Custom Config) Handler - use event delegation
  $(document).on('click', '.amqPlusHubAdvancedBtn', function (e) {
    e.stopPropagation();

    // Only host can enable AMQ+
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      $("#amqPlusHubModal").modal("hide");
      return;
    }

    const $parent = $(this).closest('.gmsModeContainer');
    const isDuelMode = $parent.attr('id') === 'amqPlusHubDuel';

    if (isDuelMode) {
      console.log("[AMQ+ Hub] 1v1 Duel Advanced selected");

      // Enable duel mode
      duelModeEnabled = true;
      resetDuelState();

      // Enable AMQ+ in Advanced mode with Duel
      amqPlusEnabled = true;
      basicSettingsMode = false;
      saveSettings();
      updateToggleButton();
      updateAdvancedModeSettingsUI();
      updateUsersListsButtonVisibility();

      sendSystemMessage("🎯 1v1 Duel Mode enabled with Advanced config. Round Robin pairings will be assigned each song.");

      switchModal("#amqPlusHubModal", "#amqPlusModal");
    } else {
      console.log("[AMQ+ Hub] Standard Advanced selected");

      // Disable duel mode if it was enabled
      duelModeEnabled = false;
      resetDuelState();

      // Enable AMQ+ in Advanced mode (not basic mode)
      amqPlusEnabled = true;
      basicSettingsMode = false;
      saveSettings();
      updateToggleButton();
      updateAdvancedModeSettingsUI();
      updateUsersListsButtonVisibility();

      switchModal("#amqPlusHubModal", "#amqPlusModal");
    }
  });

  // Disable AMQ+ Button Handler
  $("#amqPlusHubDisableBtn").click(function () {
    console.log("[AMQ+ Hub] Disable AMQ+ clicked");

    // Only host can disable AMQ+
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      $("#amqPlusHubModal").modal("hide");
      return;
    }

    amqPlusEnabled = false;
    basicSettingsMode = false; // Also disable basic settings mode
    duelModeEnabled = false; // Disable duel mode
    resetDuelState();
    saveSettings();
    updateToggleButton();
    updateBasicModeSettingsUI();
    updateAdvancedModeSettingsUI();
    updateUsersListsButtonVisibility(); // Update button text
    sendSystemMessage("AMQ+ mode disabled");
    $("#amqPlusHubModal").modal("hide");
  });
}

/**
 * Reset duel state to initial values
 */
function resetDuelState() {
  duelState = {
    roster: [],
    rosterMap: {},
    indexToName: {},
    nameToIndex: {},
    pendingMappingParts: {},
    roundRobinSchedule: [],
    usedRounds: [],
    currentRound: 0,
    currentPairings: {},
    myTarget: null,
    wins: {},
    headToHead: {},
    songOverlapMap: null,
    isHost: false,
    BYE: '__BYE__'
  };

  console.log("[AMQ+ Duel] State reset");
}

// Scoreboard updates are now handled at predictable game events instead of MutationObserver

/**
 * Initialize duel roster from quiz players at game start
 * Locks the roster and generates the round-robin schedule
 */
function initializeDuelRoster() {
  if (!duelModeEnabled) return;

  // Get players from quiz.players (available at game start)
  const players = Object.values(quiz.players || {});
  if (players.length < 2) {
    console.warn("[AMQ+ Duel] Not enough players for duel mode");
    return;
  }

  // Build roster from player names
  duelState.roster = players.map(p => p._name);
  duelState.isHost = lobby?.isHost || false;

  // Build index mappings for compact messaging
  duelState.indexToName = {};
  duelState.nameToIndex = {};
  duelState.roster.forEach((name, idx) => {
    duelState.indexToName[idx] = name;
    duelState.nameToIndex[name] = idx;
  });
  console.log("[AMQ+ Duel] Index mappings built:", duelState.nameToIndex);

  // Update scoreboard after roster initialization
  setTimeout(() => {
    updateDuelScoreboard();
  }, 200);

  // Build roster map with cached list info
  duelState.rosterMap = {};
  duelState.roster.forEach(playerName => {
    // Try to find player's list info from cachedPlayerLists
    // Match by amqUsername (AMQ username) since playerName is the AMQ username
    const listEntry = cachedPlayerLists?.find(e =>
      e.amqUsername === playerName || e.username === playerName
    );

    // Store the anime list username (for overlap matching) - this is what appears in songOverlapMap
    const animeListUsername = listEntry?.username || playerName;
    const hasProperMapping = listEntry && listEntry.amqUsername && listEntry.username !== listEntry.amqUsername;

    duelState.rosterMap[playerName] = {
      username: animeListUsername, // Anime list username for overlap check
      amqUsername: playerName, // AMQ username for display
      platform: listEntry?.platform || null,
      hasAnimeForSong: {} // Will be populated per-song
    };

    if (!listEntry) {
      console.warn(`[AMQ+ Duel] No cached player list entry found for "${playerName}" - song overlap matching may not work correctly`);
    } else if (!listEntry.amqUsername) {
      console.warn(`[AMQ+ Duel] Entry for "${playerName}" missing amqUsername - please refresh page and re-sync player lists`);
    }

    console.log(`[AMQ+ Duel DEBUG] rosterMap entry for "${playerName}": animeListUsername="${animeListUsername}", hasProperMapping=${hasProperMapping}`);
  });

  // Initialize wins and head-to-head trackers
  duelState.wins = {};
  duelState.headToHead = {};
  duelState.roster.forEach(player => {
    duelState.wins[player] = 0;
    duelState.headToHead[player] = {};
    duelState.roster.forEach(opponent => {
      if (player !== opponent) {
        duelState.headToHead[player][opponent] = 0;
      }
    });
  });

  // Get number of songs from game settings
  const numberOfSongs = (typeof lobby !== 'undefined' && lobby.settings && lobby.settings.numberOfSongs)
    ? lobby.settings.numberOfSongs
    : null;

  // Generate round-robin schedule with target number of rounds matching game song count
  duelState.roundRobinSchedule = generateRoundRobinSchedule(duelState.roster, numberOfSongs);
  duelState.usedRounds = [];
  duelState.currentRound = 0;

  console.log("[AMQ+ Duel] Roster initialized:", duelState.roster);
  console.log("[AMQ+ Duel] Round-robin schedule generated:", duelState.roundRobinSchedule.length, "rounds",
    numberOfSongs ? `(target: ${numberOfSongs} songs)` : "(using default round-robin)");

  // Log pairing summary
  logRoundRobinPairingSummary();

  if (duelState.isHost) {
    sendSystemMessage(`🎯 Duel Mode: ${duelState.roster.length} players, ${duelState.roundRobinSchedule.length} rounds scheduled`);
  }
}

/**
 * Generate round-robin schedule using the circle method
 * For n players, generates n-1 rounds (or n rounds if odd, with BYE)
 * If targetRounds is specified, generates that many rounds by cycling through the base schedule
 * @param {Array<string>} players - Array of player names
 * @param {number|null} targetRounds - Target number of rounds (e.g., number of songs in game). If null, uses default round-robin.
 * @returns {Array<Array<Array<string>>>} Array of rounds, each round is array of pairs [playerA, playerB]
 */
function generateRoundRobinSchedule(players, targetRounds = null) {
  const roster = [...players];
  const BYE = duelState.BYE;

  // If odd number of players, add BYE
  if (roster.length % 2 !== 0) {
    roster.push(BYE);
  }

  const n = roster.length;
  const baseRounds = [];
  const numBaseRounds = n - 1;

  // Generate base round-robin schedule using circle method
  for (let round = 0; round < numBaseRounds; round++) {
    const pairs = [];

    for (let i = 0; i < n / 2; i++) {
      const home = i === 0 ? roster[0] : roster[i];
      const away = roster[n - 1 - i];

      // Skip if pairing with BYE results in a bye round
      if (home !== BYE && away !== BYE) {
        pairs.push([home, away]);
      } else if (home === BYE) {
        // away gets a BYE
        pairs.push([away, BYE]);
      } else {
        // home gets a BYE
        pairs.push([home, BYE]);
      }
    }

    baseRounds.push(pairs);

    // Rotate: move last element to position 1, shift others right
    const last = roster.pop();
    roster.splice(1, 0, last);
  }

  // If targetRounds is specified and greater than base rounds, cycle through to generate more
  if (targetRounds !== null && targetRounds > numBaseRounds) {
    const rounds = [];
    for (let i = 0; i < targetRounds; i++) {
      rounds.push(baseRounds[i % numBaseRounds]);
    }
    return rounds;
  }

  // Otherwise return base schedule
  return baseRounds;
}

/**
 * Log summary of how many times each player will be paired with each other player
 */
function logRoundRobinPairingSummary() {
  if (!duelState.roundRobinSchedule || duelState.roundRobinSchedule.length === 0) {
    return;
  }

  // Count pairings: player -> { opponent: count }
  const pairingCounts = {};

  // Initialize counts for all players
  duelState.roster.forEach(player => {
    pairingCounts[player] = {};
    duelState.roster.forEach(opponent => {
      if (player !== opponent) {
        pairingCounts[player][opponent] = 0;
      }
    });
  });

  // Count pairings across all rounds
  duelState.roundRobinSchedule.forEach((round, roundIdx) => {
    round.forEach(([playerA, playerB]) => {
      // Skip BYE pairs
      if (playerA !== duelState.BYE && playerB !== duelState.BYE) {
        if (pairingCounts[playerA] && pairingCounts[playerA][playerB] !== undefined) {
          pairingCounts[playerA][playerB]++;
        }
        if (pairingCounts[playerB] && pairingCounts[playerB][playerA] !== undefined) {
          pairingCounts[playerB][playerA]++;
        }
      }
    });
  });

  // Log summary in requested format
  console.log("[AMQ+ Duel DEBUG] Round-robin pairing summary:");
  duelState.roster.forEach(player => {
    console.log(`  username: ${player}`);
    console.log(`  Targets:`);
    Object.entries(pairingCounts[player] || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([opponent, count]) => {
        console.log(`    ${opponent}: ${count}`);
      });
  });
}

/**
 * Check if a player has the anime for a given song on their list
 * @param {string} playerName - Player name
 * @param {number} annSongId - Song ID
 * @returns {boolean} True if player has the anime on their list
 */
function playerHasAnimeForSong(playerName, annSongId) {
  if (!duelState.songOverlapMap || !annSongId) {
    console.log(`[AMQ+ Duel DEBUG] playerHasAnimeForSong: No map or songId. playerName=${playerName}, annSongId=${annSongId}, hasMap=${!!duelState.songOverlapMap}`);
    return false;
  }

  const usersWithSong = duelState.songOverlapMap.get(annSongId) || [];
  const playerInfo = duelState.rosterMap[playerName];

  if (!playerInfo) {
    console.log(`[AMQ+ Duel DEBUG] playerHasAnimeForSong: No playerInfo. playerName=${playerName}, annSongId=${annSongId}`);
    return false;
  }

  // Check if player's username is in the list of users who have this song
  const hasAnime = usersWithSong.some(username =>
    username === playerInfo.username ||
    username === playerName ||
    username?.toLowerCase() === playerInfo.username?.toLowerCase()
  );

  console.log(`[AMQ+ Duel DEBUG] playerHasAnimeForSong: playerName=${playerName}, annSongId=${annSongId}, playerInfo.username=${playerInfo.username}, usersWithSong=[${usersWithSong.join(', ')}], hasAnime=${hasAnime}`);

  return hasAnime;
}

/**
 * Score a pair for a given song based on familiarity fairness
 * When unfair, prefers to give disadvantage to player with most wins
 * @param {Array<string>} pair - [playerA, playerB]
 * @param {number} annSongId - Song ID
 * @returns {number} Score: +1 for fair (both know or both don't), -1 for unfair (adjusted by wins)
 */
function scorePairForSong(pair, annSongId) {
  const [playerA, playerB] = pair;

  // BYE pairs are neutral
  if (playerA === duelState.BYE || playerB === duelState.BYE) {
    console.log(`[AMQ+ Duel DEBUG] scorePairForSong: BYE pair, annSongId=${annSongId}, pair=[${playerA}, ${playerB}]`);
    return 0;
  }

  const aKnows = playerHasAnimeForSong(playerA, annSongId);
  const bKnows = playerHasAnimeForSong(playerB, annSongId);

  const fairness = (aKnows === bKnows) ? 'FAIR' : 'UNFAIR';
  const status = `(${playerA}: ${aKnows ? 'watched' : 'not watched'}, ${playerB}: ${bKnows ? 'watched' : 'not watched'})`;

  // Fair if both know or both don't know
  if (aKnows === bKnows) {
    console.log(`[AMQ+ Duel DEBUG] scorePairForSong: ${fairness} ${status}, annSongId=${annSongId}, score=1`);
    return 1;
  }

  // Unfair matchup - determine who is disadvantaged (doesn't know the song)
  // The disadvantaged player is at a disadvantage because their opponent knows the song
  const disadvantagedPlayer = aKnows ? playerB : playerA;
  const advantagedPlayer = aKnows ? playerA : playerB;

  // Get current wins for both players
  const disadvantagedWins = duelState.wins[disadvantagedPlayer] || 0;
  const advantagedWins = duelState.wins[advantagedPlayer] || 0;

  // Find the maximum wins among all players
  const maxWins = Math.max(...Object.values(duelState.wins || {}), 0);

  // Calculate bonus: prefer to give disadvantage to players with most wins
  // If the disadvantaged player is at max wins, add bonus to make this round more attractive
  // If advantaged player has more wins, add penalty
  let unfairBonus = 0;

  if (disadvantagedWins > advantagedWins) {
    // Good: disadvantage goes to player with more wins
    unfairBonus = 0.5;
    console.log(`[AMQ+ Duel DEBUG] scorePairForSong: Unfair bonus +0.5 (${disadvantagedPlayer} has more wins: ${disadvantagedWins} vs ${advantagedWins})`);
  } else if (disadvantagedWins < advantagedWins) {
    // Bad: disadvantage goes to player with fewer wins
    unfairBonus = -0.5;
    console.log(`[AMQ+ Duel DEBUG] scorePairForSong: Unfair penalty -0.5 (${disadvantagedPlayer} has fewer wins: ${disadvantagedWins} vs ${advantagedWins})`);
  } else if (disadvantagedWins === maxWins && maxWins > 0) {
    // Tied but at max wins - add small random tiebreaker
    unfairBonus = 0.25 + Math.random() * 0.1;
    console.log(`[AMQ+ Duel DEBUG] scorePairForSong: Unfair tied-at-max bonus +${unfairBonus.toFixed(3)} (both at ${maxWins} wins, random tiebreaker)`);
  }

  const finalScore = -1 + unfairBonus;
  console.log(`[AMQ+ Duel DEBUG] scorePairForSong: ${fairness} ${status}, annSongId=${annSongId}, base=-1, unfairBonus=${unfairBonus}, finalScore=${finalScore}`);

  return finalScore;
}

/**
 * Select the best round for a given song based on familiarity scoring
 * @param {number} annSongId - Song ID for the current song
 * @returns {number} Index of the best round to use
 */
function selectBestRoundForSong(annSongId) {
  console.log(`[AMQ+ Duel DEBUG] selectBestRoundForSong: Starting selection for annSongId=${annSongId}`);
  console.log(`[AMQ+ Duel DEBUG] songOverlapMap for this song:`, duelState.songOverlapMap?.get(annSongId) || 'NOT FOUND');

  const availableRounds = [];

  // Find all rounds that haven't been used yet
  for (let i = 0; i < duelState.roundRobinSchedule.length; i++) {
    if (!duelState.usedRounds.includes(i)) {
      availableRounds.push(i);
    }
  }

  // If no available rounds, cycle back (more songs than rounds)
  if (availableRounds.length === 0) {
    duelState.usedRounds = [];
    for (let i = 0; i < duelState.roundRobinSchedule.length; i++) {
      availableRounds.push(i);
    }
    console.log("[AMQ+ Duel] All rounds used, cycling back");
  }

  console.log(`[AMQ+ Duel DEBUG] Available rounds: [${availableRounds.join(', ')}]`);

  // Score each available round
  let bestRoundIdx = availableRounds[0];
  let bestScore = -Infinity;
  const roundScores = [];

  for (const roundIdx of availableRounds) {
    const round = duelState.roundRobinSchedule[roundIdx];
    let totalScore = 0;
    const pairScores = [];

    for (const pair of round) {
      const pairScore = scorePairForSong(pair, annSongId);
      totalScore += pairScore;
      pairScores.push({ pair, score: pairScore });
    }

    // Tiebreaker: prefer rounds that haven't been used recently
    // Add small bonus for earlier unused rounds
    const recencyBonus = (availableRounds.length - availableRounds.indexOf(roundIdx)) * 0.01;
    totalScore += recencyBonus;

    roundScores.push({ roundIdx, totalScore, recencyBonus, pairScores });

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestRoundIdx = roundIdx;
    }
  }

  console.log(`[AMQ+ Duel DEBUG] Round scores for annSongId=${annSongId}:`, roundScores);
  console.log(`[AMQ+ Duel DEBUG] Selected round ${bestRoundIdx} with score ${bestScore}`);

  return bestRoundIdx;
}

/**
 * Compute pairings for the current song (host only)
 * @param {number} songNumber - Current song number (1-indexed)
 * @param {number} annSongId - Song ID for the current song
 * @returns {Object} Pairings map: playerName -> opponentName
 */
function computePairingsForSong(songNumber, annSongId) {
  console.log(`[AMQ+ Duel DEBUG] computePairingsForSong: songNumber=${songNumber}, annSongId=${annSongId}`);
  console.log(`[AMQ+ Duel DEBUG] Full songOverlapMap:`, duelState.songOverlapMap);
  console.log(`[AMQ+ Duel DEBUG] rosterMap:`, duelState.rosterMap);

  const pairings = {};

  // Select the best round for this song
  const roundIdx = selectBestRoundForSong(annSongId);
  const round = duelState.roundRobinSchedule[roundIdx];

  // Mark round as used
  duelState.usedRounds.push(roundIdx);

  // Build pairings map and verify fairness
  const pairingDetails = [];
  for (const [playerA, playerB] of round) {
    if (playerA !== duelState.BYE && playerB !== duelState.BYE) {
      pairings[playerA] = playerB;
      pairings[playerB] = playerA;

      // Verify fairness for final pairings
      const aKnows = playerHasAnimeForSong(playerA, annSongId);
      const bKnows = playerHasAnimeForSong(playerB, annSongId);
      const isFair = (aKnows === bKnows);
      pairingDetails.push({
        pair: [playerA, playerB],
        aKnows,
        bKnows,
        isFair,
        status: isFair ? 'FAIR' : 'UNFAIR'
      });
    } else if (playerA === duelState.BYE) {
      pairings[playerB] = duelState.BYE;
      pairingDetails.push({ pair: [playerA, playerB], status: 'BYE' });
    } else {
      pairings[playerA] = duelState.BYE;
      pairingDetails.push({ pair: [playerA, playerB], status: 'BYE' });
    }
  }

  console.log(`[AMQ+ Duel] Song ${songNumber}: Using round ${roundIdx + 1}, pairings:`, pairings);
  console.log(`[AMQ+ Duel DEBUG] Final pairing fairness check:`, pairingDetails);

  return pairings;
}

/**
 * Apply pairings received from host (all clients)
 * @param {Object} pairings - Pairings map: playerName -> opponentName
 */
function applyPairings(pairings) {
  // Ensure duel mode is enabled (should be enabled by enable command, but check just in case)
  if (!duelModeEnabled) {
    console.warn("[AMQ+ Duel] Received pairings but duel mode not enabled, enabling now...");
    duelModeEnabled = true;
  }

  duelState.currentPairings = pairings;

  // Find my target
  const myName = selfName;
  duelState.myTarget = pairings[myName] || null;

  console.log(`[AMQ+ Duel] Applied pairings. My target: ${duelState.myTarget}`);

  // Update UI to show only self and target
  updateDuelAvatarVisibility();

  // Update scoreboard to prevent AMQ from overwriting it
  updateDuelScoreboard();
}

/**
 * Get the annSongId for the current song
 * @param {number} songNumber - Current song number (1-indexed)
 * @returns {number|null} The annSongId or null if not found
 */
function getAnnSongIdForSong(songNumber) {
  let annSongId = null;

  // Try to get from quizSave blocks
  if (currentQuizData && currentQuizData.command && currentQuizData.command.data) {
    try {
      const quizSave = currentQuizData.command.data.quizSave;
      if (quizSave && quizSave.ruleBlocks && quizSave.ruleBlocks[0]) {
        const ruleBlock = quizSave.ruleBlocks[0];
        if (ruleBlock.blocks && Array.isArray(ruleBlock.blocks) && songNumber > 0) {
          const blockIndex = songNumber - 1; // blocks are 0-indexed
          if (blockIndex >= 0 && blockIndex < ruleBlock.blocks.length) {
            const block = ruleBlock.blocks[blockIndex];
            annSongId = block.annSongId || null;
          }
        }
      }
    } catch (e) {
      console.error("[AMQ+ Duel] Error getting annSongId from quizSave:", e);
    }
  }

  return annSongId;
}

/**
 * Handle song start in duel mode - host computes and broadcasts pairings
 * @param {number} songNumber - Current song number
 */
function handleDuelSongStart(songNumber) {
  if (!duelModeEnabled || duelState.roster.length < 2) return;

  duelState.currentRound = songNumber;

  // Only host computes and broadcasts pairings
  if (duelState.isHost) {
    const annSongId = getAnnSongIdForSong(songNumber);
    const pairings = computePairingsForSong(songNumber, annSongId);

    // Broadcast pairings to all players
    broadcastDuelPairings(songNumber, pairings);

    // Apply pairings locally
    applyPairings(pairings);
  }
}

/**
 * Broadcast duel mode enable command to all players at game start
 * Uses compact format: ❦M[part]/[total]:[idx=name,idx=name,...]
 * Splits into multiple messages if needed (150 char limit)
 * Only host should call this
 * @param {Array<string>} roster - Array of player names
 */
function broadcastDuelModeEnable(roster) {
  const MAX_MSG_LENGTH = 150;
  const PREFIX_OVERHEAD = 10; // "❦M99/99:" = max 9 chars + safety
  const MAX_CONTENT_LENGTH = MAX_MSG_LENGTH - PREFIX_OVERHEAD;

  // Build mapping entries: "0=name,1=name,..."
  const entries = roster.map((name, idx) => `${idx}=${name}`);

  // Split into parts if needed
  const parts = [];
  let currentPart = [];
  let currentLength = 0;

  for (const entry of entries) {
    const entryLength = entry.length + (currentPart.length > 0 ? 1 : 0); // +1 for comma

    if (currentLength + entryLength > MAX_CONTENT_LENGTH && currentPart.length > 0) {
      // Start new part
      parts.push(currentPart.join(','));
      currentPart = [entry];
      currentLength = entry.length;
    } else {
      currentPart.push(entry);
      currentLength += entryLength;
    }
  }

  // Add last part
  if (currentPart.length > 0) {
    parts.push(currentPart.join(','));
  }

  const totalParts = parts.length;

  // Build index mappings for debug
  const indexToName = {};
  const nameToIndex = {};
  roster.forEach((name, idx) => {
    indexToName[idx] = name;
    nameToIndex[name] = idx;
  });

  // Send each part with delay between them
  parts.forEach((partContent, idx) => {
    const partNum = idx + 1;
    const message = `❦M${partNum}/${totalParts}:${partContent}`;

    // Output debug info if enabled
    if (duelDebugEnabled) {
      const entries = partContent.split(',');
      sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
      sendSystemMessage(`[1v1 Debug] MAPPING MESSAGE SENT - Part ${partNum}/${totalParts}`);
      sendSystemMessage(`Raw: ${message}`);
      sendSystemMessage(`Part Data: ${partContent}`);
      sendSystemMessage(`Entries in this part:`);
      entries.forEach(entryStr => {
        const [idxStr, name] = entryStr.split('=');
        sendSystemMessage(`  Index ${idxStr} = ${name}`);
      });
      if (partNum === totalParts) {
        sendSystemMessage(`Full Roster (${roster.length} players):`);
        roster.forEach((name, idx) => {
          sendSystemMessage(`  Index ${idx}: ${name}`);
        });
      }
      sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    }

    setTimeout(() => {
      socket.sendCommand({
        type: "lobby",
        command: "game chat message",
        data: { msg: message, teamMessage: false }
      });
      console.log(`[AMQ+ Duel] Broadcast mapping part ${partNum}/${totalParts}: ${message.length} chars`);
    }, idx * 100); // 100ms delay between parts
  });

  console.log(`[AMQ+ Duel] Broadcast duel mode enable for ${roster.length} players in ${totalParts} part(s)`);
}

/**
 * Broadcast duel pairings to all players via chat
 * Uses compact format: ❦P[song]:[idx-idx,idx-idx,...]
 * B = BYE
 * @param {number} songNumber - Current song number
 * @param {Object} pairings - Pairings map: playerName -> opponentName
 */
function broadcastDuelPairings(songNumber, pairings) {
  // Convert name-based pairings to index-based
  const indexPairs = [];
  const processed = new Set();

  for (const [playerName, opponentName] of Object.entries(pairings)) {
    if (processed.has(playerName)) continue;

    const playerIdx = duelState.nameToIndex[playerName];
    let opponentIdx;

    if (opponentName === duelState.BYE) {
      opponentIdx = 'B'; // B for BYE
    } else {
      opponentIdx = duelState.nameToIndex[opponentName];
      processed.add(opponentName); // Mark opponent as processed
    }

    if (playerIdx !== undefined) {
      indexPairs.push(`${playerIdx}-${opponentIdx}`);
      processed.add(playerName);
    }
  }

  // Format: ❦P[song]:[pairs]
  const message = `❦P${songNumber}:${indexPairs.join(',')}`;

  // Output debug info if enabled
  if (duelDebugEnabled) {
    const namePairs = Object.entries(pairings).map(([player, opponent]) => ({
      player: player,
      opponent: opponent === duelState.BYE ? 'BYE' : opponent,
      playerIdx: duelState.nameToIndex[player],
      opponentIdx: opponent === duelState.BYE ? 'B' : duelState.nameToIndex[opponent]
    }));

    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    sendSystemMessage(`[1v1 Debug] PAIRINGS MESSAGE SENT - Song ${songNumber}`);
    sendSystemMessage(`Raw: ${message}`);
    sendSystemMessage(`Index Pairs: ${indexPairs.join(', ')}`);
    sendSystemMessage(`Pairings (${namePairs.length} pairs):`);
    namePairs.forEach(pair => {
      const opponentDisplay = pair.opponent === 'BYE' ? 'BYE' : pair.opponent;
      sendSystemMessage(`  ${pair.player} vs ${opponentDisplay} (Indices: ${pair.playerIdx}-${pair.opponentIdx})`);
    });
    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  // Send via chat (will be parsed by all clients)
  socket.sendCommand({
    type: "lobby",
    command: "game chat message",
    data: { msg: message, teamMessage: false }
  });

  console.log(`[AMQ+ Duel] Broadcast pairings for song ${songNumber}: ${message} (${message.length} chars)`);
}

/**
 * Handle duel mode messages received via chat
 * Compact formats:
 *   Mapping: ❦M[part]/[total]:[idx=name,idx=name,...]
 *   Pairings: ❦P[song]:[idx-idx,idx-idx,...] (B for BYE)
 * Only the host should send duel messages. Non-hosts accept and apply commands from the host.
 * @param {string} message - Full message starting with ❦
 * @param {string} sender - Message sender
 */
function handleDuelMessage(message, sender) {
  try {
    const content = message.substring(1); // Remove ❦ prefix

    // Determine message type by first character
    const msgType = content.charAt(0);

    // Handle Mapping command (M)
    if (msgType === 'M') {
      handleDuelMappingMessage(content, sender);
    }
    // Handle Pairings command (P)
    else if (msgType === 'P') {
      handleDuelPairingsMessage(content, sender);
    }

    // Remove message from chat history after processing
    setTimeout(() => {
      const $messages = $("#gcMessageContainer li");
      $messages.each(function () {
        const $msg = $(this);
        const msgText = $msg.text();
        if (msgText.includes('❦')) {
          $msg.remove();
        }
      });
    }, 1);
  } catch (e) {
    console.error("[AMQ+ Duel] Failed to parse duel message:", e);
  }
}

/**
 * Handle mapping message: ❦M[part]/[total]:[idx=name,idx=name,...]
 */
function handleDuelMappingMessage(content, sender) {
  // Parse: M[part]/[total]:[data]
  const match = content.match(/^M(\d+)\/(\d+):(.+)$/);
  if (!match) {
    console.error("[AMQ+ Duel] Invalid mapping format:", content);
    return;
  }

  const partNum = parseInt(match[1]);
  const totalParts = parseInt(match[2]);
  const partData = match[3];

  console.log(`[AMQ+ Duel] Received mapping part ${partNum}/${totalParts} from ${sender}`);

  // Output debug info if enabled
  if (duelDebugEnabled) {
    const entries = partData.split(',');
    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    sendSystemMessage(`[1v1 Debug] MAPPING MESSAGE RECEIVED - Part ${partNum}/${totalParts} from ${sender}`);
    sendSystemMessage(`Raw: ❦M${partNum}/${totalParts}:${partData}`);
    sendSystemMessage(`Part Data: ${partData}`);
    sendSystemMessage(`Entries in this part:`);
    entries.forEach(entryStr => {
      const [idxStr, name] = entryStr.split('=');
      sendSystemMessage(`  Index ${idxStr} = ${name}`);
    });
    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  // If we're the host, ignore (we already have the mapping)
  if (duelState.isHost) {
    console.log(`[AMQ+ Duel] Host received own mapping broadcast, ignoring`);
    return;
  }

  // Initialize pending parts if needed
  if (!duelState.pendingMappingParts.total || duelState.pendingMappingParts.total !== totalParts) {
    duelState.pendingMappingParts = { total: totalParts, parts: {} };
  }

  // Store this part
  duelState.pendingMappingParts.parts[partNum] = partData;

  // Check if we have all parts
  const receivedParts = Object.keys(duelState.pendingMappingParts.parts).length;
  if (receivedParts === totalParts) {
    // Combine all parts in order
    let fullMapping = '';
    for (let i = 1; i <= totalParts; i++) {
      if (fullMapping.length > 0) fullMapping += ',';
      fullMapping += duelState.pendingMappingParts.parts[i];
    }

    // Parse the full mapping: "0=name,1=name,..."
    const entries = fullMapping.split(',');
    const roster = [];
    duelState.indexToName = {};
    duelState.nameToIndex = {};

    for (const entry of entries) {
      const [idxStr, name] = entry.split('=');
      if (idxStr !== undefined && name !== undefined) {
        const idx = parseInt(idxStr);
        duelState.indexToName[idx] = name;
        duelState.nameToIndex[name] = idx;
        roster[idx] = name; // Maintain order by index
      }
    }

    // Filter out any undefined entries (shouldn't happen but safety)
    duelState.roster = roster.filter(n => n !== undefined);

    console.log("[AMQ+ Duel] Full mapping received:", duelState.nameToIndex);

    // Enable duel mode and initialize state
    duelModeEnabled = true;
    duelState.isHost = false;

    // Initialize wins and head-to-head trackers
    duelState.wins = {};
    duelState.headToHead = {};
    duelState.roster.forEach(player => {
      duelState.wins[player] = 0;
      duelState.headToHead[player] = {};
      duelState.roster.forEach(opponent => {
        if (player !== opponent) {
          duelState.headToHead[player][opponent] = 0;
        }
      });
    });

    // Build roster map
    duelState.rosterMap = {};
    duelState.roster.forEach(playerName => {
      duelState.rosterMap[playerName] = {
        username: playerName,
        platform: null,
        hasAnimeForSong: {}
      };
    });

    // Get number of songs from game settings (clients should have access to lobby.settings)
    const numberOfSongs = (typeof lobby !== 'undefined' && lobby.settings && lobby.settings.numberOfSongs)
      ? lobby.settings.numberOfSongs
      : null;

    // Generate round-robin schedule (for reference)
    duelState.roundRobinSchedule = generateRoundRobinSchedule(duelState.roster, numberOfSongs);
    duelState.usedRounds = [];
    duelState.currentRound = 0;

    // Log pairing summary
    logRoundRobinPairingSummary();

    // Clear pending
    duelState.pendingMappingParts = {};

    // Output full roster debug info if enabled
    if (duelDebugEnabled) {
      sendSystemMessage(`[1v1 Debug] Full mapping assembled - Roster (${duelState.roster.length} players):`);
      duelState.roster.forEach((name, idx) => {
        sendSystemMessage(`  Index ${idx}: ${name}`);
      });
    }

    console.log("[AMQ+ Duel] Duel mode enabled via mapping. Roster:", duelState.roster);

    // Update scoreboard
    setTimeout(() => {
      updateDuelScoreboard();
    }, 200);
  } else {
    console.log(`[AMQ+ Duel] Waiting for more parts... (${receivedParts}/${totalParts})`);
  }
}

/**
 * Handle pairings message: ❦P[song]:[idx-idx,idx-idx,...] (B for BYE)
 */
function handleDuelPairingsMessage(content, sender) {
  // Parse: P[song]:[pairs]
  const colonIdx = content.indexOf(':');
  if (colonIdx === -1) {
    console.error("[AMQ+ Duel] Invalid pairings format:", content);
    return;
  }

  const songNumber = parseInt(content.substring(1, colonIdx));
  const pairsStr = content.substring(colonIdx + 1);

  console.log(`[AMQ+ Duel] Received pairings from ${sender} for song ${songNumber}: ${pairsStr}`);

  // Output debug info if enabled
  if (duelDebugEnabled) {
    const pairs = pairsStr.split(',');
    const parsedPairs = pairs.map(pair => {
      const [idx1Str, idx2Str] = pair.split('-');
      const idx1 = parseInt(idx1Str);
      const name1 = duelState.indexToName[idx1];
      let name2;
      if (idx2Str === 'B') {
        name2 = duelState.BYE;
      } else {
        const idx2 = parseInt(idx2Str);
        name2 = duelState.indexToName[idx2];
      }
      return {
        indexPair: pair,
        playerIdx: idx1,
        opponentIdx: idx2Str === 'B' ? 'B' : parseInt(idx2Str),
        playerName: name1,
        opponentName: name2 === duelState.BYE ? 'BYE' : name2
      };
    });

    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    sendSystemMessage(`[1v1 Debug] PAIRINGS MESSAGE RECEIVED - Song ${songNumber} from ${sender}`);
    sendSystemMessage(`Raw: ❦P${songNumber}:${pairsStr}`);
    sendSystemMessage(`Index Pairs: ${pairs.join(', ')}`);
    sendSystemMessage(`Pairings (${parsedPairs.length} pairs):`);
    parsedPairs.forEach(pair => {
      const opponentDisplay = pair.opponentName === 'BYE' ? 'BYE' : pair.opponentName;
      sendSystemMessage(`  ${pair.playerName} vs ${opponentDisplay} (Indices: ${pair.playerIdx}-${pair.opponentIdx})`);
    });
    sendSystemMessage(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  }

  // If we're the host, ignore (we already applied pairings locally)
  if (duelState.isHost) {
    console.log(`[AMQ+ Duel] Host received own pairings broadcast, ignoring`);
    return;
  }

  // Parse index pairs and convert to name-based pairings
  const pairings = {};
  const pairs = pairsStr.split(',');

  for (const pair of pairs) {
    const [idx1Str, idx2Str] = pair.split('-');
    const idx1 = parseInt(idx1Str);
    const name1 = duelState.indexToName[idx1];

    let name2;
    if (idx2Str === 'B') {
      name2 = duelState.BYE;
    } else {
      const idx2 = parseInt(idx2Str);
      name2 = duelState.indexToName[idx2];
    }

    if (name1) {
      pairings[name1] = name2;
      if (name2 && name2 !== duelState.BYE) {
        pairings[name2] = name1;
      }
    }
  }

  console.log("[AMQ+ Duel] Parsed pairings:", pairings);

  // Apply pairings
  applyPairings(pairings);
}


/**
 * Update avatar badges for duel mode
 * Adds "Target" badge to opponent and "Pair X" badges to other pairings
 */
function updateDuelAvatarVisibility() {
  if (!duelModeEnabled || typeof quiz === 'undefined' || !quiz.players) {
    return;
  }

  const targetName = duelState.myTarget;
  const isBye = targetName === duelState.BYE;

  const players = Object.values(quiz.players);

  // Find self player name
  const selfPlayer = players.find(p => p.isSelf);
  const selfPlayerName = selfPlayer?._name || quiz.ownGamePlayerId;

  console.log(`[AMQ+ Duel] Updating avatars. Target: ${targetName}, isBye: ${isBye}`);

  // Build pair numbers for all players
  const pairNumbers = new Map(); // playerName -> pairNumber
  const processedPlayers = new Set();
  let pairCounter = 1;

  // Current player's pairing is always "Pair 1"
  if (!isBye) {
    pairNumbers.set(selfPlayerName, 1);
    pairNumbers.set(targetName, 1);
    processedPlayers.add(selfPlayerName);
    processedPlayers.add(targetName);
    pairCounter = 2;
  }

  // Assign pair numbers to other pairings
  if (duelState.currentPairings) {
    for (const [playerA, playerB] of Object.entries(duelState.currentPairings)) {
      if (processedPlayers.has(playerA) || playerB === duelState.BYE) {
        continue;
      }

      // Assign this pairing a number
      pairNumbers.set(playerA, pairCounter);
      pairNumbers.set(playerB, pairCounter);
      processedPlayers.add(playerA);
      processedPlayers.add(playerB);
      pairCounter++;
    }
  }

  // Update badges for all players
  for (const player of players) {
    const isTarget = player._name === targetName;
    const isSelf = player.isSelf;
    const pairNumber = pairNumbers.get(player._name);

    // Ensure player is visible (in case it was hidden)
    showDuelPlayer(player);

    if (isSelf) {
      // Self: no badge
      removeDuelTargetBadge(player);
      removePairBadge(player);
    } else if (isTarget && !isBye) {
      // Target: red "Target" badge
      addDuelTargetBadge(player);
      removePairBadge(player);
    } else if (pairNumber) {
      // Others: purple "Pair X" badge
      removeDuelTargetBadge(player);
      addPairBadge(player, pairNumber);
    } else {
      // No pairing (BYE or error)
      removeDuelTargetBadge(player);
      removePairBadge(player);
    }
  }

  // If BYE round, show a message
  if (isBye && duelResultMessagesEnabled) {
    sendSystemMessage(`[${duelState.currentRound}] This round: You have a BYE (no opponent)`);
  }
}

/**
 * Hide a player's avatar in duel mode
 * @param {Object} player - Quiz player object
 */
function hideDuelPlayer(player) {
  if (!player || !player.avatarSlot) return;

  // Store original values if not already stored
  if (!player._duelHidden) {
    player._duelOriginalTextColor = player.avatarSlot.$nameContainer.css("color");
    player._duelOriginalName = player._name;
    player._duelHidden = true;
  }

  // Hide avatar elements
  player.avatarSlot.$avatarImageContainer.addClass("hide");
  player.avatarSlot.$backgroundContainer.addClass("hide");
  player.avatarSlot.$nameContainer.addClass("hide");
  player.avatarSlot.$pointContainer.addClass("hide");

  // Hide the entire outer container
  const $outer = player.avatarSlot.$innerContainer?.closest('.qpAvatarContainerOuter');
  if ($outer && $outer.length) {
    $outer.addClass("hide");
  }
}

/**
 * Show a player's avatar in duel mode
 * @param {Object} player - Quiz player object
 */
function showDuelPlayer(player) {
  if (!player || !player.avatarSlot) return;

  // Restore visibility
  player.avatarSlot.$avatarImageContainer.removeClass("hide");
  player.avatarSlot.$backgroundContainer.removeClass("hide");
  player.avatarSlot.$nameContainer.removeClass("hide");
  player.avatarSlot.$pointContainer.removeClass("hide");

  // Restore original values if they were stored
  if (player._duelHidden) {
    if (player._duelOriginalTextColor) {
      player.avatarSlot.$nameContainer.css("color", player._duelOriginalTextColor);
    }
    if (player._duelOriginalName) {
      player.avatarSlot.$nameContainer.text(player._duelOriginalName);
    }
    player._duelHidden = false;
  }

  // Show the entire outer container
  const $outer = player.avatarSlot.$innerContainer?.closest('.qpAvatarContainerOuter');
  if ($outer && $outer.length) {
    $outer.removeClass("hide");
  }
}

/**
 * Add Target badge to opponent player
 * @param {Object} player - Quiz player object
 */
function addDuelTargetBadge(player) {
  if (!player || !player.avatarSlot) return;

  // Find the level bar area where host badge is shown
  const $levelBar = player.avatarSlot.$bottomContainer?.find('.qpAvatarLevelBar');
  if (!$levelBar || !$levelBar.length) return;

  // Check if badge already exists
  if ($levelBar.find('.qpAvatarDuelTargetIcon').length > 0) return;

  // Create target badge similar to host badge but with light red background
  const $targetBadge = $(`
    <div class="qpAvatarDuelTargetIcon text-center" style="
      background-color: rgba(239, 68, 68, 0.8);
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      margin-left: 5px;
      display: inline-block;
    ">
      <div>Target</div>
    </div>
  `);

  // Insert after level container
  const $levelOuter = $levelBar.find('.qpAvatarLevelOuter');
  if ($levelOuter.length) {
    $levelOuter.after($targetBadge);
  } else {
    $levelBar.append($targetBadge);
  }

  console.log(`[AMQ+ Duel] Added Target badge to ${player._name}`);
}

/**
 * Remove Target badge from player
 * @param {Object} player - Quiz player object
 */
function removeDuelTargetBadge(player) {
  if (!player || !player.avatarSlot) return;

  const $levelBar = player.avatarSlot.$bottomContainer?.find('.qpAvatarLevelBar');
  if (!$levelBar || !$levelBar.length) return;

  $levelBar.find('.qpAvatarDuelTargetIcon').remove();
}

/**
 * Get a unique color for each pair number
 * @param {number} pairNumber - The pair number
 * @returns {string} RGBA color string
 */
function getPairColor(pairNumber) {
  // const colors = [
  //   'rgba(147, 51, 234, 0.8)',  // Purple
  //   'rgba(59, 130, 246, 0.8)',  // Blue
  //   'rgba(16, 185, 129, 0.8)',  // Green
  //   'rgba(245, 158, 11, 0.8)',  // Orange
  //   'rgba(236, 72, 153, 0.8)',  // Pink
  //   'rgba(139, 92, 246, 0.8)',  // Indigo
  //   'rgba(20, 184, 166, 0.8)',  // Teal
  //   'rgba(251, 146, 60, 0.8)',  // Amber
  //   'rgba(244, 63, 94, 0.8)',   // Rose
  //   'rgba(14, 165, 233, 0.8)'   // Sky blue
  // ];

  const colors = [
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
    'rgba(147, 51, 234, 0.8)',  // Purple
  ];


  // Cycle through colors if we have more pairs than colors
  return colors[(pairNumber - 1) % colors.length];
}

/**
 * Add Pair badge to player (with unique color per pair)
 * @param {Object} player - Quiz player object
 * @param {number} pairNumber - The pair number (e.g., 1, 2, 3)
 */
function addPairBadge(player, pairNumber) {
  if (!player || !player.avatarSlot) return;

  // Find the level bar area where badges are shown
  const $levelBar = player.avatarSlot.$bottomContainer?.find('.qpAvatarLevelBar');
  if (!$levelBar || !$levelBar.length) return;

  // Remove existing badge first
  $levelBar.find('.qpAvatarDuelPairIcon').remove();

  // Get unique color for this pair
  const pairColor = getPairColor(pairNumber);

  // Create pair badge with unique background color
  const $pairBadge = $(`
    <div class="qpAvatarDuelPairIcon text-center" style="
      background-color: ${pairColor};
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      margin-left: 5px;
      display: inline-block;
    ">
      <div>Pair ${pairNumber}</div>
    </div>
  `);

  // Insert after level container
  const $levelOuter = $levelBar.find('.qpAvatarLevelOuter');
  if ($levelOuter.length) {
    $levelOuter.after($pairBadge);
  } else {
    $levelBar.append($pairBadge);
  }

  console.log(`[AMQ+ Duel] Added Pair ${pairNumber} badge to ${player._name} with color ${pairColor}`);
}

/**
 * Remove Pair badge from player
 * @param {Object} player - Quiz player object
 */
function removePairBadge(player) {
  if (!player || !player.avatarSlot) return;

  const $levelBar = player.avatarSlot.$bottomContainer?.find('.qpAvatarLevelBar');
  if (!$levelBar || !$levelBar.length) return;

  $levelBar.find('.qpAvatarDuelPairIcon').remove();
}

/**
 * Reset all duel UI changes (called when quiz ends or duel mode disabled)
 */
function resetDuelUI() {
  if (typeof quiz === 'undefined' || !quiz.players) return;

  for (const player of Object.values(quiz.players)) {
    showDuelPlayer(player);
    removeDuelTargetBadge(player);
    removePairBadge(player);
  }

  console.log("[AMQ+ Duel] UI reset");
}

/**
 * Process answer results for duel mode - determine winners for each pairing
 * @param {Object} data - Answer results data from AMQ
 */
function processDuelAnswerResults(data) {
  if (!duelModeEnabled || !duelState.currentPairings || Object.keys(duelState.currentPairings).length === 0) {
    return;
  }

  // Build a map of player name to their result
  const playerResults = {};
  if (data.players && Array.isArray(data.players)) {
    data.players.forEach(result => {
      // Find player name from gamePlayerId
      const player = quiz?.players?.[result.gamePlayerId];
      if (player) {
        playerResults[player._name] = {
          correct: result.correct,
          score: result.score || 0,
          answer: result.answer || ''
        };
      }
    });
  }

  // Process each pairing to determine winner
  const processedPairs = new Set(); // Track processed pairs to avoid double counting
  const roundResults = [];

  for (const [playerA, playerB] of Object.entries(duelState.currentPairings)) {
    // Skip if we've already processed this pair (since pairings are bidirectional)
    const pairKey = [playerA, playerB].sort().join('|');
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    // Skip BYE pairings
    if (playerB === duelState.BYE) {
      roundResults.push({ playerA, playerB: 'BYE', result: 'bye' });
      continue;
    }

    const resultA = playerResults[playerA];
    const resultB = playerResults[playerB];

    if (!resultA || !resultB) {
      console.warn(`[AMQ+ Duel] Missing result for ${playerA} or ${playerB}`);
      continue;
    }

    let winner = null;
    let result = 'tie';

    if (resultA.correct && !resultB.correct) {
      // Player A wins
      winner = playerA;
      result = 'win';
      duelState.wins[playerA] = (duelState.wins[playerA] || 0) + 1;
      duelState.headToHead[playerA][playerB] = (duelState.headToHead[playerA]?.[playerB] || 0) + 1;
    } else if (!resultA.correct && resultB.correct) {
      // Player B wins
      winner = playerB;
      result = 'win';
      duelState.wins[playerB] = (duelState.wins[playerB] || 0) + 1;
      duelState.headToHead[playerB][playerA] = (duelState.headToHead[playerB]?.[playerA] || 0) + 1;
    } else {
      // Tie (both correct or both wrong)
      result = 'tie';
    }

    roundResults.push({ playerA, playerB, winner, result, resultA, resultB });
  }

  // Log round results
  console.log(`[AMQ+ Duel] Song ${duelState.currentRound} results:`, roundResults);

  // Display my duel result
  const myResult = roundResults.find(r =>
    r.playerA === selfName || r.playerB === selfName
  );

  if (myResult && duelResultMessagesEnabled) {
    if (myResult.result === 'bye') {
      // BYE message already sent in updateDuelAvatarVisibility
    } else if (myResult.winner === selfName) {
      sendSystemMessage(`[${duelState.currentRound}] You won this round vs ${duelState.myTarget}! (Wins: ${duelState.wins[selfName] || 0})`);
    } else if (myResult.winner) {
      sendSystemMessage(`[${duelState.currentRound}] ${duelState.myTarget} won this round. (Your wins: ${duelState.wins[selfName] || 0})`);
    } else {
      sendSystemMessage(`[${duelState.currentRound}] Tie with ${duelState.myTarget}. (Your wins: ${duelState.wins[selfName] || 0})`);
    }
  }

  // Update the scoreboard to show duel wins
  updateDuelScoreboard();
}

/**
 * Update the scoreboard to show duel wins
 * Called at predictable game events: Game Starting, play next song, answer results
 */
function updateDuelScoreboard() {
  if (!duelModeEnabled || typeof quiz === 'undefined') return;

  // Update the score display to show duel wins
  // The scoreboard shows .qpsPlayerScore which normally shows total points
  // We'll update it to show duel wins instead

  try {
    const entries = quiz.scoreboard?.playerEntries;
    if (!entries) return;

    for (const [playerId, entry] of Object.entries(entries)) {
      const playerName = entry.name || entry.$scoreBoardEntryTextContainer?.find('.qpsPlayerName').text();
      const duelWins = duelState.wins[playerName] || 0;

      // Update the score display
      const $scoreElement = entry.$scoreBoardEntryTextContainer?.find('.qpsPlayerScore');
      if ($scoreElement && $scoreElement.length) {
        // Only update if value changed to minimize DOM mutations
        const currentText = $scoreElement.text();
        const newText = `${duelWins}W`;
        if (currentText !== newText) {
          // Store original score if not stored
          if (entry._duelOriginalScore === undefined) {
            entry._duelOriginalScore = currentText;
          }
          // Show duel wins with indicator
          $scoreElement.text(newText);
        }
      }
    }
  } catch (e) {
    console.error("[AMQ+ Duel] Error updating scoreboard:", e);
  }
}

/**
 * Display final duel standings at quiz end
 */
function displayDuelFinalStandings() {
  if (!duelModeEnabled || Object.keys(duelState.wins).length === 0) return;

  // Sort players by wins (descending)
  const standings = Object.entries(duelState.wins)
    .sort((a, b) => {
      // First by wins
      if (b[1] !== a[1]) return b[1] - a[1];
      // Then by head-to-head if tied
      const h2hA = duelState.headToHead[a[0]]?.[b[0]] || 0;
      const h2hB = duelState.headToHead[b[0]]?.[a[0]] || 0;
      return h2hB - h2hA;
    });

  console.log("[AMQ+ Duel] Final standings:", standings);

  // Display standings in chat
  sendSystemMessage("━━━━━━━━━━━━━━━━━━━━");
  sendSystemMessage("🏆 DUEL MODE FINAL STANDINGS 🏆");

  let currentRank = 1;
  let previousWins = null;

  standings.forEach(([player, wins], index) => {
    // Only increment rank when wins change (handles ties)
    if (previousWins !== null && wins !== previousWins) {
      currentRank = index + 1;
    }
    previousWins = wins;

    let medal = '';
    if (currentRank === 1) medal = '🥇';
    else if (currentRank === 2) medal = '🥈';
    else if (currentRank === 3) medal = '🥉';

    sendSystemMessage(`${medal} ${currentRank}. ${player}: ${wins} win${wins !== 1 ? 's' : ''}`);
  });

  sendSystemMessage("━━━━━━━━━━━━━━━━━━━━");

  // Update the final scoreboard display
  updateFinalDuelScoreboard(standings);
}

/**
 * Update the final scoreboard to show duel rankings
 * Called when quiz ends
 * @param {Array} standings - Sorted array of [playerName, wins]
 */
function updateFinalDuelScoreboard(standings) {
  if (typeof quiz === 'undefined' || !quiz.scoreboard) return;

  try {
    // The standing items container shows the final rankings
    const $container = $('#qpStandingItemContainer');
    if (!$container.length) return;

    // Update each standing item based on duel wins
    const $items = $container.find('.qpStandingItem');

    // Calculate tied ranks
    let currentRank = 1;
    let previousWins = null;

    standings.forEach(([playerName, wins], index) => {
      // Only increment rank when wins change (handles ties)
      if (previousWins !== null && wins !== previousWins) {
        currentRank = index + 1;
      }
      previousWins = wins;

      // Find the item for this player
      $items.each(function () {
        const $item = $(this);
        const $playerName = $item.find('.qpsPlayerName');
        const itemPlayerName = $playerName.text().trim();

        if (itemPlayerName === playerName) {
          // Update the rank number (using tied rank)
          const $rankNum = $item.find('.qpScoreBoardNumber');
          if ($rankNum.length) {
            $rankNum.text(currentRank);
          }

          // Update the score to show wins
          const $score = $item.find('.qpsPlayerScore');
          if ($score.length) {
            $score.text(`${wins}W`);
          }

          // Update position based on index (visual order)
          $item.css('transform', `translateY(${index * 30}px)`);
        }
      });
    });

    console.log("[AMQ+ Duel] Final scoreboard updated");
  } catch (e) {
    console.error("[AMQ+ Duel] Error updating final scoreboard:", e);
  }
}

/**
 * Check player lists and warn about missing/invalid lists
 */
function checkAndWarnUserLists() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) return;

  cachedPlayerLists.forEach(entry => {
    const username = entry.username ? entry.username.trim() : '';
    if (!username || username === '-') {
      const playerName = entry.originalName || entry.id || 'A player';
      sendSystemMessage(`⚠️ ${playerName} has no linked anime list - their songs won't be included`);
    } else if (entry.platform === 'kitsu') {
      sendSystemMessage(`⚠️ ${entry.username} uses Kitsu which is not supported - their songs won't be included`);
    }
  });
}

/**
 * Hijack Room Settings button to show Users' Lists/Load Quiz button and force Standard Quiz view
 * Button text changes based on mode: "Load Quiz" in Advanced mode, "Users' Lists" in Basic mode
 */
function hijackRoomSettings() {
  console.log("[AMQ+] Setting up Room Settings and Users' Lists/Load Quiz buttons...");

  // Move Room Settings button to the far right
  const settingsContainer = $("#lnSettingsButtonContainer");
  if (settingsContainer.length === 0) {
    console.warn("[AMQ+] Room Settings container not found, will retry...");
    setTimeout(hijackRoomSettings, 1000);
    return;
  }

  // AMQ's top menu layout:
  // [Leave] [Room Info] ... [Start] ... [Settings] [Team Setup] [AMQ+]
  // We want: [Start] ... [Users' Lists/Load Quiz] [Room Settings] [AMQ+]
  // Room Settings should be rightmost, Users' Lists/Load Quiz should be to its left

  // Remove existing Users' Lists/Load Quiz button if it exists (to reposition it)
  $("#amqPlusUsersListsBtn").remove();

  // Get the menu bar and ensure it has position relative for absolute positioning
  const menuBar = $("#lobbyPage .topMenuBar");
  if (menuBar.css("position") === "static" || !menuBar.css("position")) {
    menuBar.css("position", "relative");
  }

  // Create Users' Lists button with absolute positioning and centered text
  // Position it at the far right (rightmost)
  // Button text changes based on mode: "Load Quiz" in Advanced mode, "Users' Lists" in Basic mode
  const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;
  const initialButtonText = isAdvancedMode ? "Load Quiz" : "Users' Lists";
  const usersListsBtn = $(`
    <div id="amqPlusUsersListsBtn" class="clickAble topMenuButton topMenuMediumButton" style="position: absolute; top: 0; text-align: center; z-index: 10;">
      <h3 style="text-align: center; margin: 0;">${initialButtonText}</h3>
    </div>
  `);

  // Append Users' Lists/Load Quiz button to menu bar
  menuBar.append(usersListsBtn);

  // Update positions after elements are rendered to get accurate widths
  // Users' Lists/Load Quiz stays at right: 0 (rightmost), Room Settings goes to its left
  const updatePositions = () => {
    // Ensure Users' Lists/Load Quiz is at the far right
    const actualUsersListsWidth = usersListsBtn.outerWidth(true) || 120;
    usersListsBtn.css({
      "position": "absolute",
      "right": "0",
      "top": "0",
      "z-index": "10"
    });

    // Position Room Settings to the left of Users' Lists/Load Quiz
    const margin = 5; // spacing between buttons
    const settingsRight = actualUsersListsWidth + margin;

    settingsContainer.css({
      "position": "absolute",
      "right": `${settingsRight}px`,
      "top": "0",
      "z-index": "5"
    });

    const actualSettingsWidth = settingsContainer.outerWidth(true) || 150;

    console.log("[AMQ+] Users' Lists/Load Quiz at right: 0px (width:", actualUsersListsWidth, "px), Room Settings at right:", settingsRight, "px (width:", actualSettingsWidth, "px)");
  };

  // Update positions multiple times to ensure accuracy
  setTimeout(updatePositions, 50);
  setTimeout(updatePositions, 150);
  setTimeout(updatePositions, 300);

  // Verify the DOM structure and force reflow
  setTimeout(() => {
    const insertedBtn = $("#amqPlusUsersListsBtn");
    const nextSibling = insertedBtn.next();
    if (nextSibling.length > 0 && nextSibling.attr("id") === "lnSettingsButtonContainer") {
      console.log("[AMQ+] ✓ Users' Lists/Load Quiz button correctly positioned before Settings container");
      console.log("[AMQ+] DOM order: Users' Lists/Load Quiz -> Room Settings");
      console.log("[AMQ+] Expected visual order (with float:right): Room Settings (rightmost) -> Users' Lists/Load Quiz");

      // Force a reflow to ensure styles are applied
      insertedBtn[0].offsetHeight;
      nextSibling[0].offsetHeight;
    } else {
      console.warn("[AMQ+] ⚠ Users' Lists/Load Quiz button positioning may be incorrect. Next sibling:", nextSibling.attr("id") || "none");
    }
  }, 100);

  // Handler for Users' Lists button
  usersListsBtn.off("click").on("click", () => {
    // Only host can use this button
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can access Users' Lists or Load Quiz.");
      return;
    }

    const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;

    if (isAdvancedMode) {
      console.log("[AMQ+] Load Quiz button clicked, opening AMQ+ advanced modal");
      // Remove any leftover modal backdrops and modal-open class
      $(".modal-backdrop").remove();
      $("body").removeClass("modal-open").css("padding-right", "");

      // Show the AMQ+ modal
      $("#amqPlusModal").modal("show");

      // Ensure modal-open class is applied and scrolling works
      setTimeout(() => {
        $("body").addClass("modal-open");
      }, 50);
    } else {
      console.log("[AMQ+] Users' Lists button clicked");
      showUsersListsModal();
    }
  });

  console.log("[AMQ+] Users' Lists/Load Quiz button inserted before Settings container");

  // Update button visibility and text based on AMQ+ enabled state
  updateUsersListsButtonVisibility();

  // Intercept Room Settings button click to ensure it opens on Settings tab in Advanced mode
  const settingsButton = settingsContainer.find(".clickAble");
  if (settingsButton.length > 0) {
    settingsButton.off("click.amqPlus").on("click.amqPlus", function (e) {
      const isAdvancedMode = amqPlusEnabled && !basicSettingsMode;
      if (isAdvancedMode) {
        // Set tab to Settings before opening modal
        amqPlusHostModalTab = 'settings';

        // Wait for modal to open, then ensure Settings tab is selected
        setTimeout(() => {
          const settingsTab = $("#amqPlusSettingsTab");
          const loadQuizTab = $("#amqPlusLoadQuizTab");

          if (settingsTab.length && loadQuizTab.length) {
            // Ensure Settings tab is selected
            settingsTab.addClass("selected");
            loadQuizTab.removeClass("selected");

            // Ensure modal is in advanced mode and hide load container
            if (typeof hostModal !== 'undefined') {
              if (hostModal.changeView) {
                hostModal.changeView('advanced');
              }
              if (hostModal.hideLoadContainer) {
                hostModal.hideLoadContainer();
              }
            }

            // Render the Settings view
            renderAmqPlusHostModalView();
          }
        }, 100);
      }
    });
  }

  // Mark as hijacked (but allow repositioning on subsequent calls)
  if (!roomSettingsHijacked) {
    roomSettingsHijacked = true;
    console.log("[AMQ+] Room Settings setup complete");
  }
}

/**
 * Show Users' Lists configuration modal
 */
function showUsersListsModal() {
  // Check if modal already exists
  let modal = $("#amqPlusUsersListsModal");
  if (modal.length === 0) {
    // Create the modal
    const modalHtml = createUsersListsModalHTML();
    $("body").append(modalHtml);
    modal = $("#amqPlusUsersListsModal");
    attachUsersListsModalHandlers();
  }

  // Update content
  updateUsersListsModalContent();

  // Show modal
  modal.modal("show");
}

/**
 * Create Users' Lists modal HTML
 */
function createUsersListsModalHTML() {
  return `
    <div class="modal fade" id="amqPlusUsersListsModal" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document" style="width: 600px; max-width: 95%;">
        <div class="modal-content" style="background-color: #1a1a2e; color: #e2e8f0; border: 1px solid #4a5568;">
          <div class="modal-header" style="border-bottom: 1px solid #2d3748; padding: 15px 20px;">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="color: #fff; opacity: 0.8;">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title" style="font-weight: bold; color: #fff;">
              <i class="fa fa-users" style="color: #6366f1; margin-right: 8px;"></i>
              Users' Lists Configuration
            </h4>
          </div>
          <div class="modal-body" style="padding: 20px; max-height: 60vh; overflow-y: auto;">
            <div id="amqPlusUsersListsContent">
              <!-- Content will be populated dynamically -->
            </div>
          </div>
          <div class="modal-footer" style="border-top: 1px solid #2d3748; padding: 15px 20px;">
            <button type="button" class="btn btn-default" id="amqPlusUsersListsSyncBtn">
              <i class="fa fa-refresh"></i> Sync from Lobby
            </button>
            <button type="button" class="btn btn-success" id="amqPlusUsersListsAddBtn">
              <i class="fa fa-plus"></i> Add Player
            </button>
            <button type="button" class="btn btn-primary" data-dismiss="modal">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Attach handlers for Users' Lists modal
 */
function attachUsersListsModalHandlers() {
  // Sync from Lobby button
  $("#amqPlusUsersListsSyncBtn").off("click").on("click", function () {
    const btn = $(this);
    btn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Syncing...');

    gatherPlayerLists().then(userEntries => {
      cachedPlayerLists = userEntries;
      applyRandomPreset();
      updateUsersListsModalContent();
      checkAndWarnUserLists();
      btn.prop("disabled", false).html('<i class="fa fa-refresh"></i> Sync from Lobby');
    }).catch(error => {
      console.error("[AMQ+] Error syncing:", error);
      sendSystemMessage("⚠️ Failed to sync: " + error.message);
      btn.prop("disabled", false).html('<i class="fa fa-refresh"></i> Sync from Lobby');
    });
  });

  // Add Player button
  $("#amqPlusUsersListsAddBtn").off("click").on("click", function () {
    handleManualAdd();
    updateUsersListsModalContent();
  });
}

/**
 * Update Users' Lists modal content
 */
function updateUsersListsModalContent() {
  const container = $("#amqPlusUsersListsContent");

  if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
    container.html(`
      <div style="text-align: center; padding: 30px; color: rgba(255,255,255,0.6);">
        <i class="fa fa-users" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5; display: block;"></i>
        <p>No player lists synced yet.</p>
        <p>Click "Sync from Lobby" to gather player lists.</p>
      </div>
    `);
    return;
  }

  const entriesHtml = cachedPlayerLists.map((entry, idx) => createUsersListsEntryHTML(entry, idx)).join('');

  container.html(`
    ${entriesHtml}
  `);

  // Attach handlers for dynamic elements
  attachUsersListsEntryHandlers();
}

/**
 * Create HTML for a single user entry in Users' Lists modal
 */
function createUsersListsEntryHTML(entry, idx) {
  const animeListUsername = entry.username || '-';
  const platform = entry.platform || 'unknown';
  const amqUsername = entry.amqUsername || animeListUsername || 'Unknown';
  const isInvalid = !animeListUsername || animeListUsername === '-' || platform === 'kitsu';

  const selectedLists = entry.selectedLists || {
    completed: true,
    watching: true,
    planning: false,
    on_hold: false,
    dropped: false
  };

  // Show mapping if AMQ username differs from anime list username
  const showMapping = amqUsername !== animeListUsername && !isInvalid;

  return `
    <div class="amqPlusUsersListsEntry" data-idx="${idx}" style="
      padding: 12px;
      margin-bottom: 10px;
      background: ${isInvalid ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)'};
      border: 1px solid ${isInvalid ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.1)'};
      border-radius: 8px;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
            <strong style="color: ${isInvalid ? '#ef4444' : '#fff'}; font-size: 14px;">
              ${isInvalid ? '⚠️ ' : ''}${amqUsername}
            </strong>
            <span style="color: rgba(255,255,255,0.5); font-size: 11px;">
              (AMQ)
            </span>
            ${showMapping ? `
              <span style="color: rgba(255,255,255,0.4); font-size: 11px; margin: 0 4px;">→</span>
              <span style="color: rgba(255,255,255,0.7); font-size: 12px;">
                ${animeListUsername}
              </span>
              <span style="color: rgba(255,255,255,0.5); font-size: 11px;">
                (${platform})
              </span>
            ` : !isInvalid ? `
              <span style="color: rgba(255,255,255,0.5); font-size: 11px;">
                (${platform})
              </span>
            ` : ''}
            ${isInvalid ? '<span style="color: #ef4444; font-size: 11px; margin-left: 8px;">- No valid list</span>' : ''}
          </div>
        </div>
        <button class="btn btn-xs btn-danger amqPlusUsersListsRemoveBtn" data-idx="${idx}" style="padding: 2px 8px;">
          <i class="fa fa-times"></i>
        </button>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
          <input type="checkbox" class="amqPlusUsersListsStatus" data-idx="${idx}" data-status="completed" ${selectedLists.completed ? 'checked' : ''} style="margin-right: 4px;">
          Completed
        </label>
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
          <input type="checkbox" class="amqPlusUsersListsStatus" data-idx="${idx}" data-status="watching" ${selectedLists.watching ? 'checked' : ''} style="margin-right: 4px;">
          Watching
        </label>
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
          <input type="checkbox" class="amqPlusUsersListsStatus" data-idx="${idx}" data-status="planning" ${selectedLists.planning ? 'checked' : ''} style="margin-right: 4px;">
          Planning
        </label>
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
          <input type="checkbox" class="amqPlusUsersListsStatus" data-idx="${idx}" data-status="on_hold" ${selectedLists.on_hold ? 'checked' : ''} style="margin-right: 4px;">
          On Hold
        </label>
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
          <input type="checkbox" class="amqPlusUsersListsStatus" data-idx="${idx}" data-status="dropped" ${selectedLists.dropped ? 'checked' : ''} style="margin-right: 4px;">
          Dropped
        </label>
      </div>
    </div>
  `;
}

/**
 * Attach handlers for Users' Lists entries
 */
function attachUsersListsEntryHandlers() {
  // Remove button handler
  $(".amqPlusUsersListsRemoveBtn").off("click").on("click", function () {
    const idx = $(this).data("idx");
    if (cachedPlayerLists && cachedPlayerLists[idx]) {
      const removed = cachedPlayerLists.splice(idx, 1)[0];
      const displayName = removed.amqUsername || removed.username || 'player';
      sendSystemMessage(`Removed ${displayName} from list`);
      updateUsersListsModalContent();
    }
  });

  // Status checkbox handler
  $(".amqPlusUsersListsStatus").off("change").on("change", function () {
    const idx = $(this).data("idx");
    const status = $(this).data("status");
    const checked = $(this).is(":checked");

    if (cachedPlayerLists && cachedPlayerLists[idx]) {
      if (!cachedPlayerLists[idx].selectedLists) {
        cachedPlayerLists[idx].selectedLists = {
          completed: true,
          watching: true,
          planning: false,
          on_hold: false,
          dropped: false
        };
      }
      cachedPlayerLists[idx].selectedLists[status] = checked;
      savePlayerSettingsForEntry(cachedPlayerLists[idx]);
    }
  });
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
    // Disable script in restricted modes (Jam, Ranked, Themed)
    if (shouldDisableScript()) {
      sendSystemMessage("⚠️ AMQ+ is disabled in Jam, Ranked, and Themed modes.");
      $(this).prop("checked", false); // Keep it disabled
      amqPlusEnabled = false;
      return;
    }

    // Only host can toggle AMQ+
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      $(this).prop("checked", amqPlusEnabled); // Revert the toggle
      return;
    }

    amqPlusEnabled = $(this).is(":checked");
    if (!amqPlusEnabled) {
      basicSettingsMode = false; // Disable basic mode when AMQ+ is disabled
      autoDisableTraining("AMQ+ disabled");
    }
    saveSettings();
    updateToggleButton();
    updateBasicModeSettingsUI();
    updateAdvancedModeSettingsUI();
    updateUsersListsButtonVisibility(); // Update button text
    if (amqPlusEnabled) {
      sendSystemMessage("AMQ+ mode enabled");
      // Send /listhelp message to inform users about list commands
      setTimeout(() => {
        const isLiveNodeConfigured = cachedPlayerLists && cachedPlayerLists.length > 0;
        handleListHelpCommand("System", isLiveNodeConfigured);
      }, 500);
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

  // Disable AMQ+ if in restricted modes
  if (shouldDisableScript()) {
    amqPlusEnabled = false;
    console.log("[AMQ+] AMQ+ disabled due to restricted mode (Jam/Ranked/Themed)");
  }

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
    // Disable the toggle checkbox if in restricted mode
    if (shouldDisableScript()) {
      $("#amqPlusEnableToggle").prop("disabled", true);
    } else {
      $("#amqPlusEnableToggle").prop("disabled", false);
    }
  }

  // Update Users' Lists button visibility
  updateUsersListsButtonVisibility();
}

/**
 * Update Users' Lists button visibility and text based on AMQ+ enabled state and mode
 */
function updateUsersListsButtonVisibility() {
  const usersListsBtn = $("#amqPlusUsersListsBtn");
  if (usersListsBtn.length > 0) {
    if (amqPlusEnabled && !isTrainingMode) {
      usersListsBtn.show();

      // Update button text based on mode
      const isAdvancedMode = !basicSettingsMode;
      const buttonText = isAdvancedMode ? "Load Quiz" : "Users' Lists";
      usersListsBtn.find("h3").text(buttonText);

      console.log("[AMQ+] Users' Lists/Load Quiz button shown as:", buttonText);
    } else {
      usersListsBtn.hide();
      if (isTrainingMode) {
        console.log("[AMQ+] Users' Lists/Load Quiz button hidden (training mode)");
      } else {
        console.log("[AMQ+] Users' Lists/Load Quiz button hidden");
      }
    }
  } else if (amqPlusEnabled && !isTrainingMode) {
    // Button doesn't exist but AMQ+ is enabled - create it
    console.log("[AMQ+] Users' Lists/Load Quiz button doesn't exist, creating it...");
    hijackRoomSettings();
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
        #amqPlusUsersListsBtn {
            position: absolute !important;
            right: 0 !important;
            top: 0 !important;
            text-align: center !important;
            z-index: 10 !important;
            width: auto !important;
            min-width: 110px !important;
            max-width: 120px !important;
            padding-left: 8px !important;
            padding-right: 8px !important;
        }
        #lnSettingsButtonContainer {
            position: absolute !important;
            top: 0 !important;
            z-index: 5 !important;
        }
        #amqPlusUsersListsBtn h3 {
            text-align: center !important;
            margin: 0 !important;
            width: 100% !important;
            white-space: nowrap !important;
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
      songSelectionMode: basicSettingsMode ? 'default' : liveNodeSongSelectionMode
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
                    songSelectionMode: basicSettingsMode ? 'default' : liveNodeSongSelectionMode
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
                      songSelectionMode: basicSettingsMode ? 'default' : liveNodeSongSelectionMode
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

  const animeListUsername = entry.username || '-';
  const platform = entry.platform || 'unknown';
  const amqUsername = entry.amqUsername || animeListUsername || 'Unknown';
  const showMapping = amqUsername !== animeListUsername && animeListUsername !== '-';

  return `
            <div class="amqPlusPlayerEntry" data-entry-idx="${idx}" style="margin-bottom: 12px; padding: 10px; background-color: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-weight: bold; color: #fff; font-size: 13px;">
                      ${prefix}: ${amqUsername}
                      <span style="color: rgba(255,255,255,0.5); font-size: 11px; margin-left: 4px;">(AMQ)</span>
                      ${showMapping ? `
                        <span style="color: rgba(255,255,255,0.4); font-size: 11px; margin: 0 4px;">→</span>
                        <span style="color: rgba(255,255,255,0.7); font-size: 12px;">${animeListUsername}</span>
                        <span style="color: rgba(255,255,255,0.5); font-size: 11px;">(${platform})</span>
                      ` : animeListUsername !== '-' ? `
                        <span style="color: rgba(255,255,255,0.5); font-size: 11px; margin-left: 4px;">(${platform})</span>
                      ` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="btn btn-sm btn-danger amqPlusRemoveEntryBtn" data-entry-idx="${idx}" data-username="${amqUsername}" style="background-color: #dc3545; border-color: #dc3545; color: #fff; padding: 2px 8px; font-size: 10px; line-height: 1.2;">
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
    songSelectionMode: basicSettingsMode ? 'default' : liveNodeSongSelectionMode
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
      method: (liveNodeData || lobby?.gameId) ? "POST" : "GET",
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

    if (liveNodeData || lobby?.gameId) {
      requestConfig.headers = {
        "Content-Type": "application/json"
      };

      const payload = {};
      if (liveNodeData) {
        payload.liveNodeData = liveNodeData;
      }
      if (lobby?.gameId) {
        payload.roomId = String(lobby.gameId);
      }

      requestConfig.data = JSON.stringify(payload);
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

  // Build song overlap map for duel mode if available
  console.log("[AMQ+ Duel DEBUG] saveQuiz: Checking if should build songOverlapMap...");
  console.log("[AMQ+ Duel DEBUG] saveQuiz: duelModeEnabled =", duelModeEnabled);
  console.log("[AMQ+ Duel DEBUG] saveQuiz: data.songOverlapMap exists =", !!data.songOverlapMap);
  console.log("[AMQ+ Duel DEBUG] saveQuiz: data.songOverlapMap =", data.songOverlapMap);

  if (duelModeEnabled && data.songOverlapMap) {
    buildSongOverlapMap(data.songOverlapMap, quizSave);
  } else {
    console.warn("[AMQ+ Duel DEBUG] saveQuiz: NOT building songOverlapMap! Reason:",
      !duelModeEnabled ? "duelModeEnabled is false" : "data.songOverlapMap is missing from API response");
  }

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

/**
 * Build song overlap map for duel mode - maps annSongId to list of usernames who know the song
 * @param {Array} overlapMapData - Array of {annSongId, hasAnimeUsernames} from API
 * @param {Object} quizSave - Quiz save object to filter to only quiz songs
 */
function buildSongOverlapMap(overlapMapData, quizSave) {
  console.log("[AMQ+ Duel DEBUG] buildSongOverlapMap: Starting build");
  console.log("[AMQ+ Duel DEBUG] overlapMapData:", overlapMapData);

  duelState.songOverlapMap = new Map();

  // Extract annSongIds from quizSave blocks to filter
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

  console.log("[AMQ+ Duel DEBUG] Quiz annSongIds:", Array.from(quizAnnSongIds));

  if (overlapMapData && Array.isArray(overlapMapData)) {
    overlapMapData.forEach(entry => {
      if (entry.annSongId) {
        // Only add if song is in the quiz
        if (quizAnnSongIds.size === 0 || quizAnnSongIds.has(entry.annSongId)) {
          duelState.songOverlapMap.set(entry.annSongId, entry.hasAnimeUsernames || []);
          console.log(`[AMQ+ Duel DEBUG] Added to map: annSongId=${entry.annSongId}, hasAnimeUsernames=[${(entry.hasAnimeUsernames || []).join(', ')}]`);
        } else {
          console.log(`[AMQ+ Duel DEBUG] Skipped (not in quiz): annSongId=${entry.annSongId}`);
        }
      }
    });
  }

  console.log("[AMQ+ Duel] Built song overlap map with", duelState.songOverlapMap.size, "entries");
  console.log("[AMQ+ Duel DEBUG] Full songOverlapMap:", Array.from(duelState.songOverlapMap.entries()).map(([id, users]) => ({ annSongId: id, users })));
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

    // If no exact match and the new quiz starts with "AMQ+ ",
    // look for ANY quiz starting with "AMQ+ " to overwrite to save space
    if (!existingQuiz && quizName.startsWith("AMQ+ ")) {
      existingQuiz = quizzes.find(q => q.name.startsWith("AMQ+ "));
      if (existingQuiz) {
        console.log("[AMQ+] No exact match, but found another AMQ+ quiz to overwrite:", existingQuiz.name);
      }
    }
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

  // Set flag to prevent infinite loop when applying quiz triggers settings change
  isApplyingRoomSettingsQuiz = true;

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

    // Clear the flag after quiz is applied
    setTimeout(() => {
      isApplyingRoomSettingsQuiz = false;
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

// Distribution Output Logic
let distributionOutputEnabled = false;

/**
 * Handle listhelp command
 */
function handleListHelpCommand(sender, isLiveNodeConfigured) {
  const isSystemMessage = sender === "System";
  const helpMessages = [
    isSystemMessage ? "Player List Commands Help" : `@${sender}: Player List Commands Help`,
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "/ add [status...] - Add list statuses",
    "/ remove [status...] - Remove list statuses",
    "/ list - Show your enabled lists",
    "/ listhelp - Show this help",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "Valid statuses: completed, watching, planning, on-hold, dropped",
    "Example: / add completed watching",
    "Example: / remove dropped",
    "━━━━━━━━━━━━━━━━━━━━━━━━"
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

  // First try to find by AMQ username (since commands come from AMQ usernames)
  let player = cachedPlayerLists.find(entry => entry.amqUsername === playerName);

  // If not found, try to find by anime list username (for backwards compatibility)
  if (!player) {
    player = cachedPlayerLists.find(entry => entry.username === playerName);
  }

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

/**
 * Handle /1v1debug command - toggle real-time debug output for duel mode messages
 */
function handle1v1DebugCommand() {
  duelDebugEnabled = !duelDebugEnabled;
  sendSystemMessage(`1v1 Debug Mode ${duelDebugEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (duelDebugEnabled) {
    sendSystemMessage("All duel mode commands will now be displayed as human-readable messages in system chat.");
  }
}

/**
 * Handle /1v1results command - toggle duel result messages (wins/losses/ties)
 */
function handle1v1ResultsCommand() {
  duelResultMessagesEnabled = !duelResultMessagesEnabled;
  sendSystemMessage(`1v1 Result Messages ${duelResultMessagesEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (!duelResultMessagesEnabled) {
    sendSystemMessage("Round result messages will be hidden. Use /1v1results to show them again.");
  }
}

function handleChatCommand(msg) {
  console.log("[AMQ+] Chat message from self:", msg);

  // Check for 1v1 debug command
  if (msg.toLowerCase().trim() === "/1v1debug") {
    handle1v1DebugCommand();
    return;
  }

  // Check for 1v1 results toggle command
  if (msg.toLowerCase().trim() === "/1v1results") {
    handle1v1ResultsCommand();
    return;
  }

  if (!msg.startsWith("/amqplus")) {
    // Also check for player list commands from self
    handlePlayerListCommand(msg, selfName);
    return;
  }

  console.log("[AMQ+] AMQ+ command detected");
  const parts = msg.split(" ");

  if (parts[1] === "toggle") {
    console.log("[AMQ+] Toggle command received");

    // Disable script in restricted modes (Jam, Ranked, Themed)
    if (shouldDisableScript()) {
      sendSystemMessage("⚠️ AMQ+ is disabled in Jam, Ranked, and Themed modes.");
      amqPlusEnabled = false;
      saveSettings();
      updateToggleButton();
      return;
    }

    // Only host can toggle AMQ+ via command
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
      sendSystemMessage("⚠️ Only the room host can enable or configure AMQ+.");
      return;
    }
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
  } else if (parts[1] === "distribution" || parts[1] === "dist") {
    console.log("[AMQ+] Distribution command received");
    distributionOutputEnabled = !distributionOutputEnabled;
    sendSystemMessage("Song distribution output " + (distributionOutputEnabled ? "enabled" : "disabled"));
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

    // Reset quiz fetched flag when quiz ends (allows loading new quiz for next game)
    quizFetchedBeforeGameStart = false;
    console.log("[AMQ+] Quiz end result, reset quiz fetched flag");

    // Reset duel UI when quiz ends
    if (duelModeEnabled) {
      resetDuelUI();
      displayDuelFinalStandings();
    }

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

    // Remind users to sync players list if AMQ+ is enabled
    if (amqPlusEnabled && cachedPlayerLists && cachedPlayerLists.length > 0) {
      setTimeout(() => {
        sendSystemMessage("Remember to sync players list through Users' List tab if anyone joins or leaves the lobby!");
      }, 1000);
    }
  }).bindListener();

  new Listener("quiz over", (payload) => {
    // Reset quiz fetched flag when quiz ends (allows re-roll for next game)
    quizFetchedBeforeGameStart = false;
    console.log("[AMQ+] Quiz over, reset quiz fetched flag");

    // Defensive cleanup for training overlay
    hideTrainingRatingUI(false);

    // Reset duel UI when returning to lobby
    if (duelModeEnabled) {
      console.log("[AMQ+ Duel] Quiz over, resetting UI");
      resetDuelUI();
      // Display final standings before resetting
      displayDuelFinalStandings();
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
        // Mark that quiz was fetched before game start
        quizFetchedBeforeGameStart = true;
        console.log("[AMQ+] Quiz fetched before game start, flag set");
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

      // Mark that quiz was fetched/saved before game start to prevent re-roll on Start
      quizFetchedBeforeGameStart = true;
      console.log("[AMQ+] Quiz saved before game start, flag set to prevent re-roll");

      // Rebuild songSourceMap from the actual saved quiz to ensure it matches what AMQ saved
      if (payload.quizSave && currentQuizData && currentQuizData.songSourceMap) {
        console.log("[AMQ+] Rebuilding songSourceMap from saved quiz");
        buildSongSourceMap({
          songSourceMap: currentQuizData.songSourceMap,
          command: { data: { quizSave: payload.quizSave } }
        }, payload.quizSave);
      }

      updateModalStatus("Quiz saved successfully - Applying to lobby...");

      // Get song count for the message
      const songCount = payload.quizSave?.ruleBlocks?.[0]?.blocks?.length || 0;

      // Send message to chat that quiz is ready
      if (songCount > 0) {
        sendSystemMessage(`✅ Quiz ready! ${songCount} song${songCount !== 1 ? 's' : ''} loaded. Press Start to begin.`);
      } else {
        sendSystemMessage("✅ Quiz ready! Press Start to begin.");
      }

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

      // Apply quiz to lobby (settings were already applied in basic settings mode)
      if (!isTrainingMode) {
        // Only auto-apply quiz to lobby if not in training mode
        // Training mode sessions handle quiz application themselves
        applyQuizToLobby(newQuizId, quizName);
      }
    } else {
      console.error("[AMQ+] Save quiz command failed:", payload);
      updateModalStatus(null);

      messageDisplayer.displayMessage("Quiz Save Failed", "The quiz failed to save. This is likely due to insufficient community quiz slots (need at least 1). Please delete an old quiz and try again.");
    }
  }).bindListener();

  new Listener("Game Starting", (payload) => {
    // Disable script in restricted modes
    if (shouldDisableScript()) {
      console.log("[AMQ+] Script disabled: Jam, Ranked, or Themed mode detected");
      return;
    }

    // Initialize duel mode if enabled
    if (duelModeEnabled) {
      console.log("[AMQ+ Duel] Game starting, initializing duel roster...");
      setTimeout(() => {
        initializeDuelRoster();

        // Host broadcasts enable command to all clients
        if (duelState.isHost && duelState.roster.length >= 2) {
          console.log("[AMQ+ Duel] Host broadcasting duel mode enable command...");
          broadcastDuelModeEnable(duelState.roster);
        }

        // Update scoreboard after roster initialization
        updateDuelScoreboard();

        // Send 1v1 mode instructions
        setTimeout(() => {
          sendSystemMessage("━━━━━━━━━━━━━━━━━━━━━━━━");
          sendSystemMessage("🎯 1v1 Duel Mode - How to Play:");
          sendSystemMessage("Each song, you'll be paired with an opponent.");
          sendSystemMessage("Points are gained when you answer correctly AND your opponent answers wrong.");
          sendSystemMessage("If both answer correctly or both wrong, it's a tie (no points gained).");
          sendSystemMessage("Your target opponent is marked with a red 'Target' badge.");
          sendSystemMessage("Other players show 'Pair X' badges for their matchups.");
          sendSystemMessage("Win the most rounds to be the champion!");
          sendSystemMessage("━━━━━━━━━━━━━━━━━━━━━━━━");
          sendSystemMessage("Commands: /1v1results - Toggle result messages");
          sendSystemMessage("━━━━━━━━━━━━━━━━━━━━━━━━");
        }, 500);
      }, 100);
    }

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

      // Send song distribution summary if enabled and songSourceMap is available
      if (distributionOutputEnabled && songSourceMap && songSourceMap.size > 0) {
        console.log("[AMQ+] Game starting, calculating song distribution...");

        const distribution = new Map();
        let totalMapped = 0;

        songSourceMap.forEach((info) => {
          const formatted = formatSourceInfo(info);
          // Use text instead of fullInfo to group properly
          let key = formatted.text;

          // Clean up key for better display
          if (key.startsWith('from list - ')) {
            key = key.substring(12); // Remove "from list - " prefix
          }

          distribution.set(key, (distribution.get(key) || 0) + 1);
          totalMapped++;
        });

        if (totalMapped > 0) {
          const sortedDist = Array.from(distribution.entries()).sort((a, b) => b[1] - a[1]);

          setTimeout(() => {
            // Header message
            socket.sendCommand({
              type: "lobby",
              command: "game chat message",
              data: { msg: "📊 Song distribution:", teamMessage: false }
            });

            // Individual member messages
            sortedDist.forEach(([name, count], index) => {
              setTimeout(() => {
                socket.sendCommand({
                  type: "lobby",
                  command: "game chat message",
                  data: { msg: `${name}: ${count} song${count !== 1 ? 's' : ''}`, teamMessage: false }
                });
              }, 100 * (index + 1));
            });
          }, 1500); // Delay slightly after credits message
        }
      }
    }
    // Reset song tracking (preserve songSourceMap - it's built from quiz data and needed during game)
    currentSongNumber = 0;
  }).bindListener();

  new Listener("play next song", (payload) => {
    if (payload && payload.songNumber) {
      currentSongNumber = payload.songNumber;
      console.log("[AMQ+] Current song number:", currentSongNumber);

      // Duel mode: host broadcasts pairings for this song
      if (duelModeEnabled && duelState.roster.length >= 2) {
        handleDuelSongStart(currentSongNumber);
        // Update scoreboard after a delay to ensure it's updated after AMQ renders it
        setTimeout(() => {
          updateDuelScoreboard();
        }, 500);
      }
    }
  }).bindListener();

  new Listener("answer results", (data) => {
    // Process duel mode scoring if enabled
    if (duelModeEnabled && duelState.roster.length >= 2) {
      processDuelAnswerResults(data);
    }

    if (!amqPlusEnabled || !selectedCustomQuizName || !selectedCustomQuizName.startsWith("AMQ+")) {
      return;
    }

    if (!songSourceMessagesEnabled) {
      return;
    }

    // Only host sends song source messages to global chat
    if (typeof lobby !== 'undefined' && lobby.inLobby && !lobby.isHost) {
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
      // Check for duel mode messages first (hidden from players)
      // Process even if duelModeEnabled is false to receive enable commands
      if (message.message.startsWith('❦')) {
        handleDuelMessage(message.message, message.sender);
        continue; // Don't process as regular chat
      }

      // Check if message is a command
      const msgLower = message.message.toLowerCase();
      if (msgLower.startsWith('/amqplus') || msgLower === '/1v1debug' || msgLower === '/1v1results') {
        // Commands that work locally for everyone (info, sources, dist)
        const localCommands = ['info', 'metadata', 'sources', 'distribution', 'dist'];
        const commandParts = msgLower.split(' ');
        const commandName = commandParts[1];
        const isLocalCommand = localCommands.includes(commandName);

        // Local commands work for everyone, even when not in lobby
        // Always allow local commands from self, regardless of lobby state
        if (isLocalCommand && message.sender === selfName) {
          handleChatCommand(msgLower);
          continue;
        }

        // Other commands require lobby and host status
        if (typeof lobby !== 'undefined' && lobby.inLobby) {
          // Get the sender's game player ID
          const senderPlayer = Object.values(quiz?.players || {}).find(p => p._name === message.sender);
          // Check if sender is host: either player object has host flag, or sender is self and lobby says we're host
          const isHost = senderPlayer?.host === true || (message.sender === selfName && lobby.isHost === true);

          if (isHost) {
            handleChatCommand(msgLower);
          } else if (message.sender === selfName) {
            // If self but not host, show error
            sendSystemMessage("⚠️ Only the room host can use AMQ+ commands.");
          }
        } else if (message.sender === selfName) {
          // If not in lobby but command is from self, try to handle it anyway
          // This handles edge cases where lobby state might not be properly initialized
          handleChatCommand(msgLower);
        }
      } else {
        // Handle player list commands from other players (host only)
        handlePlayerListCommand(message.message, message.sender);
      }
    }
  }).bindListener();

  new Listener("Game Chat Message", (payload) => {
    // Check for duel mode messages first (hidden from players)
    // Process even if duelModeEnabled is false to receive enable commands
    if (payload.message.startsWith('❦')) {
      handleDuelMessage(payload.message, payload.sender);
      return; // Don't process as regular chat
    }

    // Check if message is a command
    const msgLower = payload.message.toLowerCase();
    if (msgLower.startsWith('/amqplus') || msgLower === '/1v1debug' || msgLower === '/1v1results') {
      // Commands that work locally for everyone (info, sources, dist)
      const localCommands = ['info', 'metadata', 'sources', 'distribution', 'dist'];
      const commandParts = msgLower.split(' ');
      const commandName = commandParts[1];
      const isLocalCommand = localCommands.includes(commandName);

      // Local commands work for everyone, even when not in lobby
      // Always allow local commands from self, regardless of lobby state
      if (isLocalCommand && payload.sender === selfName) {
        handleChatCommand(msgLower);
        return;
      }

      // Other commands require lobby and host status
      if (typeof lobby !== 'undefined' && lobby.inLobby) {
        // Get the sender's game player ID
        const senderPlayer = Object.values(quiz?.players || {}).find(p => p._name === payload.sender);
        // Check if sender is host: either player object has host flag, or sender is self and lobby says we're host
        const isHost = senderPlayer?.host === true || (payload.sender === selfName && lobby.isHost === true);

        if (isHost) {
          handleChatCommand(msgLower);
        } else if (payload.sender === selfName) {
          // If self but not host, show error
          sendSystemMessage("⚠️ Only the room host can use AMQ+ commands.");
        }
      } else if (payload.sender === selfName) {
        // If not in lobby but command is from self, try to handle it anyway
        // This handles edge cases where lobby state might not be properly initialized
        handleChatCommand(msgLower);
      }
    } else {
      // Handle player list commands from other players (host only)
      handlePlayerListCommand(payload.message, payload.sender);
    }
  }).bindListener();

  console.log("[AMQ+] Event listeners set up complete");
}

function fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent) {
  const requestConfig = {
    method: (liveNodeData || (typeof lobby !== 'undefined' && lobby.gameId)) ? "POST" : "GET",
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

          // Build song overlap map for duel mode
          console.log("[AMQ+ Duel DEBUG] fetchQuizForReRoll: duelModeEnabled =", duelModeEnabled, ", data.songOverlapMap =", data.songOverlapMap);
          if (duelModeEnabled && data.songOverlapMap) {
            console.log("[AMQ+ Duel] Building song overlap map from re-roll response");
            buildSongOverlapMap(data.songOverlapMap, data.command.data.quizSave);
          }

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

  if (liveNodeData || (typeof lobby !== 'undefined' && lobby.gameId)) {
    requestConfig.headers = {
      "Content-Type": "application/json"
    };
    const payload = {};
    if (liveNodeData) {
      payload.liveNodeData = liveNodeData;
    }
    if (typeof lobby !== 'undefined' && lobby.gameId) {
      payload.roomId = String(lobby.gameId);
      console.log("[AMQ+] Including roomId in re-roll request:", payload.roomId);
    }
    requestConfig.data = JSON.stringify(payload);
  }

  GM_xmlhttpRequest(requestConfig);
}

function hijackStartButton() {
  console.log("[AMQ+] Setting up start button click prevention...");

  // Use MutationObserver to watch for start button appearance/changes
  const startButtonObserver = new MutationObserver(() => {
    const startButton = $("#lbStartButton");
    if (startButton.length === 0) return;

    // Remove any existing handlers to avoid duplicates
    startButton.off("click.amqplus");

    // Attach click handler
    startButton.on("click.amqplus", function (e) {
      const buttonText = startButton.find("h1").text().trim();

      // Only check for "Start" button, not "Ready" or other states
      if (buttonText !== "Start") {
        return; // Let normal behavior proceed
      }

      // Disable script in restricted modes (Jam, Ranked, Themed)
      if (shouldDisableScript()) {
        console.log("[AMQ+] Script disabled: Jam, Ranked, or Themed mode detected");
        return; // Let normal behavior proceed
      }

      // Don't prevent if in training mode
      if (isTrainingMode) {
        return; // Let normal behavior proceed
      }

      // Check if AMQ+ is enabled and quiz needs to be fetched
      if (amqPlusEnabled) {
        console.log("[AMQ+] Start button clicked, AMQ+ enabled, checking quiz status...");

        if (selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+")) {
          // Check if quiz has been fetched and saved
          // Quiz is ready if: currentQuizId exists AND quizFetchedBeforeGameStart is true
          const isQuizReady = currentQuizId && quizFetchedBeforeGameStart;

          if (!isQuizReady) {
            console.log("[AMQ+] Quiz not fetched yet, preventing start. currentQuizId:", currentQuizId, "quizFetchedBeforeGameStart:", quizFetchedBeforeGameStart);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            messageDisplayer.displayMessage(
              "Quiz Not Ready",
              "Please configure a quiz before starting the game. In basic mode the quiz should be configured automatically whenever you change room settings on STANDARD (not community) tab. For advanced mode supply the link to the quiz on AMQ+ site by clicking the the Load Quiz button. "
            );
            return false;
          } else {
            console.log("[AMQ+] Quiz already fetched and ready, allowing start");
            // Quiz is ready, allow normal start
          }
        }
        // If no AMQ+ quiz selected, allow normal start
      }
      // If AMQ+ not enabled, allow normal start
    });
  });

  // Observe the lobby page for start button
  const lobbyContainer = $("#lobbyPage");
  if (lobbyContainer.length > 0) {
    startButtonObserver.observe(lobbyContainer[0], {
      childList: true,
      subtree: true
    });
  }

  // Also check immediately in case button already exists
  setTimeout(() => {
    const startButton = $("#lbStartButton");
    if (startButton.length > 0) {
      startButton.off("click.amqplus");
      startButton.on("click.amqplus", function (e) {
        const buttonText = startButton.find("h1").text().trim();

        if (buttonText !== "Start") {
          return;
        }

        // Disable script in restricted modes (Jam, Ranked, Themed)
        if (shouldDisableScript()) {
          console.log("[AMQ+] Script disabled: Jam, Ranked, or Themed mode detected");
          return; // Let normal behavior proceed
        }

        if (isTrainingMode) {
          return;
        }

        if (amqPlusEnabled) {
          console.log("[AMQ+] Start button clicked, AMQ+ enabled, checking quiz status...");

          if (selectedCustomQuizName && selectedCustomQuizName.startsWith("AMQ+")) {
            const isQuizReady = currentQuizId && quizFetchedBeforeGameStart;

            if (!isQuizReady) {
              console.log("[AMQ+] Quiz not fetched yet, preventing start. currentQuizId:", currentQuizId, "quizFetchedBeforeGameStart:", quizFetchedBeforeGameStart);
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              messageDisplayer.displayMessage(
                "Quiz Not Ready",
                "Please wait for the AMQ+ quiz to be fetched before starting the game. The quiz will be automatically loaded when ready."
              );
              return false;
            } else {
              console.log("[AMQ+] Quiz already fetched and ready, allowing start");
            }
          }
        }
      });
    }
  }, 500);

  console.log("[AMQ+] Start button click prevention setup complete");
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
      `3. Click "Choose File" and select the downloaded JSON file<br>` +
      `4. The format will be automatically detected<br>` +
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
      `3. Click "Choose File" and select the downloaded JSON file<br>` +
      `4. The format will be automatically detected<br>` +
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

function extractPlayerNameFromProfile() {
  const profileContainer = $('.playerProfileContainer.floatingContainer:visible');
  if (profileContainer.length === 0) {
    return null;
  }

  // Try to find player name in common profile title locations
  const titleElement = profileContainer.find('.ppPlayerName, .playerName, h1, h2, .title').first();
  if (titleElement.length > 0) {
    const name = titleElement.text().trim();
    if (name) return name;
  }

  // Fallback: try to get from data attributes or other common patterns
  const dataName = profileContainer.attr('data-player-name') || profileContainer.attr('data-name');
  if (dataName) return dataName;

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
  // Get own AMQ username for duel mode matching
  const ownAmqUsername = typeof selfName !== 'undefined' ? selfName : null;

  if (ownListInfo && ownListInfo.username && ownListInfo.username.trim() !== '-' && ownListInfo.username.trim() !== '') {
    let entry = {
      id: `user-self-${Date.now()}`,
      platform: ownListInfo.platform,
      username: ownListInfo.username,
      amqUsername: ownAmqUsername, // Store AMQ username for duel mode matching
      selectedLists: { ...defaultStatuses },
      songPercentage: null
    };
    // Apply saved settings if they exist
    entry = applyPlayerSettingsToEntry(entry);
    userEntries.push(entry);
    console.log("[AMQ+] Added own list:", ownListInfo, `AMQ username: ${ownAmqUsername}`);
  } else if (ownListInfo && ownListInfo.username === '-') {
    console.log("[AMQ+] Skipped own list - username is '-' (no list provided)");
    sendSystemMessage(`⚠️ You have no linked anime list - your songs won't be included`);
  } else if (ownListInfo && (!ownListInfo.username || ownListInfo.username.trim() === '')) {
    console.log("[AMQ+] Skipped own list - username is empty or falsy");
    sendSystemMessage(`⚠️ You have no linked anime list - your songs won't be included`);
  }

  const lobbyAvatarRows = $('#lobbyAvatarContainer .lobbyAvatarRow');
  console.log("[AMQ+] Found lobby avatar rows:", lobbyAvatarRows.length);

  const profileIcons = [];
  const playerNames = [];
  lobbyAvatarRows.each(function () {
    const avatars = $(this).find('.lobbyAvatar:not(.isSelf)');
    avatars.each(function () {
      const avatar = $(this);
      const profileIcon = avatar.find('.playerCommandProfileIcon');
      if (profileIcon.length > 0) {
        // Try to extract player name from avatar element
        let playerName = avatar.attr('data-player-name') ||
          avatar.find('.playerName, .lobbyPlayerName').text().trim() ||
          avatar.attr('title') ||
          null;
        profileIcons.push(profileIcon[0]);
        playerNames.push(playerName);
      }
    });
  });

  console.log("[AMQ+] Found profile icons to process:", profileIcons.length);

  for (let i = 0; i < profileIcons.length; i++) {
    const icon = profileIcons[i];
    const storedPlayerName = playerNames[i];

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
      const playerName = storedPlayerName || extractPlayerNameFromProfile() || `Player ${i + 1}`;

      if (listInfo && listInfo.username && listInfo.username.trim() !== '-' && listInfo.username.trim() !== '') {
        let entry = {
          id: `user-${i}-${Date.now()}`,
          platform: listInfo.platform,
          username: listInfo.username,
          amqUsername: playerName, // Store AMQ username for duel mode matching
          selectedLists: { ...defaultStatuses },
          songPercentage: null
        };
        // Apply saved settings if they exist
        entry = applyPlayerSettingsToEntry(entry);
        userEntries.push(entry);
        console.log(`[AMQ+] Added player ${i + 1} list:`, listInfo, `AMQ username: ${playerName}`);
      } else {
        if (listInfo && listInfo.username === '-') {
          console.log(`[AMQ+] Skipped player ${i + 1} - username is "-" (no list provided)`);
          sendSystemMessage(`⚠️ ${playerName} has no linked anime list - their songs won't be included`);
        } else if (!listInfo || !listInfo.username || listInfo.username.trim() === '') {
          console.log(`[AMQ+] No list info found for player ${i + 1}`);
          sendSystemMessage(`⚠️ ${playerName} has no linked anime list - their songs won't be included`);
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

function formatBadgeMetadata(label, icon, data, mode = 'count', color = null) {
  if (!data?.enabled) return null;

  let text = '';

  // Count mode
  if (mode === 'count') {
    if (data.random && data.minCount !== undefined && data.maxCount !== undefined && data.minCount < data.maxCount) {
      text = `${data.minCount}-${data.maxCount}`;
    } else if (data.count !== undefined) {
      text = `${data.count}`;
    } else {
      // Fallback if count is missing but enabled
      text = '0';
    }
  }
  // Percentage mode
  else {
    text = `${data.percentage || 0}%`;
    if (data.random) {
      text += ` (${data.minPercentage || 0}-${data.maxPercentage || 0})`;
    }
  }

  // Construct final message
  // Using simplified formatting for chat: "Icon Label Value"
  return `${icon} ${label} ${text}`;
}

function sendQuizMetadataAsMessages(quiz) {
  const messages = [];
  if (quiz.quiz_metadata) {
    const meta = quiz.quiz_metadata;

    // 1. Estimated Songs
    if (meta.estimatedSongs) {
      if (meta.estimatedSongs.min === 'unknown') {
        messages.push(`🎶 Unknown songs`);
      } else if (meta.estimatedSongs.min === meta.estimatedSongs.max) {
        messages.push(`🎶 ${meta.estimatedSongs.min} songs`);
      } else {
        messages.push(`🎶 ${meta.estimatedSongs.min}-${meta.estimatedSongs.max} songs`);
      }
    }

    // 2. Song Types
    if (meta.songTypes) {
      const songTypesMode = (
        meta.songTypes.openings?.count !== undefined ||
        meta.songTypes.openings?.minCount !== undefined ||
        meta.songTypes.endings?.count !== undefined ||
        meta.songTypes.endings?.minCount !== undefined ||
        meta.songTypes.inserts?.count !== undefined ||
        meta.songTypes.inserts?.minCount !== undefined
      ) ? 'count' : 'percentage';

      const songTypeFormatters = [
        { data: meta.songTypes.openings, label: 'OP' },
        { data: meta.songTypes.endings, label: 'ED' },
        { data: meta.songTypes.inserts, label: 'IN' }
      ];

      songTypeFormatters.forEach(formatter => {
        const msg = formatBadgeMetadata(formatter.label, '🎵', formatter.data, songTypesMode);
        if (msg) messages.push(msg);
      });
    }

    // 3. Difficulty
    if (meta.difficulty) {
      if (meta.difficulty.mode === 'basic') {
        const difficultyMode = (
          meta.difficulty.levels.easy?.count !== undefined ||
          meta.difficulty.levels.easy?.minCount !== undefined ||
          meta.difficulty.levels.medium?.count !== undefined ||
          meta.difficulty.levels.medium?.minCount !== undefined ||
          meta.difficulty.levels.hard?.count !== undefined ||
          meta.difficulty.levels.hard?.minCount !== undefined
        ) ? 'count' : 'percentage';

        const difficultyLevels = [
          { data: meta.difficulty.levels.easy, label: 'Easy' },
          { data: meta.difficulty.levels.medium, label: 'Medium' },
          { data: meta.difficulty.levels.hard, label: 'Hard' }
        ];

        difficultyLevels.forEach(({ data, label }) => {
          const msg = formatBadgeMetadata(label, '⭐', data, difficultyMode);
          if (msg) messages.push(msg);
        });
      } else if (meta.difficulty.mode === 'advanced') {
        if (meta.difficulty.ranges && meta.difficulty.ranges.length > 0) {
          meta.difficulty.ranges.forEach(range => {
            if (range.count) {
              messages.push(`⭐ ${range.from}-${range.to} (${range.count})`);
            }
          });
        }
      }
    }

    // 4. Vintage
    if (meta.vintage && meta.vintage.ranges && meta.vintage.ranges.length > 0) {
      const mode = meta.vintage.mode || 'percentage';
      const isPercentage = mode === 'percentage';

      meta.vintage.ranges.forEach(range => {
        const toDisplay = range.to.present ? 'Present' : `${range.to.season} ${range.to.year}`;
        let rangeInfo = `📅 ${range.from.season} ${range.from.year}-${toDisplay}`;

        if (range.type === 'advanced') {
          if (isPercentage) {
            if (range.percentage !== undefined) {
              rangeInfo += ` (${range.percentage}%)`;
            }
          } else {
            if (range.count !== undefined) {
              rangeInfo += ` (${range.count})`;
            }
          }
        } else {
          rangeInfo += ` (Random)`;
        }

        messages.push(rangeInfo);
      });
    }

    // 5. Song Selection
    if (meta.songSelection) {
      const songSelectionMode = (
        meta.songSelection.random?.count !== undefined ||
        meta.songSelection.random?.minCount !== undefined ||
        meta.songSelection.watched?.count !== undefined ||
        meta.songSelection.watched?.minCount !== undefined
      ) ? 'count' : 'percentage';

      const randomMsg = formatBadgeMetadata('Random', '🎲', meta.songSelection.random, songSelectionMode);
      if (randomMsg) messages.push(randomMsg);

      const watchedMsg = formatBadgeMetadata('Watched', '👁️', meta.songSelection.watched, songSelectionMode);
      if (watchedMsg) messages.push(watchedMsg);
    }

    // 6. Live Node / List Mode
    if (meta.sourceNodes) {
      const liveNode = meta.sourceNodes.find(n => n.type === 'liveNode');
      const batchUserListNode = meta.sourceNodes.find(n => n.type === 'batchUserList');
      const sourceNodeWithMode = liveNode || batchUserListNode;

      if (liveNode) {
        messages.push('🔴 Live Node');
      }

      if (sourceNodeWithMode?.songSelectionMode) {
        const modeNames = {
          default: 'Random',
          'many-lists': 'All Shared',
          'few-lists': 'No Shared'
        };
        const modeName = modeNames[sourceNodeWithMode.songSelectionMode] || sourceNodeWithMode.songSelectionMode;
        messages.push(`📊 ${modeName}`);
      }
    }

    // 7. Guess Time
    if (meta.guessTime) {
      const gt = meta.guessTime.guessTime;
      const egt = meta.guessTime.extraGuessTime;
      let guessTimeMsg = '⏱️ ';

      if (gt.useRange) {
        guessTimeMsg += `${gt.min}-${gt.max}s`;
      } else {
        guessTimeMsg += `${gt.staticValue !== undefined ? gt.staticValue : (gt.min || 0)}s`;
      }

      if (egt && ((egt.useRange && (egt.min > 0 || egt.max > 0)) || (!egt.useRange && (egt.staticValue !== undefined ? egt.staticValue > 0 : egt.min > 0)))) {
        guessTimeMsg += ' + ';
        if (egt.useRange) {
          guessTimeMsg += `${egt.min}-${egt.max}s`;
        } else {
          guessTimeMsg += `${egt.staticValue !== undefined ? egt.staticValue : egt.min}s`;
        }
      }

      messages.push(guessTimeMsg);
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

let lastTrainingAutoDisableAt = 0;
let lastTrainingAutoDisableReason = null;

function hideTrainingRatingUI(removeContainer = false) {
  $("#trainingRatingSection").stop(true, true).fadeOut(100);
  $("#trainingRatingContainer").stop(true, true).fadeOut(100, function () {
    if (removeContainer) {
      $(this).remove();
    }
  });
}

function getAnswerResultAnnSongId(result) {
  if (!result) return null;
  if (result.songInfo) {
    return result.songInfo.annSongId ?? result.songInfo.annId ?? result.songInfo.songId ?? null;
  }
  return result.annSongId ?? result.annId ?? null;
}

function isLikelyTrainingQuiz() {
  const description = currentQuizInfo?.description;
  const hasTrainingDescription = typeof description === "string" && description.toLowerCase().includes("training session with");
  const nameMatch = typeof selectedCustomQuizName === "string" &&
    typeof trainingState.currentSession?.quizName === "string" &&
    selectedCustomQuizName === `AMQ+ ${trainingState.currentSession.quizName}`;
  return hasTrainingDescription || nameMatch;
}

function autoDisableTraining(reason) {
  const hadTrainingMode = isTrainingMode;
  const hadSession = Boolean(trainingState.currentSession?.sessionId);

  isTrainingMode = false;
  if ($("#trainingModeToggle").length > 0) {
    $("#trainingModeToggle").prop("checked", false);
  }

  trainingState.pendingAnswer = null;
  trainingState.lastAnswerDetails = null;
  hideTrainingRatingUI(true);
  updateUsersListsButtonVisibility();

  const now = Date.now();
  if ((hadTrainingMode || hadSession) && reason) {
    const shouldNotify = lastTrainingAutoDisableReason !== reason || (now - lastTrainingAutoDisableAt) > 5000;
    if (shouldNotify) {
      sendSystemMessage(`⚠️ Training mode auto-disabled (${reason}).`);
      lastTrainingAutoDisableReason = reason;
      lastTrainingAutoDisableAt = now;
    }
  }
}

function attachTrainingModalHandlers() {
  // Training mode toggle checkbox handler
  $("#trainingModeToggle").off("change").on("change", function () {
    isTrainingMode = $(this).is(":checked");
    console.log("[AMQ+ Training] Training mode", isTrainingMode ? "enabled" : "disabled");
    // Update button visibility when training mode changes
    updateUsersListsButtonVisibility();
  });

  // Initialize checkbox state (unchecked by default)
  $("#trainingModeToggle").prop("checked", false);
  isTrainingMode = false;

  // Double-click mode toggle checkbox handler
  $("#trainingDoubleClickToggle").off("change").on("change", function () {
    trainingState.requireDoubleClick = $(this).is(":checked");
    console.log("[AMQ+ Training] Double-click mode", trainingState.requireDoubleClick ? "enabled" : "disabled");
    saveTrainingSettings();
  });

  // Initialize double-click checkbox state from saved settings
  $("#trainingDoubleClickToggle").prop("checked", trainingState.requireDoubleClick || false);

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

  $("#trainingJsonImportBtn").off("click").on("click", () => {
    $("#amqPlusJsonImportInstructionsModal").modal("show");
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
    // Check if a quiz was loaded from URL (use token if available, otherwise ID)
    let selectedQuizToken = trainingState.urlLoadedQuizToken;

    // If no URL quiz, check if a quiz card was selected
    if (!selectedQuizToken) {
      const selectedCard = $("#trainingQuizList .training-quiz-card.selected");
      selectedQuizToken = selectedCard.data("play-token");
    }

    console.log("[AMQ+ Training] Start button clicked, selectedQuizToken:", selectedQuizToken);

    if (!selectedQuizToken) {
      alert("Please select a quiz to practice or load one from URL");
      return;
    }

    // Read basic settings
    const sessionLength = parseInt($("#trainingSessionLength").val()) || 20;

    // Read percentages (both modes)
    const newSongPercentage = parseInt($("#trainingNewPercentage").val());
    const dueSongPercentage = parseInt($("#trainingDuePercentage").val());
    const revisionSongPercentage = parseInt($("#trainingRevisionPercentage").val());

    // Save percentages to state
    if (!isNaN(newSongPercentage)) trainingState.newSongPercentage = Math.max(0, Math.min(100, newSongPercentage));
    if (!isNaN(dueSongPercentage)) trainingState.dueSongPercentage = Math.max(0, Math.min(100, dueSongPercentage));
    if (!isNaN(revisionSongPercentage)) trainingState.revisionSongPercentage = Math.max(0, Math.min(100, revisionSongPercentage));

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
      // Build config with manual percentages
      settingsConfig = {
        mode: 'manual',
        dueSongPercentage: trainingState.dueSongPercentage,
        newSongPercentage: trainingState.newSongPercentage,
        revisionSongPercentage: trainingState.revisionSongPercentage
      };

      console.log("[AMQ+ Training] Starting with manual settings:", settingsConfig);
    } else {
      // Use automatic FSRS-based distribution (using configured percentage)
      const autoDuePercentage = 100 - (isNaN(newSongPercentage) ? 30 : newSongPercentage);
      settingsConfig = {
        mode: 'auto',
        dueSongPercentage: Math.max(0, Math.min(100, autoDuePercentage))
      };

      console.log(`[AMQ+ Training] Starting with auto settings (${settingsConfig.dueSongPercentage}% due, ${100 - settingsConfig.dueSongPercentage}% new)`);
    }

    saveTrainingSettings();

    // Show loading state
    const startBtn = $("#trainingStartBtn");
    const originalHtml = startBtn.html();
    startBtn.prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Starting...');

    console.log("[AMQ+ Training] Starting session with quizToken:", selectedQuizToken, "sessionLength:", sessionLength);
    startTrainingSession(selectedQuizToken, sessionLength, settingsConfig);
  });

  $("#trainingEndBtn").off("click").on("click", () => {
    if (confirm("Are you sure you want to end this training session?")) {
      endTrainingSession();
    }
  });

  // Note: These handlers are for the static modal buttons (will be overridden by dynamic overlay buttons during training)
  // The actual double-click logic is handled in the dynamic button creation in showTrainingRatingButtons()
  $(".trainingRatingBtn").off("click").on("click", function () {
    const rating = parseInt($(this).data("rating"));
    submitTrainingRating(rating);
  });

  // Handle quiz card selection - use event delegation that works with dynamically added cards
  $(document).off("click", ".training-quiz-card").on("click", ".training-quiz-card", function (e) {
    e.stopPropagation();
    $(".training-quiz-card").removeClass("selected");
    $(this).addClass("selected");

    const quizId = $(this).data("quiz-id");
    const playToken = $(this).data("play-token");

    trainingState.selectedQuizId = quizId;
    trainingState.selectedQuizToken = playToken;
    console.log("[AMQ+ Training] Quiz selected - ID:", quizId, "Play Token:", playToken);

    // Reset URL selection when a quiz card is selected
    resetUrlQuizSelection();

    // Save settings so it's remembered
    saveTrainingSettings();
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

        // Restore saved distribution percentages
        $("#trainingDuePercentage").val(trainingState.dueSongPercentage);
        $("#trainingNewPercentage").val(trainingState.newSongPercentage);
        $("#trainingRevisionPercentage").val(trainingState.revisionSongPercentage);

        // Restore URL quiz display if saved
        restoreUrlQuizDisplay();

        // Refresh stats for URL-loaded quiz if it exists
        if (trainingState.urlLoadedQuizId && trainingState.urlLoadedQuizName) {
          console.log("[AMQ+ Training] Refreshing stats for URL-loaded quiz:", trainingState.urlLoadedQuizName);
          const quizIdentifier = trainingState.urlLoadedQuizToken || trainingState.urlLoadedQuizId;
          fetchQuizStatsAndDisplay(quizIdentifier, trainingState.urlLoadedQuizName);
        }
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

      // Also refresh stats for URL-loaded quiz if it exists
      if (trainingState.urlLoadedQuizId && trainingState.urlLoadedQuizName) {
        console.log("[AMQ+ Training] Refreshing stats for URL-loaded quiz:", trainingState.urlLoadedQuizName);
        const quizIdentifier = trainingState.urlLoadedQuizToken || trainingState.urlLoadedQuizId;
        fetchQuizStatsAndDisplay(quizIdentifier, trainingState.urlLoadedQuizName);
      }
    },
    onError: (errorMsg) => {
      console.error("[AMQ+ Training] Failed to refresh stats:", errorMsg);
    }
  });
}

function loadTrainingQuizzes() {
  const quizListDiv = $("#trainingQuizList");

  // Populate profile dropdown (always do this, even if user has no quizzes yet)
  scanOldTrainingProfiles();

  if (!trainingState.userQuizzes || trainingState.userQuizzes.length === 0) {
    quizListDiv.html(`
      <div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.6);">
        <i class="fa fa-inbox" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5; display: block;"></i>
        <p>No quizzes found. Create some quizzes on AMQ+ website first!</p>
      </div>
    `);
    return;
  }

  let html = "";
  console.log("[AMQ+ Training] Rendering quiz list, userQuizzes count:", trainingState.userQuizzes.length);

  trainingState.userQuizzes.forEach((quiz, index) => {
    const stats = quiz.stats || {};
    const hasTrainingData = stats.totalAttempts > 0;

    console.log(`[AMQ+ Training] Quiz ${index + 1} - ${quiz.name}:`, {
      id: quiz.id,
      playToken: quiz.playToken,
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
      <div class="training-quiz-card" data-quiz-id="${quiz.id}" data-play-token="${quiz.playToken}" style="
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

  // Apply saved selection if it exists
  if (trainingState.selectedQuizId) {
    const savedCard = quizListDiv.find(`.training-quiz-card[data-quiz-id="${trainingState.selectedQuizId}"]`);
    if (savedCard.length) {
      savedCard.addClass("selected");
      console.log("[AMQ+ Training] Applied saved quiz selection:", trainingState.selectedQuizId);
    }
  }

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
  trainingState.urlLoadedQuizToken = null;
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

    // Update stats display - use token if available, otherwise ID
    const quizIdentifier = trainingState.urlLoadedQuizToken || trainingState.urlLoadedQuizId;
    $("#trainingUrlQuizStats").html(getQuizStatsHTML(quizIdentifier));

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

    // Always treat identifier as a play token for URL-based fetching
    const apiUrl = `${API_BASE_URL}/api/quiz/play/${identifier}`;

    console.log("[AMQ+ Training] Fetching quiz info from:", apiUrl, "(play token)");

    // Fetch quiz details from server using helper
    makeApiRequest({
      url: apiUrl,
      method: 'GET',
      errorPrefix: 'Training URL Load',
      onSuccess: (quizData) => {
        console.log("[AMQ+ Training] Quiz loaded:", quizData);

        // Store quiz info in training state (use token for API calls, ID for matching)
        const quizId = quizData.id || identifier;
        const quizToken = quizData.token || identifier; // Use token from response or fallback to identifier
        trainingState.urlLoadedQuizId = quizId;
        trainingState.urlLoadedQuizToken = quizToken;
        trainingState.urlLoadedQuizName = quizData.name;
        trainingState.urlLoadedQuizSongCount = quizData.songCount || 0;

        // Clear card selection when loading from URL
        trainingState.selectedQuizId = null;
        trainingState.selectedQuizToken = null;

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
          // Quiz not in list, fetch stats from server using token
          console.log("[AMQ+ Training] Quiz not in list, fetching stats from server using token:", quizToken);
          fetchQuizStatsAndDisplay(quizToken, quizData.name);
        }

        console.log("[AMQ+ Training] Quiz details displayed for:", quizData.name, "(ID:", quizId, "Token:", quizToken + ")");
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
    requestData.dueSongPercentage = settingsConfig.dueSongPercentage;
    requestData.newSongPercentage = settingsConfig.newSongPercentage;
    requestData.revisionSongPercentage = settingsConfig.revisionSongPercentage;
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
        
        // Reset the submission flag for the new session
        trainingState.isSubmittingRating = false;

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
              const songCount = payload.quizSave?.ruleBlocks?.[0]?.blocks?.length || 0;

              // Send message to chat that training quiz is ready
              if (songCount > 0) {
                sendSystemMessage(`✅ Training quiz ready! ${songCount} song${songCount !== 1 ? 's' : ''} loaded. Starting automatically...`);
              }

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
  
  // Reset the submission flag
  trainingState.isSubmittingRating = false;

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
  hideTrainingRatingUI(true);

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
  const url = `${API_BASE_URL}/api/training/session/${syncData.sessionId}/progress`;
  console.log("[AMQ+ Training] URL:", url);

  GM_xmlhttpRequest({
    method: "POST",
    url: url,
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
  const url = `${API_BASE_URL}/api/training/session/${syncItem.sessionId}/progress`;
  console.log("[AMQ+ Training] Syncing item from queue:", syncItem);
  console.log("[AMQ+ Training] Sync URL:", url);

  GM_xmlhttpRequest({
    method: "POST",
    url: url,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken,
      songKey: syncItem.songKey,
      annSongId: syncItem.annSongId, // Ensure annSongId is included
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
      } else if (response.status === 404 || response.status === 410 || response.status === 400) {
        // Discard items that will never succeed (404 Not Found, 410 Gone, 400 Bad Request)
        console.warn(`[AMQ+ Training] Discarding sync item due to ${response.status}:`, response.responseText);
        trainingState.pendingSync.shift();
        saveTrainingSettings();
        trainingState.syncInProgress = false;
        if (trainingState.pendingSync.length > 0) {
          processTrainingSyncQueue();
        }
      } else {
        console.error("[AMQ+ Training] Sync failed:", response.status, response.responseText);
        trainingState.syncInProgress = false;
        // Don't shift, it will stay in queue and potentially be retried on next refresh
        // or when a new item is added.
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

function getCurrentTrainingAnnSongId() {
  if (typeof quiz === 'undefined' || !quiz.songList || !quiz.songOrder) {
    return null;
  }

  if (!currentSongNumber || currentSongNumber <= 0) {
    return null;
  }

  try {
    const songIndex = quiz.songOrder[currentSongNumber];
    if (songIndex === undefined || !quiz.songList[songIndex]) {
      return null;
    }

    const song = quiz.songList[songIndex];
    return song.annSongId || song.annId || null;
  } catch (e) {
    console.warn("[AMQ+ Training] Error resolving current annSongId:", e);
    return null;
  }
}

function findTrainingPlaylistIndexByAnnSongId(annSongId) {
  if (!annSongId || !trainingState.currentSession || !trainingState.currentSession.playlist) {
    return -1;
  }

  return trainingState.currentSession.playlist.findIndex(
    (song) => String(song.annSongId) === String(annSongId)
  );
}

function submitTrainingRating(rating) {
  if (!trainingState.currentSession.sessionId) return;
  
  // Prevent double-clicking / multiple rapid clicks
  if (trainingState.isSubmittingRating) {
    console.log("[AMQ+ Training] Rating submission already in progress, ignoring duplicate click");
    return;
  }
  trainingState.isSubmittingRating = true;

  const playlistIndex = trainingState.currentSession.currentIndex;
  const playlistSong = trainingState.currentSession.playlist[playlistIndex];
  const actualAnnSongId = getCurrentTrainingAnnSongId();
  const resolvedIndex = actualAnnSongId
    ? findTrainingPlaylistIndexByAnnSongId(actualAnnSongId)
    : playlistIndex;

  const resolvedSong = resolvedIndex >= 0
    ? trainingState.currentSession.playlist[resolvedIndex]
    : null;

  const annSongId = actualAnnSongId || (resolvedSong ? resolvedSong.annSongId : null);
  if (!annSongId) {
    console.warn("[AMQ+ Training] No annSongId resolved for rating; skipping progress update");
  }

  // Get extra answer details if available
  const answerDetails = trainingState.lastAnswerDetails || {};
  console.log("[AMQ+ Training] Answer details:", answerDetails);
  // Clear them after use so they don't leak to next song
  trainingState.lastAnswerDetails = null;

  const success = answerDetails.success === true;
  console.log("[AMQ+ Training] Answer correctness:", {
    success: success
  });

  console.log("[AMQ+ Training] Submitting rating:", {
    rating: rating,
    annSongId: annSongId,
    success: success
  });

  // Update counters
  trainingState.currentSession.totalRated++; // Increment total rated count
  if (success) {
    trainingState.currentSession.correctCount++;
  } else {
    trainingState.currentSession.incorrectCount++;
  }

  // Report to server immediately
  if (annSongId && resolvedIndex >= 0) {
    reportSongProgress(annSongId, rating, success, answerDetails);
  } else if (actualAnnSongId && resolvedIndex < 0) {
    console.warn("[AMQ+ Training] Rated song not found in session playlist:", actualAnnSongId);
  }

  // Update UI
  $("#trainingSessionCorrect").text(trainingState.currentSession.correctCount);
  $("#trainingSessionIncorrect").text(trainingState.currentSession.incorrectCount);

  // Move to next song based on resolved index (avoid index drift)
  if (resolvedIndex >= 0) {
    trainingState.currentSession.currentIndex = resolvedIndex + 1;
  } else {
    trainingState.currentSession.currentIndex = Math.min(
      trainingState.currentSession.currentIndex + 1,
      trainingState.currentSession.playlist.length
    );
  }
  saveTrainingSettings();

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

  // Reset the submission flag after a short delay to allow UI updates
  setTimeout(() => {
    trainingState.isSubmittingRating = false;
  }, 500);

  // Check if session is complete
  if (trainingState.currentSession.currentIndex >= trainingState.currentSession.playlist.length) {
    setTimeout(() => {
      endTrainingSession();
    }, 1000);
  }
}

function skipTrainingRating() {
  if (!trainingState.currentSession.sessionId) return;
  
  // Prevent double-clicking / multiple rapid clicks
  if (trainingState.isSubmittingRating) {
    console.log("[AMQ+ Training] Skip action already in progress, ignoring duplicate click");
    return;
  }
  trainingState.isSubmittingRating = true;

  const playlistIndex = trainingState.currentSession.currentIndex;
  const currentSong = trainingState.currentSession.playlist[playlistIndex];
  const songKey = currentSong ? currentSong.songKey : null;
  const actualAnnSongId = getCurrentTrainingAnnSongId();
  let removedIndex = -1;

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

  // Remove skipped song from the session playlist so it can't be reported later
  if (actualAnnSongId) {
    removedIndex = findTrainingPlaylistIndexByAnnSongId(actualAnnSongId);
  }
  if (removedIndex < 0 && playlistIndex >= 0 && playlistIndex < trainingState.currentSession.playlist.length) {
    removedIndex = playlistIndex;
  }
  if (removedIndex >= 0) {
    trainingState.currentSession.playlist.splice(removedIndex, 1);
  }

  // Move to next song without reporting
  // Note: totalRated is NOT incremented for skipped songs
  if (removedIndex >= 0 && removedIndex <= trainingState.currentSession.currentIndex) {
    trainingState.currentSession.currentIndex = Math.max(0, removedIndex);
  } else {
    trainingState.currentSession.currentIndex = Math.min(
      trainingState.currentSession.currentIndex + 1,
      trainingState.currentSession.playlist.length
    );
  }
  saveTrainingSettings();

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

  // Reset the submission flag after a short delay to allow UI updates
  setTimeout(() => {
    trainingState.isSubmittingRating = false;
  }, 500);

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
    // Find self player
    const players = typeof quiz !== 'undefined' && quiz.players ? Object.values(quiz.players) : [];
    const selfPlayer = players.find(p => p.isSelf);
    const myPlayerId = selfPlayer ? selfPlayer.gamePlayerId : null;

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

  const expectedSong = trainingState.currentSession.playlist?.[trainingState.currentSession.currentIndex];
  const expectedAnnSongId = expectedSong?.annSongId;
  const resultAnnSongId = getAnswerResultAnnSongId(result);
  const isTrainingContext = isLikelyTrainingQuiz() ||
    (expectedAnnSongId && resultAnnSongId && String(expectedAnnSongId) === String(resultAnnSongId));

  if (!isTrainingContext) {
    console.log("[AMQ+ Training] Non-training quiz detected, auto-disabling training mode");
    autoDisableTraining("non-training quiz");
    return;
  }

  console.log("[AMQ+ Training] Answer results received, showing rating UI");

  // Merge previously captured answer from "player answers" with result data
  try {
    // Find self player
    const players = typeof quiz !== 'undefined' && quiz.players ? Object.values(quiz.players) : [];
    const selfPlayer = players.find(p => p.isSelf);
    const myPlayerId = selfPlayer ? selfPlayer.gamePlayerId : null;

    let userAnswer = null;
    let success = false;
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
        success = myPlayerResult.correct === true;
      }
    }

    // 3. Get correct answer info
    if (result.songInfo) {
      correctAnswer = result.songInfo.animeNames ? (result.songInfo.animeNames.english || result.songInfo.animeNames.romaji) : null;
    }

    console.log("[AMQ+ Training] Extracted answer details - myPlayerId:", myPlayerId, "success:", success);

    trainingState.lastAnswerDetails = {
      userAnswer,
      correctAnswer,
      success
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

    // Re-attach handlers for dynamically created buttons
    // Check if double-click mode is enabled
    if (trainingState.requireDoubleClick) {
      // Use double-click for all buttons (rating and skip)
      $(".trainingRatingBtn").off("click dblclick").on("dblclick", function () {
        const rating = parseInt($(this).data("rating"));
        submitTrainingRating(rating);
      });

      $(".trainingSkipBtn").off("click dblclick").on("dblclick", function () {
        skipTrainingRating();
      });
    } else {
      // Use single-click for rating buttons, double-click for skip button
      $(".trainingRatingBtn").off("click dblclick").on("click", function () {
        const rating = parseInt($(this).data("rating"));
        submitTrainingRating(rating);
      });

      $(".trainingSkipBtn").off("click dblclick").on("dblclick", function () {
        skipTrainingRating();
      });
    }

    // Add hover effects
    $(".trainingRatingBtn, .trainingSkipBtn").hover(
      function () { $(this).css("opacity", "0.8"); },
      function () { $(this).css("opacity", "1"); }
    );
  }

  // Reset the submission flag for the new song
  trainingState.isSubmittingRating = false;

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
  console.log("[AMQ+ Training] Scanning for old training profiles...");

  // Log all localStorage keys for debugging
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    allKeys.push(localStorage.key(i));
  }
  console.log("[AMQ+ Training] All localStorage keys:", allKeys);

  let foundProfiles = new Set();

  // 1. Pattern-based discovery from localStorage (Most reliable)
  for (const key of allKeys) {
    if (key && key.startsWith('spacedRepetitionData_')) {
      const profileName = key.replace('spacedRepetitionData_', '');
      if (profileName) {
        console.log(`[AMQ+ Training] Discovered profile via pattern: ${profileName}`);
        foundProfiles.add(profileName);
      }
    }
  }

  // 2. Legacy check: cslProfiles/CSLProfiles array
  const legacyProfileKeys = ['cslProfiles', 'CSLProfiles'];
  for (const profileKey of legacyProfileKeys) {
    try {
      const profilesData = localStorage.getItem(profileKey);
      if (profilesData) {
        console.log(`[AMQ+ Training] Found ${profileKey} in localStorage, parsing...`);
        const profiles = JSON.parse(profilesData);
        if (Array.isArray(profiles)) {
          profiles.forEach(p => {
            if (p) {
              console.log(`[AMQ+ Training] Discovered profile via ${profileKey}: ${p}`);
              foundProfiles.add(p);
            }
          });
        }
      }
    } catch (e) {
      console.warn(`[AMQ+ Training] Error parsing ${profileKey}:`, e);
    }
  }

  // Populate dropdown with song counts (one profile at a time)
  const profileSelect = $("#trainingImportProfileSelect");
  if (foundProfiles.size === 0) {
    console.log("[AMQ+ Training] No legacy training profiles found.");
    profileSelect.html('<option value="">No training data found</option>');
  } else {
    console.log(`[AMQ+ Training] Total profiles found: ${foundProfiles.size}`);
    let html = '<option value="">Select profile to import...</option>';
    // Convert Set back to Array for sorted display
    Array.from(foundProfiles).sort().forEach(profile => {
      try {
        const data = localStorage.getItem(`spacedRepetitionData_${profile}`);
        if (data) {
          const parsed = JSON.parse(data);
          const songCount = Object.keys(parsed).length;
          console.log(`[AMQ+ Training] Profile "${profile}" has ${songCount} songs.`);
          html += `<option value="${profile}">${profile} (${songCount} songs)</option>`;
        } else {
          console.log(`[AMQ+ Training] Profile "${profile}" has no data in localStorage.`);
        }
      } catch (e) {
        console.warn(`Error reading profile ${profile}:`, e);
      }
    });
    profileSelect.html(html);
  }
}

function getOldTrainingData(specificProfile = null) {
  console.log(`[AMQ+ Training] Getting old training data${specificProfile ? ` for profile: ${specificProfile}` : ''}...`);

  // Log all localStorage keys for debugging
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    allKeys.push(localStorage.key(i));
  }
  // console.log("[AMQ+ Training] All localStorage keys:", allKeys); // Already logged in scanOldTrainingProfiles

  const oldData = {};
  let foundProfiles = new Set();

  // Use only the specific profile requested or discover all
  if (specificProfile) {
    foundProfiles.add(specificProfile);
  } else {
    // 1. Pattern-based discovery
    for (const key of allKeys) {
      if (key && key.startsWith('spacedRepetitionData_')) {
        const profileName = key.replace('spacedRepetitionData_', '');
        if (profileName) foundProfiles.add(profileName);
      }
    }

    // 2. Legacy check: cslProfiles/CSLProfiles array
    const legacyProfileKeys = ['cslProfiles', 'CSLProfiles'];
    for (const profileKey of legacyProfileKeys) {
      try {
        const profilesData = localStorage.getItem(profileKey);
        if (profilesData) {
          const profiles = JSON.parse(profilesData);
          if (Array.isArray(profiles)) {
            profiles.forEach(p => {
              if (p) foundProfiles.add(p);
            });
          }
        }
      } catch (e) { }
    }

    // Fallback to default if nothing found
    if (foundProfiles.size === 0) {
      console.log("[AMQ+ Training] No profiles found, falling back to 'default'");
      foundProfiles.add('default');
    }

    console.log(`[AMQ+ Training] Discovered profiles: ${Array.from(foundProfiles).join(', ')}`);
  }

  // Try to load data from each profile
  for (const profile of foundProfiles) {
    const key = `spacedRepetitionData_${profile}`;
    try {
      console.log(`[AMQ+ Training] Attempting to load data from key: ${key}`);
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
            console.log(`[AMQ+ Training] Found valid training data in profile: ${profile} (${Object.keys(parsed).length} songs)`);

            // Convert the data to the format expected by the import API
            // The old format uses songKey as "${artist}_${songName}"
            // We need to keep this format and add any missing fields
            let convertedCount = 0;
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
              convertedCount++;
            }
            console.log(`[AMQ+ Training] Successfully converted ${convertedCount} songs from profile: ${profile}`);
          } else {
            console.warn(`[AMQ+ Training] Data in profile ${profile} does not match expected training format (first key check failed).`);
          }
        } else {
          console.warn(`[AMQ+ Training] Data in profile ${profile} is empty or not an object.`);
        }
      } else {
        console.log(`[AMQ+ Training] No data found in localStorage for profile: ${profile}`);
      }
    } catch (e) {
      console.warn(`[AMQ+ Training] Error parsing localStorage key ${key}:`, e);
    }
  }

  console.log(`[AMQ+ Training] Total songs collected for import: ${Object.keys(oldData).length}`);
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

function updateImportProgress(data) {
  const statusDiv = $("#trainingImportStatus");
  const type = data.type === 'error' ? 'error' : 'info';
  const colors = {
    info: "#0dcaf0",
    success: "#28a745",
    error: "#dc3545",
    warning: "#ffc107"
  };

  if (data.type === 'progress') {
    const percent = Math.round((data.current / data.total) * 100);
    const elapsed = (Date.now() - (window._importStartTime || Date.now())) / 1000;
    const rate = data.current / elapsed;
    const remaining = data.total - data.current;
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;

    const hours = Math.floor(etaSeconds / 3600);
    const minutes = Math.floor((etaSeconds % 3600) / 60);
    const seconds = etaSeconds % 60;

    let etaParts = [];
    if (hours > 0) etaParts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) etaParts.push(`${minutes}m`);
    etaParts.push(`${seconds}s`);
    const etaStr = etaParts.join(" ");

    statusDiv.html(`
      <div style="padding: 10px; background: ${colors.info}15; border-left: 4px solid ${colors.info}; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <strong style="color: ${colors.info};">${data.status || 'Reconstructing songs...'}</strong>
          <span style="font-size: 12px; color: #666;">ETA: ${etaStr}</span>
        </div>
        <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.1); border-radius: 4px; overflow: hidden; margin-bottom: 5px;">
          <div style="width: ${percent}%; height: 100%; background: ${colors.info}; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666;">
          <span>${data.current} / ${data.total} songs</span>
          <span>${percent}%</span>
        </div>
        <div style="font-size: 11px; color: #888; margin-top: 4px;">
          Found: ${data.reconstructed} | Failed: ${data.failed}
        </div>
      </div>
    `).show();
  } else if (data.type === 'status') {
    const strong = statusDiv.find('strong');
    if (strong.length > 0) {
      strong.text(data.message);
    } else {
      showImportStatus(data.message, "info");
    }
  } else if (data.type === 'error') {
    showImportStatus(data.message, "error");
  } else if (data.type === 'complete') {
    showImportStatus(`✓ Created quiz "${data.quizName}" with ${data.imported} songs!`, "success");
  }
}

function importOldTrainingData() {
  const selectedProfile = $("#trainingImportProfileSelect").val();
  console.log(`[AMQ+ Training] Initializing import for profile: ${selectedProfile || 'none'}`);

  if (!selectedProfile) {
    showImportStatus("Please select a profile to import", "error");
    return;
  }

  if (!trainingState.authToken) {
    console.warn("[AMQ+ Training] Import aborted: No auth token found.");
    showImportStatus("Please link your account first", "error");
    return;
  }

  // Get old training data from localStorage
  const oldData = getOldTrainingData(selectedProfile);

  if (!oldData || Object.keys(oldData).length === 0) {
    console.warn(`[AMQ+ Training] Import aborted: No training data found for profile "${selectedProfile}"`);
    showImportStatus("No training data found for this profile", "warning");
    return;
  }

  const songCount = Object.keys(oldData).length;
  const estimatedSeconds = Math.ceil(songCount * 1.5);
  console.log(`[AMQ+ Training] Preparing to import ${songCount} songs. Estimated time: ${estimatedSeconds}s`);
  if (!confirm(`Import ${songCount} songs from profile "${selectedProfile}"?\n\nThis will create a new quiz with the imported training data.\n\nNote: This process will take approximately ${estimatedSeconds} seconds. PLEASE DO NOT REFRESH THE PAGE DURING IMPORT.`)) {
    console.log("[AMQ+ Training] Import cancelled by user.");
    return;
  }

  window._importStartTime = Date.now();

  // Setup countdown timer
  if (window._importCountdownTimer) clearInterval(window._importCountdownTimer);
  let remainingSeconds = estimatedSeconds;

  const updateStatusWithCountdown = () => {
    if (remainingSeconds > 0) {
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      showImportStatus(`Importing ${songCount} songs... ETA: ${timeStr}. PLEASE DO NOT REFRESH THE PAGE.`, "info");
    } else {
      showImportStatus(`Processing import... This may take a while. PLEASE DO NOT REFRESH THE PAGE.`, "info");
    }
  };

  updateStatusWithCountdown();
  window._importCountdownTimer = setInterval(() => {
    remainingSeconds--;
    updateStatusWithCountdown();
    if (remainingSeconds <= -300) { // Stop updating after 5 minutes past estimate
      clearInterval(window._importCountdownTimer);
    }
  }, 1000);

  // Disable button during import
  $("#trainingImportBtn").prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');

  // First, create the quiz with the profile name
  const quizName = `Imported: ${selectedProfile}`;
  console.log(`[AMQ+ Training] Creating quiz: ${quizName}`);

  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/training/import-with-quiz`,
    timeout: 43200000, // 12 hours
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      token: trainingState.authToken,
      localStorageData: oldData,
      quizName: quizName
    }),
    onload: function (response) {
      if (window._importCountdownTimer) clearInterval(window._importCountdownTimer);
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
    onerror: function (error) {
      if (window._importCountdownTimer) clearInterval(window._importCountdownTimer);
      $("#trainingImportBtn").prop("disabled", false).html('<i class="fa fa-upload"></i> Import');

      // Log full error details to console for debugging
      console.error("[AMQ+ Training] Import error:", error);

      // Build detailed error message
      let errorMessage = "Connection error occurred. ";
      if (error) {
        const errorDetails = [];
        if (error.status) errorDetails.push(`Status: ${error.status}`);
        if (error.statusText) errorDetails.push(`Status Text: ${error.statusText}`);
        if (error.error) errorDetails.push(`Error: ${error.error}`);
        if (error.responseText) {
          try {
            const errorData = JSON.parse(error.responseText);
            if (errorData.error) errorDetails.push(`Server Error: ${errorData.error}`);
          } catch (e) {
            errorDetails.push(`Response: ${error.responseText.substring(0, 200)}`);
          }
        }

        if (errorDetails.length > 0) {
          errorMessage += "Details: " + errorDetails.join(" | ");
        } else {
          errorMessage += "Please check the browser console for more details.";
        }
      } else {
        errorMessage += "Please check the browser console for more details.";
      }

      errorMessage += "\nConnection to the server was lost but your import is probably still going on the server side. Please check the training page after your ETA has passed.";

      showImportStatus(errorMessage, "error");
    },
    ontimeout: function () {
      if (window._importCountdownTimer) clearInterval(window._importCountdownTimer);
      $("#trainingImportBtn").prop("disabled", false).html('<i class="fa fa-upload"></i> Import');
      showImportStatus("Import timed out. Large imports can still be processing on the server, please check back in a few minutes.", "warning");
    }
  });
}

console.log("[AMQ+ Training] Training mode initialized");

