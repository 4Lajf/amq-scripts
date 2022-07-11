// ==UserScript==
// @name         AMQ Mute Button Buzzer
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  Posts the time when the player mutes their audio per round, acting as a buzzer
// @author       BobTheSheriff
// @match        https://animemusicquiz.com/*
// @grant        none
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==

/* Usage:
When you recognize a song, mute the audio by clicking the volume icon next to the slider.
Then, enter your answer in the answer bar. Do not unmute your audio (if you do, it will be counted as a missed buzzer).
Your audio will be automatically unmuted going into the results phase, and when the next song is loaded.

The time taken to hit the buzzer, as well as whether or not your answer was correct, will be posted in the chat.

Shoutout to Zolhungaj and TheJoseph98 as I mostly looked at their scripts to figure out how to write this
*/


"use strict"
let songStartTime = 0,
    songMuteTime = 0,
    muteClick,
    buzzerInitialized = false,
    ignoredPlayerIds = [],
    disqualified = false;

if (document.getElementById('startPage')) return;

function sendLobbyMessage(message) {
    socket.sendCommand({
        type: 'lobby',
        command: 'game chat message',
        data: { msg: message, teamMessage: false }
    });
}

function setupMuteBuzzer() {
    muteClick = document.getElementById("qpVolumeIcon");

    muteClick.observer = new MutationObserver((change) => {
        if (songMuteTime !== "Unmuted") {
            songMuteTime === 0 ? songMuteTime = Date.now() : songMuteTime = "Unmuted";
        }
    })

    if (muteClick.className === "fa fa-volume-off") { muteClick.click() };

    muteClick.observer.observe(muteClick, { attributes: true })
    songMuteTime = 0;
    buzzerInitialized = true;

    /*     muteClick.observer = new MutationObserver((change, data) => {
            if (songMuteTime !== "Unmuted") {
                songMuteTime === 0 ? songMuteTime = Date.now() : songMuteTime = "Unmuted";
            }
            if (quiz.isSpectator) { return }
            // post time in chat
            let songNumber = parseInt($("#qpCurrentSongCount").text()),
                message = "### Song " + songNumber + ": ",
                messageAnswer = '';

            if (songMuteTime == "Unmuted") {
                message += "Player unmuted - disqualified"
                messageAnswer = 'Disqualified'
                disqualified = true;
            } // set unmuted message
            else {
                songMuteTime ? message += "Buzzer clicked at: " + (songMuteTime - songStartTime) + "ms" : message += "No Buzzer";
                songMuteTime ? messageAnswer = (songMuteTime - songStartTime) + "ms" : messageAnswer += "No Buzzer";
            }
            sendLobbyMessage(message)
        }) */
}

// reset volume button between games
function shutdownBtn() {
    if (muteClick) { muteClick.observer.disconnect() };
    muteClick = null;
    buzzerInitialized = false;
    songMuteTime = 0;
}

// find mute button
new Listener("Game Starting", ({ players }) => {
    if (quiz.isSpectator) { return }
    shutdownBtn();
    setupMuteBuzzer();
    ignoredPlayerIds = []
    const self = players.find(player => player.name === selfName)
    if (self) {
        const teamNumber = self.teamNumber
        if (teamNumber) {
            const teamMates = players.filter(player => player.teamNumber === teamNumber)
            if (teamMates.length > 1) {
                ignoredPlayerIds = teamMates.map(player => player.gamePlayerId)
            }
        }
    }

}).bindListener()

new Listener("rejoin game", (data) => {
    if (quiz.isSpectator) { return }
    shutdownBtn();
    setupMuteBuzzer();
    if (data) { songStartTime = Date.now(); }
}).bindListener()


// unmute and stop looking at mute button
new Listener("guess phase over", () => {
    if (quiz.isSpectator) { return }
    muteClick.observer.disconnect();
    if (muteClick.className === "fa fa-volume-off") { muteClick.click() };
}).bindListener()


// post to chat
new Listener("answer results", (results) => {
    if (quiz.isSpectator) { return }
    // post time in chat
    let songNumber = parseInt($("#qpCurrentSongCount").text());
    let message = "### Song " + songNumber + ": ";

    if (songMuteTime == "Unmuted") { message += "Player unmuted - disqualified" } // set unmuted message
    else {
        songMuteTime ? message += "Buzzer clicked at: " + (songMuteTime - songStartTime) + "ms" : message += "No Buzzer";

        for (let player of results.players) {
            if ((quiz.players[player.gamePlayerId]._name === selfName) && (songMuteTime)) {
                (player.correct) ? message += " and answered correctly." : message = '';
            }
        }
    }

    // post message to chat
    if (quiz.gameMode !== "Ranked") {
        let oldMessage = gameChat.$chatInputField.val();
        gameChat.$chatInputField.val(message);
        gameChat.sendMessage();
        gameChat.$chatInputField.val(oldMessage);
    }

    // reset for next round
    songMuteTime = 0;
}).bindListener()

new Listener("play next song", () => {
    if (quiz.isSpectator) { return }
    if (!buzzerInitialized) { setupMuteBuzzer(); } // just in case
    if (muteClick.className === "fa fa-volume-off") { muteClick.click() }; // check if muted

    muteClick.observer.observe(muteClick, { attributes: true });

    songStartTime = Date.now();
    songMuteTime = 0;

    if (disqualified === true) {
        sendLobbyMessage()
    }

}).bindListener()

// check exits
new Listener("return lobby vote result", (result) => {
    if (quiz.isSpectator) { return }
    if (result.passed) {
        shutdownBtn();
    }
}).bindListener()
new Listener("quiz over", () => {
    shutdownBtn();
}).bindListener()
new Listener("leave game", () => {
    shutdownBtn();
}).bindListener()
new Listener("Spectate Game", () => {
    shutdownBtn();
}).bindListener()
new Listener("Host Game", () => {
    shutdownBtn();
}).bindListener()

AMQ_addScriptData({
    name: "AMQ Mute Button Buzzer",
    author: "4Lajf (forked from BobTheSheriff)",
    description: `Posts the time when the player mutes their audio per round, acting as a buzzer`
});
