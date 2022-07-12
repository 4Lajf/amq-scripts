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

//post to chat
new Listener("answer results", (results) => {
    if (quiz.isSpectator) { return }

    console.log(buzzerFired)

    let limiter = 0,
        correctIds = [],
        incorrectIds = [],
        displayCorrectPlayers = [],
        displayInCorrectPlayers = [];
    //Get those who answered correctly
    const correctPlayers = results.players
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


    //Get those who answered incorrectly
    const incorrectPlayers = results.players
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
    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
    displayCorrectPlayers = displayCorrectPlayers.sort(compare)
    for (let i = 0; i < displayCorrectPlayers.length; i++) {
        if (limiter < 10) {
            if (i === 0) {
                sendLobbyMessage(`⚡${displayCorrectPlayers[0].name} 🡆 ${displayCorrectPlayers[0].time}ms`);
                globalFastestLeaderboard.push({
                    'name': displayCorrectPlayers[0].name,
                    'time': parseInt(displayCorrectPlayers[0].time),
                })
                limiter++
            } else {
                sendLobbyMessage(`${placeNumber[i]} ${displayCorrectPlayers[i].name} 🡆 +${displayCorrectPlayers[i].time - displayCorrectPlayers[0].time}ms`);
                globalFastestLeaderboard.push({
                    'name': displayCorrectPlayers[i].name,
                    'time': parseInt(displayCorrectPlayers[i].time),
                })
                limiter++
            }
        } else {
            globalFastestLeaderboard.push({
                'name': displayCorrectPlayers[i].name,
                'time': parseInt(displayCorrectPlayers[i].time),
            })
        }
    }
    console.log(globalFastestLeaderboard)
    displayInCorrectPlayers = displayInCorrectPlayers.sort(compare)
    for (let i = 0; i < displayInCorrectPlayers.length; i++) {
        if (limiter < 10) {
            displayInCorrectPlayers[i].time = 3000;
            sendLobbyMessage(`❌${displayInCorrectPlayers[i].name} 🡆 Penalty +3000ms`);
            globalFastestLeaderboard.push({
                'name': displayInCorrectPlayers[i].name,
                'time': 3000,
            })
            limiter++
        } else {
            displayInCorrectPlayers[i].time = 3000;
            globalFastestLeaderboard.push({
                'name': displayInCorrectPlayers[i].name,
                'time': 3000,
            })
        }
        limiter++
    }
    console.log(globalFastestLeaderboard)
}).bindListener()

function quizEndResult(results) {
    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

    //Display leaderboard, player's scores are summed up
    globalFastestLeaderboard = mergeArray(globalFastestLeaderboard)
    sendLobbyMessage(`===== SUMMED UP TIMES =====`)
    for (let i = 0; i <= globalFastestLeaderboard.length - 1; i++) {
        if (i > 10) break;
        sendLobbyMessage(`${placeNumber[i]} ${globalFastestLeaderboard[i].name} 🡆 ${globalFastestLeaderboard[i].time}ms`);
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

function processChatCommand(payload) {
    let time,
        gamePlayerId;
    if (payload.message.startsWith('[time]')) {
        for (let i = 0; i < 40; i++) {
            if (payload.sender === quiz.players[i]._name) {
                gamePlayerId = quiz.players[i].gamePlayerId;
                break;
            }
        }
        if (songMuteTime < 0 || payload.content === 'none') {
            time = -1
        } else {
            time = payload.message.substring(6, payload.message.length)
        }
        fastestLeaderboard.push({
            'gamePlayerId': gamePlayerId,
            'name': payload.sender,
            'time': time,
        })
    }
}

AMQ_addScriptData({
    name: "AMQ Mute Button Buzzer",
    author: "4Lajf (forked from BobTheSheriff)",
    description: `Posts the time when the player mutes their audio per round, acting as a buzzer`
});
