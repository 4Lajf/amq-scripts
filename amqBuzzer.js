// ==UserScript==
// @name         AMQ Mute Button Buzzer
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Posts the time when the player mutes their audio per round, acting as a buzzer
// @author       4Lajf (forked from BobTheSheriff)
// @match        https://animemusicquiz.com/*
// @grant        none
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @downloadURL  https://raw.githubusercontent.com/4Lajf/amq-scripts/main/amqBuzzer.js
// @updateURL    https://raw.githubusercontent.com/4Lajf/amq-scripts/main/amqBuzzer.js
// @copyright    MIT license
// ==/UserScript==

/* Usage:
When you recognize a song, mute the audio by clicking the control button
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
let scoreboardReady = false;
let playerDataReady = false;
let returningToLobby = false;
let missedFromOwnList = 0;
let playerData = {};

// listeners
let quizReadyRigTracker;
let answerResultsRigTracker;
let joinLobbyListener;
let spectateLobbyListener;


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

        data.answers.forEach((answer) => {
            const quizPlayer = quiz.players[answer.gamePlayerId]
            let answerText = answer.answer
            quizPlayer.answer = answerText
            quizPlayer.unknownAnswerNumber = answer.answerNumber
            quizPlayer.toggleTeamAnswerSharing(false)
        })

        if (!quiz.isSpectator) {
            let time = songMuteTime - songStartTime
            if (buzzerFired === false || time < 0) {
                gameChat.systemMessage(`[time] none`)
            } else if (time > 3000) {
                time = 3000;
                gameChat.systemMessage(`[time] ${(time).toString()}`)
            } else {
                gameChat.systemMessage(`[time] ${(time).toString()}`)
            }
            quiz.answerInput.showSubmitedAnswer()
            quiz.answerInput.resetAnswerState()
        }
        quiz.videoTimerBar.updateState(data.progressBarState)
    }
)

function processChatCommand(payload) {
    let time,
        gamePlayerId,
        message;
    if (payload.message.startsWith('[time]')) {
        message = payload.message.substring(7, payload.message.length)
        //console.log(message)
        for (let i = 0; i < 40; i++) {
            if (payload.sender === quiz.players[i]._name) {
                gamePlayerId = quiz.players[i].gamePlayerId;
                break;
            }
        }
        if (songMuteTime < 0 || message === 'none') {
            time = -1
        } else {
            time = message
        }
        fastestLeaderboard.push({
            'gamePlayerId': gamePlayerId,
            'name': payload.sender,
            'time': time,
        })
    }
}

//post to chat
new Listener("answer results", (result) => {
    if (quiz.isSpectator) { return }

    let limiter = 0,
        correctIds = [],
        incorrectIds = [],
        displayCorrectPlayers = [],
        displayInCorrectPlayers = [];

    if (!playerDataReady) {
        initialisePlayerData();
    }
    if (!scoreboardReady) {
        initialiseScoreboard();
        if (playerDataReady) {
            writeRigToScoreboard();
        }
    }
    console.log(result.players[0].correct)
    console.log(songMuteTime - songStartTime, buzzerFired)

    //Get those who answered correctly
    const correctPlayers = result.players
        .filter(player => player.correct)
    for (let i = 0; i < correctPlayers.length; i++) {
        correctIds.push(correctPlayers[i].gamePlayerId)
    }

    //add thier times into 'displayCorrectPlayers' array
    for (let i = 0; i <= correctIds.length - 1; i++) {
        if (fastestLeaderboard.find(item => item.gamePlayerId === correctIds[i]) === -1) {
            displayInCorrectPlayers.push(fastestLeaderboard.find(item => item.gamePlayerId === incorrectIds[i]))
            continue;
        }
        displayCorrectPlayers.push(fastestLeaderboard.find(item => item.gamePlayerId === correctIds[i]))
    }
    for (let i = 0; i < displayCorrectPlayers.length; i++) {
        //If you guessed right and have >3000ms, go back to 2000ms
        if (displayCorrectPlayers[i].time > 2000) {
            displayCorrectPlayers[i].time = 2000
        }
    }

    //Get those who answered incorrectly
    const incorrectPlayers = result.players
        .filter(player => !player.correct)
    for (let i = 0; i < incorrectPlayers.length; i++) {
        incorrectIds.push(incorrectPlayers[i].gamePlayerId)
    }

    //add thier times into 'displayInCorrectPlayers' array
    for (let i = 0; i <= incorrectIds.length - 1; i++) {
        if (fastestLeaderboard.find(item => item.gamePlayerId === incorrectIds[i]) === -1) {
            continue;
        }
        displayInCorrectPlayers.push(fastestLeaderboard.find(item => item.gamePlayerId === incorrectIds[i]))
    }

    //If no one got the question right, display all the scores
    //Otherwise show only those who answered correctly
    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'],
        timeScore;
    displayCorrectPlayers = displayCorrectPlayers.sort(compare)
    for (let i = 0; i < displayCorrectPlayers.length; i++) {
        if (limiter < 10) {
            if (i === 0) {
                gameChat.systemMessage(`⚡${displayCorrectPlayers[0].name} 🡆 ${displayCorrectPlayers[0].time}ms`);
                globalFastestLeaderboard.push({
                    'name': displayCorrectPlayers[0].name,
                    'time': parseInt(displayCorrectPlayers[0].time),
                })
                timeScore = parseInt(playerData[displayCorrectPlayers[0].gamePlayerId].rig) + parseInt(displayCorrectPlayers[0].time)
                playerData[displayCorrectPlayers[0].gamePlayerId].rig = timeScore;
                /*                 playerData[displayCorrectPlayers[0].gamePlayerId].rig++ */
                writeRigToScoreboard();
                limiter++
            } else {
                gameChat.systemMessage(`${placeNumber[i]} ${displayCorrectPlayers[i].name} 🡆 +${displayCorrectPlayers[i].time - displayCorrectPlayers[0].time}ms`);
                globalFastestLeaderboard.push({
                    'name': displayCorrectPlayers[i].name,
                    'time': parseInt(displayCorrectPlayers[i].time),
                })
                timeScore = parseInt(playerData[displayCorrectPlayers[i].gamePlayerId].rig) + parseInt(displayCorrectPlayers[i].time);
                playerData[displayCorrectPlayers[i].gamePlayerId].rig = timeScore
                /*                 playerData[displayCorrectPlayers[i].gamePlayerId].rig++ */
                writeRigToScoreboard();
                limiter++
            }
        } else {
            globalFastestLeaderboard.push({
                'name': displayCorrectPlayers[i].name,
                'time': parseInt(displayCorrectPlayers[i].time),
            })
            timeScore = parseInt(playerData[displayCorrectPlayers[i].gamePlayerId].rig) + parseInt(displayCorrectPlayers[i].time);
            playerData[displayCorrectPlayers[i].gamePlayerId].rig = timeScore
            /*             playerData[displayCorrectPlayers[i].gamePlayerId].rig++ */
            writeRigToScoreboard();
        }
    }
    displayInCorrectPlayers = displayInCorrectPlayers.sort(compare)
    for (let i = 0; i < displayInCorrectPlayers.length; i++) {
        if (limiter < 10) {
            displayInCorrectPlayers[i].time = 3000;
            gameChat.systemMessage(`❌${displayInCorrectPlayers[i].name} 🡆 Penalty +3000ms`);
            globalFastestLeaderboard.push({
                'name': displayInCorrectPlayers[i].name,
                'time': 3000,
            })
            timeScore = parseInt(playerData[displayInCorrectPlayers[i].gamePlayerId].rig) + parseInt(displayInCorrectPlayers[i].time);
            playerData[displayInCorrectPlayers[i].gamePlayerId].rig = timeScore
            writeRigToScoreboard();
            limiter++
        } else {
            displayInCorrectPlayers[i].time = 3000;
            globalFastestLeaderboard.push({
                'name': displayInCorrectPlayers[i].name,
                'time': 3000,
            })
            timeScore = parseInt(playerData[displayInCorrectPlayers[i].gamePlayerId].rig) + parseInt(displayInCorrectPlayers[i].time);
            playerData[displayInCorrectPlayers[i].gamePlayerId].rig = timeScore
            writeRigToScoreboard();
        }
        limiter++
    }
}).bindListener()

function quizEndResult(results) {
    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

    //Display leaderboard, player's scores are summed up
    globalFastestLeaderboard = mergeArray(globalFastestLeaderboard)
    gameChat.systemMessage(`===== SUMMED UP TIMES =====`)
    for (let i = 0; i <= globalFastestLeaderboard.length - 1; i++) {
        if (i > 10) break;
        gameChat.systemMessage(`${placeNumber[i]} ${globalFastestLeaderboard[i].name} 🡆 ${globalFastestLeaderboard[i].time}ms`);
    }
}

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
new Listener("quiz end result", quizEndResult).bindListener();

AMQ_addScriptData({
    name: "AMQ Mute Button Buzzer",
    author: "4Lajf (forked from BobTheSheriff)",
    description: `Posts the time when the player mutes their audio per round, acting as a buzzer`
});

// Writes the current rig to scoreboard
function writeRigToScoreboard() {
    if (playerDataReady) {
        for (let entryId in quiz.scoreboard.playerEntries) {
            let entry = quiz.scoreboard.playerEntries[entryId];
            /*                 let scoreCounter = entry.$entry.find(".qpsPlayerScore") */
            let guessedCounter = entry.$entry.find(".qpsPlayerRig");
            /*                 scoreCounter.text(playerData[entryId].score) */
            guessedCounter.text(playerData[entryId].rig);
        }
    }
}

// Clears the rig counters from scoreboard
function clearScoreboard() {
    $(".qpsPlayerRig").remove();
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
        let rig = $(`<span class="qpsPlayerRig">0</span>`);
        tmp.$entry.find(".qpsPlayerName").before(rig);
    }
    scoreboardReady = true;
}

// Initial setup on quiz start
quizReadyRigTracker = new Listener("quiz ready", (data) => {
    returningToLobby = false;
    clearPlayerData();
    clearScoreboard();
    answerResultsRigTracker.bindListener();
    initialiseScoreboard();
    initialisePlayerData();

    document.addEventListener("keydown", buzzer);
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

// stuff to do on answer reveal
answerResultsRigTracker = new Listener("answer results", (result) => {

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
            .qpsPlayerRig {
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
