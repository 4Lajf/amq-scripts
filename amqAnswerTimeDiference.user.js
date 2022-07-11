// ==UserScript==
// @name         AMQ Player Answer Time Diference
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Makes you able to see how quickly people answered and the diference beetween the first player and everyone else, sends the result on chat at the end of a round and sends some stats and the end of the game
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

    let settingsData = [
        {
            containerId: "smTimeDiferenceOptions",
            title: "Time Diference Options",
            data: [
                {
                    label: "Enable Plugin",
                    id: "smTimeDiference",
                    popover: "Toggles TimeDiference",
                    enables: ["smTimeDiferenceChat", "smTimeDiferenceChatHidden", "smTimeDiferenceChatSilent", "smTimeDiferenceTimes", "smTimeDiferenceRoundLeaderboard", "smTimeDiferenceGameLeaderboard"],
                    offset: 0,
                    default: true
                },
                {
                    label: "Write times to chat",
                    id: "smTimeDiferenceChat",
                    popover: "Sends song's and quiz's leaderboard at the end of each one",
                    unchecks: ["smTimeDiferenceChatHidden", "smTimeDiferenceChatSilent"],
                    offset: 1,
                    default: false
                },
                {
                    label: "Write times to chat (only you)",
                    id: "smTimeDiferenceChatHidden",
                    popover: "Sends song's and quiz's leaderboard at the end of each one, but only you can see that messages",
                    unchecks: ["smTimeDiferenceChat", "smTimeDiferenceChatSilent"],
                    offset: 1,
                    default: true,
                },
                {
                    label: "Don't Write times to chat",
                    id: "smTimeDiferenceChatSilent",
                    popover: "Disables Sending song's and quiz's leaderboard to chat",
                    unchecks: ["smTimeDiferenceChat", "smTimeDiferenceChatHidden"],
                    offset: 1,
                    default: false,
                },
                {
                    label: "Round's leaderboard",
                    id: "smTimeDiferenceRoundLeaderboard",
                    popover: "Toggles sending round's leaderboard to chat",
                    offset: 2,
                    default: true
                },
                {
                    label: "Game's leaderboard",
                    id: "smTimeDiferenceGameLeaderboard",
                    popover: "Toggles sending game's leaderboard to chat",
                    offset: 2,
                    default: true
                },
                {
                    label: "Time Diferences",
                    id: "smTimeDiferenceTimes",
                    popover: "Toggle time diferences at the place of player's answer",
                    offset: 1,
                    default: true
                },
            ]
        },
    ];

    // Create the "TimeDiference" tab in settings
    $("#settingModal .tabContainer")
        .append($("<div></div>")
            .addClass("tab leftRightButtonTop clickAble")
            .attr("onClick", "options.selectTab('settingsCustomContainer', this)")
            .append($("<h5></h5>")
                .text("TimeDiference")
            )
        );

    // Create the body base
    $("#settingModal .modal-body")
        .append($("<div></div>")
            .attr("id", "settingsCustomContainer")
            .addClass("settingContentContainer hide")
            .append($("<div></div>")
                .addClass("row")
            )
        );


    // Create the checkboxes
    for (let setting of settingsData) {
        $("#settingsCustomContainer > .row")
            .append($("<div></div>")
                .addClass("col-xs-6")
                .attr("id", setting.containerId)
                .append($("<div></div>")
                    .attr("style", "text-align: center")
                    .append($("<label></label>")
                        .text(setting.title)
                    )
                )
            );
        for (let data of setting.data) {
            $("#" + setting.containerId)
                .append($("<div></div>")
                    .addClass("customCheckboxContainer")
                    .addClass(data.offset !== 0 ? "offset" + data.offset : "")
                    .addClass(data.offset !== 0 ? "disabled" : "")
                    .append($("<div></div>")
                        .addClass("customCheckbox")
                        .append($("<input id='" + data.id + "' type='checkbox'>")
                            .prop("checked", data.default !== undefined ? data.default : false)
                        )
                        .append($("<label for='" + data.id + "'><i class='fa fa-check' aria-hidden='true'></i></label>"))
                    )
                    .append($("<label></label>")
                        .addClass("customCheckboxContainerLabel")
                        .text(data.label)
                    )
                );
            if (data.popover !== undefined) {
                $("#" + data.id).parent().parent().find("label:contains(" + data.label + ")")
                    .attr("data-toggle", "popover")
                    .attr("data-content", data.popover)
                    .attr("data-trigger", "hover")
                    .attr("data-html", "true")
                    .attr("data-placement", "top")
                    .attr("data-container", "#settingModal")
            }
        }
    }

    // Update the enabled and checked checkboxes
    for (let setting of settingsData) {
        for (let data of setting.data) {
            updateEnabled(data.id);
            $("#" + data.id).click(function () {
                updateEnabled(data.id);
                if (data.unchecks !== undefined) {
                    data.unchecks.forEach((settingId) => {
                        if ($(this).prop("checked")) {
                            $("#" + settingId).prop("checked", false);
                        }
                        else {
                            $(this).prop("checked", true);
                        }
                    })
                }
            });
        }
    }

    // Updates the enabled checkboxes, checks each node recursively
    function updateEnabled(settingId) {
        let current;
        settingsData.some((setting) => {
            current = setting.data.find((data) => {
                return data.id === settingId;
            });
            return current !== undefined;
        });
        if (current === undefined) {
            return;
        }
        if (current.enables === undefined) {
            return;
        }
        else {
            for (let enableId of current.enables) {
                if ($("#" + current.id).prop("checked") && !$("#" + current.id).parent().parent().hasClass("disabled")) {
                    $("#" + enableId).parent().parent().removeClass("disabled");
                }
                else {
                    $("#" + enableId).parent().parent().addClass("disabled");
                }
                updateEnabled(enableId);
            }
        }
    }

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

    let ignoredPlayerIds = [],
        fastestLeaderboard = null,
        fastestLeaderboardToSum,
        leader = null,
        newLeader,
        playerID,
        gameRound,
        summedUpLeaderBoard;

    //Sends a message to lobby chat
    function sendLobbyMessage(message) {
        socket.sendCommand({
            type: 'lobby',
            command: 'game chat message',
            data: { msg: message, teamMessage: false }
        });
    }

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
            if ($("#smTimeDiference").prop("checked")) {
                if ($("#smTimeDiferenceChatSilent").prop("checked")) {
                    //Do nothing
                } else {
                    if ($("#smTimeDiferenceRoundLeaderboard").prop("checked")) {
                        if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                            gameChat.systemMessage(`===== ROUND ${gameRound} =====`)
                        } else {
                            sendLobbyMessage(`===== ROUND ${gameRound} =====`)
                        }
                    }
                }
                this.songStartTime = Date.now()
                this.playerTimes = []
                gameRound++
            }
        }).bindListener()

        new Listener("player answered", (data) => {
            if ($("#smTimeDiference").prop("checked")) {
                const time = Date.now() - this.songStartTime
                data.forEach(gamePlayerId => {
                    const quizPlayer = that.players[gamePlayerId]
                    this.playerTimes.push({
                        "gamePlayerId": gamePlayerId,
                        "time": time,
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
            }
        }).bindListener()

        new Listener("Join Game", (data) => {
            if ($("#smTimeDiference").prop("checked")) {
                console.log('joinGame',data)
                const quizState = data.quizState;
                if (quizState) {
                    this.songStartTime = Date.now() - quizState.songTimer * 1000
                }
                fastestLeaderboard = [];
                ignoredPlayerIds = [];
                leader = null;
                newLeader = null;
                playerID = null;
                gameRound = quizState.songNumber + 1;
                const self = quizState.players.find(player => player.name === selfName)
                if (self) {
                    const teamNumber = self.teamNumber
                    if (teamNumber) {
                        const teamMates = quizState.players.filter(player => player.teamNumber === teamNumber)
                        if (teamMates.length > 1) {
                            ignoredPlayerIds = teamMates.map(player => player.gamePlayerId)
                        }
                    }
                }
            }
        }).bindListener()

        new Listener("New Spectator", (data) => {
            if ($("#smTimeDiference").prop("checked")) {
                console.log('specJoin',data)
                const quizState = data.quizState;
                if (quizState) {
                    this.songStartTime = Date.now() - quizState.songTimer * 1000
                }
                fastestLeaderboard = [];
                ignoredPlayerIds = [];
                leader = null;
                newLeader = null;
                playerID = null;
                gameRound = quizState.songNumber + 1;
                const self = quizState.players.find(player => player.name === selfName)
                if (self) {
                    const teamNumber = self.teamNumber
                    if (teamNumber) {
                        const teamMates = quizState.players.filter(player => player.teamNumber === teamNumber)
                        if (teamMates.length > 1) {
                            ignoredPlayerIds = teamMates.map(player => player.gamePlayerId)
                        }
                    }
                }
            }
        }).bindListener()
    }()

    new Listener("Game Starting", ({ players }) => {
        if ($("#smTimeDiference").prop("checked")) {
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
        }
    }).bindListener()

    //On player answering the quiz question
    new Listener("player answered", (data) => {
        if ($("#smTimeDiference").prop("checked") === true && $("#smTimeDiferenceTimes").prop("checked") === true) {
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
        }
    }).bindListener()

    //On pre-show-answer phase
    quiz._playerAnswerListner = new Listener(
        "player answers",
        function (data) {
            const that = quiz
            if ($("#smTimeDiference").prop("checked") === true && $("#smTimeDiferenceTimes").prop("checked") === true) {
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
            } else {
                data.answers.forEach((answer) => {
                    const quizPlayer = that.players[answer.gamePlayerId]
                    let answerText = answer.answer
                    quizPlayer.answer = answerText
                    quizPlayer.unknownAnswerNumber = answer.answerNumber
                    quizPlayer.toggleTeamAnswerSharing(false)
                })
            }
        }
    )
    //On show answer phase
    function answerResults(results) {
        if ($("#smTimeDiference").prop("checked")) {
            if ($("#smTimeDiferenceChatSilent").prop("checked")) {
                return;
            } else {
                if ($("#smTimeDiferenceRoundLeaderboard").prop("checked")) {
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
                                    if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                                        gameChat.systemMessage(`⚡ ${displayPlayers[0].name} 🡆 ${displayPlayers[0].time}ms`);
                                    } else {
                                        sendLobbyMessage(`⚡ ${displayPlayers[0].name} 🡆 ${displayPlayers[0].time}ms`);
                                    }
                                } else {
                                    fastestLeaderboard.push({
                                        "name": displayPlayers[limiter].name,
                                        'time': displayPlayers[limiter].time,
                                        'round': gameRound - 1
                                    })
                                    summedUpLeaderBoard = mergeArray(fastestLeaderboard)

                                    if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                                        gameChat.systemMessage(`${placeNumber[limiter]} ${displayPlayers[limiter].name} 🡆 +${displayPlayers[limiter].time - displayPlayers[0].time}ms`);
                                    } else {
                                        sendLobbyMessage(`${placeNumber[limiter]} ${displayPlayers[limiter].name} 🡆 +${displayPlayers[limiter].time - displayPlayers[0].time}ms`);
                                    }
                                }
                            }
                            limiter++
                        }
                    } else if (amqAnswerTimesUtility.playerTimes.length === 0) {
                        if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                            gameChat.systemMessage(`Not even trying? I see...`);
                        } else {
                            sendLobbyMessage(`Not even trying? I see...`);
                        }
                    } else {
                        if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                            gameChat.systemMessage(`You are all terrible at this...`);
                        } else {
                            sendLobbyMessage(`You are all terrible at this...`);
                        }
                    }
                }
            }
        }
    }

    function quizEndResult(results) {
        if ($("#smTimeDiference").prop("checked")) {
            if ($("#smTimeDiferenceChatSilent").prop("checked")) {
                //Do nothing
            } else {
                if ($("#smTimeDiferenceRoundLeaderboard").prop("checked")) {
                    let placeNumber = ['⚡', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
                    fastestLeaderboard = fastestLeaderboard.sort(compare)
                    fastestLeaderboardToSum = fastestLeaderboard
                    let limiter = 0;
                    if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                        gameChat.systemMessage(`===== FASTEST ANSWERS =====`)
                        for (let i = 0; i <= fastestLeaderboard.length - 1; i++) {
                            if (limiter > 9) break;
                            gamechat.systemMessage(`${placeNumber[i]} ${fastestLeaderboard[i].name} 🡆 ${fastestLeaderboard[i].time}ms (R${fastestLeaderboard[i].round})`);
                            limiter++
                        }
                    } else {
                        sendLobbyMessage(`===== FASTEST ANSWERS =====`)
                        for (let i = 0; i <= fastestLeaderboard.length - 1; i++) {
                            if (limiter > 9) break;
                            sendLobbyMessage(`${placeNumber[i]} ${fastestLeaderboard[i].name} 🡆 ${fastestLeaderboard[i].time}ms (R${fastestLeaderboard[i].round})`);
                            limiter++
                        }
                    }

                    //Display leaderboard, player's scores are summed up
                    summedUpLeaderBoard = mergeArray(fastestLeaderboardToSum)

                    if ($("#smTimeDiferenceChatHidden").prop("checked")) {
                        gameChat.systemMessage(`===== SUMMED UP TIMES =====`)
                        for (let i = 0; i <= fastestLeaderboard.length - 1; i++) {
                            if (limiter > 9) break;
                            gamechat.systemMessage(`${placeNumber[i]} ${summedUpLeaderBoard[i].name} 🡆 ${summedUpLeaderBoard[i].time}ms`);
                            limiter++
                        }
                    } else {
                        sendLobbyMessage(`===== SUMMED UP TIMES =====`)
                        for (let i = 0; i <= fastestLeaderboard.length - 1; i++) {
                            if (limiter > 9) break;
                            sendLobbyMessage(`${placeNumber[i]} ${summedUpLeaderBoard[i].name} 🡆 ${summedUpLeaderBoard[i].time}ms`);
                            limiter++
                        }
                    }
                }
            }
        }
    }

    //Initialize listeners and 'Installed Userscripts' menu
    function setup() {
        new Listener("answer results", answerResults).bindListener();
        new Listener("quiz end result", quizEndResult).bindListener();
        AMQ_addScriptData({
            name: "AMQ Player Answer Time Diference",
            author: "4Lajf (forked from Zolhungaj)",
            description: `Displays time diference in seconds between the fastest player and the rest, then and the end of the round sends results in chat. Send to chat the final leaderboard once the game ends`
        });
    }

})();
