// ==UserScript==
// @name         AMQ Buzzer Gamemode V2
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Hit your buzzer key to mute song, type your answer. Score = placement points per round (1st=5, 2nd=3, 3rd=2, 4th=1) + speed bonus. Anti-cheat: unmuting after buzz = no points.
// @author       4Lajf
// @match        https://*.animemusicquiz.com/*
// @grant        none
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==

/* Usage:
- /buzzer - open configuration modal, set your buzzer key
- /buzzerinfo - disable the info message
- /buzzerround - toggle per-round fastest leaderboard in chat (host only)
- /buzzertime <seconds> - set time limit for valid buzzer responses (host only, default 5)
- /buzzeroff - disable the script completely (behaves like it was never loaded)
- /buzzeron - re-enable the script after /buzzeroff
- Round starts unmuted. Press buzzer key to mute, then type your answer.
- Song unmutes on replay phase. Unmuting after buzz = cheating, no points.
- During guessing: buzzer times are shown in other players' answer boxes. After phase ends, normal answers are shown.
*/

"use strict";

const BUZZER_STORAGE_KEY = "amqBuzzerKey";
const BUZZER_INFO_DISMISSED_KEY = "amqBuzzerInfoDismissed";
const BUZZER_ROUND_LEADERBOARD_KEY = "amqBuzzerRoundLeaderboard";
const BUZZER_DISABLED_KEY = "amqBuzzerDisabled";
const ROUND_PLACEMENT_POINTS = [5, 3, 2, 1];
const SPEED_BONUS_FAST_MS = 500;
const SPEED_BONUS_SLOW_MS = 1500;
let MAX_BUZZ_TIME_MS = 5000;

let songStartTime = 0;
let songMuteTime = 0;
let muteButton = null;
let muteObserver = null;
let buzzerKeyHandler = null;
let buzzerInitialized = false;
let buzzerFired = false;
let userUnmutedCheat = false;
let _weAreUnmuting = false;

let fastestLeaderboard = [];
let playerData = {};
let scoreboardReady = false;
let playerDataReady = false;
let displayPlayers = [];
let currentSongNumber = 0;
let hasShownTimeLimitMessage = false;
let guessPhaseActive = false;
let hasSentBuzzerThisRound = false;

let quizReadyBuzzerTracker;
let answerResultsBuzzerTracker;
let joinLobbyListener;
let spectateLobbyListener;

if (document.getElementById("startPage")) return;

let loadInterval = setInterval(() => {
  if (document.getElementById("loadingScreen").classList.contains("hidden")) {
    setup();
    clearInterval(loadInterval);
  }
}, 500);

function getBuzzerKey() {
  try {
    const saved = localStorage.getItem(BUZZER_STORAGE_KEY);
    return saved || "Control";
  } catch (e) {
    return "Control";
  }
}

function setBuzzerKey(key) {
  try {
    localStorage.setItem(BUZZER_STORAGE_KEY, key);
  } catch (e) {
    console.error("[AMQ Buzzer] Failed to save buzzer key:", e);
  }
}

function isBuzzerInfoDismissed() {
  try {
    return localStorage.getItem(BUZZER_INFO_DISMISSED_KEY) === "true";
  } catch (e) {
    return false;
  }
}

function setBuzzerInfoDismissed() {
  try {
    localStorage.setItem(BUZZER_INFO_DISMISSED_KEY, "true");
  } catch (e) {
    console.error("[AMQ Buzzer] Failed to save info dismissed:", e);
  }
}

function isRoundLeaderboardEnabled() {
  try {
    return localStorage.getItem(BUZZER_ROUND_LEADERBOARD_KEY) !== "false";
  } catch (e) {
    return true;
  }
}

function setRoundLeaderboardEnabled(enabled) {
  try {
    localStorage.setItem(BUZZER_ROUND_LEADERBOARD_KEY, enabled ? "true" : "false");
  } catch (e) {
    console.error("[AMQ Buzzer] Failed to save round leaderboard setting:", e);
  }
}

function isBuzzerDisabled() {
  try {
    return localStorage.getItem(BUZZER_DISABLED_KEY) === "true";
  } catch (e) {
    return false;
  }
}

function setBuzzerDisabled(disabled) {
  try {
    localStorage.setItem(BUZZER_DISABLED_KEY, disabled ? "true" : "false");
  } catch (e) {
    console.error("[AMQ Buzzer] Failed to save disabled state:", e);
  }
}

function sendLobbyMessage(message) {
  if (typeof socket !== "undefined") {
    socket.sendCommand({
      type: "lobby",
      command: "game chat message",
      data: { msg: message, teamMessage: false }
    });
  }
}

function hideBuzzerChatMessages() {
  if (isBuzzerDisabled()) return;
  $("#gcMessageContainer li, #qpChatMessageContainer li").each(function () {
    if ($(this).text().includes("[buzzer]") || $(this).text().includes("[buzzer-time]")) {
      $(this).remove();
    }
  });
}

let buzzerChatObserverAttached = false;
let buzzerChatHideInterval = null;

function setupBuzzerChatObserver() {
  const container = document.getElementById("gcMessageContainer") || document.getElementById("qpChatMessageContainer");
  if (!container) return;
  if (!buzzerChatObserverAttached) {
    const observer = new MutationObserver(() => hideBuzzerChatMessages());
    observer.observe(container, { childList: true, subtree: true });
    buzzerChatObserverAttached = true;
  }
  if (!buzzerChatHideInterval) {
    buzzerChatHideInterval = setInterval(() => {
      if (!quiz?.inQuiz) {
        clearInterval(buzzerChatHideInterval);
        buzzerChatHideInterval = null;
        return;
      }
      hideBuzzerChatMessages();
    }, 1500);
  }
}

function stopBuzzerChatHideInterval() {
  if (buzzerChatHideInterval) {
    clearInterval(buzzerChatHideInterval);
    buzzerChatHideInterval = null;
  }
}

function sendSystemMessage(message) {
  if (typeof gameChat !== "undefined" && gameChat.systemMessage) {
    setTimeout(() => gameChat.systemMessage(String(message)), 1);
  } else {
    console.log("[AMQ Buzzer]", message);
  }
}

function formatKeyName(key) {
  if (!key) return "None";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function ensureUnmuted() {
  if (!muteButton) return;
  if (muteButton.className === "fa fa-volume-off") {
    _weAreUnmuting = true;
    muteButton.click();
    setTimeout(() => { _weAreUnmuting = false; }, 50);
  }
}

function buzzerKeyMatches(event, key) {
  if (!key) return false;
  if (key === " ") return event.key === " ";
  if (key === "Control") return event.key === "Control";
  if (key === "Shift") return event.key === "Shift";
  if (key === "Alt") return event.key === "Alt";
  if (key === "Meta") return event.key === "Meta";
  return event.key?.toLowerCase() === key.toLowerCase();
}

function createBuzzerKeybindHandler() {
  const key = getBuzzerKey();
  return function (event) {
    if (!buzzerInitialized || !muteButton || quiz?.isSpectator) return;
    if (buzzerKeyMatches(event, key)) {
      if (muteButton.className !== "fa fa-volume-off") {
        muteButton.click();
      }
    }
  };
}

function setupMuteBuzzer() {
  muteButton = document.getElementById("qpVolumeIcon");
  if (!muteButton) return;

  buzzerKeyHandler = createBuzzerKeybindHandler();
  document.addEventListener("keydown", buzzerKeyHandler);

  muteObserver = new MutationObserver(() => {
    if (muteButton.className === "fa fa-volume-off") {
      songMuteTime = Date.now();
      buzzerFired = true;
      if (!quiz?.isSpectator && !hasSentBuzzerThisRound) {
        const time = songMuteTime - songStartTime;
        if (time >= 0) {
          sendLobbyMessage(`[buzzer] ${time.toString()}`);
          hasSentBuzzerThisRound = true;
        }
      }
    } else {
      if (buzzerFired && !_weAreUnmuting) {
        userUnmutedCheat = true;
      }
      songMuteTime = -1;
    }
  });

  if (muteButton.className === "fa fa-volume-off") {
    _weAreUnmuting = true;
    muteButton.click();
    setTimeout(() => { _weAreUnmuting = false; }, 50);
  }
  muteObserver.observe(muteButton, { attributes: true });
  songMuteTime = 0;
  buzzerInitialized = true;
}

function shutdownBuzzer() {
  if (buzzerKeyHandler) {
    document.removeEventListener("keydown", buzzerKeyHandler);
  }
  if (muteObserver && muteButton) {
    muteObserver.disconnect();
  }
  muteButton = null;
  muteObserver = null;
  buzzerInitialized = false;
  buzzerFired = false;
  songMuteTime = 0;
  userUnmutedCheat = false;
}

function processChatCommand(payload) {
  if (isBuzzerDisabled()) return;
  if (!payload?.message?.startsWith("[buzzer")) return;
  if (!quiz?.players) return;

  if (payload.message.startsWith("[buzzer-time]")) {
    const message = payload.message.substring(14).trim();
    const timeSeconds = parseFloat(message);
    if (!isNaN(timeSeconds) && timeSeconds > 0) {
      MAX_BUZZ_TIME_MS = Math.round(timeSeconds * 1000);
      if (!hasShownTimeLimitMessage) {
        sendSystemMessage(`Buzzer time limit set to ${timeSeconds} seconds.`);
        hasShownTimeLimitMessage = true;
      }
    }
    hideBuzzerChatMessages();
    return;
  }

  if (!payload.message.startsWith("[buzzer]")) return;

  const message = payload.message.substring(9).trim();
  let gamePlayerId = null;

  for (const p of Object.values(quiz?.players || {})) {
    if (p && p._name === payload.sender) {
      gamePlayerId = p.gamePlayerId;
      break;
    }
  }

  if (gamePlayerId == null) return;

  fastestLeaderboard = fastestLeaderboard.filter((item) => item.gamePlayerId !== gamePlayerId);

  if (message === "none") {
    fastestLeaderboard.push({
      gamePlayerId,
      name: payload.sender,
      time: -1
    });
  } else {
    const time = parseFloat(message);
    if (!isNaN(time)) {
      fastestLeaderboard.push({
        gamePlayerId,
        name: payload.sender,
        time
      });
      if (guessPhaseActive && quiz?.players?.[gamePlayerId]) {
        quiz.players[gamePlayerId].answer = `${Math.round(time)}ms`;
      }
    }
  }
  hideBuzzerChatMessages();
}

function showBuzzerConfigModal() {
  const key = getBuzzerKey();

  const modalHtml = `
    <div id="amqBuzzerConfigModal" class="modal fade" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document" style="width: 450px; max-width: 95%;">
        <div class="modal-content" style="background-color: #1a1a2e; color: #e2e8f0; border: 1px solid #4a5568;">
          <div class="modal-header" style="border-bottom: 1px solid #2d3748; padding: 15px 20px;">
            <h4 class="modal-title">Buzzer Key Configuration</h4>
            <button type="button" class="close" data-dismiss="modal" style="color: #e2e8f0; opacity: 0.8;">
              <span>&times;</span>
            </button>
          </div>
          <div class="modal-body" style="padding: 20px;">
            <p style="margin-bottom: 15px;">Press any key to set as your buzzer key:</p>
            <div id="amqBuzzerKeyDisplay" style="
              padding: 15px;
              background: #2d3748;
              border-radius: 8px;
              text-align: center;
              font-size: 1.5em;
              font-weight: bold;
              margin-bottom: 15px;
              border: 2px dashed #4a5568;
              cursor: pointer;
            " title="Click here then press a key">${formatKeyName(key)}</div>
            <input type="text" id="amqBuzzerKeyInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" style="position:fixed;left:-9999px;width:1px;height:1px;opacity:0;" tabindex="-1" aria-label="Key capture" />
            <p style="font-size: 0.9em; color: #a0aec0;">
              When you recognize a song, press this key to stop the audio, then type your answer.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  if ($("#amqBuzzerConfigModal").length === 0) {
    $("body").append(modalHtml);
  }

  const $modal = $("#amqBuzzerConfigModal");
  const $display = $("#amqBuzzerKeyDisplay");
  const $input = $("#amqBuzzerKeyInput");

  const keydownHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Unidentified") return;
    const newKey = e.key === " " ? " " : (e.key || e.code || "Unknown");
    setBuzzerKey(newKey);
    $display.text(formatKeyName(newKey));
    document.removeEventListener("keydown", keydownHandler, true);
    $input.off("keydown", keydownHandlerInput);
  };

  const keydownHandlerInput = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Unidentified") return;
    const newKey = e.key === " " ? " " : (e.key || e.code || "Unknown");
    setBuzzerKey(newKey);
    $display.text(formatKeyName(newKey));
    document.removeEventListener("keydown", keydownHandler, true);
    $input.off("keydown", keydownHandlerInput);
  };

  $modal.off("shown.bs.modal").on("shown.bs.modal", () => {
    $display.text(formatKeyName(key));
    document.addEventListener("keydown", keydownHandler, true);
    $input.on("keydown", keydownHandlerInput);
    $display.off("click").on("click", () => $input.focus());
    setTimeout(() => $input.focus(), 150);
  });

  $modal.off("hidden.bs.modal").on("hidden.bs.modal", () => {
    document.removeEventListener("keydown", keydownHandler, true);
    $input.off("keydown", keydownHandlerInput);
    if (buzzerKeyHandler) {
      document.removeEventListener("keydown", buzzerKeyHandler);
      buzzerKeyHandler = createBuzzerKeybindHandler();
      document.addEventListener("keydown", buzzerKeyHandler);
    }
  });

  $modal.modal("show");
}

function handleChatCommand(message) {
  const msgLower = (message || "").toLowerCase().trim();
  if (msgLower === "/buzzeroff") {
    setBuzzerDisabled(true);
    shutdownBuzzer();
    stopBuzzerChatHideInterval();
    clearScoreboard();
    restoreScoreboardToGame();
    clearPlayerData();
    sendSystemMessage("Buzzer mode disabled. Type /buzzeron to re-enable.");
    return true;
  }
  if (msgLower === "/buzzeron") {
    setBuzzerDisabled(false);
    sendSystemMessage("Buzzer mode re-enabled.");
    return true;
  }
  if (isBuzzerDisabled()) return false;
  if (msgLower === "/buzzer") {
    showBuzzerConfigModal();
    return true;
  }
  if (msgLower === "/buzzerinfo") {
    setBuzzerInfoDismissed();
    sendSystemMessage("Buzzer info message disabled. Type /buzzer to configure your buzzer key.");
    return true;
  }
  if (msgLower === "/buzzerround") {
    const next = !isRoundLeaderboardEnabled();
    setRoundLeaderboardEnabled(next);
    sendSystemMessage(`Round leaderboard (fastest per round) ${next ? "enabled" : "disabled"}. Type /buzzerround to toggle.`);
    return true;
  }
  if (msgLower.startsWith("/buzzertime ")) {
    if (typeof lobby === "undefined" || !lobby?.isHost) {
      sendSystemMessage("Only the host can set the buzzer time limit.");
      return true;
    }
    const timeStr = msgLower.substring(12).trim();
    const timeSeconds = parseFloat(timeStr);
    if (isNaN(timeSeconds) || timeSeconds <= 0) {
      sendSystemMessage("Invalid time. Usage: /buzzertime <seconds> (e.g., /buzzertime 5)");
      return true;
    }
    MAX_BUZZ_TIME_MS = Math.round(timeSeconds * 1000);
    sendLobbyMessage(`[buzzer-time] ${timeSeconds}`);
    sendSystemMessage(`Buzzer time limit set to ${timeSeconds} seconds and broadcasted to players.`);
    return true;
  }
  return false;
}

function setupBuzzerSocketInterceptor() {
  if (typeof socket === "undefined" || socket._amqBuzzerHijacked) return;
  const originalSendCommand = socket.sendCommand.bind(socket);
  socket.sendCommand = function (command) {
    if (command?.type === "lobby" && command?.command === "game chat message") {
      const msg = (command?.data?.msg || "").trim();
      const msgLower = msg.toLowerCase();
      if (msgLower === "/buzzeroff") {
        setBuzzerDisabled(true);
        shutdownBuzzer();
        stopBuzzerChatHideInterval();
        clearScoreboard();
        restoreScoreboardToGame();
        clearPlayerData();
        sendSystemMessage("Buzzer mode disabled. Type /buzzeron to re-enable.");
        return;
      }
      if (msgLower === "/buzzeron") {
        setBuzzerDisabled(false);
        sendSystemMessage("Buzzer mode re-enabled.");
        return;
      }
      if (isBuzzerDisabled()) return originalSendCommand.call(this, command);
      if (msgLower === "/buzzer") {
        showBuzzerConfigModal();
        return;
      }
      if (msgLower === "/buzzerinfo") {
        setBuzzerInfoDismissed();
        sendSystemMessage("Buzzer info message disabled. Type /buzzer to configure your buzzer key.");
        return;
      }
      if (msgLower === "/buzzerround") {
        const next = !isRoundLeaderboardEnabled();
        setRoundLeaderboardEnabled(next);
        sendSystemMessage(`Round leaderboard (fastest per round) ${next ? "enabled" : "disabled"}. Type /buzzerround to toggle.`);
        return;
      }
      if (msgLower.startsWith("/buzzertime ")) {
        if (typeof lobby === "undefined" || !lobby?.isHost) {
          sendSystemMessage("Only the host can set the buzzer time limit.");
          return;
        }
        const timeStr = msgLower.substring(12).trim();
        const timeSeconds = parseFloat(timeStr);
        if (isNaN(timeSeconds) || timeSeconds <= 0) {
          sendSystemMessage("Invalid time. Usage: /buzzertime <seconds> (e.g., /buzzertime 5)");
          return;
        }
        MAX_BUZZ_TIME_MS = Math.round(timeSeconds * 1000);
        sendLobbyMessage(`[buzzer-time] ${timeSeconds}`);
        sendSystemMessage(`Buzzer time limit set to ${timeSeconds} seconds and broadcasted to players.`);
        return;
      }
    }
    return originalSendCommand.call(this, command);
  };
  socket._amqBuzzerHijacked = true;
}

function showBuzzerInfoIfNeeded() {
  if (isBuzzerInfoDismissed()) return;
  sendSystemMessage(
    "Type /buzzer in chat to configure your buzzer key. /buzzerinfo to hide this. /buzzerround to toggle per-round fastest leaderboard."
  );
}

new Listener("Game Starting", () => {
  if (isBuzzerDisabled()) return;
  if (quiz?.isSpectator) return;
  hasShownTimeLimitMessage = false;
  shutdownBuzzer();
  setupMuteBuzzer();
  setTimeout(showBuzzerInfoIfNeeded, 500);
  setTimeout(setupBuzzerChatObserver, 1000);
}).bindListener();

new Listener("rejoin game", (data) => {
  if (isBuzzerDisabled()) return;
  if (quiz?.isSpectator) return;
  shutdownBuzzer();
  setupMuteBuzzer();
  if (data) {
    songStartTime = Date.now();
  }
}).bindListener();

new Listener("guess phase over", () => {
  if (isBuzzerDisabled()) return;
  if (quiz?.isSpectator) return;
  guessPhaseActive = false;
  if (muteObserver && muteButton) {
    muteObserver.disconnect();
  }
  ensureUnmuted();
  if (buzzerKeyHandler) {
    document.removeEventListener("keydown", buzzerKeyHandler);
  }
}).bindListener();

new Listener("play next song", (payload) => {
  if (isBuzzerDisabled()) return;
  buzzerFired = false;
  userUnmutedCheat = false;
  hasSentBuzzerThisRound = false;
  fastestLeaderboard = [];
  displayPlayers = [];
  guessPhaseActive = true;

  if (payload?.songNumber !== undefined) {
    currentSongNumber = payload.songNumber;
  }

  if (quiz?.isSpectator) return;

  if (!buzzerInitialized) setupMuteBuzzer();
  else if (buzzerKeyHandler) {
    document.addEventListener("keydown", buzzerKeyHandler);
  }

  if (muteObserver && muteButton) {
    muteObserver.observe(muteButton, { attributes: true });
  }

  songStartTime = Date.now();
  songMuteTime = 0;

  // Reset to default at start of each round (host can override with /buzzertime)
  if (typeof lobby === "undefined" || !lobby?.isHost) {
    MAX_BUZZ_TIME_MS = 5000;
  } else {
    // Host broadcasts current time limit at start of round
    const timeSeconds = MAX_BUZZ_TIME_MS / 1000;
    sendLobbyMessage(`[buzzer-time] ${timeSeconds}`);
  }
  
  setTimeout(writeBuzzerToScoreboard, 300);
}).bindListener();


new Listener("player answers", function (data) {
  if (isBuzzerDisabled()) return;
  if (!quiz.isSpectator) {
    if (userUnmutedCheat || buzzerFired === false || songMuteTime < 0) {
      sendLobbyMessage("[buzzer] none");
    } else {
      const time = songMuteTime - songStartTime;
      sendLobbyMessage(`[buzzer] ${time.toString()}`);
    }
  }
}).bindListener();

new Listener("Game Chat Message", (payload) => {
  if (handleChatCommand(payload.message)) return;
  if (isBuzzerDisabled()) return;
  processChatCommand(payload);
}).bindListener();

new Listener("game chat update", (payload) => {
  if (payload?.messages) {
    payload.messages.forEach((msg) => {
      if (handleChatCommand(msg?.message)) return;
      if (isBuzzerDisabled()) return;
      processChatCommand(msg);
    });
  }
}).bindListener();

new Listener("answer results", (result) => {
  if (isBuzzerDisabled()) return;
  if (quiz?.isSpectator) return;

  if (!playerDataReady) initialisePlayerData();
  if (!scoreboardReady) {
    initialiseScoreboard();
    if (playerDataReady) writeBuzzerToScoreboard();
  }

  const correctIds = result.players.filter((p) => p.correct).map((p) => p.gamePlayerId);
  const incorrectIds = result.players.filter((p) => !p.correct).map((p) => p.gamePlayerId);

  const validCorrectPlayers = fastestLeaderboard
    .filter(
      (item) =>
        correctIds.includes(item.gamePlayerId) &&
        item.time !== -1 &&
        item.time !== "none" &&
        !isNaN(parseInt(item.time, 10)) &&
        parseInt(item.time, 10) >= 0 &&
        parseInt(item.time, 10) <= MAX_BUZZ_TIME_MS
    )
    .sort((a, b) => parseInt(a.time, 10) - parseInt(b.time, 10));

  const roundPointsGained = {};

  for (let rank = 0; rank < validCorrectPlayers.length; rank++) {
    const item = validCorrectPlayers[rank];
    const buzzTime = parseInt(item.time, 10);
    if (!playerData[item.gamePlayerId]) continue;

    const placementPoints = ROUND_PLACEMENT_POINTS[rank] ?? 1;
    const speedBonus =
      buzzTime <= SPEED_BONUS_FAST_MS
        ? 1
        : buzzTime >= SPEED_BONUS_SLOW_MS
          ? 0
          : 1 - (buzzTime - SPEED_BONUS_FAST_MS) / (SPEED_BONUS_SLOW_MS - SPEED_BONUS_FAST_MS);

    const totalPoints = placementPoints + speedBonus;
    roundPointsGained[item.gamePlayerId] = totalPoints;
    playerData[item.gamePlayerId].score += totalPoints;
    playerData[item.gamePlayerId].time += buzzTime;
  }

  writeBuzzerToScoreboard();
  setTimeout(writeBuzzerToScoreboard, 500);

  if (typeof lobby !== "undefined" && lobby?.isHost && isRoundLeaderboardEnabled() && fastestLeaderboard.length > 0) {
    displayRoundLeaderboard(result, correctIds, incorrectIds, roundPointsGained);
  }
}).bindListener();

function displayRoundLeaderboard(result, correctIds, incorrectIds, roundPointsGained = {}) {
  const leaderboardData = fastestLeaderboard.map((item) => ({
    ...item,
    correct: correctIds.includes(item.gamePlayerId),
    incorrect: incorrectIds.includes(item.gamePlayerId)
  }));

  const validCorrectPlayers = leaderboardData.filter(
    p => p.correct && p.time !== -1 && p.time <= MAX_BUZZ_TIME_MS
  ).sort((a, b) => a.time - b.time);

  const invalidOrOverTimePlayers = leaderboardData.filter(
    p => p.time !== -1 && (p.incorrect || (p.correct && p.time > MAX_BUZZ_TIME_MS))
  ).sort((a, b) => a.time - b.time);

  const noBuzzPlayers = leaderboardData.filter(p => p.time === -1);

  const finalOrder = [...validCorrectPlayers, ...invalidOrOverTimePlayers, ...noBuzzPlayers];

  const emojiNumbers = ["1⃣", "2⃣", "3⃣", "4⃣", "5⃣", "6⃣", "7⃣", "8⃣", "9⃣", "🔟"];

  setTimeout(() => {
    sendLobbyMessage(`===== ROUND ${currentSongNumber} =====`);

    finalOrder.forEach((p, i) => {
      const place = i < emojiNumbers.length ? emojiNumbers[i] : `${i + 1}.`;
      let status;

      if (p.time === -1) {
        status = "-";
      } else if (p.incorrect || (p.correct && p.time > MAX_BUZZ_TIME_MS)) {
        status = `❌ (${Math.round(p.time)}ms)`;
      } else {
        const points = roundPointsGained[p.gamePlayerId];
        const pointsStr = points !== undefined ? (Number.isInteger(points) ? points : points.toFixed(1)) : "?";
        status = `${Math.round(p.time)}ms (+${pointsStr}pts)`;
      }

      const msg = `${place} ${p.name}: ${status}`;
      setTimeout(() => sendLobbyMessage(msg), (i + 1) * 150);
    });
  }, 100);
}

function quizEndBuzzerResult() {
  if (isBuzzerDisabled()) return;
  const players = Object.entries(playerData)
    .filter(([, d]) => d.name)
    .map(([id, d]) => ({
      gamePlayerId: id,
      name: d.name,
      score: d.score,
      time: d.time
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.time - b.time;
    });

  if (players.length === 0) return;

  if (typeof lobby !== "undefined" && lobby?.isHost) {
    sendLobbyMessage("=========== RESULTS ===========");
    const placeNumbers = ["🥇", "🥈", "🥉", "4.", "5.", "6.", "7.", "8.", "9.", "10."];
    for (let i = 0; i < Math.min(players.length, 10); i++) {
      const scoreStr = Number.isInteger(players[i].score) ? players[i].score : players[i].score.toFixed(1);
      sendLobbyMessage(
        `${placeNumbers[i]} ${players[i].name}: ${scoreStr} pts · ${players[i].time}ms`
      );
    }
    sendLobbyMessage("===============================");
  }
}

new Listener("quiz end result", quizEndBuzzerResult).bindListener();

new Listener("return lobby vote result", (result) => {
  if (result?.passed) {
    shutdownBuzzer();
    stopBuzzerChatHideInterval();
  }
}).bindListener();

new Listener("quiz over", () => {
  if (isBuzzerDisabled()) return;
  shutdownBuzzer();
  stopBuzzerChatHideInterval();
}).bindListener();

new Listener("leave game", () => {
  if (isBuzzerDisabled()) return;
  shutdownBuzzer();
  stopBuzzerChatHideInterval();
}).bindListener();

new Listener("Spectate Game", () => {
  if (isBuzzerDisabled()) return;
  shutdownBuzzer();
  stopBuzzerChatHideInterval();
}).bindListener();

new Listener("Host Game", () => {
  if (isBuzzerDisabled()) return;
  shutdownBuzzer();
  stopBuzzerChatHideInterval();
}).bindListener();

function writeBuzzerToScoreboard() {
  if (!playerDataReady || !quiz?.scoreboard?.playerEntries) return;

  try {
    for (const [playerId, entry] of Object.entries(quiz.scoreboard.playerEntries)) {
      const data = playerData[playerId];
      if (!data) continue;

      const score = data.score;
      const $scoreElement = entry.$scoreBoardEntryTextContainer?.find(".qpsPlayerScore");

      if ($scoreElement?.length) {
        if (entry._buzzerOriginalScore === undefined) {
          entry._buzzerOriginalScore = $scoreElement.text();
        }
        $scoreElement.text(Number.isInteger(score) ? score : score.toFixed(1));
      }
    }
  } catch (e) {
    console.error("[AMQ Buzzer] Error updating scoreboard:", e);
  }
}

function clearScoreboard() {
  $(".qpsPlayerBuzzerTime").remove();
  scoreboardReady = false;
}

function restoreScoreboardToGame() {
  try {
    const entries = quiz?.scoreboard?.playerEntries;
    if (!entries) return;
    for (const [, entry] of Object.entries(entries)) {
      const $scoreElement = entry.$scoreBoardEntryTextContainer?.find(".qpsPlayerScore");
      if ($scoreElement?.length && entry._buzzerOriginalScore !== undefined) {
        $scoreElement.text(entry._buzzerOriginalScore);
      }
    }
  } catch (e) {
    console.error("[AMQ Buzzer] Error restoring scoreboard:", e);
  }
}

function clearPlayerData() {
  playerData = {};
  playerDataReady = false;
}

function initialisePlayerData() {
  clearPlayerData();
  for (const [entryId, p] of Object.entries(quiz?.players || {})) {
    if (!p || !p._name) continue;
    playerData[entryId] = {
      score: 0,
      time: 0,
      name: p._name
    };
  }
  playerDataReady = true;
}

function initialiseScoreboard() {
  clearScoreboard();
  const entries = quiz?.scoreboard?.playerEntries;
  if (!entries) return;
  scoreboardReady = true;
}

quizReadyBuzzerTracker = new Listener("quiz ready", () => {
  if (isBuzzerDisabled()) return;
  hasShownTimeLimitMessage = false;
  clearPlayerData();
  clearScoreboard();
  answerResultsBuzzerTracker?.bindListener?.();
  initialiseScoreboard();
  initialisePlayerData();
  currentSongNumber = 0;
  if (buzzerKeyHandler) {
    document.addEventListener("keydown", buzzerKeyHandler);
  }
});

joinLobbyListener = new Listener("Join Game", (payload) => {
  if (isBuzzerDisabled()) return;
  if (payload?.error) return;
  hasShownTimeLimitMessage = false;
  answerResultsBuzzerTracker?.unbindListener?.();
  clearPlayerData();
  clearScoreboard();
});

answerResultsBuzzerTracker = new Listener("answer results", () => { });

spectateLobbyListener = new Listener("Spectate Game", (payload) => {
  if (isBuzzerDisabled()) return;
  if (payload?.error) return;
  answerResultsBuzzerTracker?.bindListener?.();
  clearPlayerData();
  clearScoreboard();
});

quizReadyBuzzerTracker?.bindListener?.();
answerResultsBuzzerTracker?.bindListener?.();
joinLobbyListener?.bindListener?.();
spectateLobbyListener?.bindListener?.();

function setup() {
  setupBuzzerSocketInterceptor();
  if (!isBuzzerDisabled()) {
    setupBuzzerChatObserver();
  }

  if (!isBuzzerDisabled() && typeof AMQ_addScriptData === "function") {
    AMQ_addScriptData({
      name: "AMQ Buzzer Gamemode V2",
      author: "4Lajf",
      description: `Race to recognize songs: press buzzer key to mute, type answer. Points = placement per round (1st=5, 2nd=3, 3rd=2, 4th=1) + speed bonus; tiebreak = total buzz time. /buzzer keybind, /buzzerinfo hide tip, /buzzerround toggle per-round leaderboard, /buzzeroff disable script. Host posts fastest per round in chat. [buzzer] messages hidden from chat.`
    });
  }
}
