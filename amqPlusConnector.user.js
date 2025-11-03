// ==UserScript==
// @name         AMQ Plus Connector
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Connect AMQ to AMQ+ quiz configurations for seamless quiz playing
// @author       AMQ+
// @match        https://animemusicquiz.com/*
// @match        https://*.animemusicquiz.com/*
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
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

let amqPlusEnabled = true;
let currentQuizData = null;
let currentQuizId = null;
let selectedCustomQuizId = null;
let selectedCustomQuizName = null;
let isWaitingForQuizList = false;
let quizListAttempts = 0;
let pendingQuizData = null;
let amqPlusCreditsSent = false;
let lastLoadedQuizId = null;
let lastLoadedQuizSave = null;
let pendingExportData = null;
let pendingExportFilename = null;
let cachedPlayerLists = null;
let currentAMQQuizId = null; // AMQ's customQuizId from "quiz display custom quiz" event
let amqQuizLikesStorage = null; // localStorage key for storing liked quizzes
let currentQuizInfo = null; // Store quiz name, description, and creator for AMQ+ quizzes
let songSourceMap = null; // Map of annSongId to player source info
let currentSongNumber = 0; // Track current song number
let songSourceMessagesEnabled = true; // Whether to show song source messages in chat
let liveNodeSongSelectionMode = 'default'; // Song selection mode for live node: 'default' | 'many-lists' | 'few-lists'

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
}

function saveSettings() {
  localStorage.setItem("amqPlusConnector", JSON.stringify({
    enabled: amqPlusEnabled,
    songSourceMessagesEnabled: songSourceMessagesEnabled,
    liveNodeSongSelectionMode: liveNodeSongSelectionMode
  }));
}

function sendSystemMessage(message) {
  if (gameChat && gameChat.systemMessage) {
    setTimeout(() => { gameChat.systemMessage(String(message)) }, 1);
  } else {
    console.log("[AMQ+] System message:", message);
  }
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

function setupQuizSavedModalObserver() {
  const observer = new MutationObserver((mutations) => {
    const savedModal = document.querySelector(".swal2-popup.swal2-show");
    if (savedModal) {
      const title = savedModal.querySelector(".swal2-title");
      if (title && title.textContent === "Quiz Saved") {
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

function createUI() {
  console.log("[AMQ+] Creating UI elements...");

  if ($("#amqPlusToggle").length > 0) {
    console.log("[AMQ+] Toggle button already exists, skipping creation");
    return;
  }

  $("#lobbyPage .topMenuBar").append(`<div id="amqPlusToggle" class="clickAble topMenuButton topMenuMediumButton"><h3>AMQ+</h3></div>`);
  $("#amqPlusToggle").click(() => {
    console.log("[AMQ+] AMQ+ button clicked, opening modal");
    $("#amqPlusModal").modal("show");
  });

  updateToggleButton();
  applyStyles();

  const modal = $(`
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
                                <label style="display: block; margin-bottom: 8px; color: #fff; font-size: 13px; font-weight: bold;">Song Selection Mode:</label>
                                <select id="amqPlusSongSelectionMode" style="width: 100%; padding: 6px 10px; background-color: #1a1a2e; border: 1px solid #2d3748; color: #e2e8f0; border-radius: 4px; font-size: 12px;">
                                    <option value="default">Default</option>
                                    <option value="many-lists">Prioritize songs on many lists</option>
                                    <option value="few-lists">Prioritize songs on few lists</option>
                                </select>
                                <small style="display: block; margin-top: 6px; color: rgba(255,255,255,0.6); font-size: 11px;">
                                    Controls how songs are prioritized during random selection. "Default" maintains current behavior where songs appear multiple times. "Many lists" prioritizes songs that appear on more user lists. "Few lists" prioritizes songs that appear on fewer user lists.
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
                                <div style="color: #e2e8f0;"><strong style="color: #fff;">/amqplus [url]</strong> - Fetch quiz from URL</div>
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
    `);

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
  } else {
    console.warn("[AMQ+] GameContainer not found, appending to body as fallback");
    if ($("#amqPlusModal").length === 0) {
      $("body").append(modal);
      attachModalHandlers();
    } else {
      attachModalHandlers();
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

function checkQuizForLiveNode(quizId) {
  const apiUrl = `${API_BASE_URL}/play/${quizId}`;
  GM_xmlhttpRequest({
    method: "GET",
    url: apiUrl,
    onload: function (response) {
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.success === false) {
            return;
          }

          const configData = data.configuration_data || data.configurationData;
          if (configData && configData.nodes) {
            const hasLiveNode = configData.nodes.some(n => n.data?.id === 'live-node');
            if (hasLiveNode) {
              console.log("[AMQ+] Quiz has Live Node, fetching player lists");

              if (cachedPlayerLists && cachedPlayerLists.length > 0) {
                console.log("[AMQ+] Using cached player lists");
                usePlayerLists(cachedPlayerLists, quizId);
              } else {
                gatherPlayerLists().then(userEntries => {
                  cachedPlayerLists = userEntries;
                  applyRandomPreset();
                  usePlayerLists(userEntries, quizId);
                }).catch(error => {
                  console.error("[AMQ+] Error gathering player lists:", error);
                  showError("Failed to gather player lists: " + error.message);
                });
              }
            }
          }
        } catch (e) {
          console.error("[AMQ+] Failed to check quiz for live node:", e);
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error checking quiz for live node:", error);
    }
  });
}

function checkQuizForLiveNodeForReRoll(quizId, skipAutoReady, originalFireMainButtonEvent) {
  const apiUrl = `${API_BASE_URL}/play/${quizId}`;
  GM_xmlhttpRequest({
    method: "GET",
    url: apiUrl,
    onload: function (response) {
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.responseText);
          if (data.success === false) {
            fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
            return;
          }

          const configData = data.configuration_data || data.configurationData;
          if (configData && configData.nodes) {
            const hasLiveNode = configData.nodes.some(n => n.data?.id === 'live-node');
            if (hasLiveNode) {
              console.log("[AMQ+] Quiz has Live Node, fetching player lists for re-roll");

              if (cachedPlayerLists && cachedPlayerLists.length > 0) {
                console.log("[AMQ+] Using cached player lists for re-roll");
                const configuredEntries = getConfiguredPlayerLists();
                const liveNodeData = {
                  useEntirePool: false,
                  userEntries: configuredEntries,
                  songSelectionMode: liveNodeSongSelectionMode
                };
                fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent);
              } else {
                gatherPlayerLists().then(userEntries => {
                  cachedPlayerLists = userEntries;
                  applyRandomPreset();
                  const configuredEntries = getConfiguredPlayerLists();
                  const liveNodeData = {
                    useEntirePool: false,
                    userEntries: configuredEntries,
                    songSelectionMode: liveNodeSongSelectionMode
                  };
                  fetchQuizForReRoll(quizId, liveNodeData, skipAutoReady, originalFireMainButtonEvent);
                }).catch(error => {
                  console.error("[AMQ+] Error gathering player lists for re-roll:", error);
                  sendSystemMessage("Failed to gather player lists, re-rolling without live data...");
                  fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
                });
              }
            } else {
              fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
            }
          } else {
            fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
          }
        } catch (e) {
          console.error("[AMQ+] Failed to check quiz for live node:", e);
          fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
        }
      } else {
        fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error checking quiz for live node:", error);
      fetchQuizForReRoll(quizId, null, skipAutoReady, originalFireMainButtonEvent);
    }
  });
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

    const listMessage = userEntries.map((entry, idx) => {
      const prefix = entry.id?.includes('self') ? 'You' : `Player ${idx + 1}`;
      const statuses = [];
      if (entry.selectedLists?.completed) statuses.push('Completed');
      if (entry.selectedLists?.watching) statuses.push('Watching');
      if (entry.selectedLists?.planning) statuses.push('Planning');
      if (entry.selectedLists?.on_hold) statuses.push('On Hold');
      if (entry.selectedLists?.dropped) statuses.push('Dropped');
      return `${prefix}: ${entry.username} (${entry.platform}) - ${statuses.join(', ')}`;
    }).join(' | ');

    sendSystemMessage(`Synced ${userEntries.length} player list${userEntries.length !== 1 ? 's' : ''}: ${listMessage}`);
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

function updatePlayerListsConfigUI() {
  if (!cachedPlayerLists || cachedPlayerLists.length === 0) {
    $("#amqPlusPlayerListsConfigContent").html('<div style="color: rgba(255,255,255,0.6); padding: 20px; text-align: center;"><div style="margin-bottom: 12px; padding: 10px; background-color: rgba(255, 193, 7, 0.2); border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 4px; color: #ffc107; font-size: 12px;"><strong>Note:</strong> This feature will only work if the quiz has a Live Node in it.</div>No player lists fetched yet. Click "Sync Now" to gather player lists from the lobby.</div>');
    return;
  }

  $("#amqPlusPlayerListsConfig").show();

  const html = cachedPlayerLists.map((entry, idx) => {
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
                    <div style="display: flex; align-items: center;">
                        <div class="customCheckbox" style="margin-right: 6px;">
                            <input type="checkbox" class="amqPlusUseRandom" id="amqPlusUseRandom${idx}" data-entry-idx="${idx}" ${isRandom ? 'checked' : ''}>
                            <label for="amqPlusUseRandom${idx}"><i class="fa fa-check" aria-hidden="true"></i></label>
                        </div>
                        <span style="font-size: 12px; color: #e2e8f0;">Random Range</span>
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
  }).join('');

  $("#amqPlusPlayerListsConfigContent").html(html);

  $('.amqPlusUseRandom').off('change').on('change', function () {
    const idx = $(this).data('entry-idx');
    updatePercentageControls(idx);
    validatePercentages();
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
    }
  });

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
  });

  validatePercentages();
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
  });
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

  const liveNodeData = {
    useEntirePool: false,
    userEntries: configuredEntries,
    songSelectionMode: liveNodeSongSelectionMode
  };

  const listMessage = configuredEntries.map((entry, idx) => {
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

  sendSystemMessage(`Synced ${configuredEntries.length} player list${configuredEntries.length !== 1 ? 's' : ''}: ${listMessage}`);

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

  // Check if we have songSourceMap directly from the API response (preferred)
  if (data.songSourceMap && Array.isArray(data.songSourceMap)) {
    console.log("[AMQ+] Building song source map from API songSourceMap");

    // Create a map of annSongId to source info
    data.songSourceMap.forEach(entry => {
      if (entry.annSongId) {
        songSourceMap.set(entry.annSongId, {
          sourceInfo: entry.sourceInfo || 'Unknown source',
          nodeId: entry.nodeId,
          username: entry.username
        });
      }
    });
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

  if (sourceInfo.sourceInfo === 'Random' || sourceInfo.username === null) {
    return { icon: '🎲', text: 'Random', nodeId: sourceInfo.nodeId || null };
  }

  // Use sourceInfo as primary display (it contains readable names like "Live Node - PlayerName" or "Saved list: Name")
  const displayText = sourceInfo.sourceInfo || sourceInfo.username || 'Unknown';

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

  const existingQuiz = quizzes.find(q => q.name.startsWith("AMQ+"));

  if (existingQuiz) {
    console.log("[AMQ+] Found existing AMQ+ quiz:", existingQuiz.name, "ID:", existingQuiz.customQuizId);
    saveQuiz(pendingQuizData, existingQuiz.customQuizId);
  } else {
    console.log("[AMQ+] No existing AMQ+ quiz found, creating new one");
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
  console.log("[AMQ+] Command to send:", command);

  socket.sendCommand(command);

  console.log("[AMQ+] Save quiz command sent");
}

function applyQuizToLobby(quizId, quizName) {
  console.log("[AMQ+] Applying quiz to lobby, quiz ID:", quizId, "quiz name:", quizName);

  console.log("[AMQ+] Sending community mode command...");
  socket.sendCommand({
    type: "lobby",
    command: "change game settings",
    data: {
      settingChanges: {},
      communityMode: true
    }
  });

  setTimeout(() => {
    console.log("[AMQ+] Sending select custom quiz command, quiz ID:", quizId);
    socket.sendCommand({
      command: "select custom quiz",
      type: "lobby",
      data: {
        quizId: quizId
      }
    });

    updateModalStatus("Quiz applied - Click 'Start' button to begin");
    $("#amqPlusLoadingSpinner").hide();
    console.log("[AMQ+] Quiz applied");
    setTimeout(() => {
      $("#amqPlusModal").modal("hide");
    }, 100);
  }, 500);
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
      currentAMQQuizId = quizDesc.customQuizId;
      console.log("[AMQ+] Stored AMQ quiz ID:", currentAMQQuizId);
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
      applyQuizToLobby(newQuizId, quizName);
    } else {
      console.error("[AMQ+] Save quiz command failed:", payload);
      showError("Failed to save quiz");
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
        sendSystemMessage(`${formatted.icon} Song source: ${formatted.text}`);
      }, 500);
    } else if (annSongId) {
      // Song found but no source info - default to Random
      console.log("[AMQ+] Song annSongId:", annSongId, "but no source mapping found, defaulting to Random");
      setTimeout(() => {
        sendSystemMessage('🎲 Song source: Random');
      }, 500);
    } else {
      // Couldn't determine annSongId
      console.log("[AMQ+] Could not determine annSongId for current song", currentSongNumber);
    }
  }).bindListener();

  new Listener("game chat update", (payload) => {
    for (let message of payload.messages) {
      if (message.sender === selfName) {
        const msg = message.message.toLowerCase();
        console.log("[AMQ+] Chat message from self:", msg);

        if (msg.startsWith("/amqplus")) {
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
      }
    }
  }).bindListener();

  new Listener("Game Chat Message", (payload) => {
    if (payload.sender === selfName) {
      const msg = payload.message.toLowerCase();
      console.log("[AMQ+] Game Chat Message from self:", msg);

      if (msg.startsWith("/amqplus")) {
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
    console.log("[AMQ+] fireMainButtonEvent called, AMQ+ enabled:", amqPlusEnabled, "skipAutoReady:", skipAutoReady);

    const startButton = $("#lbStartButton");
    const buttonText = startButton.find("h1").text().trim();

    if (buttonText !== "Start") {
      console.log("[AMQ+] Button text is not 'Start' (is '" + buttonText + "'), proceeding normally");
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
  if (exportButton.length > 0) {
    if (lastLoadedQuizSave !== null) {
      exportButton.show().css("opacity", "1").css("pointer-events", "auto");
    } else {
      exportButton.hide().css("opacity", "0.5").css("pointer-events", "none");
    }
  }
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
  if (ownListInfo) {
    userEntries.push({
      id: `user-self-${Date.now()}`,
      platform: ownListInfo.platform,
      username: ownListInfo.username,
      selectedLists: { ...defaultStatuses },
      songPercentage: null
    });
    console.log("[AMQ+] Added own list:", ownListInfo);
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

    $(icon).click();

    await new Promise(resolve => setTimeout(resolve, 500));

    const listInfo = readPlayerListFromProfile();
    if (listInfo) {
      userEntries.push({
        id: `user-${i}-${Date.now()}`,
        platform: listInfo.platform,
        username: listInfo.username,
        selectedLists: { ...defaultStatuses },
        songPercentage: null
      });
      console.log(`[AMQ+] Added player ${i + 1} list:`, listInfo);
    }

    const profileContainer = $('.playerProfileContainer.floatingContainer:visible');
    if (profileContainer.length > 0) {
      const closeButton = profileContainer.find('.close');
      if (closeButton.length > 0) {
        closeButton[0].click();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("[AMQ+] Total player lists gathered:", userEntries.length);
  cachedPlayerLists = userEntries;
  return userEntries;
}

function sendQuizPlayByIdentifiers(quizInfo) {
  console.log("[AMQ+] Sending play to API for quiz:", quizInfo.name);
  GM_xmlhttpRequest({
    method: "POST",
    url: `${API_BASE_URL}/api/quiz-configurations/stats`,
    headers: {
      "Content-Type": "application/json"
    },
    data: JSON.stringify({
      name: quizInfo.name,
      description: quizInfo.description,
      creatorUsername: quizInfo.creatorUsername
    }),
    onload: function (response) {
      if (response.status === 200) {
        console.log("[AMQ+] Play recorded successfully");
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

  const storageKey = `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;
  const currentLikeState = amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;
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

    const storedState = amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;
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

  const storageKey = `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;
  const currentLikeState = amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;

  updateCustomLikeButtonUI(likeButton, currentLikeState);
}

function sendQuizLikeByIdentifiers(quizInfo, likeState) {
  console.log("[AMQ+] Sending like state to API for quiz:", quizInfo.name, "likeState:", likeState);

  const storageKey = `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;

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
          const storageKey = `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;
          const storedState = amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;
          updateCustomLikeButtonUI(customLikeButton, storedState);
        }
      }
    },
    onerror: function (error) {
      console.error("[AMQ+] Error sending like state:", error);
      const customLikeButton = document.getElementById('amqPlusCustomLikeButton');
      if (customLikeButton) {
        const storageKey = `${quizInfo.name}|${quizInfo.description || ''}|${quizInfo.creatorUsername || ''}`;
        const storedState = amqQuizLikesStorage && amqQuizLikesStorage[storageKey] ? amqQuizLikesStorage[storageKey].likeState : 0;
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

    if (meta.songTypes) {
      if (meta.songTypes.openings?.enabled) {
        // Match quizzes page display: prioritize count ranges over percentage
        if (meta.songTypes.openings.minCount !== undefined && meta.songTypes.openings.maxCount !== undefined) {
          messages.push(`🎵 OP ${meta.songTypes.openings.minCount}-${meta.songTypes.openings.maxCount}`);
        } else {
          const opPercent = meta.songTypes.openings.percentage || 0;
          if (meta.songTypes.openings.random) {
            messages.push(`🎵 OP ${opPercent}% (${meta.songTypes.openings.minPercentage || 0}-${meta.songTypes.openings.maxPercentage || 0})`);
          } else {
            messages.push(`🎵 OP ${opPercent}%`);
          }
        }
      }
      if (meta.songTypes.endings?.enabled) {
        // Match quizzes page display: prioritize count ranges over percentage
        if (meta.songTypes.endings.minCount !== undefined && meta.songTypes.endings.maxCount !== undefined) {
          messages.push(`🎵 ED ${meta.songTypes.endings.minCount}-${meta.songTypes.endings.maxCount}`);
        } else {
          const edPercent = meta.songTypes.endings.percentage || 0;
          if (meta.songTypes.endings.random) {
            messages.push(`🎵 ED ${edPercent}% (${meta.songTypes.endings.minPercentage || 0}-${meta.songTypes.endings.maxPercentage || 0})`);
          } else {
            messages.push(`🎵 ED ${edPercent}%`);
          }
        }
      }
      if (meta.songTypes.inserts?.enabled) {
        // Match quizzes page display: prioritize count ranges over percentage
        if (meta.songTypes.inserts.minCount !== undefined && meta.songTypes.inserts.maxCount !== undefined) {
          messages.push(`🎵 IN ${meta.songTypes.inserts.minCount}-${meta.songTypes.inserts.maxCount}`);
        } else {
          const insPercent = meta.songTypes.inserts.percentage || 0;
          if (meta.songTypes.inserts.random) {
            messages.push(`🎵 IN ${insPercent}% (${meta.songTypes.inserts.minPercentage || 0}-${meta.songTypes.inserts.maxPercentage || 0})`);
          } else {
            messages.push(`🎵 IN ${insPercent}%`);
          }
        }
      }
    }

    if (meta.difficulty) {
      if (meta.difficulty.mode === 'basic') {
        if (meta.difficulty.levels.easy?.enabled) {
          // Match quizzes page display: count ranges > count > percentage
          if (meta.difficulty.levels.easy.minCount !== undefined && meta.difficulty.levels.easy.maxCount !== undefined) {
            messages.push(`⭐ Easy ${meta.difficulty.levels.easy.minCount}-${meta.difficulty.levels.easy.maxCount}`);
          } else if (meta.difficulty.levels.easy.count !== undefined) {
            messages.push(`⭐ Easy ${meta.difficulty.levels.easy.count}`);
          } else {
            const easyPercent = meta.difficulty.levels.easy.percentage || 0;
            if (meta.difficulty.levels.easy.random) {
              messages.push(`⭐ Easy ${easyPercent}% (${meta.difficulty.levels.easy.minPercentage || 0}-${meta.difficulty.levels.easy.maxPercentage || 0})`);
            } else {
              messages.push(`⭐ Easy ${easyPercent}%`);
            }
          }
        }
        if (meta.difficulty.levels.medium?.enabled) {
          // Match quizzes page display: count ranges > count > percentage
          if (meta.difficulty.levels.medium.minCount !== undefined && meta.difficulty.levels.medium.maxCount !== undefined) {
            messages.push(`⭐ Medium ${meta.difficulty.levels.medium.minCount}-${meta.difficulty.levels.medium.maxCount}`);
          } else if (meta.difficulty.levels.medium.count !== undefined) {
            messages.push(`⭐ Medium ${meta.difficulty.levels.medium.count}`);
          } else {
            const medPercent = meta.difficulty.levels.medium.percentage || 0;
            if (meta.difficulty.levels.medium.random) {
              messages.push(`⭐ Medium ${medPercent}% (${meta.difficulty.levels.medium.minPercentage || 0}-${meta.difficulty.levels.medium.maxPercentage || 0})`);
            } else {
              messages.push(`⭐ Medium ${medPercent}%`);
            }
          }
        }
        if (meta.difficulty.levels.hard?.enabled) {
          // Match quizzes page display: count ranges > count > percentage
          if (meta.difficulty.levels.hard.minCount !== undefined && meta.difficulty.levels.hard.maxCount !== undefined) {
            messages.push(`⭐ Hard ${meta.difficulty.levels.hard.minCount}-${meta.difficulty.levels.hard.maxCount}`);
          } else if (meta.difficulty.levels.hard.count !== undefined) {
            messages.push(`⭐ Hard ${meta.difficulty.levels.hard.count}`);
          } else {
            const hardPercent = meta.difficulty.levels.hard.percentage || 0;
            if (meta.difficulty.levels.hard.random) {
              messages.push(`⭐ Hard ${hardPercent}% (${meta.difficulty.levels.hard.minPercentage || 0}-${meta.difficulty.levels.hard.maxPercentage || 0})`);
            } else {
              messages.push(`⭐ Hard ${hardPercent}%`);
            }
          }
        }
      } else if (meta.difficulty.mode === 'advanced') {
        if (meta.difficulty.ranges && meta.difficulty.ranges.length > 0) {
          meta.difficulty.ranges.forEach(range => {
            messages.push(`⭐ ${range.from}-${range.to} (${range.count})`);
          });
        }
      }
    }

    if (meta.songSelection) {
      if (meta.songSelection.random?.enabled) {
        // Match quizzes page display: count > count ranges > percentage
        if (meta.songSelection.random.count !== undefined) {
          messages.push(`🎲 Random ${meta.songSelection.random.count}`);
        } else if (meta.songSelection.random.minCount !== undefined && meta.songSelection.random.maxCount !== undefined) {
          messages.push(`🎲 Random ${meta.songSelection.random.minCount}-${meta.songSelection.random.maxCount}`);
        } else {
          messages.push(`🎲 Random ${meta.songSelection.random.percentage || 0}%`);
        }
      }
      if (meta.songSelection.watched?.enabled) {
        // Match quizzes page display: count > count ranges > percentage
        if (meta.songSelection.watched.count !== undefined) {
          messages.push(`👁️ Watched ${meta.songSelection.watched.count}`);
        } else if (meta.songSelection.watched.minCount !== undefined && meta.songSelection.watched.maxCount !== undefined) {
          messages.push(`👁️ Watched ${meta.songSelection.watched.minCount}-${meta.songSelection.watched.maxCount}`);
        } else {
          messages.push(`👁️ Watched ${meta.songSelection.watched.percentage || 0}%`);
        }
      }
    }

    if (meta.sourceNodes && meta.sourceNodes.length > 0) {
      const liveNodes = meta.sourceNodes.filter(source => source.type === 'liveNode');
      liveNodes.forEach((source, idx) => {
        let sourceMsg = `Source ${idx + 1}: Live Node`;
        if (source.useEntirePool) {
          sourceMsg += ' - Entire Pool';
        }
        sourceMsg += ` - Players: ${source.playerCount}`;
        messages.push(sourceMsg);
        if (source.players && source.players.length > 0) {
          source.players.forEach((player, pIdx) => {
            let playerMsg = `  Player ${pIdx + 1}: ${player.username} (${player.platform}) [${player.lists.join(', ')}]`;
            if (player.percentage) {
              playerMsg += ` - ${player.percentage}`;
            }
            messages.push(playerMsg);
          });
        }
        if (source.percentage) {
          messages.push(`  Percentage: ${source.percentage}`);
        }
      });
    }
  }

  messages.forEach((msg, idx) => {
    setTimeout(() => {
      socket.sendCommand({
        type: "lobby",
        command: "game chat message",
        data: { msg: msg, teamMessage: false }
      });
    }, idx * 100);
  });
}



