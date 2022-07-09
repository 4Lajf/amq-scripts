// ==UserScript==
// @name         AMQ Player Answer Time Diference
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Makes you able to see how quickly people answered and the diference beetween the first player and everyone else, sends the result on chat at the end of a round and sends some stats and the end of the game
// @author       4Lajf (forked from Zolhungaj)
// @match        https://animemusicquiz.com/*
// @grant        none
// @downloadURL  https://github.com/amq-script-project/AMQ-Scripts/raw/master/gameplay/amqPlayerAnswerTimeDisplay.user.js
// @updateURL    https://github.com/amq-script-project/AMQ-Scripts/raw/master/gameplay/amqPlayerAnswerTimeDisplay.user.js
// @require     	https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==
(() => {
    //Prevent listener errors on the front page
    if (document.getElementById('startPage')) return;
    let loadInterval = setInterval(() => {
        if (document.getElementById("loadingScreen").classList.contains("hidden")) {
            setup();
            clearInterval(loadInterval);
        }
    }, 500);

    function compare(a, b) {
        if (a.time < b.time) {
            return -1;
        }
        if (a.time > b.time) {
            return 1;
        }
        return 0;
    }

    function sendLobbyMessage(message) {
        socket.sendCommand({
            type: 'lobby',
            command: 'game chat message',
            data: { msg: message, teamMessage: false }
        });
    }

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
                this.playerTimes.push({
                    "gamePlayerId": gamePlayerId,
                    "time": time,
                    "date": Date.now()
                })

                function isDuplicate(values) {
                    var valueArr = values.map(function (item) { return item.gamePlayerId });
                    var isDuplicate = valueArr.some(function (item, idx) {
                        return valueArr.indexOf(item) != idx
                    });
                    return isDuplicate
                }

                //deletes duplicate entry and leaves only the newest one
                if (isDuplicate(this.playerTimes) === true) {
                    for (var i = 0; i <= this.playerTimes.length - 1; i++) {
                        let tmp = this.playerTimes[i].gamePlayerId;
                        if (tmp === gamePlayerId) {
                            delete this.playerTimes[i].date
                            delete this.playerTimes[i].gamePlayerId
                            delete this.playerTimes[i].time
                            this.playerTimes = this.playerTimes.filter(
                                obj => !(obj && Object.keys(obj).length === 0 && obj.constructor === Object)
                            );
                            break;
                        }
                    }
                }
                this.playerTimes.sort(compare)
            })
        }).bindListener()

        new Listener("Join Game", (data) => {
            const quizState = data.quizState;
            if (quizState) {
                this.songStartTime = Date.now() - quizState.songTimer * 1000
            }
        }).bindListener()
    }()

    let ignoredPlayerIds = []

    new Listener("Game Starting", ({ players }) => {
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

    new Listener("player answered", (data) => {
        data.filter(gamePlayerId => !ignoredPlayerIds.includes(gamePlayerId)).forEach(gamePlayerId => {
            for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId !== gamePlayerId) {
                    continue;
                } else {
                    if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                        quiz.players[gamePlayerId].answer = amqAnswerTimesUtility.playerTimes[i].time + 'ms'
                    } else {
                        quiz.players[gamePlayerId].answer = `+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms`
                    }
                }
            }
        })
    }).bindListener()

    quiz._playerAnswerListner = new Listener(
        "player answers",
        function (data) {
            const that = quiz
            let limiter = 0;
            data.answers.forEach((answer) => {
                const quizPlayer = that.players[answer.gamePlayerId]
                let answerText = answer.answer
                for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                    if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId !== quizPlayer.gamePlayerId) {
                        continue;
                    } else {

                        if (amqAnswerTimesUtility.playerTimes[i] !== undefined) {
                            if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                                answerText += ` (${amqAnswerTimesUtility.playerTimes[i].time}ms)`
                            } else {
                                answerText += ` (+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms)`
                            }
                        }
                    }
                }
                quizPlayer.answer = answerText
                quizPlayer.unknownAnswerNumber = answer.answerNumber
                quizPlayer.toggleTeamAnswerSharing(false)
                if (amqAnswerTimesUtility.playerTimes[limiter] !== undefined) {
                    if (limiter <= 10) {
                        let placeNumber
                        switch (limiter) {
                            case 0:
                                placeNumber = '⚡'
                                break;
                            case 1:
                                placeNumber = '2️⃣'
                                break;
                            case 2:
                                placeNumber = '3️⃣'
                                break;
                            case 3:
                                placeNumber = '4️⃣'
                                break;
                            case 4:
                                placeNumber = '5️⃣'
                                break;
                            case 5:
                                placeNumber = '6️⃣'
                                break;
                            case 6:
                                placeNumber = '7️⃣'
                                break;
                            case 7:
                                placeNumber = '8️⃣'
                                break;
                            case 8:
                                placeNumber = '9️⃣'
                                break;
                            case 9:
                                placeNumber = '🔟'
                                break;
                        }
                        if (limiter === 0) {
                            sendLobbyMessage(`⚡ ${quizPlayer._name} --> ${amqAnswerTimesUtility.playerTimes[0].time}ms`);
                        } else {
                            sendLobbyMessage(`${placeNumber} ${quizPlayer._name} --> +${amqAnswerTimesUtility.playerTimes[limiter].time - amqAnswerTimesUtility.playerTimes[0].time}ms`);
                        }
                    }
                }
                limiter++
            })

            if (!that.isSpectator) {
                that.answerInput.showSubmitedAnswer()
                that.answerInput.resetAnswerState()
            }

            that.videoTimerBar.updateState(data.progressBarState)
        }
    )

    function setup() {
        AMQ_addScriptData({
            name: "AMQ Player Answer Time Diference",
            author: "4Lajf (forked from Zolhungaj)",
            description: `Displays time diference in ms between the fastest player and the rest, then and the end of the round sends results in chat.`
        });
    }

})();
