// ==UserScript==
// @name         AMQ Style Points
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Awards additional "style points" (on the right side of your score in leaderboard) if you are the first one to get the answer right.
// @author       4Lajf
// @match        https://animemusicquiz.com/*
// @grant        none
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/main/amqStylePoints.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/main/amqStylePoints.user.js
// @copyright    MIT license
// ==/UserScript==


"use strict"
let scoreboardReady = false;
let playerDataReady = false;
let returningToLobby = false;
let playerData = {};

// listeners
let quizReadyRigTracker;
let answerResultsRigTracker;
let joinLobbyListener;
let spectateLobbyListener;
let playerTimes = [{}]

if (document.getElementById('startPage')) return;

// Wait until the LOADING... screen is hidden and load script
let loadInterval = setInterval(() => {
    if (document.getElementById("loadingScreen").classList.contains("hidden")) {
        setup();
        clearInterval(loadInterval);
    }
}, 500);

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

function filterAndSortPlayerTimes(correctPlayers, playerTimes) {
    const correctPlayerIdsSet = new Set(correctPlayers.map((player) => player.gamePlayerId));
    const filteredPlayerTimes = playerTimes.filter((playerTime) =>
        correctPlayerIdsSet.has(playerTime.gamePlayerId)
    );
    const sortedPlayerTimes = filteredPlayerTimes.sort((a, b) => a.answerTime - b.answerTime);
    return sortedPlayerTimes[0];
}

AMQ_addScriptData({
    name: "AMQ Style Points",
    author: "4Lajf",
    description: `Awards additional "style points" (on the right side of your score in leaderboard) if you are the first one to get the answer right.`
});

// Writes the current rig to scoreboard
function writeRigToScoreboard() {
    if (playerDataReady) {
        for (let entryId in quiz.scoreboard.playerEntries) {
            let entry = quiz.scoreboard.playerEntries[entryId];
            /*                 let scoreCounter = entry.$entry.find(".qpsPlayerScore") */
            let guessedCounter = entry.$entry.find(".qpsStylePoints");
            /*                 scoreCounter.text(playerData[entryId].score) */
            guessedCounter.text(playerData[entryId].rig);
        }
    }
}

// Clears the rig counters from scoreboard
function clearScoreboard() {
    $(".qpsStylePoints").remove();
    scoreboardReady = false;
}

// Clears player data
function clearPlayerData() {
    playerData = {};
    playerDataReady = false;
    missedFromOwnList = 0;
}

// Creates the player data for counting rig (and score)
function initialisePlayerData() {
    clearPlayerData();
    for (let entryId in quiz.players) {
        playerData[entryId] = {
            rig: 0,
            score: 0,
            missedList: 0,
            name: quiz.players[entryId]._name
        };
    }
    playerDataReady = true;
}

// Creates the rig counters on the scoreboard and sets them to 0
function initialiseScoreboard() {
    clearScoreboard();
    for (let entryId in quiz.scoreboard.playerEntries) {
        let tmp = quiz.scoreboard.playerEntries[entryId];
        let rig = $(`<span class="qpsStylePoints">0</span>`);
        tmp.$entry.find(".qpsPlayerName").before(rig);
    }
    scoreboardReady = true;
}

new Listener("player answers", (data) => {
    playerTimes = [{}]
    const that = quiz
    data.answers.forEach((answer) => {
        const quizPlayer = that.players[answer.gamePlayerId]
        console.log(amqAnswerTimesUtility)
        for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
            if (amqAnswerTimesUtility.playerTimes[i] !== undefined) {
                playerTimes.push({
                    'gamePlayerId': quizPlayer.gamePlayerId,
                    'answerTime': amqAnswerTimesUtility.playerTimes[quizPlayer.gamePlayerId]
                })
            }
        }
    })
    quiz.answerInput.showSubmitedAnswer()
    quiz.answerInput.resetAnswerState()
    quiz.videoTimerBar.updateState(data.progressBarState)
}).bindListener()

new Listener("answer results", (result) => {
    if (quiz.isSpectator) { return }

    let correctIds = [];

    if (!playerDataReady) {
        initialisePlayerData();
    }
    if (!scoreboardReady) {
        initialiseScoreboard();
        if (playerDataReady) {
            writeRigToScoreboard();
        }
    }

    //Get those who answered correctly
    const correctPlayers = result.players
        .filter(player => player.correct)
    for (let i = 0; i < correctPlayers.length; i++) {
        correctIds.push(correctPlayers[i].gamePlayerId)
    }

    let fastestPlayer = filterAndSortPlayerTimes(correctPlayers, playerTimes)
    console.log(fastestPlayer)
    if (fastestPlayer) playerData[fastestPlayer.gamePlayerId].rig++
    console.log(playerData)
    writeRigToScoreboard();
    return;
}).bindListener()

// stuff to do on answer reveal
answerResultsRigTracker = new Listener("answer results", (result) => {

});

// Initial setup on quiz start
quizReadyRigTracker = new Listener("quiz ready", (data) => {
    returningToLobby = false;
    clearPlayerData();
    clearScoreboard();
    answerResultsRigTracker.bindListener();
    initialiseScoreboard();
    initialisePlayerData();
});

// Reset data when joining a lobby
joinLobbyListener = new Listener("Join Game", (payload) => {
    if (payload.error) {
        return;
    }
    answerResultsRigTracker.unbindListener();
    clearPlayerData();
    clearScoreboard();
});

// Reset data when spectating a lobby
spectateLobbyListener = new Listener("Spectate Game", (payload) => {
    if (payload.error) {
        return;
    }
    answerResultsRigTracker.bindListener();
    clearPlayerData();
    clearScoreboard();
});

// bind listeners
quizReadyRigTracker.bindListener();
answerResultsRigTracker.bindListener();
joinLobbyListener.bindListener();
spectateLobbyListener.bindListener();

function setup() {
    // CSS stuff
    AMQ_addStyle(`
            .qpsStylePoints {
                padding-right: 5px;
                opacity: 0.3;
            }
            .customCheckboxContainer {
                display: flex;
            }
            .customCheckboxContainer > div {
                display: inline-block;
                margin: 5px 0px;
            }
            .customCheckboxContainer > .customCheckboxContainerLabel {
                margin-left: 5px;
                margin-top: 5px;
                font-weight: normal;
            }
            .offset1 {
                margin-left: 20px;
            }
            .offset2 {
                margin-left: 40px;
            }
            .offset3 {
                margin-left: 60px;
            }
            .offset4 {
                margin-left: 80px;
            }
        `);
}
