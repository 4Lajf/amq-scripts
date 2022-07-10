// ==UserScript==
// @name         AMQ Player Answer Time Diference (hidden messages)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  <sends system messages only visible for you> Makes you able to see how quickly people answered and the diference beetween the first player and everyone else, sends the result on chat at the end of a round and sends some stats and the end of the game
// @author       4Lajf (forked from Zolhungaj)
// @match        https://animemusicquiz.com/*
// @grant        none
// @downloadURL  https://github.com/amq-script-project/AMQ-Scripts/raw/master/gameplay/amqPlayerAnswerTimeDisplay.user.js
// @updateURL    https://github.com/amq-script-project/AMQ-Scripts/raw/master/gameplay/amqPlayerAnswerTimeDisplay.user.js
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==
(() => {
    // don't load on login page
    if (document.getElementById('startPage')) return;

    // Wait until the LOADING... screen is hidden and load script
    let loadInterval = setInterval(() => {
        if (document.getElementById("loadingScreen").classList.contains("hidden")) {
            setup();
            clearInterval(loadInterval);
        }
    }, 500);

    //sort object by time (fastest first)
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
            let { gamePlayerId, time, name } = val;
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

    let ignoredPlayerIds = [],
        fastestLeaderboard = null,
        leader = null,
        newLeader,
        playerID,
        gameRound,
        summedUpLeaderBoard;

    //Measure answer speed
    const amqAnswerTimesUtility = new function () {
        "use strict"
        this.songStartTime = 0
        this.playerTimes = []
        const that = quiz
        if (typeof (Listener) === "undefined") {
            return
        }
        new Listener("play next song", () => {
            gameChat.systemMessage(`===== ROUND ${gameRound} =====`)
            this.songStartTime = Date.now()
            this.playerTimes = []
            gameRound++
        }).bindListener()

        new Listener("player answered", (data) => {
            const time = Date.now() - this.songStartTime
            data.forEach(gamePlayerId => {
                const quizPlayer = that.players[gamePlayerId]
                this.playerTimes.push({
                    "gamePlayerId": gamePlayerId,
                    "time": time.toPrecision(3),
                    "date": Date.now(),
                    'name': quizPlayer._name
                })

                //Deletes duplicate entry and leaves only the newest one
                if (isDuplicate(this.playerTimes) === true) {
                    for (var i = 0; i <= this.playerTimes.length - 1; i++) {
                        let tmp = this.playerTimes[i].gamePlayerId;
                        if (tmp === gamePlayerId) {
                            delete this.playerTimes[i].date
                            delete this.playerTimes[i].gamePlayerId
                            delete this.playerTimes[i].time
                            delete this.playerTimes[i].name
                            this.playerTimes = this.playerTimes.filter(
                                obj => !(obj && Object.keys(obj).length === 0 && obj.constructor === Object)
                            );
                            break;
                        }
                    }
                }

                //Helper function to code above
                function isDuplicate(values) {
                    var valueArr = values.map(function (item) { return item.gamePlayerId });
                    var isDuplicate = valueArr.some(function (item, idx) {
                        return valueArr.indexOf(item) != idx
                    });
                    return isDuplicate
                }

                //Sort object by time (faster is first)
                this.playerTimes = this.playerTimes.sort(compare)
            })
        }).bindListener()

        new Listener("Join Game", (data) => {
            const quizState = data.quizState;
            if (quizState) {
                this.songStartTime = Date.now() - quizState.songTimer * 1000
            }
        }).bindListener()
    }()

    new Listener("Game Starting", ({ players }) => {
        fastestLeaderboard = [];
        ignoredPlayerIds = [];
        leader = null;
        newLeader = null;
        playerID = null;
        gameRound = 1;
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

    //On player answering the quiz question
    new Listener("player answered", (data) => {
        //Display timer
        data.filter(gamePlayerId => !ignoredPlayerIds.includes(gamePlayerId)).forEach(gamePlayerId => {
            //Make sure the '⚡' symbol will always follow the fasteset player and update other players accordingly

            //Make sure we are editing the right player
            for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId !== gamePlayerId) {
                    continue;
                } else {
                    //If player is already the leader pass the '⚡' to the second fastest player
                    if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId === leader) {
                        newLeader = amqAnswerTimesUtility.playerTimes[0].gamePlayerId;
                        for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                            if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                                quiz.players[newLeader].answer = `⚡ ${amqAnswerTimesUtility.playerTimes[i].time}ms`
                                leader = newLeader;
                                //Update other players accordingly
                            } else {
                                if (playerID === leader) continue;
                                quiz.players[gamePlayerId].answer = `+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms`
                            }
                        }
                        //If the leader is yet to be chosen
                    } else {
                        if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                            quiz.players[gamePlayerId].answer = `⚡ ${amqAnswerTimesUtility.playerTimes[i].time}ms`
                            leader = gamePlayerId;
                            //Everything else
                        } else {
                            quiz.players[gamePlayerId].answer = `+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms`
                        }
                    }
                }
            }
        })
    }).bindListener()

    //On pre-show-answer phase
    quiz._playerAnswerListner = new Listener(
        "player answers",
        function (data) {
            const that = quiz
            let limiter = 0;
            //Display answer and timer simultaneously
            data.answers.forEach((answer) => {
                const quizPlayer = that.players[answer.gamePlayerId]
                let answerText = answer.answer
                //Make sure we are getting the right player
                for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                    if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId !== quizPlayer.gamePlayerId) {
                        continue;
                    } else {
                        if (amqAnswerTimesUtility.playerTimes[i] !== undefined) {
                            if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                                answerText = `⚡ ${answerText} (${amqAnswerTimesUtility.playerTimes[i].time}ms)`
                            } else {
                                answerText += ` (+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms)`
                            }
                        }
                    }
                }

                quizPlayer.answer = answerText
                quizPlayer.unknownAnswerNumber = answer.answerNumber
                quizPlayer.toggleTeamAnswerSharing(false)
                limiter++
            })

            if (!that.isSpectator) {
                that.answerInput.showSubmitedAnswer()
                that.answerInput.resetAnswerState()
            }

            that.videoTimerBar.updateState(data.progressBarState)
        }
    )
    //On show answer phase
    function answerResults(results) {
        let limiter = 0,
            correctIds = [],
            displayPlayers = [];
        //Get only those who answered correctly
        const correctPlayers = results.players
            .filter(player => player.correct)
        for (let i = 0; i < correctPlayers.length; i++) {
            correctIds.push(correctPlayers[i].gamePlayerId)
        }

        //add them into 'displayPlayers' array
        for (let i = 0; i <= correctIds.length - 1; i++) {
            displayPlayers.push(amqAnswerTimesUtility.playerTimes.find(item => item.gamePlayerId === correctIds[i]))
        }

        //If no one got the question right, display all the scores
        //Otherwise show only those who answered correctly
        if (displayPlayers.length > 0) {

            displayPlayers = displayPlayers.sort(compare)

            for (let i = 0; i < displayPlayers.length; i++) {
                if (limiter < 10) {
                    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

                    if (limiter === 0) {
                        fastestLeaderboard.push({
                            "name": displayPlayers[0].name,
                            'time': displayPlayers[0].time,
                            'round': gameRound - 1
                        })
                        summedUpLeaderBoard = mergeArray(fastestLeaderboard)
                        console.log(summedUpLeaderBoard)
                        gameChat.systemMessage(`⚡ ${displayPlayers[0].name} 🡆 ${displayPlayers[0].time}ms`);
                    } else {
                        fastestLeaderboard.push({
                            "name": displayPlayers[limiter].name,
                            'time': displayPlayers[limiter].time,
                            'round': gameRound - 1
                        })
                        summedUpLeaderBoard = mergeArray(fastestLeaderboard)
                        console.log(summedUpLeaderBoard)
                        gameChat.systemMessage(`${placeNumber[limiter]} ${displayPlayers[limiter].name} 🡆 +${displayPlayers[limiter].time - displayPlayers[0].time}ms`);
                    }
                }
                limiter++
            }
        } else if (amqAnswerTimesUtility.playerTimes.length === 0) {
            gameChat.systemMessage(`Not even trying? I see...`);
        } else {
            gameChat.systemMessage(`You are all terrible at this...`);
        }
    }

    function quizEndResult(results) {
        fastestLeaderboard = fastestLeaderboard.sort(compare)
        gameChat.systemMessage(`===== FINAL RESULTS =====`)
        //If you want the "per player" behaviour uncomment 4 following lines and comment the other
        /*         for (let i = 0; i < fastestLeaderboard.length; i++) {
                    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
                    gameChat.systemMessage(`${placeNumber[i]} ${fastestLeaderboard[i].name} 🡆 ${fastestLeaderboard[i].time}ms (R${fastestLeaderboard[i].round})`);
                } */

        //Display leaderboard, player's scores are summed up
        summedUpLeaderBoard = mergeArray(fastestLeaderboard)
        for (let i = 0; i < summedUpLeaderBoard.length; i++) {
            let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
            gameChat.systemMessage(`${placeNumber[i]} ${summedUpLeaderBoard[i].name} 🡆 ${summedUpLeaderBoard[i].time}ms`);
        }
    }

    //Initialize listeners and 'Installed Userscripts' menu
    function setup() {
        new Listener("answer results", answerResults).bindListener();
        new Listener("quiz end result", quizEndResult).bindListener();
        AMQ_addScriptData({
            name: "AMQ Player Answer Time Diference (hidden)",
            author: "4Lajf (forked from Zolhungaj)",
            description: `<sends system messages only visible for you> Displays time diference in seconds between the fastest player and the rest, then and the end of the round sends results in chat. Send to chat the final leaderboard once the game ends`
        });
    }

})();
