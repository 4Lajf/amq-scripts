// ==UserScript==
// @name         AMQ Player Answer Time Difference
// @namespace    http://tampermonkey.net/
// @version      1.6.3
// @description  Makes you able to see how quickly people answered and the difference between the first player and everyone else, sends the result on chat at the end of a round and sends some stats at the end of the game
// @author       4Lajf (forked from Zolhungaj)
// @match        https://animemusicquiz.com/*
// @grant        none
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/main/amqAnswerTimeDifference.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/main/amqAnswerTimeDifference.user.js
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==

/* KNOWN BUG######################################################################################################### KNOWN BUG */
/* IF PLAYER GETS ANSWER WRONG IT ADDS [ROUND_LENGTH_TIME] (AS IT SHOULD) TO THEIR ANSWER TIME BUT NOT WHEN THE ANSWER IS EMPTY */
/* KNOWN BUG######################################################################################################### KNOWN BUG */

(() => {
    // don't load on login page
    if (document.getElementById("startPage")) return;

    // Wait until the LOADING... screen is hidden and load script
    let loadInterval = setInterval(() => {
        if (document.getElementById("loadingScreen").classList.contains("hidden")) {
            setup();
            clearInterval(loadInterval);
        }
    }, 500);

    let settingsData = [
        {
            containerId: "smTimeDifferenceOptions",
            title: "Time Difference Options",
            data: [
                {
                    label: "Enable Plugin",
                    id: "smTimeDifference",
                    popover: "Toggles TimeDifference",
                    enables: ["smTimeDifferenceChat", "smTimeDifferenceChatHidden", "smTimeDifferenceChatSilent", "smTimeDifferenceTimes", "smTimeDifferenceRoundLeaderboard", "smTimeDifferenceGameLeaderboard"],
                    offset: 0,
                    default: true,
                },
                {
                    label: "Write times to chat",
                    id: "smTimeDifferenceChat",
                    popover: "Send song's leaderboard at the end of each round",
                    unchecks: ["smTimeDifferenceChatHidden", "smTimeDifferenceChatSilent"],
                    offset: 1,
                    default: false,
                },
                {
                    label: "Write times to chat (only you)",
                    id: "smTimeDifferenceChatHidden",
                    popover: "Send song's leaderboard at the end of each round, but only you can see those messages",
                    unchecks: ["smTimeDifferenceChat", "smTimeDifferenceChatSilent"],
                    offset: 1,
                    default: true,
                },
                {
                    label: "Don't Write times to chat",
                    id: "smTimeDifferenceChatSilent",
                    popover: "Send song's leaderboard to chat",
                    unchecks: ["smTimeDifferenceChat", "smTimeDifferenceChatHidden"],
                    offset: 1,
                    default: false,
                },
                {
                    label: "Round's leaderboard",
                    id: "smTimeDifferenceRoundLeaderboard",
                    popover: "Toggles sending round's leaderboard to chat",
                    offset: 2,
                    default: true,
                },
                {
                    label: "Game's leaderboard",
                    id: "smTimeDifferenceGameLeaderboard",
                    popover: "Toggles sending game's leaderboard to chat",
                    offset: 2,
                    default: true,
                },
                {
                    label: "Time Differences",
                    id: "smTimeDifferenceTimes",
                    popover: "Toggle time differences at a place of player's answer",
                    offset: 1,
                    default: true,
                },
            ],
        },
    ];

    // Create the "TimeDifference" tab in settings
    $("#settingModal .tabContainer").append($("<div></div>").addClass("tab leftRightButtonTop clickAble").attr("onClick", "options.selectTab('timeDifferenceSettings', this)").append($("<h5></h5>").text("TimeDifference")));

    // Create a separate container for TimeDifference settings
    $("#settingModal .modal-body").append($("<div></div>").attr("id", "timeDifferenceSettings").addClass("settingContentContainer hide").append($("<div></div>").addClass("row")));

    // Create the checkboxes
    for (let setting of settingsData) {
        $("#timeDifferenceSettings > .row").append(
            $("<div></div>")
                .addClass("col-xs-6")
                .attr("id", setting.containerId)
                .append($("<div></div>").attr("style", "text-align: center").append($("<label></label>").text(setting.title)))
        );
        for (let data of setting.data) {
            $("#" + setting.containerId).append(
                $("<div></div>")
                    .addClass("customCheckboxContainer")
                    .addClass(data.offset !== 0 ? "offset" + data.offset : "")
                    .addClass(data.offset !== 0 ? "disabled" : "")
                    .append(
                        $("<div></div>")
                            .addClass("customCheckbox")
                            .append($("<input id='" + data.id + "' type='checkbox'>").prop("checked", data.default !== undefined ? data.default : false))
                            .append($("<label for='" + data.id + "'><i class='fa fa-check' aria-hidden='true'></i></label>"))
                    )
                    .append($("<label></label>").addClass("customCheckboxContainerLabel").text(data.label))
            );
            if (data.popover !== undefined) {
                $("#" + data.id)
                    .parent()
                    .parent()
                    .find("label:contains(" + data.label + ")")
                    .attr("data-toggle", "popover")
                    .attr("data-content", data.popover)
                    .attr("data-trigger", "hover")
                    .attr("data-html", "true")
                    .attr("data-placement", "top")
                    .attr("data-container", "#settingModal");
            }
        }
    }

    // Modify the options object to handle the new tab
    if (!options.oldSelectTab) {
        options.oldSelectTab = options.selectTab;
        options.selectTab = function (newTab, tabObject) {
            // Hide all setting containers
            $("#settingModal .settingContentContainer").addClass("hide");

            // Show the selected container
            $("#" + newTab).removeClass("hide");

            // Update tab selection
            $("#settingModal .tab").removeClass("selected");
            $(tabObject).addClass("selected");
        };
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
                        } else {
                            $(this).prop("checked", true);
                        }
                    });
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
        } else {
            for (let enableId of current.enables) {
                if (
                    $("#" + current.id).prop("checked") &&
                    !$("#" + current.id)
                        .parent()
                        .parent()
                        .hasClass("disabled")
                ) {
                    $("#" + enableId)
                        .parent()
                        .parent()
                        .removeClass("disabled");
                } else {
                    $("#" + enableId)
                        .parent()
                        .parent()
                        .addClass("disabled");
                }
                updateEnabled(enableId);
            }
        }
    }

    //sort object by time (fastest first)
    function compare(a, b) {
        return a.time - b.time;
    }

    function mergeArray(data) {
        return [...data].reduce((acc, val) => {
            let { time, name } = val;
            time = parseFloat(time);
            const ind = acc.findIndex((el) => el.name === name);
            if (ind !== -1) {
                acc[ind].time += time;
            } else {
                acc.push({ time, name });
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
            type: "lobby",
            command: "game chat message",
            data: { msg: message, teamMessage: false },
        });
    }

    //Measure answer speed
    const amqAnswerTimesUtility = new (function () {
        "use strict";
        this.songStartTime = 0;
        this.playerTimes = [];
        const that = quiz;
        if (typeof Listener === "undefined") {
            return;
        }

        new Listener("play next song", () => {
            if ($("#smTimeDifference").prop("checked")) {
                if (!$("#smTimeDifferenceChatSilent").prop("checked")) {
                    let gameRound = parseInt($("#qpCurrentSongCount").text()) + 1;
                    if ($("#smTimeDifferenceRoundLeaderboard").prop("checked")) {
                        const message = `===== ROUND ${gameRound} =====`;
                        if ($("#smTimeDifferenceChatHidden").prop("checked")) {
                            gameChat.systemMessage(message);
                        } else {
                            sendLobbyMessage(message);
                        }
                    }
                }
                this.songStartTime = Date.now();
                this.playerTimes = [];
            }
        }).bindListener();

        new Listener("player answered", (data) => {
            if ($("#smTimeDifference").prop("checked")) {
                const time = Date.now() - this.songStartTime;
                data.forEach((gamePlayerId) => {
                    const quizPlayer = that.players[gamePlayerId];
                    this.playerTimes.push({
                        gamePlayerId: gamePlayerId,
                        time: time,
                        date: Date.now(),
                        name: quizPlayer._name,
                    });

                    // Deletes duplicate entry and leaves only the newest one
                    if (isDuplicate(this.playerTimes)) {
                        for (let i = 0; i < this.playerTimes.length; i++) {
                            if (this.playerTimes[i].gamePlayerId === gamePlayerId) {
                                this.playerTimes.splice(i, 1);
                                break;
                            }
                        }
                    }

                    // Sort object by time (faster is first)
                    this.playerTimes.sort(compare);
                });
            }
        }).bindListener();

        new Listener("Join Game", (data) => {
            const quizState = data.quizState;
            if (quizState) {
                this.songStartTime = Date.now() - quizState.songTimer * 1000;
            }
        }).bindListener();

        new Listener("Spectate Game", (data) => {
            const quizState = data.quizState;
            if (quizState) {
                this.songStartTime = Date.now() - quizState.songTimer * 1000;
            }
        }).bindListener();

        // Helper function to check for duplicates
        function isDuplicate(values) {
            const valueArr = values.map((item) => item.gamePlayerId);
            return valueArr.some((item, idx) => valueArr.indexOf(item) != idx);
        }

        // Comparison function for sorting
        function compare(a, b) {
            return a.time - b.time;
        }
    })();

    new Listener("Game Starting", ({ players }) => {
        if ($("#smTimeDifference").prop("checked")) {
            fastestLeaderboard = [];
            ignoredPlayerIds = [];
            leader = null;
            newLeader = null;
            playerID = null;
            gameRound = 1;
            const self = players.find((player) => player.name === selfName);
            if (self) {
                const teamNumber = self.teamNumber;
                if (teamNumber) {
                    const teamMates = players.filter((player) => player.teamNumber === teamNumber);
                    if (teamMates.length > 1) {
                        ignoredPlayerIds = teamMates.map((player) => player.gamePlayerId);
                    }
                }
            }
        }
    }).bindListener();

    //On player answering the quiz question
    new Listener("player answered", (data) => {
        if ($("#smTimeDifference").prop("checked") === true && $("#smTimeDifferenceTimes").prop("checked") === true) {
            //Display timer
            data.filter((gamePlayerId) => !ignoredPlayerIds.includes(gamePlayerId)).forEach((gamePlayerId) => {
                //Make sure the '⚡' symbol will always follow the fastest player and update other players accordingly

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
                                    quiz.players[newLeader].answer = `⚡ ${amqAnswerTimesUtility.playerTimes[i].time}ms`;
                                    leader = newLeader;
                                    //Update other players accordingly
                                } else {
                                    if (playerID === leader) continue;
                                    quiz.players[gamePlayerId].answer = `+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms`;
                                }
                            }
                            //If the leader is yet to be chosen
                        } else {
                            if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                                quiz.players[gamePlayerId].answer = `⚡ ${amqAnswerTimesUtility.playerTimes[i].time}ms`;
                                leader = gamePlayerId;
                                //Everything else
                            } else {
                                quiz.players[gamePlayerId].answer = `+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms`;
                            }
                        }
                    }
                }
            });
        }
    }).bindListener();

    //On pre-show-answer phase
    quiz._playerAnswerListner = new Listener("player answers", function (data) {
        const that = quiz;
        if ($("#smTimeDifference").prop("checked") === true && $("#smTimeDifferenceTimes").prop("checked") === true) {
            data.answers.forEach((answer) => {
                const quizPlayer = that.players[answer.gamePlayerId];
                let answerText = answer.answer;
                //Make sure we are getting the right player
                for (let i = 0; i < amqAnswerTimesUtility.playerTimes.length; i++) {
                    if (amqAnswerTimesUtility.playerTimes[i].gamePlayerId !== quizPlayer.gamePlayerId) {
                        continue;
                    } else {
                        if (amqAnswerTimesUtility.playerTimes[i] !== undefined) {
                            if (amqAnswerTimesUtility.playerTimes[i].time === amqAnswerTimesUtility.playerTimes[0].time) {
                                answerText = `⚡ ${answerText} (${amqAnswerTimesUtility.playerTimes[i].time}ms)`;
                            } else {
                                answerText += ` (+${amqAnswerTimesUtility.playerTimes[i].time - amqAnswerTimesUtility.playerTimes[0].time}ms)`;
                            }
                        }
                    }
                }

                quizPlayer.answer = answerText;
                quizPlayer.unknownAnswerNumber = answer.answerNumber;
                quizPlayer.toggleTeamAnswerSharing(false);
            });

            if (!that.isSpectator) {
                that.answerInput.showSubmitedAnswer();
                that.answerInput.resetAnswerState();
            }

            that.videoTimerBar.updateState(data.progressBarState);
            quizVideoController.checkForBufferingIssue();
        } else {
            data.answers.forEach((answer) => {
                const quizPlayer = that.players[answer.gamePlayerId];
                let answerText = answer.answer;
                quizPlayer.answer = answerText;
                quizPlayer.unknownAnswerNumber = answer.answerNumber;
                quizPlayer.toggleTeamAnswerSharing(false);
            });
        }

        if (!that.isSpectator) {
            that.answerInput.showSubmitedAnswer();
            that.answerInput.resetAnswerState();
            if (that.hintGameMode) {
                that.hintController.hide();
            }
        }

        that.videoTimerBar.updateState(data.progressBarState);
        quizVideoController.checkForBufferingIssue();
    });

    //On show answer phase
    function answerResults(results) {
        let gameRound = parseInt($("#qpCurrentSongCount").text()) + 1;
        if ($("#smTimeDifference").prop("checked") && !$("#smTimeDifferenceChatSilent").prop("checked") && $("#smTimeDifferenceRoundLeaderboard").prop("checked")) {
            let correctIds = results.players.filter((player) => player.correct).map((player) => player.gamePlayerId);
            let displayPlayers = [];

            amqAnswerTimesUtility.playerTimes.forEach((player) => {
                const isCorrect = correctIds.includes(player.gamePlayerId);
                const time = isCorrect ? player.time : quiz.nextSongPlayLength * 1000;

                fastestLeaderboard.push({
                    name: player.name,
                    time: time,
                    round: gameRound - 1,
                    correct: isCorrect,
                });

                if (isCorrect) {
                    displayPlayers.push({ ...player, time: time });
                }
            });

            displayPlayers.sort(compare);

            if (displayPlayers.length > 0) {
                let placeNumber = ["⚡", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
                displayPlayers.slice(0, 10).forEach((player, index) => {
                    let message = index === 0 ? `⚡ ${player.name} ➔ ${player.time}ms` : `${placeNumber[index]} ${player.name} ➔ +${player.time - displayPlayers[0].time}ms`;

                    if ($("#smTimeDifferenceChatHidden").prop("checked")) {
                        gameChat.systemMessage(message);
                    } else {
                        sendLobbyMessage(message);
                    }
                });
            } else if (amqAnswerTimesUtility.playerTimes.length === 0) {
                let message = "Not even trying? I see...";
                $("#smTimeDifferenceChatHidden").prop("checked") ? gameChat.systemMessage(message) : sendLobbyMessage(message);
            } else {
                let message = "You are all terrible at this...";
                $("#smTimeDifferenceChatHidden").prop("checked") ? gameChat.systemMessage(message) : sendLobbyMessage(message);
            }
        }
        console.log(fastestLeaderboard);
    }

    function quizEndResult(results) {
        if ($("#smTimeDifference").prop("checked") && $("#smTimeDifferenceGameLeaderboard").prop("checked")) {
            let placeNumber = ["⚡", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

            // Sort fastestLeaderboard by time
            fastestLeaderboard.sort(compare);

            // Display fastest correct answers
            let correctAnswers = fastestLeaderboard.filter((entry) => entry.correct).slice(0, 10);

            let fastestMessage = "===== FASTEST ANSWERS =====\n" + correctAnswers.map((entry, index) => `${placeNumber[index]} ${entry.name} ➔ ${entry.time}ms (R${entry.round})`).join("\n");

            // Calculate and display summed up times (including all answers)
            let summedUpLeaderBoard = mergeArray(fastestLeaderboard);
            summedUpLeaderBoard.sort((a, b) => a.time - b.time);

            let summedMessage =
                "===== SUMMED UP TIMES =====\n" +
                summedUpLeaderBoard
                    .slice(0, 10)
                    .map((entry, index) => `${placeNumber[index]} ${entry.name} ➔ ${entry.time}ms`)
                    .join("\n");

            if ($("#smTimeDifferenceChatHidden").prop("checked")) {
                gameChat.systemMessage(fastestMessage);
                gameChat.systemMessage(summedMessage);
            } else {
                sendLobbyMessage(fastestMessage);
                sendLobbyMessage(summedMessage);
            }
        }
    }

    //Initialize listeners and 'Installed Userscripts' menu
    function setup() {
        new Listener("answer results", answerResults).bindListener();
        new Listener("quiz end result", quizEndResult).bindListener();
        AMQ_addScriptData({
            name: "AMQ Player Answer Time Difference",
            author: "4Lajf (forked from Zolhungaj)",
            version: "1.6",
            description: `Displays time difference in milliseconds between the fastest player and the rest, then at the end of the round sends results in chat. Sends the final leaderboard to chat once the game ends.`,
        });
    }
})();
