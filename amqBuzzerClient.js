// ==UserScript==
// @name         AMQ Mute Button Buzzer Client
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
    disqualified = false,
    fastestLeaderboard = [],
    buzzerInitialization = false,
    globalFastestLeaderboard = [],
    buzzerFired = false;

if (document.getElementById('startPage')) return;

const amqAnswerTimesUtility = new function () {
    "use strict"
    this.songStartTime = 0
    this.playerTimes = []
    if (typeof (Listener) === "undefined") {
        return
    }
    new Listener("play next song", () => {
        this.songStartTime = Date.now()
        this.playerTimes = []
    }).bindListener()

    new Listener("player answered", (data) => {
        const time = Date.now() - this.songStartTime
        data.forEach(gamePlayerId => {
            this.playerTimes[gamePlayerId] = time
        })
    }).bindListener()

    new Listener("Join Game", (data) => {
        const quizState = data.quizState;
        if (quizState) {
            this.songStartTime = Date.now() - quizState.songTimer * 1000
        }
    }).bindListener()
}()

function sendLobbyMessage(message) {
    socket.sendCommand({
        type: 'lobby',
        command: 'game chat message',
        data: { msg: message, teamMessage: false }
    });
}

function compare(a, b) {
    if (a.time < b.time) {
        return -1;
    }
    if (a.time > b.time) {
        return 1;
    }
    return 0;
}

function mergeArray(data) {
    return [...data].reduce((acc, val, i, arr) => {
        let { time, name } = val;
        time = parseFloat(time);
        const ind = acc.findIndex(el => el.name === name);
        if (ind !== -1) {
            acc[ind].time += time;
        } else {
            acc.push({
                time,
                name
            });
        }
        return acc;
    }, []);
}

function buzzer(event) {
    muteClick = document.getElementById("qpVolumeIcon");
    if (event.key === 'Control') {
        if (muteClick.className !== "fa fa-volume-off") { muteClick.click() };
    }
}

function setupMuteBuzzer() {
    buzzerInitialization = true;
    document.addEventListener("keydown", buzzer);
    muteClick = document.getElementById("qpVolumeIcon");
    muteClick.observer = new MutationObserver((change) => {
        if (songMuteTime !== -1 && muteClick.className === "fa fa-volume-off") {
            songMuteTime = Date.now()
        } else {
            songMuteTime = -1;
        }
        buzzerFired = true;
    })

    if (muteClick.className === "fa fa-volume-off") { muteClick.click() };
    muteClick.observer.observe(muteClick, { attributes: true })
    songMuteTime = 0;
    buzzerInitialized = true;
}


// reset volume button between games
function shutdownBtn() {
    if (buzzerInitialization === true) {
        document.removeEventListener("keydown", buzzer);
    }
    if (muteClick) {
        muteClick.observer.disconnect()
    };
    muteClick = null;
    buzzerInitialized = false;
    buzzerFired = false;
    songMuteTime = 0;
}

// find mute button
new Listener("Game Starting", ({ players }) => {
    if (quiz.isSpectator) { return }
    shutdownBtn();
    setupMuteBuzzer();
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
    document.removeEventListener("keydown", buzzer);
}).bindListener()

new Listener("play next song", (data) => {
    buzzerFired = false;
    fastestLeaderboard = [];
    displayPlayers = [];
    document.addEventListener("keydown", buzzer);
    if (quiz.isSpectator) { return }
    if (!buzzerInitialized) { setupMuteBuzzer(); } // just in case
    if (muteClick.className === "fa fa-volume-off") { muteClick.click() }; // check if muted

    muteClick.observer.observe(muteClick, { attributes: true });

    songStartTime = Date.now();
    songMuteTime = 0;

}).bindListener()

quiz._playerAnswerListner = new Listener(
    "player answers",
    function (data) {
        let time = songMuteTime - songStartTime
        if (!quiz.isSpectator) {
            if (buzzerFired === false) {
                sendLobbyMessage(`[time] none`)
            } else if (time > 3000) {
                time = 3000;
                sendLobbyMessage(`[time] ${(time).toString()}`)
            } else {
                sendLobbyMessage(`[time] ${(time).toString()}`)
            }
            quiz.answerInput.showSubmitedAnswer()
            quiz.answerInput.resetAnswerState()
        }
        quiz.videoTimerBar.updateState(data.progressBarState)
    }
)

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
new Listener("Game Chat Message", processChatCommand).bindListener();
new Listener("game chat update", (payload) => {
    payload.messages.forEach(message => processChatCommand(message));
}).bindListener();

AMQ_addScriptData({
    name: "AMQ Mute Button Buzzer",
    author: "4Lajf (forked from BobTheSheriff)",
    description: `Posts the time when the player mutes their audio per round, acting as a buzzer`
});
