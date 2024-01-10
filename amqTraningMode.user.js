// ==UserScript==
// @name         AMQ Training Mode (CSL)
// @namespace    https://github.com/4Lajf
// @version      0.1.0
// @description  Extended version of kempanator's Custom Song List Game Training mode allows you to practice your songs efficiently something line anki or other memory card software. It's goal is to give you songs that you don't recozniged mixed with some songs that you do recognize to solidify them in your memory.
// @match        https://animemusicquiz.com/*
// @author       4Lajf & kempanator
// @grant        none
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// @downloadURL  https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js
// @updateURL    https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js
// ==/UserScript==

/*
How to start a custom song list game:
  1. create a solo lobby
  2. click the CSL button in the top right
  3. click the autocomplete button if it is red
  4. create or upload a list in the song list tab
  5. change settings in the settings tab
  6. fix any invalid answers in the answer tab
  7. click start to play the quiz

Supported upload files:
  1. anisongdb json
  2. official AMQ song history export
  3. joseph song list script export
  4. blissfulyoshi ranked song list

Some considerations:
  1. anisongdb is unavailable during ranked, please prepare some json files in advance
  2. anime titles that were changed recently in AMQ will be incorrect if anisongdb never updated it
  3. no automatic volume equalizing
  4. keep duplicates in the song list if you want to use any acceptable title for each
*/

"use strict";
if (typeof Listener === "undefined") return;
let loadInterval = setInterval(() => {
    if ($("#loadingScreen").hasClass("hidden")) {
        clearInterval(loadInterval);
        setup();
    }
}, 500);

const version = "0.44";
const saveData = validateLocalStorage("customSongListGame");
const catboxHostDict = { 1: "files.catbox.moe", 2: "nl.catbox.moe", 3: "nl.catbox.video", 4: "ladist1.catbox.video", 5: "abdist1.catbox.video", 6: "vhdist1.catbox.video" };
let CSLButtonCSS = saveData.CSLButtonCSS || "calc(25% - 250px)";
let showCSLMessages = saveData.showCSLMessages ?? true;
let replacedAnswers = saveData.replacedAnswers || {};
let debug = Boolean(saveData.debug);
let fastSkip = false;
let nextVideoReady = false;
let showSelection = 1;
let guessTime = 20;
let extraGuessTime = 0;
let currentSong = 0;
let totalSongs = 0;
let currentAnswers = {};
let score = {};
let songListTableMode = 0; //0: song + artist, 1: anime + song type + vintage, 2: catbox links
let songListTableSort = [0, 0, 0, 0, 0, 0, 0, 0, 0] //song, artist, difficulty, anime, type, vintage, mp3, 480, 720 (0: off, 1: ascending, 2: descending)
let songList = [];
let songOrder = {}; //{song#: index#, ...}
let mergedSongList = [];
let songOrderType = "random";
let startPointRange = [0, 100];
let difficultyRange = [0, 100];
let previousSongFinished = false;
let skipInterval;
let nextVideoReadyInterval;
let answerTimer;
let extraGuessTimer;
let endGuessTimer;
let fileHostOverride = "0";
let autocomplete = []; //store lowercase version for faster compare speed
let autocompleteInput;
let cslMultiplayer = { host: "", songInfo: {}, voteSkip: {} };
let cslState = 0; //0: none, 1: guessing phase, 2: answer phase
let songLinkReceived = {};
let skipping = false;
let isTraining = false;

$("#gameContainer").append($(`
    <div class="modal fade tab-modal" id="cslgSettingsModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header" style="padding: 3px 0 0 0">
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                    <h4 class="modal-title">Custom Song List Game</h4>
                    <div class="tabContainer">
                        <div id="cslgSongListTab" class="tab clickAble selected">
                            <h5>Song List</h5>
                        </div>
                        <div id="cslgQuizSettingsTab" class="tab clickAble">
                            <h5>Settings</h5>
                        </div>
                        <div id="cslgAnswerTab" class="tab clickAble">
                            <h5>Answers</h5>
                        </div>
                        <div id="cslgMergeTab" class="tab clickAble">
                            <h5>Merge</h5>
                        </div>
                        <div id="cslgMultiplayerTab" class="tab clickAble">
                            <h5>Multiplayer</h5>
                        </div>
                        <div id="cslgInfoTab" class="tab clickAble" style="width: 45px; margin-right: -10px; padding-right: 8px; float: right;">
                            <h5><i class="fa fa-info-circle" aria-hidden="true"></i></h5>
                        </div>
                    </div>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(100vh - 150px);">
                    <div id="cslgSongListContainer">
                        <div>
                            <span style="font-size: 20px; font-weight: bold;">Mode</span>
                            <label class="clickAble" style="margin-left: 10px">Anisongdb<input id="cslgModeAnisongdbRadio" type="radio" name="cslgSongListMode"></label>
                            <label class="clickAble" style="margin-left: 10px">Load File<input id="cslgModeFileUploadRadio" type="radio" name="cslgSongListMode"></label>
                            <i id="cslgTableModeButton" class="fa fa-table clickAble" aria-hidden="true" style="font-size: 20px; margin-left: 80px;"></i>
                            <span id="cslgSongListCount" style="font-size: 20px; font-weight: bold; margin-left: 20px;">Total Songs: 0</span>
                        </div>
                        <div id="cslgFileUploadRow">
                            <label style="vertical-align: -4px"><input id="cslgFileUpload" type="file" style="width: 500px"></label>
                        </div>
                        <div id="cslgAnisongdbSearchRow">
                            <div>
                                <select id="cslgAnisongdbModeSelect" style="color: black; padding: 3px 0;">
                                    <option value="Anime">Anime</option>
                                    <option value="Artist">Artist</option>
                                    <option value="Song">Song</option>
                                    <option value="Composer">Composer</option>
                                </select>
                                <input id="cslgAnisongdbQueryInput" type="text" style="color: black; width: 185px;">
                                <button id="cslgAnisongdbSearchButtonGo" style="color: black">Go</button>
                                <label class="clickAble" style="margin-left: 7px">Partial<input id="cslgAnisongdbPartialCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">OP<input id="cslgAnisongdbOPCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">ED<input id="cslgAnisongdbEDCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">IN<input id="cslgAnisongdbINCheckbox" type="checkbox"></label>
                            </div>
                            <div>
                                <label class="clickAble">Max Other People<input id="cslgAnisongdbMaxOtherPeopleInput" type="text" style="color: black; font-weight: normal; width: 40px; margin-left: 3px;"></label>
                                <label class="clickAble" style="margin-left: 10px">Min Group Members<input id="cslgAnisongdbMinGroupMembersInput" type="text" style="color: black; font-weight: normal; width: 40px; margin-left: 3px;"></label>
                                <label class="clickAble" style="margin-left: 20px">Ignore Duplicates<input id="cslgAnisongdbIgnoreDuplicatesCheckbox" type="checkbox"></label>
                            </div>
                        </div>
                        <div style="height: 400px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgSongListTable">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="song">Song</th>
                                        <th class="artist">Artist</th>
                                        <th class="difficulty">Dif</th>
                                        <th class="trash"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                            <div id="cslgSongListWarning"></div>
                        </div>
                    </div>
                    <div id="cslgQuizSettingsContainer" style="margin-top: 10px">
                        <div>
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 0;">Songs:</span><input id="cslgSettingsSongs" type="text" style="width: 40px">
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 40px;">Guess Time:</span><input id="cslgSettingsGuessTime" type="text" style="width: 40px">
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 40px;">Extra Time:</span><input id="cslgSettingsExtraGuessTime" type="text" style="width: 40px">
                        </div>
                        <div style="margin-top: 5px">
                            <span style="font-size: 18px; font-weight: bold; margin-right: 15px;">Song Types:</span>
                            <label class="clickAble">OP<input id="cslgSettingsOPCheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">ED<input id="cslgSettingsEDCheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">IN<input id="cslgSettingsINCheckbox" type="checkbox"></label>
                            <span style="font-size: 18px; font-weight: bold; margin: 0 15px 0 35px;">Guess:</span>
                            <label class="clickAble">Correct<input id="cslgSettingsCorrectGuessCheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">Wrong<input id="cslgSettingsIncorrectGuessCheckbox" type="checkbox"></label>
                        </div>
                        <div style="margin-top: 5px">
                            <span style="font-size: 18px; font-weight: bold; margin-right: 15px;">Anime Types:</span>
                            <label class="clickAble">TV<input id="cslgSettingsTVCheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">Movie<input id="cslgSettingsMovieCheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">OVA<input id="cslgSettingsOVACheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">ONA<input id="cslgSettingsONACheckbox" type="checkbox"></label>
                            <label class="clickAble" style="margin-left: 10px">Special<input id="cslgSettingsSpecialCheckbox" type="checkbox"></label>
                        </div>
                        <div style="margin-top: 5px">
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 0;">Sample:</span>
                            <input id="cslgSettingsStartPoint" type="text" style="width: 70px">
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 40px;">Difficulty:</span>
                            <input id="cslgSettingsDifficulty" type="text" style="width: 70px">
                            <label class="clickAble" style="margin-left: 50px">Fast Skip<input id="cslgSettingsFastSkip" type="checkbox"></label>
                        </div>
                        <div style="margin-top: 5px">
                            <span style="font-size: 18px; font-weight: bold; margin-right: 10px;">Song Order:</span>
                            <select id="cslgSongOrderSelect" style="color: black; padding: 3px 0;">
                                <option value="random">random</option>
                                <option value="ascending">ascending</option>
                                <option value="descending">descending</option>
                            </select>
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 10px;">Override URL:</span>
                            <select id="cslgHostOverrideSelect" style="color: black; padding: 3px 0;">
                                <option value="0">default</option>
                                <option value="1">files.catbox.moe</option>
                                <option value="2">nl.catbox.moe</option>
                                <option value="3">nl.catbox.video</option>
                                <option value="4">ladist1.catbox.video</option>
                                <option value="5">abdist1.catbox.video</option>
                                <option value="6">vhdist1.catbox.video</option>

                            </select>
                        </div>
                        <p style="margin-top: 20px">Normal room settings are ignored. Only these settings will apply.</p>
                    </div>
                    <div id="cslgAnswerContainer">
                        <span style="font-size: 16px; font-weight: bold;">Old:</span>
                        <input id="cslgOldAnswerInput" type="text" style="width: 200px; color: black; margin: 10px 0;">
                        <span style="font-size: 16px; font-weight: bold; margin-left: 10px;">New:</span>
                        <input id="cslgNewAnswerInput" type="text" style="width: 200px; color: black; margin: 10px 0;">
                        <button id="cslgAnswerButtonAdd" style="color: black; margin-left: 10px;">Add</button>
                        <div id="cslgAnswerText" style="font-size: 16px; font-weight: bold;">No list loaded</div>
                        <div style="height: 300px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgAnswerTable">
                                <thead>
                                    <tr>
                                        <th class="oldName">Old</th>
                                        <th class="newName">New</th>
                                        <th class="edit"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                        <p style="margin-top: 5px">Use this window to replace invalid answers from your imported song list with valid answers from AMQ's autocomplete.</p>
                    </div>
                    <div id="cslgMergeContainer">
                        <h4 style="text-align: center; margin-bottom: 20px;">Merge multiple song lists into 1 JSON file</h4>
                        <div id="cslgMergeCurrentCount" style="font-size: 16px; font-weight: bold; margin-bottom: 15px;">Found 0 songs in the current song list</div>
                        <span id="cslgMergeTotalCount" style="font-size: 16px; font-weight: bold;">Merged JSON file: 0 songs</span>
                        <span style="float: right">
                            <button id="cslgMergeButton" class="btn btn-default">Merge</button>
                            <button id="cslgMergeClearButton" class="btn btn-warning">Clear</button>
                            <button id="cslgMergeDownloadButton" class="btn btn-success">Download</button>
                        </span>
                        <p style="margin-top: 30px">1. Load some songs into the table in the song list tab<br>2. Come back to this tab<br>3. Click "merge" to add everything from that list to a new combined list<br>4. Repeat steps 1-3 as many times as you want<br>5. Click "download" to download the new json file<br>6. Upload the file in the song list tab and play</p>
                    </div>
                    <div id="cslgMultiplayerContainer" style="text-align: center; margin: 10px 0;">
                        <div style="font-size: 20px; margin: 20px 0;">WORK IN PROGRESS</div>
                        <div style="margin-top: 15px"><span style="font-size: 16px; margin-right: 10px; vertical-align: middle;">Show CSL Messages</span><div class="customCheckbox" style="vertical-align: middle"><input type="checkbox" id="cslgShowCSLMessagesCheckbox"><label for="cslgShowCSLMessagesCheckbox"><i class="fa fa-check" aria-hidden="true"></i></label></div></div>
                        <h4 style="margin-top: 20px;">Prompt All Players</h4>
                        <div style="margin: 10px 0"><button id="cslgPromptAllAutocompleteButton" style="color: black; margin-right: 10px;">Autocomplete</button><button id="cslgPromptAllVersionButton" style="color: black;">Version</button></div>
                    </div>
                    <div id="cslgInfoContainer" style="text-align: center; margin: 10px 0;">
                        <h4>Script Info</h4>
                        <div>Created by: kempanator</div>
                        <div>Version: ${version}</div>
                        <div><a href="https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js" target="blank">Link</a></div>
                        <h4 style="margin-top: 20px;">Custom CSS</h4>
                        <div><span style="font-size: 15px; margin-right: 17px;">#lnCustomSongListButton </span>right: <input id="cslgCSLButtonCSSInput" type="text" style="width: 150px; color: black;"></div>
                        <div style="margin: 10px 0"><button id="cslgResetCSSButton" style="color: black; margin-right: 10px;">Reset</button><button id="cslgApplyCSSButton" style="color: black;">Save</button></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="cslgAutocompleteButton" class="btn btn-danger" style="float: left">Autocomplete</button>
                    <button id="cslTrainingModeButton" class="btn btn-primary" style="float: left">Training Mode</button>
                    <button id="cslUpdateListButton" class="btn btn-secondary" style="float: left">Update</button>
                    <input id="cslgSettingsTrainingModeAniList" type="text" placeholder="AniList Username" style="width: 70px">
                    <button id="cslgExitButton" class="btn btn-default" data-dismiss="modal">Exit</button>
                    <button id="cslgStartButton" class="btn btn-primary">Start</button>
                </div>
            </div>
        </div>
    </div>
`));

$("#lobbyPage .topMenuBar").append(`<div id="lnCustomSongListButton" class="clickAble topMenuButton topMenuMediumButton"><h3>CSL</h3></div>`);
$("#lnCustomSongListButton").click(() => { openSettingsModal() });
$("#cslgSongListTab").click(() => {
    tabReset();
    $("#cslgSongListTab").addClass("selected");
    $("#cslgSongListContainer").show();
});
$("#cslgQuizSettingsTab").click(() => {
    tabReset();
    $("#cslgQuizSettingsTab").addClass("selected");
    $("#cslgQuizSettingsContainer").show();
});
$("#cslgAnswerTab").click(() => {
    tabReset();
    $("#cslgAnswerTab").addClass("selected");
    $("#cslgAnswerContainer").show();
});
$("#cslgMergeTab").click(() => {
    tabReset();
    $("#cslgMergeTab").addClass("selected");
    $("#cslgMergeContainer").show();
});
$("#cslgMultiplayerTab").click(() => {
    tabReset();
    $("#cslgMultiplayerTab").addClass("selected");
    $("#cslgMultiplayerContainer").show();
});
$("#cslgInfoTab").click(() => {
    tabReset();
    $("#cslgInfoTab").addClass("selected");
    $("#cslgInfoContainer").show();
});
$("#cslgAnisongdbSearchButtonGo").click(() => { anisongdbDataSearch() });
$("#cslgAnisongdbQueryInput").keypress((event) => { if (event.which === 13) anisongdbDataSearch() });
$("#cslgFileUpload").on("change", function () {
    if (this.files.length) {
        this.files[0].text().then((data) => {
            try {
                handleData(JSON.parse(data));
            }
            catch {
                songList = [];
                displayMessage("Upload Error");
            }
            setSongListTableSort();
            createSongListTable();
            createAnswerTable();
        });
    }
});
$("#cslgSongOrderSelect").on("change", function () {
    songOrderType = this.value;
});
$("#cslgHostOverrideSelect").on("change", function () {
    fileHostOverride = this.value;
});
$("#cslgMergeButton").click(() => {
    mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
    $("#cslgMergeTotalCount").text(`Merged JSON file: ${mergedSongList.length} song${mergedSongList.length === 1 ? "" : "s"}`);
});
$("#cslgMergeClearButton").click(() => {
    mergedSongList = [];
    $("#cslgMergeTotalCount").text("Merged JSON file: 0 songs");
});
$("#cslgMergeDownloadButton").click(() => {
    if (mergedSongList.length) {
        let data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mergedSongList));
        let element = document.createElement("a");
        element.setAttribute("href", data);
        element.setAttribute("download", "merged.json");
        document.body.appendChild(element);
        element.click();
        element.remove();
    }
    else {
        displayMessage("No songs", "add some songs to the merged song list");
    }
});
$("#cslgAutocompleteButton").click(() => {
    if (lobby.soloMode) {
        $("#cslgSettingsModal").modal("hide");
        socket.sendCommand({ type: "lobby", command: "start game" });
        let autocompleteListener = new Listener("get all song names", () => {
            autocompleteListener.unbindListener();
            viewChanger.changeView("main");
            setTimeout(() => {
                hostModal.displayHostSolo();
            }, 200);
            setTimeout(() => {
                let returnListener = new Listener("Host Game", (payload) => {
                    returnListener.unbindListener();
                    if (songList.length) createAnswerTable();
                    setTimeout(() => { openSettingsModal() }, 10);
                });
                returnListener.bindListener();
                roomBrowser.host();
            }, 400);
        });
        autocompleteListener.bindListener();
    }
    else {
        displayMessage("Autocomplete", "For multiplayer, just start the quiz normally and immediately lobby");
    }
});
$("#cslTrainingModeButton").click(() => {
    startTrainingMode()
    songOrder = {};
    if (!lobby.isHost) {
        return displayMessage("Unable to start", "must be host");
    }
    if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
        return displayMessage("Unable to start", "all players must be ready");
    }
    if (!songList || !songList.length) {
        return displayMessage("Unable to start", "no songs");
    }
    if (autocomplete.length === 0) {
        return displayMessage("Unable to start", "autocomplete list empty");
    }
    let numSongs = parseInt($("#cslgSettingsSongs").val());
    if (isNaN(numSongs) || numSongs < 1) {
        return displayMessage("Unable to start", "invalid number of songs");
    }
    guessTime = parseInt($("#cslgSettingsGuessTime").val());
    if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
        return displayMessage("Unable to start", "invalid guess time");
    }
    extraGuessTime = parseInt($("#cslgSettingsExtraGuessTime").val());
    if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
        return displayMessage("Unable to start", "invalid extra guess time");
    }
    let startPointText = $("#cslgSettingsStartPoint").val().trim();
    if (/^[0-9]+$/.test(startPointText)) {
        startPointRange = [parseInt(startPointText), parseInt(startPointText)];
    }
    else if (/^[0-9]+[\s-]+[0-9]+$/.test(startPointText)) {
        startPointRange = [parseInt(/^([0-9]+)[\s-]+[0-9]+$/.exec(startPointText)[1]), parseInt(/^[0-9]+[\s-]+([0-9]+)$/.exec(startPointText)[1])];
    }
    else {
        return displayMessage("Unable to start", "song start sample must be a number or range 0-100");
    }
    if (startPointRange[0] < 0 || startPointRange[0] > 100 || startPointRange[1] < 0 || startPointRange[1] > 100 || startPointRange[0] > startPointRange[1]) {
        return displayMessage("Unable to start", "song start sample must be a number or range 0-100");
    }
    let difficultyText = $("#cslgSettingsDifficulty").val().trim();
    if (/^[0-9]+[\s-]+[0-9]+$/.test(difficultyText)) {
        difficultyRange = [parseInt(/^([0-9]+)[\s-]+[0-9]+$/.exec(difficultyText)[1]), parseInt(/^[0-9]+[\s-]+([0-9]+)$/.exec(difficultyText)[1])];
    }
    else {
        return displayMessage("Unable to start", "difficulty must be a range 0-100");
    }
    if (difficultyRange[0] < 0 || difficultyRange[0] > 100 || difficultyRange[1] < 0 || difficultyRange[1] > 100 || difficultyRange[0] > difficultyRange[1]) {
        return displayMessage("Unable to start", "difficulty must be a range 0-100");
    }
    // let ops = $("#cslgSettingsOPCheckbox").prop("checked");
    // let eds = $("#cslgSettingsEDCheckbox").prop("checked");
    // let ins = $("#cslgSettingsINCheckbox").prop("checked");
    // let tv = $("#cslgSettingsTVCheckbox").prop("checked");
    // let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
    // let ova = $("#cslgSettingsOVACheckbox").prop("checked");
    // let ona = $("#cslgSettingsONACheckbox").prop("checked");
    // let special = $("#cslgSettingsSpecialCheckbox").prop("checked");
    let songKeys = Object.keys(songList)
    // TODO: Build my own filter mechanic
    // .filter((key) => songTypeFilter(songList[key], ops, eds, ins))
    // .filter((key) => animeTypeFilter(songList[key], tv, movie, ova, ona, special))
    // .filter((key) => difficultyFilter(songList[key], difficultyRange[0], difficultyRange[1]))
    if (songOrderType === "random") shuffleArray(songKeys);
    else if (songOrderType === "descending") songKeys.reverse();
    songKeys.slice(0, numSongs).forEach((key, i) => { songOrder[i + 1] = parseInt(key) });
    totalSongs = Object.keys(songOrder).length;
    if (totalSongs === 0) {
        return displayMessage("Unable to start", "no songs");
    }
    fastSkip = $("#cslgSettingsFastSkip").prop("checked");
    $("#cslgSettingsModal").modal("hide");
    //console.log(songOrder);
    if (lobby.soloMode) {
        isTraining = true;
        startQuiz();
    }
    else if (lobby.isHost) {
        cslMessage("§CSL0" + btoa(encodeURI(`${showSelection}-${currentSong}-${totalSongs}-${guessTime}-${extraGuessTime}-${fastSkip ? "1" : "0"}`)));
    }
    console.log(songList)
});
$("#cslUpdateListButton").click(() => {
    updateList()
});
$("#cslgStartButton").click(() => {
    console.log(songList)
    songOrder = {};
    if (!lobby.isHost) {
        return displayMessage("Unable to start", "must be host");
    }
    if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
        return displayMessage("Unable to start", "all players must be ready");
    }
    if (!songList || !songList.length) {
        return displayMessage("Unable to start", "no songs");
    }
    if (autocomplete.length === 0) {
        return displayMessage("Unable to start", "autocomplete list empty");
    }
    let numSongs = parseInt($("#cslgSettingsSongs").val());
    if (isNaN(numSongs) || numSongs < 1) {
        return displayMessage("Unable to start", "invalid number of songs");
    }
    guessTime = parseInt($("#cslgSettingsGuessTime").val());
    if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
        return displayMessage("Unable to start", "invalid guess time");
    }
    extraGuessTime = parseInt($("#cslgSettingsExtraGuessTime").val());
    if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
        return displayMessage("Unable to start", "invalid extra guess time");
    }
    let startPointText = $("#cslgSettingsStartPoint").val().trim();
    if (/^[0-9]+$/.test(startPointText)) {
        startPointRange = [parseInt(startPointText), parseInt(startPointText)];
    }
    else if (/^[0-9]+[\s-]+[0-9]+$/.test(startPointText)) {
        startPointRange = [parseInt(/^([0-9]+)[\s-]+[0-9]+$/.exec(startPointText)[1]), parseInt(/^[0-9]+[\s-]+([0-9]+)$/.exec(startPointText)[1])];
    }
    else {
        return displayMessage("Unable to start", "song start sample must be a number or range 0-100");
    }
    if (startPointRange[0] < 0 || startPointRange[0] > 100 || startPointRange[1] < 0 || startPointRange[1] > 100 || startPointRange[0] > startPointRange[1]) {
        return displayMessage("Unable to start", "song start sample must be a number or range 0-100");
    }
    let difficultyText = $("#cslgSettingsDifficulty").val().trim();
    if (/^[0-9]+[\s-]+[0-9]+$/.test(difficultyText)) {
        difficultyRange = [parseInt(/^([0-9]+)[\s-]+[0-9]+$/.exec(difficultyText)[1]), parseInt(/^[0-9]+[\s-]+([0-9]+)$/.exec(difficultyText)[1])];
    }
    else {
        return displayMessage("Unable to start", "difficulty must be a range 0-100");
    }
    if (difficultyRange[0] < 0 || difficultyRange[0] > 100 || difficultyRange[1] < 0 || difficultyRange[1] > 100 || difficultyRange[0] > difficultyRange[1]) {
        return displayMessage("Unable to start", "difficulty must be a range 0-100");
    }
    let ops = $("#cslgSettingsOPCheckbox").prop("checked");
    let eds = $("#cslgSettingsEDCheckbox").prop("checked");
    let ins = $("#cslgSettingsINCheckbox").prop("checked");
    let tv = $("#cslgSettingsTVCheckbox").prop("checked");
    let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
    let ova = $("#cslgSettingsOVACheckbox").prop("checked");
    let ona = $("#cslgSettingsONACheckbox").prop("checked");
    let special = $("#cslgSettingsSpecialCheckbox").prop("checked");
    let correctGuesses = $("#cslgSettingsCorrectGuessCheckbox").prop("checked");
    let incorrectGuesses = $("#cslgSettingsIncorrectGuessCheckbox").prop("checked");
    // songKeys = songKeys.filter((key) => songTypeFilter(songList[key], ops, eds, ins))
    let songKeys = Object.keys(songList)
        .filter((key) => animeTypeFilter(songList[key], tv, movie, ova, ona, special))
        .filter((key) => difficultyFilter(songList[key], difficultyRange[0], difficultyRange[1]))
        .filter((key) => guessTypeFilter(songList[key], correctGuesses, incorrectGuesses));
    if (songOrderType === "random") shuffleArray(songKeys);
    else if (songOrderType === "descending") songKeys.reverse();
    songKeys.slice(0, numSongs).forEach((key, i) => { songOrder[i + 1] = parseInt(key) });
    totalSongs = Object.keys(songOrder).length;
    if (totalSongs === 0) {
        return displayMessage("Unable to start", "no songs");
    }
    fastSkip = $("#cslgSettingsFastSkip").prop("checked");
    $("#cslgSettingsModal").modal("hide");
    //console.log(songOrder);
    if (lobby.soloMode) {
        // isTraining = false;
        isTraining = true;
        startQuiz();
    }
    else if (lobby.isHost) {
        cslMessage("§CSL0" + btoa(encodeURI(`${showSelection}-${currentSong}-${totalSongs}-${guessTime}-${extraGuessTime}-${fastSkip ? "1" : "0"}`)));
    }
});
$("#cslgSongListTable").on("click", "i.fa-trash", (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector("td.number").innerText) - 1;
    songList.splice(index, 1);
    createSongListTable();
    createAnswerTable();
});
$("#cslgAnswerButtonAdd").click(() => {
    let oldName = $("#cslgOldAnswerInput").val().trim();
    let newName = $("#cslgNewAnswerInput").val().trim();
    if (oldName) {
        newName ? replacedAnswers[oldName] = newName : delete replacedAnswers[oldName];
        saveSettings();
        createAnswerTable();
    }
    //console.log(replacedAnswers);
});
$("#cslgAnswerTable").on("click", "i.fa-pencil", (event) => {
    let oldName = event.target.parentElement.parentElement.querySelector("td.oldName").innerText;
    let newName = event.target.parentElement.parentElement.querySelector("td.newName").innerText;
    $("#cslgOldAnswerInput").val(oldName);
    $("#cslgNewAnswerInput").val(newName);
});
$("#cslgModeAnisongdbRadio").prop("checked", true);
$("#cslgAnisongdbModeSelect").val("Artist");
$("#cslgAnisongdbPartialCheckbox").prop("checked", true);
$("#cslgAnisongdbOPCheckbox").prop("checked", true);
$("#cslgAnisongdbEDCheckbox").prop("checked", true);
$("#cslgAnisongdbINCheckbox").prop("checked", true);
$("#cslgAnisongdbMaxOtherPeopleInput").val("99");
$("#cslgAnisongdbMinGroupMembersInput").val("0");
$("#cslgSettingsSongs").val("20");
$("#cslgSettingsGuessTime").val("20");
$("#cslgSettingsExtraGuessTime").val("0");
$("#cslgSettingsOPCheckbox").prop("checked", true);
$("#cslgSettingsEDCheckbox").prop("checked", true);
$("#cslgSettingsINCheckbox").prop("checked", true);
$("#cslgSettingsCorrectGuessCheckbox").prop("checked", true);
$("#cslgSettingsIncorrectGuessCheckbox").prop("checked", true);
$("#cslgSettingsTVCheckbox").prop("checked", true);
$("#cslgSettingsMovieCheckbox").prop("checked", true);
$("#cslgSettingsOVACheckbox").prop("checked", true);
$("#cslgSettingsONACheckbox").prop("checked", true);
$("#cslgSettingsSpecialCheckbox").prop("checked", true);
$("#cslgSettingsStartPoint").val("0-100");
$("#cslgSettingsDifficulty").val("0-100");
$("#cslgSettingsFastSkip").prop("checked", false);
$("#cslgFileUploadRow").hide();
$("#cslgModeAnisongdbRadio").click(() => {
    songList = [];
    $("#cslgFileUploadRow").hide();
    $("#cslgAnisongdbSearchRow").show();
    $("#cslgSongListCount").text("Total Songs: 0");
    $("#cslgFileUploadRow input").val("");
    $("#cslgSongListTable tbody").empty();
    $("#cslgMergeCurrentCount").text("Found 0 songs in the current song list");
});
$("#cslgModeFileUploadRadio").click(() => {
    songList = [];
    $("#cslgAnisongdbSearchRow").hide();
    $("#cslgFileUploadRow").show();
    $("#cslgSongListCount").text("Total Songs: 0");
    $("#cslgAnisongdbQueryInput").val("");
    $("#cslgSongListTable tbody").empty();
    $("#cslgMergeCurrentCount").text("Found 0 songs in the current song list");
});
$("#cslgTableModeButton").click(() => {
    songListTableMode = (songListTableMode + 1) % 3;
    createSongListTable();
});
$("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
$("#cslgResetCSSButton").click(() => {
    CSLButtonCSS = "calc(25% - 250px)";
    $("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
});
$("#cslgApplyCSSButton").click(() => {
    let val = $("#cslgCSLButtonCSSInput").val();
    if (val) {
        CSLButtonCSS = val;
        saveSettings();
        applyStyles();
    }
    else {
        displayMessage("Error");
    }
});
$("#cslgShowCSLMessagesCheckbox").prop("checked", showCSLMessages).click(() => {
    showCSLMessages = !showCSLMessages;
});
$("#cslgPromptAllAutocompleteButton").click(() => {
    cslMessage("§CSL21");
});
$("#cslgPromptAllVersionButton").click(() => {
    cslMessage("§CSL22");
});
tabReset();
$("#cslgSongListTab").addClass("selected");
$("#cslgSongListContainer").show();

// setup
function setup() {
    new Listener("New Player", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                sendSystemMessage(`CSL: reconnecting ${payload.name}`);
                cslMessage("§CSL0" + btoa(encodeURI(`${showSelection}-${currentSong}-${totalSongs}-${guessTime}-${extraGuessTime}-${fastSkip ? "1" : "0"}`)));
            }
            else {
                cslMessage(`CSL game in progress, removing ${payload.name}`);
                lobby.changeToSpectator(payload.name);
            }
        }
    }).bindListener();
    new Listener("New Spectator", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                sendSystemMessage(`CSL: reconnecting ${payload.name}`);
                cslMessage("§CSL20" + btoa(payload.name));
            }
            setTimeout(() => {
                cslMessage("§CSL3" + btoa(`${currentSong}-${getStartPoint()}-${songList[songOrder[currentSong]].audio || ""}-${/*nextSong.video480 || */""}-${/*nextSong.video720 || */""}`));
            }, 300);
        }
    }).bindListener();
    new Listener("Spectator Change To Player", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                cslMessage("§CSL0" + btoa(encodeURI(`${showSelection}-${currentSong}-${totalSongs}-${guessTime}-${extraGuessTime}-${fastSkip ? "1" : "0"}`)));
            }
            else {
                cslMessage(`CSL game in progress, removing ${payload.name}`);
                lobby.changeToSpectator(payload.name);
            }
        }
    }).bindListener();
    new Listener("Player Change To Spectator", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
            let player = Object.values(quiz.players).find((p) => p._name === payload.name);
            if (player) {
                cslMessage("§CSL20" + btoa(payload.name));
            }
        }
    }).bindListener();
    new Listener("Host Promotion", (payload) => {
        if (quiz.cslActive && quiz.inQuiz) {
            sendSystemMessage("CSL host changed, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("Player Left", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && payload.player.name === cslMultiplayer.host) {
            sendSystemMessage("CSL host left, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("Spectator Left", (payload) => {
        if (quiz.cslActive && quiz.inQuiz && payload.spectator === cslMultiplayer.host) {
            sendSystemMessage("CSL host left, ending quiz");
            quizOver();
        }
    }).bindListener();
    new Listener("game chat update", (payload) => {
        for (let message of payload.messages) {
            if (message.message.startsWith("§CSL")) {
                if (!showCSLMessages) {
                    setTimeout(() => {
                        let $message = gameChat.$chatMessageContainer.find(".gcMessage").last();
                        if ($message.text().startsWith("§CSL")) $message.parent().remove();
                    }, 0);
                }
                parseMessage(message.message, message.sender);
            }
            else if (debug && message.sender === selfName && message.message.startsWith("/csl")) {
                try { cslMessage(JSON.stringify(eval(message.message.slice(5)))) }
                catch { cslMessage("ERROR") }
            }
        }
    }).bindListener();
    new Listener("Game Chat Message", (payload) => {
        if (payload.message.startsWith("§CSL")) {
            parseMessage(message.message, message.sender);
        }
    }).bindListener();
    new Listener("Game Starting", (payload) => {
        clearTimeEvents();
    }).bindListener();
    new Listener("Join Game", (payload) => {
        reset();
    }).bindListener();
    new Listener("Spectate Game", (payload) => {
        reset();
    }).bindListener();
    new Listener("Host Game", (payload) => {
        reset();
        $("#cslgSettingsModal").modal("hide");
    }).bindListener();
    new Listener("get all song names", () => {
        setTimeout(() => {
            let list = quiz.answerInput.typingInput.autoCompleteController.list;
            if (list.length) {
                autocomplete = list.map(x => x.toLowerCase());
                autocompleteInput = new AmqAwesomeplete(document.querySelector("#cslgNewAnswerInput"), { list: list }, true);
            }
        }, 10);
    }).bindListener();
    new Listener("update all song names", () => {
        setTimeout(() => {
            let list = quiz.answerInput.typingInput.autoCompleteController.list;
            if (list.length) {
                autocomplete = list.map(x => x.toLowerCase());
                autocompleteInput.list = list;
            }
        }, 10);
    }).bindListener();

    quiz.pauseButton.$button.off("click").click(() => {
        if (quiz.cslActive) {
            if (quiz.soloMode) {
                if (quiz.pauseButton.pauseOn) {
                    fireListener("quiz unpause triggered", {
                        "playerName": selfName
                    });
                    // fireListener("quiz unpause triggered", {
                    //     "playerName": selfName,
                    //     "doCountDown": true,
                    //     "countDownLength": 3000
                    // });
                }
                else {
                    fireListener("quiz pause triggered", {
                        "playerName": selfName
                    });
                }
            }
            else {
                if (quiz.pauseButton.pauseOn) {
                    cslMessage("§CSL82");
                }
                else {
                    cslMessage("§CSL81");
                }
            }
        }
        else {
            socket.sendCommand({ type: "quiz", command: quiz.pauseButton.pauseOn ? "quiz unpause" : "quiz pause" });
        }
    });

    const oldSendSkipVote = quiz.skipController.sendSkipVote;
    quiz.skipController.sendSkipVote = function () {
        if (quiz.cslActive) {
            if (quiz.soloMode) {
                clearTimeout(this.autoVoteTimeout);
            }
            else if (!skipping) {
                cslMessage("§CSL91");
            }
        }
        else {
            oldSendSkipVote.apply(this, arguments);
        }
    }

    const oldLeave = quiz.leave;
    quiz.leave = function () {
        reset();
        oldLeave.apply(this, arguments);
    }

    const oldStartReturnLobbyVote = quiz.startReturnLobbyVote;
    quiz.startReturnLobbyVote = function () {
        if (quiz.cslActive && quiz.inQuiz) {
            if (quiz.soloMode) {
                quizOver();
            }
            else if (quiz.isHost) {
                cslMessage("§CSL1");
            }
        }
        else {
            oldStartReturnLobbyVote.apply(this, arguments);
        }
    }

    const oldSubmitAnswer = QuizTypeAnswerInputController.prototype.submitAnswer;
    QuizTypeAnswerInputController.prototype.submitAnswer = function (answer) {
        if (quiz.cslActive) {
            currentAnswers[quiz.ownGamePlayerId] = answer;
            this.skipController.highlight = true;
            fireListener("quiz answer", {
                "answer": answer,
                "success": true
            });
            if (quiz.soloMode) {
                fireListener("player answered", [0]);
                if (options.autoVoteSkipGuess) {
                    this.skipController.voteSkip();
                    fireListener("quiz overlay message", "Skipping to Answers");
                }
            }
            else {
                cslMessage("§CSL5");
                if (options.autoVoteSkipGuess) {
                    this.skipController.voteSkip();
                }
            }
        }
        else {
            oldSubmitAnswer.apply(this, arguments);
        }
    }

    const oldVideoReady = quiz.videoReady;
    quiz.videoReady = function (songId) {
        if (quiz.cslActive && this.inQuiz) {
            nextVideoReady = true;
        }
        else {
            oldVideoReady.apply(this, arguments);
        }
    }

    const oldHandleError = MoeVideoPlayer.prototype.handleError;
    MoeVideoPlayer.prototype.handleError = function () {
        if (quiz.cslActive) {
            gameChat.systemMessage(`CSL Error: couldn't load song ${currentSong + 1}`);
            nextVideoReady = true;
        }
        else {
            oldHandleError.apply(this, arguments);
        }
    }

    AMQ_addScriptData({
        name: "Custom Song List Game",
        author: "kempanator",
        version: version,
        link: "https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js",
        description: `
            </ul><b>How to start a custom song list game:</b>
                <li>create a solo lobby</li>
                <li>click the CSL button in the top right</li>
                <li>click the autocomplete button if it is red</li>
                <li>create or upload a list in the song list tab</li>
                <li>change settings in the settings tab</li>
                <li>fix any invalid answers in the answer tab</li>
                <li>click start to play the quiz</li>
            </ul>
        `
    });
    applyStyles();
}

function loadSongs() {
    const data = localStorage.getItem('tracks');
    return data ? JSON.parse(data) : [];
}

function saveSongs(tracks) {
    localStorage.setItem('tracks', JSON.stringify(tracks));
}

function updateEFactor(oldEFactor, qualityOfResponse) {
    // Ensure that the quality of response is between 0 and 5
    qualityOfResponse = Math.max(0, Math.min(qualityOfResponse, 5));

    // Adjust the rate of E-Factor decrease for incorrect answers to be less severe
    const incorrectResponseFactor = 0.06; // Was 0.08 in the original formula
    const incorrectResponseSlope = 0.01; // Was 0.02 in the original formula

    // Adjust the rate of E-Factor increase for correct answers to be more substantial
    const correctResponseBonus = 0.15; // Was 0.1 in the original formula, can be increased if needed

    let newEFactor = oldEFactor + (correctResponseBonus - (5 - qualityOfResponse) * (incorrectResponseFactor + (5 - qualityOfResponse) * incorrectResponseSlope));

    newEFactor = Math.max(Math.min(newEFactor, 5), 1.3);

    return newEFactor;
}

function reviewSong(song, success) {
    if (!isTraining) return;
    let songs = loadSongs(); // Assuming loadSongs loads the songs from local storage
    // Find and update the specific song in the array
    const songIndex = songs.findIndex(s => s.video720 === song.video720);
    if (songIndex !== -1) {
        const grade = success ? 5 : 0;
        const lastReview = songs[songIndex].reviewState;
        const efactor = updateEFactor(lastReview.efactor, grade);
        let successCount = songs[songIndex].reviewState.successCount
        let successStreak = songs[songIndex].reviewState.successStreak
        let failureCount = songs[songIndex].reviewState.failureCount
        let failureStreak = songs[songIndex].reviewState.failureStreak
        let isLastTryCorrect = songs[songIndex].reviewState.isLastTryCorrect;

        // Increment the appropriate statistic based on the success of the review
        if (success) {
            failureStreak = 0
            successStreak++
            successCount++
            isLastTryCorrect = true;
        } else {
            successStreak = 0
            failureStreak++
            failureCount++
            isLastTryCorrect = false;
        }

        songs[songIndex].reviewState = {
            date: Date.now(),
            efactor,
            successCount,
            successStreak,
            failureCount,
            failureStreak,
            isLastTryCorrect
        };

        songs[songIndex].weight = parseFloat(calculateWeight(songs[songIndex]).toFixed(3));
    }
    console.log(songs[songIndex])
    // Save the updated songs array back to local storage
    saveSongs(songs);
}

function getReviewState(track) {
    const lastReview = track.reviewState
    const efactor = lastReview ? lastReview.efactor : 2.5;
    const date = lastReview ? lastReview.date : Date.now();
    const successCount = lastReview ? lastReview.successCount : 0;
    const successStreak = lastReview ? lastReview.successStreak : 0;
    const failureCount = lastReview ? lastReview.failureCount : 0;
    const failureStreak = lastReview ? lastReview.failureStreak : 0;
    const isLastTryCorrect = lastReview ? lastReview.isLastTryCorrect : false;

    // Return a new object composed of the original track properties
    // along with the additional properties needed for the cooldown logic.
    return {
        ...track, // Preserve existing track properties
        reviewState: {
            date,
            efactor,
            successCount,
            successStreak,
            failureCount,
            failureStreak,
            isLastTryCorrect,
        }
    };
}
let appearanceCounter = {};

function calculateWeight(track) {
    const OVERDUE_FACTOR_PERCENTAGE = 0.10;
    const LAST_PERFORMANCE_PERCENTAGE = 0.05;
    const EFACTOR_IMPACT_PERCENTAGE = 0.60;
    const CORRECT_GUESSES_PERCENTAGE_INFLUENCE = 0.15;
    const SUCCESS_STREAK_INFLUENCE = -0.20; // Negative influence to represent lower urgency with successive successes
    const FAILURE_STREAK_INFLUENCE = 0.20; // Positive influence to represent higher urgency with successive failures

    const currentDate = Date.now();
    const reviewState = track.reviewState
    const reviewDate = reviewState.date;
    const efactor = reviewState.efactor;
    const successCount = reviewState.successCount;
    const failureCount = reviewState.failureCount;
    const successStreak = reviewState.successStreak
    const failureStreak = reviewState.failureStreak
    // Use a factor to increase the rate of growth of the logarithm

    // Calculate weights for success and failure streaks
    function calculateSuccessStreakImpact(successStreak, influence, cap, startFrom) {
        if (successStreak < startFrom) return 0;
        let multiplier = Math.pow(2, successStreak - startFrom);
        multiplier = Math.min(multiplier, cap);
        return multiplier * influence;
    }

    function calculateFailureStreakImpact(failureStreak, influence, cap, startFrom) {
        if (failureStreak < startFrom) return 0;
        let multiplier = Math.pow(2, failureStreak - startFrom);
        multiplier = Math.min(multiplier, cap);
        return multiplier * influence;
    }

    // Calculate the impacts for both success and failure streaks with the desired properties
    const successStreakImpact = calculateSuccessStreakImpact(successStreak, SUCCESS_STREAK_INFLUENCE, 4, 2);
    const failureStreakImpact = calculateFailureStreakImpact(failureStreak, FAILURE_STREAK_INFLUENCE, 4, 2);

    // Calculate the percentage of correct guesses
    const totalAttempts = successCount + failureCount;
    let correctGuessPercentage = totalAttempts > 0 ? successCount / totalAttempts : 1;

    // Using logarithmic function to control the growth of the interval increase factor
    const MIN_EFACTOR = 1.3; // The minimum efactor to prevent intervals from being too short
    const successCountEffect = successCount > 0 ? Math.log(successCount) / Math.log(2) : 0;
    const intervalIncreaseFactor = Math.max(MIN_EFACTOR, efactor) * Math.pow(correctGuessPercentage, successCountEffect);

    // Calculate the ideal review date based on the interval increase factor
    const idealReviewDate = reviewDate + intervalIncreaseFactor * (24 * 60 * 60 * 1000) - 2 * (24 * 60 * 60 * 1000);
    let overdueFactor = Math.max(0, (currentDate - idealReviewDate) / (24 * 60 * 60 * 1000));
    overdueFactor /= 10
    console.log(overdueFactor)

    // Assuming lastPerformance is a value between 0 (forgot) and 1 (perfect recall)
    const lastPerformance = track.reviewState.isLastTryCorrect ? 1 : 0;

    // Calculate efactor impact, which we will normalize from 0 to 1
    const efactorImpact = (5 - efactor) / 4;

    let correctGuessPercentageInfluence =
        totalAttempts < 4
            ? 0 * CORRECT_GUESSES_PERCENTAGE_INFLUENCE
            : (1 - correctGuessPercentage) * CORRECT_GUESSES_PERCENTAGE_INFLUENCE;

    // Calculate the weighted score
    let weight =
        overdueFactor * OVERDUE_FACTOR_PERCENTAGE +
        (1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE +
        efactorImpact * EFACTOR_IMPACT_PERCENTAGE +
        successStreakImpact +
        failureStreakImpact +
        correctGuessPercentageInfluence;
    weight *= 100
    weight += 100

    // Log the calculated variables
    console.log({
        currentDate,
        reviewDate,
        efactor,
        successCount,
        failureCount,
        correctGuessPercentage,
        idealReviewDate,
        overdueFactor,
        lastPerformance,
        efactorImpact,
        weight
    });
    // Log the calculated variables
    console.log(`
    Ideal review date: ${new Date(idealReviewDate).toISOString()}
    OverdueFactor: ${overdueFactor * OVERDUE_FACTOR_PERCENTAGE}
    LastPerformance: ${(1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE}
    EFactorImpact: ${efactorImpact * EFACTOR_IMPACT_PERCENTAGE}
    SuccessStreakImpact: ${successStreakImpact * SUCCESS_STREAK_INFLUENCE}
    FailureStreakImpact: ${failureStreakImpact * FAILURE_STREAK_INFLUENCE}
    CorrectGuessPercentage: ${correctGuessPercentageInfluence}
    FINAL WEIGHT: ${weight / 100}`);
    // Return the weight, ensuring it is a positive number and rounding to three decimal places
    return weight;
}

function weightedRandomSelection(reviewCandidates, maxSongs) {
    // Convert the object to an array of candidates
    const candidatesArray = Object.values(reviewCandidates);

    // Calculate the total weight
    let totalWeight = candidatesArray.reduce((total, candidate) => total + candidate.weight, 0);

    // Function to randomly select a candidate based on original weights
    const selectRandomly = () => {
        let r = Math.random() * totalWeight;
        for (const candidate of candidatesArray) {
            r -= candidate.weight;
            if (r <= 0) {
                return candidate;
            }
        }
        // If by some floating-point arithmetic error we got here, return the last candidate
        console.error("Floating-point arithmetic error, returning the last candidate")
        return candidatesArray[candidatesArray.length - 1];
    };

    // Perform selections
    const selections = [];
    for (let i = 0; i < maxSongs; i++) {
        selections.push(selectRandomly());
    }

    return selections;
}

function penalizeDuplicateRomajiNames(selectedTracks, reviewCandidates) {
    let index = 0;
    while (index < selectedTracks.length) {
        let duplicateIndexes = [];
        // Window to look for duplicate "animeRomajiName"
        // console.log('--------------------------------------------')
        for (let i = index + 1; i < selectedTracks.length; i++) {
            // console.log(i, index, selectedTracks[i].animeRomajiName, selectedTracks[index].animeRomajiName, selectedTracks[i].animeRomajiName === selectedTracks[index].animeRomajiName, selectedTracks[i].animeRomajiName == selectedTracks[index].animeRomajiName)
            if (selectedTracks[i].animeRomajiName === selectedTracks[index].animeRomajiName) {
                if (i - index <= 7) { // Only count as a duplicate if within 7 items
                    // console.log('DUPLICATE DETECTED')
                    duplicateIndexes.push(i);
                }
            }
        }

        while (duplicateIndexes.length > 0 && selectedTracks.length > 1) {
            let randomChance = Math.random() * 10;
            // TODO: let weight influence it
            if (randomChance >= 3) {
                // console.log(randomChance)
                // console.log('RNG PASSED', selectedTracks[index])
                let dupeIndex = duplicateIndexes.pop();
                selectedTracks.splice(dupeIndex, 1); // Remove duplicate entry

                let newTrack;
                do {
                    let selectionResult = weightedRandomSelection(reviewCandidates, 1);
                    newTrack = selectionResult[0]; // Get the new track
                } while (selectedTracks.some(track => track.animeRomajiName === newTrack.animeRomajiName));
                // console.log("NEW TRACK:", newTrack)
                selectedTracks.splice(dupeIndex, 0, newTrack); // Insert the new track
            } else {
                // console.log('RNG FAILED', selectedTracks[index + 1])
                // console.log(randomChance)
            }
        }

        // Only increase the index if no duplicates found, otherwise recheck the same index
        if (duplicateIndexes.length === 0) {
            index++;
        }
    }
}

// Check for and take action against penalized tracks, generating extra picks as necessary
function penalizeAndAdjustSelection(selectedCandidates, reviewCandidates, maxSongs) {

    let adjustedSelection = [...selectedCandidates];
    let remainingCandidates = [...reviewCandidates];

    penalizeDuplicateRomajiNames(adjustedSelection, remainingCandidates);
    while (adjustedSelection.length < maxSongs && remainingCandidates.length > 0) {
        // Select additional tracks if needed after penalization
        let extraPick = weightedRandomSelection(remainingCandidates, 1);
        adjustedSelection.push(extraPick)
    }

    return adjustedSelection.slice(0, maxSongs);
}

function prepareSongForTraining(tracks, maxSongs) {
    // Prepare review candidates with initial weights
    let reviewCandidates = tracks.map(track => {
        let candidate = getReviewState(track);
        candidate.weight = calculateWeight(candidate);
        return candidate;
    });
    saveSongs(reviewCandidates)

    // Randomly select tracks based on weight

    let selectedCandidates = weightedRandomSelection(reviewCandidates, maxSongs);

    // Get the final list of selected candidates after penalty adjustments
    selectedCandidates = penalizeAndAdjustSelection(selectedCandidates, reviewCandidates, maxSongs);
    return selectedCandidates
}

function startTrainingMode() {
    songOrderType = 'ascending'
    const tracks = loadSongs()
    const numSongs = parseInt($("#cslgSettingsSongs").val());
    songList = prepareSongForTraining(tracks, numSongs);
}

async function updateList() {
    // // TODO: Only one type of list (MAL/AL) can be enabled at a time
    // // TODO: save songList to localStorage to avoid calling it every time a user boots AMQ
    // function getAnilistAnimeList(username) {
    //     let query = `
    //       query {
    //         MediaListCollection(userName: "${username}", type: ANIME) {
    //           lists {
    //             entries {
    //               media {
    //                 idMal
    //                 title {
    //                   romaji
    //                 }
    //               }
    //             status
    //             }
    //           }
    //         }
    //       }
    //     `;

    //     return fetch("https://graphql.anilist.co", {
    //         method: "POST",
    //         headers: { "Content-Type": "application/json", "Accept": "application/json" },
    //         body: JSON.stringify({ query: query })
    //     }).then((res) => res.json()).then((json) => {
    //         if (json.errors) return [];
    //         let completedAnimeList = [];
    //         for (let item of json.data.MediaListCollection.lists) {
    //             // Filter to only include anime where the status is 'COMPLETED'
    //             item.entries.forEach((anime) => {
    //                 if (anime.status === 'COMPLETED') {
    //                     completedAnimeList.push(anime.media);
    //                 }
    //             });
    //         }
    //         return completedAnimeList;
    //     });
    // }
    // let anilistUsername = $("#cslgSettingsTrainingModeAniList").val().trim();
    // let animeList = await getAnilistAnimeList(anilistUsername)
    // console.log(animeList)

    let data = `[
        {
          "annId": 25176,
          "annSongId": 39567,
          "animeENName": "Alice Gear Aegis Expansion",
          "animeJPName": "Alice Gear Aegis Expansion",
          "animeAltName": null,
          "animeVintage": "Spring 2023",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Dash and Go!",
          "songArtist": "Aina Suzuki",
          "songDifficulty": 24.88,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/t442w6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/af2akq.mp3",
          "artists": [
            {
              "id": 6654,
              "names": [
                "Aina Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6648,
                  "names": [
                    "Aqours"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6918,
                  "names": [
                    "Capsule Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7387,
                  "names": [
                    "Jashin★Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13203,
                  "names": [
                    "Teppen All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10496,
              "names": [
                "Daisuke Kikuta"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10496,
              "names": [
                "Daisuke Kikuta"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25176,
          "annSongId": 39568,
          "animeENName": "Alice Gear Aegis Expansion",
          "animeJPName": "Alice Gear Aegis Expansion",
          "animeAltName": null,
          "animeVintage": "Spring 2023",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Just a little bit",
          "songArtist": "Marina Horiuchi",
          "songDifficulty": 21.22,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/gherk8.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/6wpgmk.mp3",
          "artists": [
            {
              "id": 8777,
              "names": [
                "Marina Horiuchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6024,
                  "names": [
                    "Maboroshi☆Love"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8776,
                  "names": [
                    "Healer Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 16986,
                  "names": [
                    "NO PRINCESS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14333,
              "names": [
                "Eriko Yoshiki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11710,
              "names": [
                "Daisuke Kahara"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14333,
              "names": [
                "Eriko Yoshiki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25176,
          "annSongId": 40109,
          "animeENName": "Alice Gear Aegis Expansion",
          "animeJPName": "Alice Gear Aegis Expansion",
          "animeAltName": null,
          "animeVintage": "Spring 2023",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Nakano Bojou",
          "songArtist": "Yuna Taniguchi",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/qgzd36.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/qkbc7s.mp3",
          "artists": [
            {
              "id": 18106,
              "names": [
                "Yuna Taniguchi"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18701,
              "names": [
                "Shinji Kaizu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18701,
              "names": [
                "Shinji Kaizu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 37979,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Seishun Complex",
          "songArtist": "Kessoku Band",
          "songDifficulty": 66.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/frqozi.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/emy158.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 18087,
              "names": [
                "otoha"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 37978,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Distortion!!",
          "songArtist": "Kessoku Band",
          "songDifficulty": 56.99,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/zka54p.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8j5lok.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 13166,
              "names": [
                "Maguro Taniguchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38124,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Karakara",
          "songArtist": "Kessoku Band",
          "songDifficulty": 58.04,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/s11etb.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/jj2ihg.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 8642,
                  "names": [
                    "Saku Mizuno"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 18470,
              "names": [
                "Ikkyuu Nakajima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38411,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Nani ga Warui",
          "songArtist": "Kessoku Band",
          "songDifficulty": 50.49,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/781hw6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/lxvjha.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 2,
              "groups": null,
              "members": [
                {
                  "id": 7835,
                  "names": [
                    "Sayumi Suzushiro"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 15588,
              "names": [
                "Yuuho Kitazawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38713,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "Korogaru Iwa, Kimi ni Asa ga Furu",
          "songArtist": "Kessoku Band",
          "songDifficulty": 45.37,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/e97hs2.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/e73pqj.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 3,
              "groups": null,
              "members": [
                {
                  "id": 6442,
                  "names": [
                    "Yoshino Aoyama"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 11990,
              "names": [
                "Masafumi Goto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38082,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Dakishime Magic",
          "songArtist": "AKORINGO",
          "songDifficulty": 25.06,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/epdqw3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ez02bv.mp3",
          "artists": [
            {
              "id": 7374,
              "names": [
                "AKORINGO"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15802,
              "names": [
                "Shigetoshi Yamada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15802,
              "names": [
                "Shigetoshi Yamada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38083,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "8-gatsu o Yubiori Kazoeru Kimi to Machi de Deaeru Kakuritsu ni Tsuite",
          "songArtist": "Alexandism",
          "songDifficulty": 22.92,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/mybh8f.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/a6kdwm.mp3",
          "artists": [
            {
              "id": 13967,
              "names": [
                "Alexandism"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 13968,
                  "names": [
                    "Keiki Nishida"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 13968,
              "names": [
                "Keiki Nishida"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13968,
              "names": [
                "Keiki Nishida"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38253,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Guitar to Kodoku to Aoi Hoshi",
          "songArtist": "Kessoku Band",
          "songDifficulty": 69.88,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/fosmi3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/mucloo.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 18087,
              "names": [
                "otoha"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11423,
              "names": [
                "Akkin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38412,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Ano Band",
          "songArtist": "Kessoku Band",
          "songDifficulty": 66.64,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/xqao00.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/fq2xi4.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10465,
              "names": [
                "Kayoko Kusano"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38712,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Wasurete Yaranai",
          "songArtist": "Kessoku Band",
          "songDifficulty": 69.25,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/2zdeya.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/hl7up4.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 18471,
              "names": [
                "Daichi Yoshioka"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 38715,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Seiza ni Naretara",
          "songArtist": "Kessoku Band",
          "songDifficulty": 54.99,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/jphrlp.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/xas9h7.mp3",
          "artists": [
            {
              "id": 13916,
              "names": [
                "Kessoku Band"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7929,
                  "names": [
                    "Ikumi Hasegawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 17787,
              "names": [
                "Hidemasa Naito"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18469,
              "names": [
                "Ritsuo Mitsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24062,
          "annSongId": 39897,
          "animeENName": "Bocchi the Rock!",
          "animeJPName": "Bocchi the Rock!",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Watashi dake Yuurei",
          "songArtist": "SICK HACK",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/tivja0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/5018lh.mp3",
          "artists": [
            {
              "id": 17708,
              "names": [
                "SICK HACK"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 5829,
                  "names": [
                    "Sayaka Senbongi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 16530,
              "names": [
                "Kouki Adaniya"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11423,
              "names": [
                "Akkin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24734,
          "annSongId": 39261,
          "animeENName": "To Every You I've Loved Before",
          "animeJPName": "Boku ga Aishita Subete no Kimi e",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "Kumo o Kou",
          "songArtist": "Keina Suda",
          "songDifficulty": 25.39,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/lgcoml.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/70ad55.mp3",
          "artists": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15861,
              "names": [
                "Primagic"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24734,
          "annSongId": 39262,
          "animeENName": "To Every You I've Loved Before",
          "animeJPName": "Boku ga Aishita Subete no Kimi e",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Rakka Ryuusui",
          "songArtist": "Keina Suda",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/ahkdwg.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/i7y6x6.mp3",
          "artists": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24734,
          "annSongId": 39263,
          "animeENName": "To Every You I've Loved Before",
          "animeJPName": "Boku ga Aishita Subete no Kimi e",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Shion",
          "songArtist": "Saucy Dog",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/1alvq5.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/1wjopx.mp3",
          "artists": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 17376,
                  "names": [
                    "Shinya Ishihara"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18478,
              "names": [
                "Kazuma Nagasawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22941,
          "annSongId": 34497,
          "animeENName": "Words Bubble Up Like Soda Pop",
          "animeJPName": "Cider no You ni Kotoba ga Wakiagaru",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "Cider no You ni Kotoba ga Wakiagaru",
          "songArtist": "never young beach",
          "songDifficulty": 26.26,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/engcnf.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/hl4mqu.mp3",
          "artists": [
            {
              "id": 8049,
              "names": [
                "never young beach"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14156,
                  "names": [
                    "Yuuma Abe"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14156,
              "names": [
                "Yuuma Abe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 8049,
              "names": [
                "never young beach"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22941,
          "annSongId": 34498,
          "animeENName": "Words Bubble Up Like Soda Pop",
          "animeJPName": "Cider no You ni Kotoba ga Wakiagaru",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "YAMAZAKURA",
          "songArtist": "Taeko Ohnuki",
          "songDifficulty": 19.25,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/gc5zh5.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7eroh6.mp3",
          "artists": [
            {
              "id": 1925,
              "names": [
                "Taeko Ohnuki"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 1925,
              "names": [
                "Taeko Ohnuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15763,
              "names": [
                "Hirokazu Ogura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22941,
          "annSongId": 34616,
          "animeENName": "Words Bubble Up Like Soda Pop",
          "animeJPName": "Cider no You ni Kotoba ga Wakiagaru",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Odayama Daruma Ondo",
          "songArtist": "Shohei Naruse",
          "songDifficulty": 12.88,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ecw4ja.webm",
          "MQ": "https://ladist1.catbox.video/m3hyxe.webm",
          "audio": "https://ladist1.catbox.video/lu27me.mp3",
          "artists": [
            {
              "id": 8050,
              "names": [
                "Shohei Naruse"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7244,
              "names": [
                "Kensuke Ushio",
                "agraph"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7244,
              "names": [
                "Kensuke Ushio",
                "agraph"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 127,
          "annSongId": 343,
          "animeENName": "Lupin III: The Castle of Cagliostro",
          "animeJPName": "Lupin Sansei: Cagliostro no Shiro",
          "animeAltName": null,
          "animeVintage": "Fall 1979",
          "animeType": "movie",
          "songType": "Opening 1",
          "songName": "Honoo no Takaramono",
          "songArtist": "BOBBY",
          "songDifficulty": 31.14,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/gcgxao.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/dkd8ps.mp3",
          "artists": [
            {
              "id": 267,
              "names": [
                "BOBBY"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 1543,
              "names": [
                "Yuji Ohno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 1543,
              "names": [
                "Yuji Ohno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 23545,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Kiss Me",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 72.18,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/rxijh3.webm",
          "MQ": "https://ladist1.catbox.video/ok7o7j.webm",
          "audio": "https://ladist1.catbox.video/fs1tel.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7789,
              "names": [
                "Nulbarich"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7789,
              "names": [
                "Nulbarich"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25258,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Opening 2",
          "songName": "Polly Jean",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 50.1,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/a9d3tt.webm",
          "MQ": "https://ladist1.catbox.video/gh88uk.webm",
          "audio": "https://ladist1.catbox.video/xfcig6.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5752,
              "names": [
                "Cornelius",
                "Keigo Oyamada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5752,
              "names": [
                "Cornelius",
                "Keigo Oyamada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 23546,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Hold Me Now",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 62.36,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/siprap.webm",
          "MQ": "https://ladist1.catbox.video/gw8jco.webm",
          "audio": "https://ladist1.catbox.video/0i49d1.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25261,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Not Afraid",
          "songArtist": "Alisa",
          "songDifficulty": 65.06,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/tt46n9.webm",
          "MQ": "https://ladist1.catbox.video/x6wfdb.webm",
          "audio": "https://ladist1.catbox.video/o8tccd.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15965,
              "names": [
                "Lido"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15965,
              "names": [
                "Lido"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26301,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Endless",
          "songArtist": "Alisa",
          "songDifficulty": 53.42,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/z1723z.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/eshb42.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15989,
              "names": [
                "D.A.N."
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15989,
              "names": [
                "D.A.N."
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26812,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "The Tower",
          "songArtist": "Alisa",
          "songDifficulty": 58.21,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/10nt1h.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/1v5gon.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15994,
              "names": [
                "Cole M. Greif-Neil"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15995,
              "names": [
                "Justin Hayward-Young"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15996,
              "names": [
                "Timothy Lanham"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15994,
              "names": [
                "Cole M. Greif-Neil"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15995,
              "names": [
                "Justin Hayward-Young"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15996,
              "names": [
                "Timothy Lanham"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26813,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 5",
          "songName": "Mother",
          "songArtist": "VOICES FROM MARS",
          "songDifficulty": 45.59,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/9s39u6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/widbmb.mp3",
          "artists": [
            {
              "id": 7674,
              "names": [
                "VOICES FROM MARS"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24142,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "The Loneliest Girl",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 70.25,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/fw7s98.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/f7h6dw.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24299,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Round & Laundry",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 73.9,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bx9ner.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/xpdf2v.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15028,
              "names": [
                "Maisa Tsuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15028,
              "names": [
                "Maisa Tsuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24497,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Move Mountains",
          "songArtist": "Alisa",
          "songDifficulty": 66.81,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/7x3j5u.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/f5c1tk.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15965,
              "names": [
                "Lido"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15965,
              "names": [
                "Lido"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24505,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "unrequited love",
          "songArtist": "Thundercat",
          "songDifficulty": 25.02,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/af02gv.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/j3ld6i.mp3",
          "artists": [
            {
              "id": 7663,
              "names": [
                "Thundercat"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7663,
              "names": [
                "Thundercat"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 8501,
              "names": [
                "Flying Lotus"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7663,
              "names": [
                "Thundercat"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 8501,
              "names": [
                "Flying Lotus"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24506,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Unbreakable",
          "songArtist": "Lauren Dyson",
          "songDifficulty": 66.7,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ey4gbr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bjq9d6.mp3",
          "artists": [
            {
              "id": 7664,
              "names": [
                "Lauren Dyson"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24632,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Dance Tonight",
          "songArtist": "J R Price",
          "songDifficulty": 38.58,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/i8f3cu.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ye1bve.mp3",
          "artists": [
            {
              "id": 7665,
              "names": [
                "J R Price"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15968,
              "names": [
                "G. Rina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15968,
              "names": [
                "G. Rina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24633,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Bulldog Anthem",
          "songArtist": "Hiroshi Shirokuma",
          "songDifficulty": 28.94,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/xg7qiu.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/158nz3.mp3",
          "artists": [
            {
              "id": 7666,
              "names": [
                "Hiroshi Shirokuma"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15969,
              "names": [
                "YUC'e"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15969,
              "names": [
                "YUC'e"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24634,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Whispering My Love",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 72.92,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ze3mu0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/p0qmyo.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15970,
              "names": [
                "Jen Wood"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15970,
              "names": [
                "Jen Wood"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24698,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Milky Way",
          "songArtist": "Madison McFerrin",
          "songDifficulty": 36.05,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ywqr71.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9luwlb.mp3",
          "artists": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15971,
              "names": [
                "Taylor McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15971,
              "names": [
                "Taylor McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24699,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Galactic mermaid",
          "songArtist": "Yuuri Kuriyama",
          "songDifficulty": 67.24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/255a1x.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/wcvob1.mp3",
          "artists": [
            {
              "id": 7668,
              "names": [
                "Yuuri Kuriyama"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15972,
              "names": [
                "Tokinori Kakimoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7668,
              "names": [
                "Yuuri Kuriyama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24700,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "La ballade",
          "songArtist": "Maika Loubté",
          "songDifficulty": 33.06,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vffwlm.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/lcms5a.mp3",
          "artists": [
            {
              "id": 7669,
              "names": [
                "Maika Loubté"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7669,
              "names": [
                "Maika Loubté"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7669,
              "names": [
                "Maika Loubté"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24747,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Gravity Bounce",
          "songArtist": "Madison McFerrin",
          "songDifficulty": 36.28,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/z5csl0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7jvj5f.mp3",
          "artists": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15971,
              "names": [
                "Taylor McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7667,
              "names": [
                "Madison McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15971,
              "names": [
                "Taylor McFerrin"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24748,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Love Yourself",
          "songArtist": "J R Price",
          "songDifficulty": 36.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3425co.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/c7niwn.mp3",
          "artists": [
            {
              "id": 7665,
              "names": [
                "J R Price"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15968,
              "names": [
                "G. Rina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15968,
              "names": [
                "G. Rina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24749,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "All I Want",
          "songArtist": "Alisa",
          "songDifficulty": 52.61,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/sbim2w.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/q7urtw.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15973,
              "names": [
                "Mark Redito"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15973,
              "names": [
                "Mark Redito"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 24911,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Lost My Way",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 51.53,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/rtkr8p.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/jtwlen.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15970,
              "names": [
                "Jen Wood"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15970,
              "names": [
                "Jen Wood"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15974,
              "names": [
                "Gabe Vanbenschoten"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25042,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Light A Fire",
          "songArtist": "Alisa",
          "songDifficulty": 65.89,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/gs07xj.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/or51fc.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25043,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Threads",
          "songArtist": "Eirik Glambek Bøe (King of Convenience)",
          "songDifficulty": 20.92,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/v44ors.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/e8cvdc.mp3",
          "artists": [
            {
              "id": 7670,
              "names": [
                "Eirik Glambek Bøe (King of Convenience)"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7670,
              "names": [
                "Eirik Glambek Bøe (King of Convenience)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7670,
              "names": [
                "Eirik Glambek Bøe (King of Convenience)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25262,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Breathe Again",
          "songArtist": "Alisa",
          "songDifficulty": 58.77,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/7i3dby.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/g135ll.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15975,
              "names": [
                "Alison Wonderland"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15976,
              "names": [
                "Brendon Scott"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15977,
              "names": [
                "Mark A Jackson"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15975,
              "names": [
                "Alison Wonderland"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15976,
              "names": [
                "Brendon Scott"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15977,
              "names": [
                "Mark A Jackson"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25263,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Army Of Two",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 59.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/pj7bkr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/lo7861.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15978,
              "names": [
                "Andy Platts"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15978,
              "names": [
                "Andy Platts"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25511,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Someday I'll Find My Way Home",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 57.17,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/5x1i19.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/4cyktw.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15964,
              "names": [
                "Benny Sings"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25512,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Never Die",
          "songArtist": "Singman",
          "songDifficulty": 23.23,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/03dpet.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/vwq7vp.mp3",
          "artists": [
            {
              "id": 4672,
              "names": [
                "Hiroaki Takeuchi",
                "Singman",
                "singman"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15979,
              "names": [
                "Ichirou Yoshida",
                "Ichirou Yoshida Fukashoku Sekai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15979,
              "names": [
                "Ichirou Yoshida",
                "Ichirou Yoshida Fukashoku Sekai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25605,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Miserere mei, deus",
          "songArtist": "Marker Starling",
          "songDifficulty": 19.91,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/9omwys.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/vlwuil.mp3",
          "artists": [
            {
              "id": 7671,
              "names": [
                "Marker Starling"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6782,
              "names": [
                "Tarou Umebayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6782,
              "names": [
                "Tarou Umebayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25687,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Give You The World C&T ver.",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 55.13,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ybk0fj.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/27dtke.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25888,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Threads",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 38.76,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f325sn.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/mkxpee.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7670,
              "names": [
                "Eirik Glambek Bøe (King of Convenience)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7670,
              "names": [
                "Eirik Glambek Bøe (King of Convenience)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25983,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "LIGHTS GO OUT",
          "songArtist": "Ertegun feat. Alisa",
          "songDifficulty": 41.96,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/9axskn.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/dkyqha.mp3",
          "artists": [
            {
              "id": 7662,
              "names": [
                "Alisa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7672,
              "names": [
                "Ertegun"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15980,
              "names": [
                "Jacob Summers"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15981,
              "names": [
                "MOGUAI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15982,
              "names": [
                "Ole Sturm"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15983,
              "names": [
                "Santino Holtzer"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15984,
              "names": [
                "Steve Aoki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15985,
              "names": [
                "Tyler Spry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15980,
              "names": [
                "Jacob Summers"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15981,
              "names": [
                "MOGUAI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15982,
              "names": [
                "Ole Sturm"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15983,
              "names": [
                "Santino Holtzer"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15984,
              "names": [
                "Steve Aoki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15985,
              "names": [
                "Tyler Spry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 25984,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Message in the Wind",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 59.36,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/4ub4zx.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/va8p3l.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15986,
              "names": [
                "Sensei Bueno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15986,
              "names": [
                "Sensei Bueno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26051,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Beautiful Breakdown",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 41.6,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/d4qb5d.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ntyoh1.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6782,
              "names": [
                "Tarou Umebayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6782,
              "names": [
                "Tarou Umebayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26052,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Crash The Server",
          "songArtist": "Denzel Curry",
          "songDifficulty": 39.68,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/2hmvae.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bpiehx.mp3",
          "artists": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15987,
              "names": [
                "Steven D Ellison"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15987,
              "names": [
                "Steven D Ellison"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26237,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Lonestar Jazz",
          "songArtist": "Denzel Curry",
          "songDifficulty": 30.39,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/6yd0bv.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/o7uw4z.mp3",
          "artists": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15987,
              "names": [
                "Steven D Ellison"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7673,
              "names": [
                "Denzel Curry"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15987,
              "names": [
                "Steven D Ellison"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26241,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Lay It All On Me",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 46.11,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/76ba5s.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/qasqfj.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15988,
              "names": [
                "Isaac Gracie"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15988,
              "names": [
                "Isaac Gracie"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26302,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "After the Fire",
          "songArtist": "Nai Br.XX&Celeina Ann feat. Lauren Dyson",
          "songDifficulty": 59.43,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/fgzhoe.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7zoqep.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7664,
              "names": [
                "Lauren Dyson"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15990,
              "names": [
                "Fraser T Smith"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15991,
              "names": [
                "Tim Rice-Oxley"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15990,
              "names": [
                "Fraser T Smith"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15991,
              "names": [
                "Tim Rice-Oxley"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26303,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Happy Birthday",
          "songArtist": "Celeina Ann",
          "songDifficulty": 77.61,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/e8cgjx.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/mqbjne.mp3",
          "artists": [
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15992,
              "names": [
                "Mildred J. Hill"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15993,
              "names": [
                "Patty Smith Hill"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26814,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Day By Day",
          "songArtist": "Nai Br.XX&Celeina Ann",
          "songDifficulty": 56.36,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bxq48f.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/zq34x9.mp3",
          "artists": [
            {
              "id": 7660,
              "names": [
                "Nai Br.XX"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 7661,
              "names": [
                "Celeina Ann"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15997,
              "names": [
                "Shouhei Takagi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15998,
              "names": [
                "Cero"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26815,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "All I See",
          "songArtist": "Marker Starling",
          "songDifficulty": 23.91,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/x6c9o0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/rtgcg2.mp3",
          "artists": [
            {
              "id": 7671,
              "names": [
                "Marker Starling"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15999,
              "names": [
                "Yahyel"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15999,
              "names": [
                "Yahyel"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 26816,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Give You The World",
          "songArtist": "Jessica Karpov",
          "songDifficulty": 63.63,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/wvndn0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/4igjvx.mp3",
          "artists": [
            {
              "id": 7675,
              "names": [
                "Jessica Karpov"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15966,
              "names": [
                "Evan Bogart"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15967,
              "names": [
                "Justin Gray"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 34879,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Who am I the Greatest",
          "songArtist": "Ertegun",
          "songDifficulty": 18.25,
          "songCategory": "Instrumental",
          "HQ": "https://ladist1.catbox.video/m7x7j3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/m8dh6x.mp3",
          "artists": [
            {
              "id": 7672,
              "names": [
                "Ertegun"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5192,
              "names": [
                "☆Taku Takahashi",
                "☆Taku Takahashi (m-flo)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5192,
              "names": [
                "☆Taku Takahashi",
                "☆Taku Takahashi (m-flo)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21557,
          "annSongId": 34880,
          "animeENName": "Carole & Tuesday",
          "animeJPName": "Carole & Tuesday",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Take Me Now",
          "songArtist": "Ertegun",
          "songDifficulty": 29.08,
          "songCategory": "Instrumental",
          "HQ": "https://ladist1.catbox.video/y7kdsb.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/l13qqz.mp3",
          "artists": [
            {
              "id": 7672,
              "names": [
                "Ertegun"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 16000,
              "names": [
                "banvox"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16000,
              "names": [
                "banvox"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 37888,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "KICK BACK",
          "songArtist": "Kenshi Yonezu",
          "songDifficulty": 80.2,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/wx6gbd.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/c7kkmy.mp3",
          "artists": [
            {
              "id": 6730,
              "names": [
                "Kenshi Yonezu"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6730,
              "names": [
                "Kenshi Yonezu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6730,
              "names": [
                "Kenshi Yonezu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15746,
              "names": [
                "Daiki Tsuneta"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 37889,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "CHAINSAW BLOOD",
          "songArtist": "Vaundy",
          "songDifficulty": 59.76,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/p9bkcr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/31jb1l.mp3",
          "artists": [
            {
              "id": 8637,
              "names": [
                "Vaundy"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 8637,
              "names": [
                "Vaundy"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 8637,
              "names": [
                "Vaundy"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38055,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Zanki",
          "songArtist": "Zutto Mayonaka de Iinoni.",
          "songDifficulty": 41.9,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/m8kgbj.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/tg2j1z.mp3",
          "artists": [
            {
              "id": 13828,
              "names": [
                "Zutto Mayonaka de Iinoni."
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 13966,
                  "names": [
                    "ACA-ne"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 18439,
              "names": [
                "ACANe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13828,
              "names": [
                "Zutto Mayonaka de Iinoni."
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18440,
              "names": [
                "100-kai Outo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38086,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Hawatari 2-oku Centi",
          "songArtist": "Maximum the Hormone",
          "songDifficulty": 57.33,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/u2tlb4.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ik065w.mp3",
          "artists": [
            {
              "id": 187,
              "names": [
                "Maximum the Hormone"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 4747,
                  "names": [
                    "Maximum the Ryo-kun",
                    "Maximum the Ryo-kun (Maximum the Hormone)"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 9383,
                  "names": [
                    "Daisuke Tsuda"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 4747,
              "names": [
                "Maximum the Ryo-kun",
                "Maximum the Ryo-kun (Maximum the Hormone)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 4747,
              "names": [
                "Maximum the Ryo-kun",
                "Maximum the Ryo-kun (Maximum the Hormone)"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38175,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "Jouzai",
          "songArtist": "TOOBOE",
          "songDifficulty": 56.96,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ls0c01.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/b3pe11.mp3",
          "artists": [
            {
              "id": 14016,
              "names": [
                "TOOBOE"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14016,
              "names": [
                "TOOBOE"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14016,
              "names": [
                "TOOBOE"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38277,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 5",
          "songName": "In The Back Room",
          "songArtist": "syudou",
          "songDifficulty": 54.77,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/m0qduc.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/vxmt5d.mp3",
          "artists": [
            {
              "id": 8476,
              "names": [
                "syudou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 8476,
              "names": [
                "syudou"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 8476,
              "names": [
                "syudou"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38324,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 6",
          "songName": "Dainou-teki na Rendezvous",
          "songArtist": "Kanaria",
          "songDifficulty": 46.47,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/qk41os.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/pnore2.mp3",
          "artists": [
            {
              "id": 16602,
              "names": [
                "Kanaria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 16602,
              "names": [
                "Kanaria"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16602,
              "names": [
                "Kanaria"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38388,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 7",
          "songName": "Chu, Tayousei.",
          "songArtist": "ano",
          "songDifficulty": 34.12,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/k64po0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/qnhpzd.mp3",
          "artists": [
            {
              "id": 8798,
              "names": [
                "ano"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14884,
              "names": [
                "Shuichi Mabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15318,
              "names": [
                "Taku Inoue"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38425,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 8",
          "songName": "first death",
          "songArtist": "TK from Ling Tosite Sigure",
          "songDifficulty": 55.95,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/pz9aq0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/g5q99o.mp3",
          "artists": [
            {
              "id": 4055,
              "names": [
                "TK from Ling Tosite Sigure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5518,
                  "names": [
                    "Ling Tosite Sigure"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 4055,
              "names": [
                "TK from Ling Tosite Sigure"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 4055,
              "names": [
                "TK from Ling Tosite Sigure"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38471,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 9",
          "songName": "Deep down",
          "songArtist": "Aimer",
          "songDifficulty": 42.33,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/3vl9do.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/hyj8ki.mp3",
          "artists": [
            {
              "id": 3441,
              "names": [
                "Aimer"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18478,
              "names": [
                "Kazuma Nagasawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11997,
              "names": [
                "Rui Momota"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 12589,
              "names": [
                "Kenji Tamai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38600,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 10",
          "songName": "DOGLAND",
          "songArtist": "PEOPLE 1",
          "songDifficulty": 45.83,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/cf3u6r.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8i9tsb.mp3",
          "artists": [
            {
              "id": 16841,
              "names": [
                "PEOPLE 1"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 16855,
                  "names": [
                    "Deu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 16855,
              "names": [
                "Deu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16855,
              "names": [
                "Deu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18479,
              "names": [
                "Hajime Taguchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38601,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 11",
          "songName": "Violence",
          "songArtist": "Ziyoou-vachi",
          "songDifficulty": 39.82,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/3gtv01.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/j5er5k.mp3",
          "artists": [
            {
              "id": 7285,
              "names": [
                "Ziyoou-vachi"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 7243,
                  "names": [
                    "Avu-chan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 7243,
              "names": [
                "Avu-chan"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7285,
              "names": [
                "Ziyoou-vachi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15737,
              "names": [
                "Kouji Tsukada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23843,
          "annSongId": 38731,
          "animeENName": "Chainsaw Man",
          "animeJPName": "Chainsaw Man",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Ending 12",
          "songName": "Fight Song",
          "songArtist": "Eve",
          "songDifficulty": 50.55,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/c1qz1n.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/n1bdyz.mp3",
          "artists": [
            {
              "id": 10350,
              "names": [
                "Eve"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10350,
              "names": [
                "Eve"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15860,
              "names": [
                "Numa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18556,
          "annSongId": 16122,
          "animeENName": "Chäos;Child",
          "animeJPName": "Chäos;Child",
          "animeAltName": null,
          "animeVintage": "Winter 2017",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Uncontrollable",
          "songArtist": "Kanako Itou",
          "songDifficulty": 49.32,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/jjb93w.webm",
          "MQ": "https://ladist1.catbox.video/zk746s.webm",
          "audio": "https://ladist1.catbox.video/gnwm5v.mp3",
          "artists": [
            {
              "id": 2977,
              "names": [
                "Kanako Itou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10522,
              "names": [
                "Chiyomaru Shikura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14415,
              "names": [
                "Shinichi Yuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18556,
          "annSongId": 20298,
          "animeENName": "Chäos;Child",
          "animeJPName": "Chäos;Child",
          "animeAltName": null,
          "animeVintage": "Winter 2017",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Find the blue",
          "songArtist": "Kanako Itou",
          "songDifficulty": 25.73,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/s7ckhx.webm",
          "MQ": "https://ladist1.catbox.video/nm4rhe.webm",
          "audio": "https://ladist1.catbox.video/ycv6x6.mp3",
          "artists": [
            {
              "id": 2977,
              "names": [
                "Kanako Itou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10522,
              "names": [
                "Chiyomaru Shikura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10481,
              "names": [
                "Toshimichi Isoe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18556,
          "annSongId": 16123,
          "animeENName": "Chäos;Child",
          "animeJPName": "Chäos;Child",
          "animeAltName": null,
          "animeVintage": "Winter 2017",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Chaos Syndrome",
          "songArtist": "Konomi Suzuki",
          "songDifficulty": 20.76,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/jk7ccs.webm",
          "MQ": "https://ladist1.catbox.video/4ik3tf.webm",
          "audio": "https://ladist1.catbox.video/n7cv4s.mp3",
          "artists": [
            {
              "id": 5440,
              "names": [
                "Konomi Suzuki",
                "Koneko Yasagure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5870,
                  "names": [
                    "AG7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10522,
              "names": [
                "Chiyomaru Shikura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14415,
              "names": [
                "Shinichi Yuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 10182,
          "annSongId": 9808,
          "animeENName": "ChäoS;HEAd",
          "animeJPName": "ChäoS;HEAd",
          "animeAltName": null,
          "animeVintage": "Fall 2008",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "F.D.D.",
          "songArtist": "Kanako Itou",
          "songDifficulty": 45.96,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/jgx32d.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/f1jsuh.mp3",
          "artists": [
            {
              "id": 2977,
              "names": [
                "Kanako Itou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10522,
              "names": [
                "Chiyomaru Shikura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10481,
              "names": [
                "Toshimichi Isoe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 10182,
          "annSongId": 9810,
          "animeENName": "ChäoS;HEAd",
          "animeJPName": "ChäoS;HEAd",
          "animeAltName": null,
          "animeVintage": "Fall 2008",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Super Special",
          "songArtist": "Seira Kagami",
          "songDifficulty": 30.09,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/5s3m91.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/0n7mb7.mp3",
          "artists": [
            {
              "id": 4480,
              "names": [
                "Seira Kagami",
                "𝄞Seira"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14328,
              "names": [
                "Koichi Makai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14329,
              "names": [
                "Masanobu Komaba"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14330,
              "names": [
                "Takashi Ikezawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 10182,
          "annSongId": 34504,
          "animeENName": "ChäoS;HEAd",
          "animeJPName": "ChäoS;HEAd",
          "animeAltName": null,
          "animeVintage": "Fall 2008",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "D.P.",
          "songArtist": "Kanako Itou",
          "songDifficulty": 18.45,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/njlxx5.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/wxr6z7.mp3",
          "artists": [
            {
              "id": 2977,
              "names": [
                "Kanako Itou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10481,
              "names": [
                "Toshimichi Isoe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10481,
              "names": [
                "Toshimichi Isoe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 10182,
          "annSongId": 9811,
          "animeENName": "ChäoS;HEAd",
          "animeJPName": "ChäoS;HEAd",
          "animeAltName": null,
          "animeVintage": "Fall 2008",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Haritsuke no Misa",
          "songArtist": "Phantasm",
          "songDifficulty": 18.6,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vlalbf.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/rn4rsi.mp3",
          "artists": [
            {
              "id": 4736,
              "names": [
                "Phantasm"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 4033,
                  "names": [
                    "Yui Sakakibara"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14331,
              "names": [
                "Tatsushi Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14331,
              "names": [
                "Tatsushi Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 10182,
          "annSongId": 9812,
          "animeENName": "ChäoS;HEAd",
          "animeJPName": "ChäoS;HEAd",
          "animeAltName": null,
          "animeVintage": "Fall 2008",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Harukanaru Idiyona",
          "songArtist": "Phantasm",
          "songDifficulty": 21.35,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/mxn4g3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/gaqw9x.mp3",
          "artists": [
            {
              "id": 4736,
              "names": [
                "Phantasm"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 4033,
                  "names": [
                    "Yui Sakakibara"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14331,
              "names": [
                "Tatsushi Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14331,
              "names": [
                "Tatsushi Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 862,
          "annSongId": 2321,
          "animeENName": "Cosplay Complex",
          "animeJPName": "Cosplay Complex",
          "animeAltName": null,
          "animeVintage": "Spring 2002",
          "animeType": "OVA",
          "songType": "Opening 1",
          "songName": "Moetekoso Cosplay",
          "songArtist": "Sakura Nogawa, Chiaki Takahashi, Akeno Watanabe, Rie Kugimiya, Ai Shimizu, Saeko Chiba",
          "songDifficulty": 14.22,
          "songCategory": "Standard",
          "HQ": null,
          "MQ": "https://ladist1.catbox.video/a8xei2.webm",
          "audio": "https://ladist1.catbox.video/88nvyh.mp3",
          "artists": [
            {
              "id": 810,
              "names": [
                "Sakura Nogawa",
                "LUNAR"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 1924,
                  "names": [
                    "P.E.T.S."
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4318,
                  "names": [
                    "SUN&LUNAR"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4648,
                  "names": [
                    "PNGN 6"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4667,
                  "names": [
                    "Setobana Angels"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5157,
                  "names": [
                    "Dai 501 Tougou Sentou Koukuu-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17169,
                  "names": [
                    "Lovedol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17170,
                  "names": [
                    "Lovedol 1-kisei"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1491,
              "names": [
                "Chiaki Takahashi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 1802,
                  "names": [
                    "Aice⁵"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5013,
                  "names": [
                    "765PRO ALLSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5123,
                  "names": [
                    "Love♥Roulettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5186,
                  "names": [
                    "Alex 3"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5252,
                  "names": [
                    "Ryuuguu Komachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5681,
                  "names": [
                    "Puchidol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13581,
                  "names": [
                    "Almost The Entire Fucking Cast"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19132,
                  "names": [
                    "exige"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1492,
              "names": [
                "Akeno Watanabe"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 2381,
                  "names": [
                    "Kaleido Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3098,
                  "names": [
                    "Five Spirits"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3484,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A",
                    "Mahora Gakuen Chuutoubu 3-A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3769,
                  "names": [
                    "Amae-tai!!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17087,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A Shishou to Nayameru Otome-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1493,
              "names": [
                "Rie Kugimiya"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3094,
                  "names": [
                    "Atena☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4440,
                  "names": [
                    "Astral no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4571,
                  "names": [
                    "Kemeko to Deluxe"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4832,
                  "names": [
                    "Hataraku Shoujo-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5013,
                  "names": [
                    "765PRO ALLSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5161,
                  "names": [
                    "Precure All Stars",
                    "Precure All Stars 21"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5252,
                  "names": [
                    "Ryuuguu Komachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5376,
                  "names": [
                    "Ushiro kara Haiyori-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5417,
                  "names": [
                    "Love♥Stay"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5643,
                  "names": [
                    "Rain Boys"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5681,
                  "names": [
                    "Puchidol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5713,
                  "names": [
                    "RAMM ni Haiyoru Jashin-san"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6340,
                  "names": [
                    "Team AA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17159,
                  "names": [
                    "Samurai Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17171,
                  "names": [
                    "Lovedol 2-kisei"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17677,
                  "names": [
                    "The Capucchu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1494,
              "names": [
                "Ai Shimizu"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 2718,
                  "names": [
                    "Lime-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3351,
                  "names": [
                    "PoppinS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4175,
                  "names": [
                    "Love Pheromone"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13948,
                  "names": [
                    "Ryuumonbuchi Koukou Mahjong-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1495,
              "names": [
                "Saeko Chiba"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 785,
                  "names": [
                    "Yukinon's"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 1924,
                  "names": [
                    "P.E.T.S."
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 2426,
                  "names": [
                    "Shading Musume"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 2954,
                  "names": [
                    "tiaraway"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8262,
                  "names": [
                    "Four Seasons"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17476,
                  "names": [
                    "Guardian"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17677,
                  "names": [
                    "The Capucchu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10556,
              "names": [
                "Masashi Chizawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10559,
              "names": [
                "Kenichi Sudou"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 862,
          "annSongId": 2322,
          "animeENName": "Cosplay Complex",
          "animeJPName": "Cosplay Complex",
          "animeAltName": null,
          "animeVintage": "Spring 2002",
          "animeType": "OVA",
          "songType": "Ending 1",
          "songName": "Cosplay Ondo",
          "songArtist": "Sakura Nogawa, Chiaki Takahashi, Akeno Watanabe, Rie Kugimiya, Ai Shimizu, Saeko Chiba",
          "songDifficulty": 15.7,
          "songCategory": "Standard",
          "HQ": null,
          "MQ": "https://ladist1.catbox.video/0gkyee.webm",
          "audio": "https://ladist1.catbox.video/zpmtf3.mp3",
          "artists": [
            {
              "id": 810,
              "names": [
                "Sakura Nogawa",
                "LUNAR"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 1924,
                  "names": [
                    "P.E.T.S."
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4318,
                  "names": [
                    "SUN&LUNAR"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4648,
                  "names": [
                    "PNGN 6"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4667,
                  "names": [
                    "Setobana Angels"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5157,
                  "names": [
                    "Dai 501 Tougou Sentou Koukuu-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17169,
                  "names": [
                    "Lovedol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17170,
                  "names": [
                    "Lovedol 1-kisei"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1491,
              "names": [
                "Chiaki Takahashi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 1802,
                  "names": [
                    "Aice⁵"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5013,
                  "names": [
                    "765PRO ALLSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5123,
                  "names": [
                    "Love♥Roulettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5186,
                  "names": [
                    "Alex 3"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5252,
                  "names": [
                    "Ryuuguu Komachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5681,
                  "names": [
                    "Puchidol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13581,
                  "names": [
                    "Almost The Entire Fucking Cast"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19132,
                  "names": [
                    "exige"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1492,
              "names": [
                "Akeno Watanabe"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 2381,
                  "names": [
                    "Kaleido Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3098,
                  "names": [
                    "Five Spirits"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3484,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A",
                    "Mahora Gakuen Chuutoubu 3-A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3769,
                  "names": [
                    "Amae-tai!!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17087,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A Shishou to Nayameru Otome-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1493,
              "names": [
                "Rie Kugimiya"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3094,
                  "names": [
                    "Atena☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4440,
                  "names": [
                    "Astral no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4571,
                  "names": [
                    "Kemeko to Deluxe"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4832,
                  "names": [
                    "Hataraku Shoujo-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5013,
                  "names": [
                    "765PRO ALLSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5161,
                  "names": [
                    "Precure All Stars",
                    "Precure All Stars 21"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5252,
                  "names": [
                    "Ryuuguu Komachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5376,
                  "names": [
                    "Ushiro kara Haiyori-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5417,
                  "names": [
                    "Love♥Stay"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5643,
                  "names": [
                    "Rain Boys"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5681,
                  "names": [
                    "Puchidol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5713,
                  "names": [
                    "RAMM ni Haiyoru Jashin-san"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6340,
                  "names": [
                    "Team AA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17159,
                  "names": [
                    "Samurai Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17171,
                  "names": [
                    "Lovedol 2-kisei"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17677,
                  "names": [
                    "The Capucchu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1494,
              "names": [
                "Ai Shimizu"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 2718,
                  "names": [
                    "Lime-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3351,
                  "names": [
                    "PoppinS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4175,
                  "names": [
                    "Love Pheromone"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13948,
                  "names": [
                    "Ryuumonbuchi Koukou Mahjong-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 1495,
              "names": [
                "Saeko Chiba"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 785,
                  "names": [
                    "Yukinon's"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 1924,
                  "names": [
                    "P.E.T.S."
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 2426,
                  "names": [
                    "Shading Musume"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 2954,
                  "names": [
                    "tiaraway"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8262,
                  "names": [
                    "Four Seasons"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17476,
                  "names": [
                    "Guardian"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17677,
                  "names": [
                    "The Capucchu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10138,
              "names": [
                "Ritsuko Miyajima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10559,
              "names": [
                "Kenichi Sudou"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24494,
          "annSongId": 37758,
          "animeENName": "DEEMO Memorial Keys",
          "animeJPName": "Gekijouban Deemo: Sakura no Oto - Anata no Kanadeta Oto ga, Ima mo Hibiku",
          "animeAltName": null,
          "animeVintage": "Winter 2022",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "nocturne",
          "songArtist": "Hinano",
          "songDifficulty": 18.36,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/gtrw72.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/224irs.mp3",
          "artists": [
            {
              "id": 13812,
              "names": [
                "Hinano"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3019,
              "names": [
                "Yuki Kajiura",
                "Fion"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3019,
              "names": [
                "Yuki Kajiura",
                "Fion"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24494,
          "annSongId": 37760,
          "animeENName": "DEEMO Memorial Keys",
          "animeJPName": "Gekijouban Deemo: Sakura no Oto - Anata no Kanadeta Oto ga, Ima mo Hibiku",
          "animeAltName": null,
          "animeVintage": "Winter 2022",
          "animeType": "movie",
          "songType": "Ending 2",
          "songName": "Deemo Main Theme",
          "songArtist": "Wen Tzu-Chieh",
          "songDifficulty": 21.32,
          "songCategory": "Instrumental",
          "HQ": "https://ladist1.catbox.video/5nu2mf.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/quz43e.mp3",
          "artists": [],
          "composers": [
            {
              "id": 13813,
              "names": [
                "Wen Tzu-Chieh"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11908,
              "names": [
                "Yoshichika Kuriyama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24494,
          "annSongId": 37756,
          "animeENName": "DEEMO Memorial Keys",
          "animeJPName": "Gekijouban Deemo: Sakura no Oto - Anata no Kanadeta Oto ga, Ima mo Hibiku",
          "animeAltName": null,
          "animeVintage": "Winter 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Kakurenbo",
          "songArtist": "Aira Yuuki",
          "songDifficulty": 21.04,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/l2urk0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7odzzo.mp3",
          "artists": [
            {
              "id": 3936,
              "names": [
                "Aira Yuuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3396,
                  "names": [
                    "FictionJunction ASUKA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14598,
              "names": [
                "Shiho Terada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14598,
              "names": [
                "Shiho Terada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24494,
          "annSongId": 37757,
          "animeENName": "DEEMO Memorial Keys",
          "animeJPName": "Gekijouban Deemo: Sakura no Oto - Anata no Kanadeta Oto ga, Ima mo Hibiku",
          "animeAltName": null,
          "animeVintage": "Winter 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Haru no Sora e to",
          "songArtist": "Akari Kitou & Ayane Sakura",
          "songDifficulty": 14.73,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/nl8twj.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/b9gwro.mp3",
          "artists": [
            {
              "id": 5113,
              "names": [
                "Ayane Sakura"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5460,
                  "names": [
                    "Sprouts"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5526,
                  "names": [
                    "Goku♨Rakujokai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5668,
                  "names": [
                    "Fujijo Seitokai Shikkou-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5782,
                  "names": [
                    "Occult Kenkyuu-bu Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6218,
                  "names": [
                    "Plasmagica"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6340,
                  "names": [
                    "Team AA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6361,
                  "names": [
                    "Petit Rabbit's"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6367,
                  "names": [
                    "THREE"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6914,
                  "names": [
                    "Petit Rabbit's with beans"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7089,
                  "names": [
                    "Shinjugamine Jogakuen Hoshimori Class"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7652,
                  "names": [
                    "Nakano-ke no Itsutsugo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7687,
                  "names": [
                    "Lightning Shadows"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7941,
                  "names": [
                    "Teikoku Kageki-dan・Hana-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8364,
                  "names": [
                    "team Umifure"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8565,
                  "names": [
                    "YuiLevi♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13931,
                  "names": [
                    "Gatajo DIY-bu!!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13969,
                  "names": [
                    "Prizmmy☆Voice Actress"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 7085,
              "names": [
                "Akari Kitou"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7144,
                  "names": [
                    "Blend・A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7431,
                  "names": [
                    "Uma Musume",
                    "Uma Musume 2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7436,
                  "names": [
                    "Wiseman"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7547,
                  "names": [
                    "Wataten☆5"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7730,
                  "names": [
                    "KiRaRe"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7771,
                  "names": [
                    "shami momo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7772,
                  "names": [
                    "Kouro Machikado"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8029,
                  "names": [
                    "Nijigasaki Gakuen School Idol Doukoukai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8063,
                  "names": [
                    "Adachi to Shimamura"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8437,
                  "names": [
                    "Mystery Kiss"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8695,
                  "names": [
                    "Roubai Gakuen Chuutoubu 1-nen 3-kumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8780,
                  "names": [
                    "QU4RTZ"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13524,
                  "names": [
                    "Chat Noir"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17531,
                  "names": [
                    "Umayuru"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18433,
              "names": [
                "Inagi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18433,
              "names": [
                "Inagi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24494,
          "annSongId": 37759,
          "animeENName": "DEEMO Memorial Keys",
          "animeJPName": "Gekijouban Deemo: Sakura no Oto - Anata no Kanadeta Oto ga, Ima mo Hibiku",
          "animeAltName": null,
          "animeVintage": "Winter 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "inside a dream",
          "songArtist": "Joelle",
          "songDifficulty": 10.45,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/o7c5du.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/cbcls9.mp3",
          "artists": [
            {
              "id": 3334,
              "names": [
                "Joelle"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3019,
              "names": [
                "Yuki Kajiura",
                "Fion"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3019,
              "names": [
                "Yuki Kajiura",
                "Fion"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 27422,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Welcome to Chaos",
          "songArtist": "(K)NoW_NAME:Ayaka Tachibana",
          "songDifficulty": 55.61,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/eqzpzb.webm",
          "MQ": "https://ladist1.catbox.video/7358gy.webm",
          "audio": "https://ladist1.catbox.video/3ibzo1.mp3",
          "artists": [
            {
              "id": 6577,
              "names": [
                "Ayaka Tachibana"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10372,
              "names": [
                "Makoto Miyazaki",
                "Ptolemaios[(K)NoW_NAME:Makoto Miyazaki]"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10372,
              "names": [
                "Makoto Miyazaki",
                "Ptolemaios[(K)NoW_NAME:Makoto Miyazaki]"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 27778,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Who am I?",
          "songArtist": "(K)NoW_NAME:Ayaka Tachibana & NIKIIE",
          "songDifficulty": 48.67,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/i7swn3.webm",
          "MQ": "https://ladist1.catbox.video/828k8i.webm",
          "audio": "https://ladist1.catbox.video/yp1qrw.mp3",
          "artists": [
            {
              "id": 6577,
              "names": [
                "Ayaka Tachibana"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 6578,
              "names": [
                "NIKIIE"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10372,
              "names": [
                "Makoto Miyazaki",
                "Ptolemaios[(K)NoW_NAME:Makoto Miyazaki]"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10372,
              "names": [
                "Makoto Miyazaki",
                "Ptolemaios[(K)NoW_NAME:Makoto Miyazaki]"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 27894,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Night SURFING",
          "songArtist": "(K)NoW_NAME:Ayaka Tachibana",
          "songDifficulty": 42.85,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/tugpn2.webm",
          "MQ": "https://ladist1.catbox.video/lkefc1.webm",
          "audio": "https://ladist1.catbox.video/03llsp.mp3",
          "artists": [
            {
              "id": 6577,
              "names": [
                "Ayaka Tachibana"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15154,
              "names": [
                "Shuhei Mutsuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15154,
              "names": [
                "Shuhei Mutsuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 28057,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "D.D.D.D.",
          "songArtist": "(K)NoW_NAME:NIKIIE",
          "songDifficulty": 49.97,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/timams.webm",
          "MQ": "https://ladist1.catbox.video/1zd5xn.webm",
          "audio": "https://ladist1.catbox.video/wj2npw.mp3",
          "artists": [
            {
              "id": 6578,
              "names": [
                "NIKIIE"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15154,
              "names": [
                "Shuhei Mutsuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15154,
              "names": [
                "Shuhei Mutsuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 28349,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "Strange Meat Pie",
          "songArtist": "(K)NoW_NAME:Ayaka Tachibana",
          "songDifficulty": 42.54,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bisix3.webm",
          "MQ": "https://ladist1.catbox.video/1ey8k7.webm",
          "audio": "https://ladist1.catbox.video/agb117.mp3",
          "artists": [
            {
              "id": 6577,
              "names": [
                "Ayaka Tachibana"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14892,
              "names": [
                "Tetsuya Shitara"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14892,
              "names": [
                "Tetsuya Shitara"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 28574,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 5",
          "songName": "SECONDs FLY",
          "songArtist": "(K)NoW_NAME:NIKIIE",
          "songDifficulty": 38.43,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/i7edi3.webm",
          "MQ": "https://ladist1.catbox.video/de9auc.webm",
          "audio": "https://ladist1.catbox.video/ik2pds.mp3",
          "artists": [
            {
              "id": 6578,
              "names": [
                "NIKIIE"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 12795,
              "names": [
                "Hiromitsu Kawashima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 12795,
              "names": [
                "Hiromitsu Kawashima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 28783,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 6",
          "songName": "404",
          "songArtist": "(K)NoW_NAME:NIKIIE & AIJ",
          "songDifficulty": 40.06,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/z9xssy.webm",
          "MQ": "https://ladist1.catbox.video/x35jxl.webm",
          "audio": "https://ladist1.catbox.video/txubzk.mp3",
          "artists": [
            {
              "id": 6578,
              "names": [
                "NIKIIE"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 6579,
              "names": [
                "AIJ"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14892,
              "names": [
                "Tetsuya Shitara"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6576,
              "names": [
                "(K)NoW_NAME",
                "KNoW_NAME"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14892,
              "names": [
                "Tetsuya Shitara"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22562,
          "annSongId": 28463,
          "animeENName": "Dorohedoro",
          "animeJPName": "Dorohedoro",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Dream Kinoko",
          "songArtist": "Kenyuu Horiuchi",
          "songDifficulty": 24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/b39gpi.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ik1h2q.mp3",
          "artists": [
            {
              "id": 93,
              "names": [
                "Kenyuu Horiuchi"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3686,
              "names": [
                "STEREO DIVE FOUNDATION",
                "R・O・N"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3686,
              "names": [
                "STEREO DIVE FOUNDATION",
                "R・O・N"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15245,
          "annSongId": 13262,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Summer 2013",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "starlog",
          "songArtist": "ChouCho",
          "songDifficulty": 52.38,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3r2had.webm",
          "MQ": "https://ladist1.catbox.video/cfqh1f.webm",
          "audio": "https://ladist1.catbox.video/khidi5.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15245,
          "annSongId": 13264,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Summer 2013",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Prism Sympathy",
          "songArtist": "StylipS",
          "songDifficulty": 37.46,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/xo61mw.webm",
          "MQ": "https://ladist1.catbox.video/9ccqzg.webm",
          "audio": "https://ladist1.catbox.video/20aw35.mp3",
          "artists": [
            {
              "id": 5374,
              "names": [
                "StylipS"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 5841,
                  "names": [
                    "Arisa Noto"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7973,
                  "names": [
                    "Maho Matsunaga"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5934,
                  "names": [
                    "Moe Toyota"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6035,
                  "names": [
                    "Miku Itou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15245,
          "annSongId": 13265,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Summer 2013",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Tsunagu Kizuna Tsutsumu Kodoku",
          "songArtist": "StylipS",
          "songDifficulty": 19.29,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/d5s57l.webm",
          "MQ": "https://ladist1.catbox.video/2lrjsi.webm",
          "audio": "https://ladist1.catbox.video/1vnrxh.mp3",
          "artists": [
            {
              "id": 5374,
              "names": [
                "StylipS"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 5841,
                  "names": [
                    "Arisa Noto"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7973,
                  "names": [
                    "Maho Matsunaga"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5934,
                  "names": [
                    "Moe Toyota"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6035,
                  "names": [
                    "Miku Itou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15245,
          "annSongId": 13266,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Summer 2013",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "kagami",
          "songArtist": "ChouCho",
          "songDifficulty": 18.09,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/swwmcd.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7flmow.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15630,
          "annSongId": 13605,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeAltName": null,
          "animeVintage": "Summer 2014",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "moving soul",
          "songArtist": "Minami Kuribayashi",
          "songDifficulty": 45.67,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f5ny75.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/2acsys.mp3",
          "artists": [
            {
              "id": 2434,
              "names": [
                "Minami Kuribayashi",
                "Minami"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19132,
                  "names": [
                    "exige"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14860,
              "names": [
                "Satoru Kuwabara",
                "Fandelmale"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14930,
              "names": [
                "Takuya Sakai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15630,
          "annSongId": 13606,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeAltName": null,
          "animeVintage": "Summer 2014",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "TWO BY TWO",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 33.58,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/nsah1d.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/2o7552.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15635,
          "annSongId": 20634,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Winter 2014",
          "animeType": "OVA",
          "songType": "Opening 1",
          "songName": "starlog",
          "songArtist": "ChouCho",
          "songDifficulty": 55.63,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3r2had.webm",
          "MQ": "https://ladist1.catbox.video/cfqh1f.webm",
          "audio": "https://ladist1.catbox.video/khidi5.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15635,
          "annSongId": 20633,
          "animeENName": "Fate/kaleid liner Prisma☆Illya",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya",
          "animeAltName": null,
          "animeVintage": "Winter 2014",
          "animeType": "OVA",
          "songType": "Insert Song",
          "songName": "Prism Sympathy",
          "songArtist": "StylipS",
          "songDifficulty": 41.93,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/6w5qtw.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/m365o0.mp3",
          "artists": [
            {
              "id": 5374,
              "names": [
                "StylipS"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 5841,
                  "names": [
                    "Arisa Noto"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7973,
                  "names": [
                    "Maho Matsunaga"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5934,
                  "names": [
                    "Moe Toyota"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6035,
                  "names": [
                    "Miku Itou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 14528,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Wonder Stella",
          "songArtist": "fhána",
          "songDifficulty": 42.31,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/eqwdnt.webm",
          "MQ": "https://ladist1.catbox.video/srhrig.webm",
          "audio": "https://ladist1.catbox.video/run9u5.mp3",
          "artists": [
            {
              "id": 5783,
              "names": [
                "fhána"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 10234,
                  "names": [
                    "towana"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10235,
              "names": [
                "Junichi Satou"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5783,
              "names": [
                "fhána"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 14529,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Happening☆Diary",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 23.07,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/md9aiv.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/siebbf.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 12696,
              "names": [
                "Koshiro Honda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12696,
              "names": [
                "Koshiro Honda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 14530,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Wishing diary",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 15.11,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3grzrc.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/sn90v2.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15219,
              "names": [
                "Naohiro Minami"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14488,
              "names": [
                "Takamitsu Shimazaki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 21215,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "starlog",
          "songArtist": "ChouCho",
          "songDifficulty": 62.66,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/05fgbc.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/lfr60g.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14999,
              "names": [
                "Shin Kawamoto"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 21216,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Prism Sympathy",
          "songArtist": "StylipS",
          "songDifficulty": 43.91,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3et40b.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/fipfq0.mp3",
          "artists": [
            {
              "id": 5374,
              "names": [
                "StylipS"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 5841,
                  "names": [
                    "Arisa Noto"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7973,
                  "names": [
                    "Maho Matsunaga"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5934,
                  "names": [
                    "Moe Toyota"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6035,
                  "names": [
                    "Miku Itou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 21217,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "TWO BY TWO",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 39.44,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/a80wln.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/51dlkz.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16275,
          "annSongId": 21397,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei Herz!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "moving soul",
          "songArtist": "Minami Kuribayashi",
          "songDifficulty": 48.42,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f3892a.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/vqqdw2.mp3",
          "artists": [
            {
              "id": 2434,
              "names": [
                "Minami Kuribayashi",
                "Minami"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19132,
                  "names": [
                    "exige"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14860,
              "names": [
                "Satoru Kuwabara",
                "Fandelmale"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14930,
              "names": [
                "Takuya Sakai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 17690,
          "annSongId": 15501,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeAltName": null,
          "animeVintage": "Summer 2016",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Asterism",
          "songArtist": "ChouCho",
          "songDifficulty": 39.35,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/kj41e7.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/nx943q.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15297,
              "names": [
                "AstroNoteS"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15297,
              "names": [
                "AstroNoteS"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 17690,
          "annSongId": 15502,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeAltName": null,
          "animeVintage": "Summer 2016",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "WHIMSICAL WAYWARD WISH",
          "songArtist": "TECHNOBOYS PULCRAFT GREEN-FUND feat. Yumeha Kouda",
          "songDifficulty": 27.77,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/9qrakm.webm",
          "MQ": "https://ladist1.catbox.video/hf1q5e.webm",
          "audio": "https://ladist1.catbox.video/uupank.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 6633,
              "names": [
                "Youhei Matsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10449,
              "names": [
                "Tohru Fujimura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 6633,
              "names": [
                "Youhei Matsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10449,
              "names": [
                "Tohru Fujimura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 17690,
          "annSongId": 20630,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeAltName": null,
          "animeVintage": "Summer 2016",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "cuddle",
          "songArtist": "ChouCho",
          "songDifficulty": 20.54,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ke60kp.webm",
          "MQ": "https://ladist1.catbox.video/docmls.webm",
          "audio": "https://ladist1.catbox.video/r7z1z5.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 19029,
          "annSongId": 16475,
          "animeENName": "Fate/kaleid liner Prisma☆Illya: Vow in the Snow",
          "animeJPName": "Gekijouban Fate/kaleid liner Prisma☆Illya: Sekka no Chikai",
          "animeAltName": null,
          "animeVintage": "Summer 2017",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "kaleidoscope",
          "songArtist": "ChouCho",
          "songDifficulty": 30.63,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/jcq9dd.webm",
          "MQ": "https://ladist1.catbox.video/qxbzxj.webm",
          "audio": "https://ladist1.catbox.video/m1s8vd.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15613,
              "names": [
                "Jun Murayama",
                "Junâ˜†Murayama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 19029,
          "annSongId": 16476,
          "animeENName": "Fate/kaleid liner Prisma☆Illya: Vow in the Snow",
          "animeJPName": "Gekijouban Fate/kaleid liner Prisma☆Illya: Sekka no Chikai",
          "animeAltName": null,
          "animeVintage": "Summer 2017",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Usubeni no Tsuki",
          "songArtist": "ChouCho",
          "songDifficulty": 23.63,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/182l3d.webm",
          "MQ": "https://ladist1.catbox.video/fdited.webm",
          "audio": "https://ladist1.catbox.video/s80tsf.mp3",
          "artists": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5279,
              "names": [
                "ChouCho"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15613,
              "names": [
                "Jun Murayama",
                "Junâ˜†Murayama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21867,
          "annSongId": 25402,
          "animeENName": "Fate/kaleid liner Prisma☆Illya: Prisma☆Phantasm",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya: Prisma☆Phantasm",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "OVA",
          "songType": "Opening 1",
          "songName": "Kaleido☆Festival!",
          "songArtist": "Homurahara Gakuen Shoutoubu no Minna",
          "songDifficulty": 21.66,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bzihhy.webm",
          "MQ": "https://ladist1.catbox.video/38msb6.webm",
          "audio": "https://ladist1.catbox.video/q7m4ji.mp3",
          "artists": [
            {
              "id": 7739,
              "names": [
                "Homurahara Gakuen Shoutoubu no Minna"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10451,
              "names": [
                "Tsukasa Yatoki",
                "Tsukasa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10451,
              "names": [
                "Tsukasa Yatoki",
                "Tsukasa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21867,
          "annSongId": 28671,
          "animeENName": "Fate/kaleid liner Prisma☆Illya: Prisma☆Phantasm",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya: Prisma☆Phantasm",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "OVA",
          "songType": "Ending 1",
          "songName": "After School Route",
          "songArtist": "Mai Kadowaki, Kaori Nazuka, Chiwa Saito",
          "songDifficulty": 14.79,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/i5d0ig.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/gxrw6w.mp3",
          "artists": [
            {
              "id": 2031,
              "names": [
                "Kaori Nazuka"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 607,
                  "names": [
                    "nana×nana"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3055,
                  "names": [
                    "Bottle fairy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3855,
                  "names": [
                    "Kaoru no Inukami 10-nin"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4662,
                  "names": [
                    "B・B Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4888,
                  "names": [
                    "Ayanoi Koukou GA girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5157,
                  "names": [
                    "Dai 501 Tougou Sentou Koukuu-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5417,
                  "names": [
                    "Love♥Stay"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5816,
                  "names": [
                    "Jupiter no Shimai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8014,
                  "names": [
                    "nonet"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 3077,
              "names": [
                "Mai Kadowaki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3484,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A",
                    "Mahora Gakuen Chuutoubu 3-A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3646,
                  "names": [
                    "Lime-tai Army"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3796,
                  "names": [
                    "Momotsuki Gakuen 1-nen D-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3861,
                  "names": [
                    "Dai-I-Ki Lemon Angel",
                    "Dai-II-Ki Lemon Angel",
                    "Lemon Angel",
                    "Dai Ni Ki LemonAngel"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4176,
                  "names": [
                    "Gedou Otometai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4648,
                  "names": [
                    "PNGN 6"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5157,
                  "names": [
                    "Dai 501 Tougou Sentou Koukuu-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5158,
                  "names": [
                    "Hinako to Hiyoko"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 3451,
              "names": [
                "Chiwa Saito"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 2928,
                  "names": [
                    "Mix JUICE"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3275,
                  "names": [
                    "Keroro All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3735,
                  "names": [
                    "Gokujou Seitokai Yuugeki-bu+Sharyou-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4571,
                  "names": [
                    "Kemeko to Deluxe"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5157,
                  "names": [
                    "Dai 501 Tougou Sentou Koukuu-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5670,
                  "names": [
                    "Utakano♪"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5743,
                  "names": [
                    "Stella Jogakuin Koutou-ka C³-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8015,
                  "names": [
                    "Team Cinderella"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8343,
                  "names": [
                    "Magao Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15489,
              "names": [
                "Yuki Honda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15707,
              "names": [
                "Masatomi Waki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23759,
          "annSongId": 20637,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "OVA",
          "songType": "Opening 1",
          "songName": "moving soul",
          "songArtist": "Minami Kuribayashi",
          "songDifficulty": 49.7,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f5ny75.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/2acsys.mp3",
          "artists": [
            {
              "id": 2434,
              "names": [
                "Minami Kuribayashi",
                "Minami"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5400,
                  "names": [
                    "Project Yamato 2199"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19132,
                  "names": [
                    "exige"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14860,
              "names": [
                "Satoru Kuwabara",
                "Fandelmale"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14930,
              "names": [
                "Takuya Sakai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23759,
          "annSongId": 20638,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeAltName": null,
          "animeVintage": "Summer 2015",
          "animeType": "OVA",
          "songType": "Ending 1",
          "songName": "TWO BY TWO",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 33.85,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/7pk0p3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/94y3ro.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23760,
          "annSongId": 31560,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 2wei!",
          "animeAltName": null,
          "animeVintage": "Summer 2014",
          "animeType": "OVA",
          "songType": "Ending 1",
          "songName": "TWO BY TWO",
          "songArtist": "Yumeha Kouda",
          "songDifficulty": 33.28,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ohmt7u.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/fyq9p1.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14420,
              "names": [
                "Kyou Takada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23762,
          "annSongId": 31561,
          "animeENName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeJPName": "Fate/kaleid liner Prisma☆Illya 3rei!!",
          "animeAltName": null,
          "animeVintage": "Summer 2016",
          "animeType": "OVA",
          "songType": "Ending 1",
          "songName": "WHIMSICAL WAYWARD WISH",
          "songArtist": "TECHNOBOYS PULCRAFT GREEN-FUND feat. Yumeha Kouda",
          "songDifficulty": 30.32,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vfup6q.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9vrehm.mp3",
          "artists": [
            {
              "id": 5898,
              "names": [
                "Yumeha Kouda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 6633,
              "names": [
                "Youhei Matsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10449,
              "names": [
                "Tohru Fujimura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6448,
              "names": [
                "TECHNOBOYS PULCRAFT GREEN-FUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 6633,
              "names": [
                "Youhei Matsui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10448,
              "names": [
                "TOMOHISA ISHIKAWA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 10449,
              "names": [
                "Tohru Fujimura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 34864,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Fever Dreamer",
          "songArtist": "Mia REGINA",
          "songDifficulty": 24.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f46di0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/5vzkd4.mp3",
          "artists": [
            {
              "id": 6376,
              "names": [
                "Mia REGINA"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 5598,
                  "names": [
                    "Waka Kirishima",
                    "Waka from STAR☆ANIS",
                    "Waka"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5599,
                  "names": [
                    "Fuuri Uebana",
                    "Fuuri from STAR☆ANIS",
                    "Fuuri"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5601,
                  "names": [
                    "Risuko Sasakama",
                    "Risuko from STAR☆ANIS",
                    "Risuko"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 5821,
              "names": [
                "Tom-H@ck"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10462,
              "names": [
                "RINZO"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 34865,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Reverse-Rebirth",
          "songArtist": "Aina Suzuki",
          "songDifficulty": 17.96,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/gtsozy.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/vnj0zp.mp3",
          "artists": [
            {
              "id": 6654,
              "names": [
                "Aina Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6648,
                  "names": [
                    "Aqours"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6918,
                  "names": [
                    "Capsule Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7387,
                  "names": [
                    "Jashin★Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13203,
                  "names": [
                    "Teppen All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 11445,
              "names": [
                "ha-j"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18286,
              "names": [
                "Takashi Deguchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18287,
              "names": [
                "PA-NON"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11445,
              "names": [
                "ha-j"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 35617,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kibou no Nami Kaitei Zaburn",
          "songArtist": "Hiroshi Kitadani",
          "songDifficulty": 17.72,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f7zrl7.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/o3fy1s.mp3",
          "artists": [
            {
              "id": 179,
              "names": [
                "Hiroshi Kitadani",
                "Hiroshi Kitadani (JAM Project)"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 575,
                  "names": [
                    "JAM Project"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 973,
                  "names": [
                    "Lapis Lazuli"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5237,
                  "names": [
                    "SV TRIBE"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 35618,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Akogare no Crescendo",
          "songArtist": "Waka Kirishima",
          "songDifficulty": 14.32,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ejuo4f.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/56s089.mp3",
          "artists": [
            {
              "id": 5598,
              "names": [
                "Waka Kirishima",
                "Waka from STAR☆ANIS",
                "Waka"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6056,
                  "names": [
                    "STAR☆ANIS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6376,
                  "names": [
                    "Mia REGINA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 35619,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Akogare no Crescendo",
          "songArtist": "Aina Suzuki",
          "songDifficulty": 17.76,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vm40g7.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9hxgqo.mp3",
          "artists": [
            {
              "id": 6654,
              "names": [
                "Aina Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6648,
                  "names": [
                    "Aqours"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6918,
                  "names": [
                    "Capsule Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7387,
                  "names": [
                    "Jashin★Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13203,
                  "names": [
                    "Teppen All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 35620,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Pyon Pyon♡Love It",
          "songArtist": "Aina Suzuki",
          "songDifficulty": 14.21,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/iolpqg.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/3dob74.mp3",
          "artists": [
            {
              "id": 6654,
              "names": [
                "Aina Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6648,
                  "names": [
                    "Aqours"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6918,
                  "names": [
                    "Capsule Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7387,
                  "names": [
                    "Jashin★Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13203,
                  "names": [
                    "Teppen All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24215,
          "annSongId": 35655,
          "animeENName": "Rumble Garanndoll",
          "animeJPName": "Gyakuten Sekai no Denchi Shoujo",
          "animeAltName": null,
          "animeVintage": "Fall 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "The Burn Rumble -Burst refrain!- Yuki Aoba ver.",
          "songArtist": "Aina Suzuki",
          "songDifficulty": 14.1,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/iyub2s.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/l1n8dl.mp3",
          "artists": [
            {
              "id": 6654,
              "names": [
                "Aina Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6648,
                  "names": [
                    "Aqours"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6918,
                  "names": [
                    "Capsule Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7387,
                  "names": [
                    "Jashin★Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13203,
                  "names": [
                    "Teppen All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16382,
              "names": [
                "Fuwari"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24160,
          "annSongId": 34225,
          "animeENName": "Higurashi: When They Cry - Sotsu",
          "animeJPName": "Higurashi no Naku Koro ni Sotsu",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Analogy",
          "songArtist": "Ayane",
          "songDifficulty": 41.18,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/n1zba6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/0u280i.mp3",
          "artists": [
            {
              "id": 3530,
              "names": [
                "Ayane"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10522,
              "names": [
                "Chiyomaru Shikura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14415,
              "names": [
                "Shinichi Yuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24160,
          "annSongId": 34226,
          "animeENName": "Higurashi: When They Cry - Sotsu",
          "animeJPName": "Higurashi no Naku Koro ni Sotsu",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Missing Promise",
          "songArtist": "Konomi Suzuki",
          "songDifficulty": 29.59,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/j9lqgr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/58u0hk.mp3",
          "artists": [
            {
              "id": 5440,
              "names": [
                "Konomi Suzuki",
                "Koneko Yasagure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5870,
                  "names": [
                    "AG7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 8631,
              "names": [
                "Tsubasa Handa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 8631,
              "names": [
                "Tsubasa Handa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24160,
          "annSongId": 38247,
          "animeENName": "Higurashi: When They Cry - Sotsu",
          "animeJPName": "Higurashi no Naku Koro ni Sotsu",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "you-Sotsugyou-",
          "songArtist": "Eiko Shimamiya",
          "songDifficulty": 28.51,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/3nf0mq.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/zc4jbb.mp3",
          "artists": [
            {
              "id": 3869,
              "names": [
                "Eiko Shimamiya"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3982,
                  "names": [
                    "Love Planet Five ~I've special unit~"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10942,
              "names": [
                "Dai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10942,
              "names": [
                "Dai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22509,
          "annSongId": 26617,
          "animeENName": "Id: Invaded",
          "animeJPName": "Id: Invaded",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Mr. Fixer",
          "songArtist": "Sou",
          "songDifficulty": 50.01,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/y859wo.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/aosjsm.mp3",
          "artists": [
            {
              "id": 7845,
              "names": [
                "Sou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 16133,
              "names": [
                "Shiryu Kamiya"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16133,
              "names": [
                "Shiryu Kamiya"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22509,
          "annSongId": 26618,
          "animeENName": "Id: Invaded",
          "animeJPName": "Id: Invaded",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Other Side",
          "songArtist": "MIYAVI",
          "songDifficulty": 48.6,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/j6wn6l.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/pkfyqw.mp3",
          "artists": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15849,
              "names": [
                "Seann Bowe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 16134,
              "names": [
                "Max Matluck"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 16135,
              "names": [
                "Tido"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 16136,
              "names": [
                "Yung Spielberg"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22509,
          "annSongId": 28687,
          "animeENName": "Id: Invaded",
          "animeJPName": "Id: Invaded",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "UP",
          "songArtist": "MIYAVI",
          "songDifficulty": 31.95,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/2kloev.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/t4mkep.mp3",
          "artists": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22509,
          "annSongId": 27790,
          "animeENName": "Id: Invaded",
          "animeJPName": "Id: Invaded",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Samurai 45",
          "songArtist": "MIYAVI",
          "songDifficulty": 46.24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/dxir65.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/03122v.mp3",
          "artists": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22509,
          "annSongId": 28581,
          "animeENName": "Id: Invaded",
          "animeJPName": "Id: Invaded",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Butterfly",
          "songArtist": "MIYAVI",
          "songDifficulty": 47.88,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/s3ef55.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7q2ry4.mp3",
          "artists": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7300,
              "names": [
                "MIYAVI"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15848,
              "names": [
                "Lenard Skolnik"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25111,
          "annSongId": 38200,
          "animeENName": "KanColle: See You Again on Another Quiet Blue Sea",
          "animeJPName": "KanColle: Itsuka Ano Umi de",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Shigure",
          "songArtist": "Toshl RYUGEN",
          "songDifficulty": 25.56,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bxq0zc.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/268um8.mp3",
          "artists": [
            {
              "id": 14144,
              "names": [
                "Toshl RYUGEN"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 221,
                  "names": [
                    "X JAPAN"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 17727,
              "names": [
                "Kaori Ookoshi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 17727,
              "names": [
                "Kaori Ookoshi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25111,
          "annSongId": 39158,
          "animeENName": "KanColle: See You Again on Another Quiet Blue Sea",
          "animeJPName": "KanColle: Itsuka Ano Umi de",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "DIVA DIVA",
          "songArtist": "Toshl RYUGEN",
          "songDifficulty": 13.58,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/mi2ly0.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/einyjl.mp3",
          "artists": [
            {
              "id": 14144,
              "names": [
                "Toshl RYUGEN"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 221,
                  "names": [
                    "X JAPAN"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14144,
              "names": [
                "Toshl RYUGEN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14144,
              "names": [
                "Toshl RYUGEN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23918,
          "annSongId": 34234,
          "animeENName": "Girlfriend, Girlfriend",
          "animeJPName": "Kanojo mo Kanojo",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Fuzaketenai ze",
          "songArtist": "Necry Talkie",
          "songDifficulty": 51.71,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/yo27f9.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ad3wtn.mp3",
          "artists": [
            {
              "id": 8345,
              "names": [
                "Necry Talkie"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14173,
                  "names": [
                    "Mossa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 16354,
              "names": [
                "Asahi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 8345,
              "names": [
                "Necry Talkie"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23918,
          "annSongId": 34235,
          "animeENName": "Girlfriend, Girlfriend",
          "animeJPName": "Kanojo mo Kanojo",
          "animeAltName": null,
          "animeVintage": "Summer 2021",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Pinky Hook",
          "songArtist": "Momo Asakura",
          "songDifficulty": 37.01,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/iv1w00.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/fjqabm.mp3",
          "artists": [
            {
              "id": 6826,
              "names": [
                "Momo Asakura"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5883,
                  "names": [
                    "SAKURA∗TRICK"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5919,
                  "names": [
                    "KMM-dan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6343,
                  "names": [
                    "TrySail"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6394,
                  "names": [
                    "MON"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8021,
                  "names": [
                    "TRINITYAiLE"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19408,
                  "names": [
                    "MILLIONSTARS Team5th"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13459,
              "names": [
                "Shou Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14877,
              "names": [
                "Tatsuya Kurauchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21778,
          "annSongId": 24691,
          "animeENName": "To the Abandoned Sacred Beasts",
          "animeJPName": "Katsute Kami Datta Kemono-tachi e",
          "animeAltName": null,
          "animeVintage": "Summer 2019",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Sacrifice",
          "songArtist": "Mafumafu",
          "songDifficulty": 38.2,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/g7cldy.webm",
          "MQ": "https://ladist1.catbox.video/hc6dzf.webm",
          "audio": "https://ladist1.catbox.video/l0xqu4.mp3",
          "artists": [
            {
              "id": 6620,
              "names": [
                "Mafumafu"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6928,
                  "names": [
                    "Kamisama, Boku wa Kizuite Shimatta"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6994,
                  "names": [
                    "After the Rain"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13567,
                  "names": [
                    "RetBear"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6620,
              "names": [
                "Mafumafu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6620,
              "names": [
                "Mafumafu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21778,
          "annSongId": 24692,
          "animeENName": "To the Abandoned Sacred Beasts",
          "animeJPName": "Katsute Kami Datta Kemono-tachi e",
          "animeAltName": null,
          "animeVintage": "Summer 2019",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "HHOOWWLL",
          "songArtist": "Gero×ARAKI",
          "songDifficulty": 19.49,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/6cherp.webm",
          "MQ": "https://ladist1.catbox.video/vmckzp.webm",
          "audio": "https://ladist1.catbox.video/vq1kp1.mp3",
          "artists": [
            {
              "id": 5656,
              "names": [
                "Gero"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 17195,
                  "names": [
                    "Dagero"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 7592,
              "names": [
                "ARAKI"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5821,
              "names": [
                "Tom-H@ck"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10461,
              "names": [
                "KanadeYUK"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21778,
          "annSongId": 25836,
          "animeENName": "To the Abandoned Sacred Beasts",
          "animeJPName": "Katsute Kami Datta Kemono-tachi e",
          "animeAltName": null,
          "animeVintage": "Summer 2019",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Beatrice's Lullaby",
          "songArtist": "Saori Hayami",
          "songDifficulty": 13.5,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/mqsfid.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ftbpha.mp3",
          "artists": [
            {
              "id": 4344,
              "names": [
                "Saori Hayami"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4803,
                  "names": [
                    "Eclipse"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4862,
                  "names": [
                    "blue drops"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4973,
                  "names": [
                    "St. Visual Jogakuin Gasshou-bu starring Saori Hayami to Seibijyo-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5071,
                  "names": [
                    "Oratorio The World God Only Knows"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5163,
                  "names": [
                    "MM second"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5227,
                  "names": [
                    "Kami nomi zo Shiri-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5228,
                  "names": [
                    "Kaketama-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5508,
                  "names": [
                    "Shirahamazaka Koukou Gasshou-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5512,
                  "names": [
                    "Shirahamazaka Koukou Seito Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5513,
                  "names": [
                    "Nishinohashi Hero Shoutenger"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5661,
                  "names": [
                    "Eisui Joshi Koukou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6126,
                  "names": [
                    "Neuron★Cream Soft"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6164,
                  "names": [
                    "Qverktett:||"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6197,
                  "names": [
                    "Choujougenshou-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6221,
                  "names": [
                    "Tsurezurenaru Ayatsuri Mugenan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6800,
                  "names": [
                    "in NO hurry to shout;"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7089,
                  "names": [
                    "Shinjugamine Jogakuen Hoshimori Class"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7210,
                  "names": [
                    "XX:me"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7392,
                  "names": [
                    "Dai Ni Maru San Koukuu Madou Dai-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7749,
                  "names": [
                    "Akuma Gakkou Babyls Seito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7941,
                  "names": [
                    "Teikoku Kageki-dan・Hana-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3677,
              "names": [
                "Yoshihiro Ike"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3677,
              "names": [
                "Yoshihiro Ike"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21419,
          "annSongId": 23694,
          "animeENName": "Wise Man's Grandchild",
          "animeJPName": "Kenja no Mago",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Ultimate☆MAGIC",
          "songArtist": "i☆Ris",
          "songDifficulty": 42.05,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/8wvh1p.webm",
          "MQ": "https://ladist1.catbox.video/cd467w.webm",
          "audio": "https://ladist1.catbox.video/8kx0zz.mp3",
          "artists": [
            {
              "id": 5595,
              "names": [
                "i☆Ris"
              ],
              "line_up_id": 1,
              "groups": null,
              "members": [
                {
                  "id": 5403,
                  "names": [
                    "Yuki Wakai",
                    "Yuki Wakai from i☆Ris"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5747,
                  "names": [
                    "Yuu Serizawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6040,
                  "names": [
                    "Himika Akaneya"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6041,
                  "names": [
                    "Miyu Kubota"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6338,
                  "names": [
                    "Saki Yamakita"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6336,
                  "names": [
                    "Azuki Shibuya"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 7083,
              "names": [
                "Yuuki Hirose"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14921,
              "names": [
                "Mine Kushita"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21419,
          "annSongId": 23695,
          "animeENName": "Wise Man's Grandchild",
          "animeJPName": "Kenja no Mago",
          "animeAltName": null,
          "animeVintage": "Spring 2019",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Attouteki Vivid Days",
          "songArtist": "Nanami Yoshi.",
          "songDifficulty": 21.43,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/p77v39.webm",
          "MQ": "https://ladist1.catbox.video/fgrwwx.webm",
          "audio": "https://ladist1.catbox.video/q8uapg.mp3",
          "artists": [
            {
              "id": 7642,
              "names": [
                "Nanami Yoshi."
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10507,
              "names": [
                "Ryouta Tomaru"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10507,
              "names": [
                "Ryouta Tomaru"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24735,
          "annSongId": 39264,
          "animeENName": "To Me, The One Who Loved You",
          "animeJPName": "Kimi o Aishita Hitori no Boku e",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "Shion",
          "songArtist": "Saucy Dog",
          "songDifficulty": 15.35,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/eyta0x.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/5twe6x.mp3",
          "artists": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 17376,
                  "names": [
                    "Shinya Ishihara"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 17375,
              "names": [
                "Saucy Dog"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18478,
              "names": [
                "Kazuma Nagasawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24735,
          "annSongId": 39265,
          "animeENName": "To Me, The One Who Loved You",
          "animeJPName": "Kimi o Aishita Hitori no Boku e",
          "animeAltName": null,
          "animeVintage": "Fall 2022",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Kumo o Kou",
          "songArtist": "Keina Suda",
          "songDifficulty": 14.42,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/79guna.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/eh0ysl.mp3",
          "artists": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7721,
              "names": [
                "Keina Suda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 15861,
              "names": [
                "Primagic"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10979,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Ma・Ka・Se・Te Tonight",
          "songArtist": "Iori Nomizu",
          "songDifficulty": 58.02,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/2yf9vl.webm",
          "MQ": "https://ladist1.catbox.video/nlbc0s.webm",
          "audio": "https://ladist1.catbox.video/12efls.mp3",
          "artists": [
            {
              "id": 4848,
              "names": [
                "Iori Nomizu",
                "Iori Nomizu from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4868,
                  "names": [
                    "Himarinko L Shizukuesu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5334,
                  "names": [
                    "Hekiyou Gakuen Seitokai Lv.2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5411,
                  "names": [
                    "sweet ARMS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5871,
                  "names": [
                    "coffin princess"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8187,
                  "names": [
                    "Marronni☆Yell"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10980,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Kizuite Zombie-sama, Watashi wa Classmate desu",
          "songArtist": "Rie Yamaguchi with manzo",
          "songDifficulty": 27.4,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/0a69cr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8y6i99.mp3",
          "artists": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 5105,
              "names": [
                "Rie Yamaguchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6346,
                  "names": [
                    "Idol College"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10981,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kirakira Diamond",
          "songArtist": "Aya Gouda",
          "songDifficulty": 32.03,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/0d1lvc.webm",
          "MQ": "https://ladist1.catbox.video/ahbxsf.webm",
          "audio": "https://ladist1.catbox.video/vehw1o.mp3",
          "artists": [
            {
              "id": 4357,
              "names": [
                "Aya Gouda"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10982,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kyuuketsuki Venus",
          "songArtist": "Aya Gouda & Yoko Hikasa",
          "songDifficulty": 25.29,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/dwvlh9.webm",
          "MQ": "https://ladist1.catbox.video/sufj2a.webm",
          "audio": "https://ladist1.catbox.video/ma8n17.mp3",
          "artists": [
            {
              "id": 4357,
              "names": [
                "Aya Gouda"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 4782,
              "names": [
                "Yoko Hikasa",
                "Hibiki from BEST FRIENDS!"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4811,
                  "names": [
                    "Ho-Kago Tea Time",
                    "Sakurakou K-On-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4999,
                  "names": [
                    "Sakurakou 3-2 to Sakurakou 2-1"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5055,
                  "names": [
                    "Triple Booking"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5123,
                  "names": [
                    "Love♥Roulettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5653,
                  "names": [
                    "RO-KYU-BU!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5782,
                  "names": [
                    "Occult Kenkyuu-bu Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5994,
                  "names": [
                    "YELL"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6432,
                  "names": [
                    "Team Fortuna"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7029,
                  "names": [
                    "FA Girls #08"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7032,
                  "names": [
                    "FA Girls #11"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7685,
                  "names": [
                    "The-Light ℵ Mare"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7792,
                  "names": [
                    "Haitoku Pistols"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8567,
                  "names": [
                    "Security Politti"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 9171,
                  "names": [
                    "BEST FRIENDS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10983,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Sorya Masou Desho! Rock 'n Roll",
          "songArtist": "Iori Nomizu",
          "songDifficulty": 32.49,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/l3u7ii.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/izet97.mp3",
          "artists": [
            {
              "id": 4848,
              "names": [
                "Iori Nomizu",
                "Iori Nomizu from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4868,
                  "names": [
                    "Himarinko L Shizukuesu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5334,
                  "names": [
                    "Hekiyou Gakuen Seitokai Lv.2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5411,
                  "names": [
                    "sweet ARMS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5871,
                  "names": [
                    "coffin princess"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8187,
                  "names": [
                    "Marronni☆Yell"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 11752,
          "annSongId": 10984,
          "animeENName": "Is This a Zombie?",
          "animeJPName": "Kore wa Zombie desu ka?",
          "animeAltName": null,
          "animeVintage": "Winter 2011",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Sugao",
          "songArtist": "Midori Tsukimiya",
          "songDifficulty": 14.38,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/mnt5p7.webm",
          "MQ": "https://ladist1.catbox.video/jd3c90.webm",
          "audio": "https://ladist1.catbox.video/64pv80.mp3",
          "artists": [
            {
              "id": 5106,
              "names": [
                "Midori Tsukimiya",
                "Midori Tsukimiya from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12061,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "*** Passionate",
          "songArtist": "Iori Nomizu",
          "songDifficulty": 45.88,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/i4xvab.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bsnxjh.mp3",
          "artists": [
            {
              "id": 4848,
              "names": [
                "Iori Nomizu",
                "Iori Nomizu from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4868,
                  "names": [
                    "Himarinko L Shizukuesu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5334,
                  "names": [
                    "Hekiyou Gakuen Seitokai Lv.2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5411,
                  "names": [
                    "sweet ARMS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5871,
                  "names": [
                    "coffin princess"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8187,
                  "names": [
                    "Marronni☆Yell"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12062,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Koi no Beginner Nan desu (T_T)",
          "songArtist": "Rie Yamaguchi",
          "songDifficulty": 22.51,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/xj9z2e.webm",
          "MQ": "https://ladist1.catbox.video/5zlyl6.webm",
          "audio": "https://ladist1.catbox.video/0cgw5k.mp3",
          "artists": [
            {
              "id": 5105,
              "names": [
                "Rie Yamaguchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6346,
                  "names": [
                    "Idol College"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12063,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Ettou Santora Kaikyou",
          "songArtist": "Shinji Kakijima",
          "songDifficulty": 11.64,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/f36ss6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/j3ez1c.mp3",
          "artists": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 1849,
                  "names": [
                    "T.L. Signal",
                    "T.L.Signal"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12064,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kirakira Diamond",
          "songArtist": "Aya Gouda",
          "songDifficulty": 32.1,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/t3hi2v.webm",
          "MQ": "https://ladist1.catbox.video/dgvxba.webm",
          "audio": "https://ladist1.catbox.video/nhpe3j.mp3",
          "artists": [
            {
              "id": 4357,
              "names": [
                "Aya Gouda"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12065,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kyuuketsuki Venus",
          "songArtist": "Aya Gouda & Yoko Hikasa",
          "songDifficulty": 27.08,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ai8f8y.webm",
          "MQ": "https://ladist1.catbox.video/p5yptv.webm",
          "audio": "https://ladist1.catbox.video/np2tu2.mp3",
          "artists": [
            {
              "id": 4357,
              "names": [
                "Aya Gouda"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 4782,
              "names": [
                "Yoko Hikasa",
                "Hibiki from BEST FRIENDS!"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4811,
                  "names": [
                    "Ho-Kago Tea Time",
                    "Sakurakou K-On-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4999,
                  "names": [
                    "Sakurakou 3-2 to Sakurakou 2-1"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5055,
                  "names": [
                    "Triple Booking"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5123,
                  "names": [
                    "Love♥Roulettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5653,
                  "names": [
                    "RO-KYU-BU!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5782,
                  "names": [
                    "Occult Kenkyuu-bu Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5994,
                  "names": [
                    "YELL"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6432,
                  "names": [
                    "Team Fortuna"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7029,
                  "names": [
                    "FA Girls #08"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7032,
                  "names": [
                    "FA Girls #11"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7685,
                  "names": [
                    "The-Light ℵ Mare"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7792,
                  "names": [
                    "Haitoku Pistols"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8567,
                  "names": [
                    "Security Politti"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 9171,
                  "names": [
                    "BEST FRIENDS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14393,
              "names": [
                "Daisuke Mizuno"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12066,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Machibito LOVESONG",
          "songArtist": "Aya Gouda",
          "songDifficulty": 10.7,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/m7pp6m.webm",
          "MQ": "https://ladist1.catbox.video/72qw7y.webm",
          "audio": "https://ladist1.catbox.video/7c3xf1.mp3",
          "artists": [
            {
              "id": 4357,
              "names": [
                "Aya Gouda"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5301,
                  "names": [
                    "R-15♡"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12067,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Mata Ashita Ne.",
          "songArtist": "Rie Yamaguchi",
          "songDifficulty": 9.37,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/u80vsy.webm",
          "MQ": "https://ladist1.catbox.video/x4zeeu.webm",
          "audio": "https://ladist1.catbox.video/6akkr7.mp3",
          "artists": [
            {
              "id": 5105,
              "names": [
                "Rie Yamaguchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6346,
                  "names": [
                    "Idol College"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12068,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Ma・Ka・Se・Te Tonight",
          "songArtist": "Iori Nomizu",
          "songDifficulty": 60.11,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/b0c2ot.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/n28oyu.mp3",
          "artists": [
            {
              "id": 4848,
              "names": [
                "Iori Nomizu",
                "Iori Nomizu from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4868,
                  "names": [
                    "Himarinko L Shizukuesu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5334,
                  "names": [
                    "Hekiyou Gakuen Seitokai Lv.2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5411,
                  "names": [
                    "sweet ARMS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5871,
                  "names": [
                    "coffin princess"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8187,
                  "names": [
                    "Marronni☆Yell"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12069,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Minna mo Ii na",
          "songArtist": "Hisako Kanemoto",
          "songDifficulty": 8.41,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ko7qh7.webm",
          "MQ": "https://ladist1.catbox.video/58xb5x.webm",
          "audio": "https://ladist1.catbox.video/77a2xf.mp3",
          "artists": [
            {
              "id": 5292,
              "names": [
                "Hisako Kanemoto"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5045,
                  "names": [
                    "Hakuou Jogakuin no Yacht-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5161,
                  "names": [
                    "Precure All Stars",
                    "Precure All Stars 21"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5589,
                  "names": [
                    "Mizukara o Enshutsu Suru Otome no Kai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5629,
                  "names": [
                    "ESP Kenkyuukai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5670,
                  "names": [
                    "Utakano♪"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5959,
                  "names": [
                    "10-nen Kurogumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8344,
                  "names": [
                    "Egaos"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 16921,
                  "names": [
                    "ONIMAI SISTERS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17060,
                  "names": [
                    "Prima Angel"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17452,
                  "names": [
                    "Smile Precure!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19329,
                  "names": [
                    "Shichikage"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 577,
              "names": [
                "Shinji Kakijima"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13782,
          "annSongId": 12070,
          "animeENName": "Is This a Zombie? of the Dead",
          "animeJPName": "Kore wa Zombie desu ka? of the Dead",
          "animeAltName": null,
          "animeVintage": "Spring 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Sorya Masou Desho! Rock 'n Roll",
          "songArtist": "Iori Nomizu",
          "songDifficulty": 34.68,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/zxfkcp.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/g7mxji.mp3",
          "artists": [
            {
              "id": 4848,
              "names": [
                "Iori Nomizu",
                "Iori Nomizu from Hoshi no Shoujo-tai☆"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4868,
                  "names": [
                    "Himarinko L Shizukuesu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5334,
                  "names": [
                    "Hekiyou Gakuen Seitokai Lv.2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5411,
                  "names": [
                    "sweet ARMS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5487,
                  "names": [
                    "Hoshi no Shoujo-tai☆"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5817,
                  "names": [
                    "Tenbi Gakuen Joseito no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5871,
                  "names": [
                    "coffin princess"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8187,
                  "names": [
                    "Marronni☆Yell"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3398,
              "names": [
                "manzo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23893,
          "annSongId": 39505,
          "animeENName": "Kuma Kuma Kuma Bear: Punch!",
          "animeJPName": "Kuma Kuma Kuma Bear: Punch!",
          "animeAltName": null,
          "animeVintage": "Spring 2023",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Kimi to no Mirai",
          "songArtist": "Azumi Waki",
          "songDifficulty": 36.31,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/2im721.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9ckplo.mp3",
          "artists": [
            {
              "id": 6602,
              "names": [
                "Azumi Waki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7144,
                  "names": [
                    "Blend・A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7416,
                  "names": [
                    "SUMMONERS 2+"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7430,
                  "names": [
                    "Spica"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7431,
                  "names": [
                    "Uma Musume",
                    "Uma Musume 2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7746,
                  "names": [
                    "Ahomushi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7836,
                  "names": [
                    "Akaki Chikai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13524,
                  "names": [
                    "Chat Noir"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13931,
                  "names": [
                    "Gatajo DIY-bu!!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17125,
                  "names": [
                    "Uchuu Seifuku"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17531,
                  "names": [
                    "Umayuru"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15180,
              "names": [
                "Mayu Miyazaki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16254,
              "names": [
                "Shuhei Takahashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23893,
          "annSongId": 39755,
          "animeENName": "Kuma Kuma Kuma Bear: Punch!",
          "animeJPName": "Kuma Kuma Kuma Bear: Punch!",
          "animeAltName": null,
          "animeVintage": "Spring 2023",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Zutto",
          "songArtist": "Maki Kawase",
          "songDifficulty": 11.75,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/c56sis.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/g79549.mp3",
          "artists": [
            {
              "id": 7439,
              "names": [
                "Maki Kawase"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7619,
                  "names": [
                    "FranChouChou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7621,
                  "names": [
                    "Green Face"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18700,
              "names": [
                "ReNee"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16458,
              "names": [
                "Umi Kinami"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22256,
          "annSongId": 27387,
          "animeENName": "In/Spectre",
          "animeJPName": "Kyokou Suiri",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Mononoke in the Fiction",
          "songArtist": "Uso to Chameleon",
          "songDifficulty": 50.42,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/5kho3h.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ezttt3.mp3",
          "artists": [
            {
              "id": 7800,
              "names": [
                "Uso to Chameleon"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14149,
                  "names": [
                    "Cham"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 16071,
              "names": [
                "Sousuke Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16071,
              "names": [
                "Sousuke Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22256,
          "annSongId": 27388,
          "animeENName": "In/Spectre",
          "animeJPName": "Kyokou Suiri",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "LAST DANCE",
          "songArtist": "Mamoru Miyano",
          "songDifficulty": 44.29,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/azll8p.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/r3dh8q.mp3",
          "artists": [
            {
              "id": 4347,
              "names": [
                "Mamoru Miyano"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3622,
                  "names": [
                    "Oujo White Knights"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3867,
                  "names": [
                    "Ouran Koukou Host Club"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4826,
                  "names": [
                    "stella quintet+"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5256,
                  "names": [
                    "ST☆RISH"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5455,
                  "names": [
                    "YamaArashi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5812,
                  "names": [
                    "STYLE FIVE",
                    "Iwatobi Machi no Yukai na Nakama-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6220,
                  "names": [
                    "Trichronika"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6546,
                  "names": [
                    "Galaxy Standard"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6821,
                  "names": [
                    "Amatelast"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7291,
                  "names": [
                    "ROUTE85"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17151,
                  "names": [
                    "Seiseki Koukou Soccer-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 11620,
              "names": [
                "Jin Nakamura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11620,
              "names": [
                "Jin Nakamura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 22256,
          "annSongId": 27995,
          "animeENName": "In/Spectre",
          "animeJPName": "Kyokou Suiri",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kaen Housha-ki to Watashi",
          "songArtist": "Sumire Uesaka",
          "songDifficulty": 23.93,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/n2xsp9.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/cx24i6.mp3",
          "artists": [
            {
              "id": 5566,
              "names": [
                "Sumire Uesaka"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5588,
                  "names": [
                    "Black Raison d'être"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5887,
                  "names": [
                    "Jigoku no Sata All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6095,
                  "names": [
                    "CINDERELLA PROJECT"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6103,
                  "names": [
                    "LOVE LAIKA"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6127,
                  "names": [
                    "Twintails"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6218,
                  "names": [
                    "Plasmagica"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6316,
                  "names": [
                    "TesaPurun♪"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7089,
                  "names": [
                    "Shinjugamine Jogakuen Hoshimori Class"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7312,
                  "names": [
                    "Dropstars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7448,
                  "names": [
                    "MakiMiki"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7532,
                  "names": [
                    "Ongaku Shoujo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7598,
                  "names": [
                    "Pastel*Palettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8293,
                  "names": [
                    "Hanamiya Joshi Climbing-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17531,
                  "names": [
                    "Umayuru"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 2775,
              "names": [
                "Cher Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 2775,
              "names": [
                "Cher Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24950,
          "annSongId": 38531,
          "animeENName": "In/Spectre",
          "animeJPName": "Kyokou Suiri",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Yotogibanashi",
          "songArtist": "KanoeRana",
          "songDifficulty": 32.58,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/g1fryb.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7waysi.mp3",
          "artists": [
            {
              "id": 8278,
              "names": [
                "KanoeRana"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 8278,
              "names": [
                "KanoeRana"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14029,
              "names": [
                "ENDO."
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24950,
          "annSongId": 38971,
          "animeENName": "In/Spectre",
          "animeJPName": "Kyokou Suiri",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Invincible Love",
          "songArtist": "Mamoru Miyano",
          "songDifficulty": 33.68,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/hjbiu3.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/y8xpoq.mp3",
          "artists": [
            {
              "id": 4347,
              "names": [
                "Mamoru Miyano"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3622,
                  "names": [
                    "Oujo White Knights"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 3867,
                  "names": [
                    "Ouran Koukou Host Club"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4826,
                  "names": [
                    "stella quintet+"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5256,
                  "names": [
                    "ST☆RISH"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5455,
                  "names": [
                    "YamaArashi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5812,
                  "names": [
                    "STYLE FIVE",
                    "Iwatobi Machi no Yukai na Nakama-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6220,
                  "names": [
                    "Trichronika"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6546,
                  "names": [
                    "Galaxy Standard"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6821,
                  "names": [
                    "Amatelast"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7291,
                  "names": [
                    "ROUTE85"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17151,
                  "names": [
                    "Seiseki Koukou Soccer-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18520,
              "names": [
                "Le'mon"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18521,
              "names": [
                "NAOtheLAIZA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 18522,
              "names": [
                "$ÜN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 18521,
              "names": [
                "NAOtheLAIZA"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 13434,
          "annSongId": 33829,
          "animeENName": "Kyousougiga",
          "animeJPName": "Kyousougiga",
          "animeAltName": null,
          "animeVintage": "Fall 2011",
          "animeType": "ONA",
          "songType": "Ending 1",
          "songName": "Shissou Ginga",
          "songArtist": "TEPPAN",
          "songDifficulty": 22.33,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/6lzk8r.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/3g3sc3.mp3",
          "artists": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15509,
          "annSongId": 13458,
          "animeENName": "Kyousougiga",
          "animeJPName": "Kyousougiga",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Koko",
          "songArtist": "Tamurapan",
          "songDifficulty": 33.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ny3eut.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ngy51x.mp3",
          "artists": [
            {
              "id": 3815,
              "names": [
                "Tamurapan"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3815,
              "names": [
                "Tamurapan"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 3815,
              "names": [
                "Tamurapan"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15509,
          "annSongId": 13460,
          "animeENName": "Kyousougiga",
          "animeJPName": "Kyousougiga",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Shissou Ginga",
          "songArtist": "TEPPAN",
          "songDifficulty": 22.24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/cllmth.webm",
          "MQ": "https://ladist1.catbox.video/hp9g5f.webm",
          "audio": "https://ladist1.catbox.video/lmieww.mp3",
          "artists": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5362,
              "names": [
                "TEPPAN"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15509,
          "annSongId": 18011,
          "animeENName": "Kyousougiga",
          "animeJPName": "Kyousougiga",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "The Secret of My Life",
          "songArtist": "Aimee Blackschleger",
          "songDifficulty": 14.38,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/4lih4b.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/c65lud.mp3",
          "artists": [
            {
              "id": 4146,
              "names": [
                "Aimee Blackschleger",
                "Aimee B"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15509,
          "annSongId": 19559,
          "animeENName": "Kyousougiga",
          "animeJPName": "Kyousougiga",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kongou Kyojin Bishamaru",
          "songArtist": "Nami Nakagawa, Mitsu, Eiji Takemoto",
          "songDifficulty": 33.24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/oqa8w8.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/50l7yu.mp3",
          "artists": [
            {
              "id": 5356,
              "names": [
                "Nami Nakagawa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 5696,
              "names": [
                "Mitsu"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 5698,
              "names": [
                "Eiji Takemoto"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 8361,
                  "names": [
                    "Rikkai Kai Shihan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18167,
          "annSongId": 15925,
          "animeENName": "Magical Girl Raising Project",
          "animeJPName": "Mahou Shoujo Ikusei Keikaku",
          "animeAltName": null,
          "animeVintage": "Fall 2016",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Sakebe",
          "songArtist": "Manami Numakura",
          "songDifficulty": 41.49,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/n9f2x2.webm",
          "MQ": "https://ladist1.catbox.video/tad3ee.webm",
          "audio": "https://ladist1.catbox.video/pdgman.mp3",
          "artists": [
            {
              "id": 5246,
              "names": [
                "Manami Numakura"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5013,
                  "names": [
                    "765PRO ALLSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5668,
                  "names": [
                    "Fujijo Seitokai Shikkou-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5681,
                  "names": [
                    "Puchidol"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5833,
                  "names": [
                    "Trident"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5959,
                  "names": [
                    "10-nen Kurogumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5970,
                  "names": [
                    "Team 'Hanayamata'"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6218,
                  "names": [
                    "Plasmagica"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7188,
                  "names": [
                    "Konohana-tei Nakai no Kai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7425,
                  "names": [
                    "Tsukikage"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7532,
                  "names": [
                    "Ongaku Shoujo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7533,
                  "names": [
                    "H☆E☆S"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14852,
              "names": [
                "Makoto Nishibe",
                "WEST GROUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14852,
              "names": [
                "Makoto Nishibe",
                "WEST GROUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18167,
          "annSongId": 15926,
          "animeENName": "Magical Girl Raising Project",
          "animeJPName": "Mahou Shoujo Ikusei Keikaku",
          "animeAltName": null,
          "animeVintage": "Fall 2016",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "DREAMCATCHER",
          "songArtist": "nano",
          "songDifficulty": 39.15,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/uz99kx.webm",
          "MQ": "https://ladist1.catbox.video/crb3me.webm",
          "audio": "https://ladist1.catbox.video/6jlvi1.mp3",
          "artists": [
            {
              "id": 5499,
              "names": [
                "nano"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14852,
              "names": [
                "Makoto Nishibe",
                "WEST GROUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14852,
              "names": [
                "Makoto Nishibe",
                "WEST GROUND"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15020,
          "annSongId": 13016,
          "animeENName": "Magical Sisters Yoyo & Nene",
          "animeJPName": "Majokko Shimai no Yoyo to Nene",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "Niji no Yakusoku",
          "songArtist": "Mikako Komatsu",
          "songDifficulty": 9.13,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/uu75o5.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bls2wn.mp3",
          "artists": [
            {
              "id": 5044,
              "names": [
                "Mikako Komatsu"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5045,
                  "names": [
                    "Hakuou Jogakuin no Yacht-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5373,
                  "names": [
                    "Shiritsu Lydian Ongakuin Seito Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5745,
                  "names": [
                    "Happy Rain♪"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6316,
                  "names": [
                    "TesaPurun♪"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6378,
                  "names": [
                    "Toy☆GunGun"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 10341,
                  "names": [
                    "TRIGGER"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14952,
              "names": [
                "Keigo You"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 15020,
          "annSongId": 24182,
          "animeENName": "Magical Sisters Yoyo & Nene",
          "animeJPName": "Majokko Shimai no Yoyo to Nene",
          "animeAltName": null,
          "animeVintage": "Fall 2013",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Yoyo no Uta",
          "songArtist": "Sumire Morohoshi",
          "songDifficulty": 17.82,
          "songCategory": "Character",
          "HQ": "https://ladist1.catbox.video/hjh6af.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ktj8ly.mp3",
          "artists": [
            {
              "id": 5732,
              "names": [
                "Sumire Morohoshi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7409,
                  "names": [
                    "Electric Show Dancers"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5697,
              "names": [
                "Go Shiina"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 38866,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "escalate",
          "songArtist": "Aimer",
          "songDifficulty": 55.83,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/uw18bk.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bvwkmc.mp3",
          "artists": [
            {
              "id": 3441,
              "names": [
                "Aimer"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18511,
              "names": [
                "Yoshida Haruo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5145,
              "names": [
                "Shogo Ohnishi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 12589,
              "names": [
                "Kenji Tamai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 38957,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Antinomy",
          "songArtist": "amazarashi",
          "songDifficulty": 48.3,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/a6csia.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8agsw2.mp3",
          "artists": [
            {
              "id": 6255,
              "names": [
                "amazarashi"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14036,
                  "names": [
                    "Hiromu Akita"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14036,
              "names": [
                "Hiromu Akita"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14036,
              "names": [
                "Hiromu Akita"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40708,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Weight of the World/English Version(Ver1.1a)",
          "songArtist": "J'Nique Nicole",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/kp48if.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ki0oqf.mp3",
          "artists": [
            {
              "id": 17025,
              "names": [
                "J'Nique Nicole"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 38956,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Nokosareta Basho/Shakou",
          "songArtist": "J'Nique Nicole",
          "songDifficulty": 43.11,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/p1gmsd.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/7eqzxz.mp3",
          "artists": [
            {
              "id": 17025,
              "names": [
                "J'Nique Nicole"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 39019,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Sajin no Kioku",
          "songArtist": "J'Nique Nicole",
          "songDifficulty": 42.94,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/xu8m8l.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/3kl9q1.mp3",
          "artists": [
            {
              "id": 17025,
              "names": [
                "J'Nique Nicole"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14899,
              "names": [
                "Kuniyuki Takahashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14899,
              "names": [
                "Kuniyuki Takahashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 39186,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Yuuen Shisetsu",
          "songArtist": "Emi Evans",
          "songDifficulty": 48.81,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/w90vvw.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8f7r2s.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 39196,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Utsukushiki Uta(Ver1.1a)",
          "songArtist": "Emi Evans & J'Nique Nicole",
          "songDifficulty": 42.81,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/6whe80.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/5cezrs.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 17025,
              "names": [
                "J'Nique Nicole"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 39503,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Kainé/Kusai",
          "songArtist": "Emi Evans",
          "songDifficulty": 48.96,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/583mdp.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9ryn2s.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 39544,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Pascal",
          "songArtist": "Saki Ishii",
          "songDifficulty": 42.16,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/0zizsc.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/qs0gc2.mp3",
          "artists": [
            {
              "id": 17489,
              "names": [
                "Saki Ishii"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40136,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Dare ga Tame no Tatakai",
          "songArtist": "Saki Nakae",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/t62xhr.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/gf00qa.mp3",
          "artists": [
            {
              "id": 18125,
              "names": [
                "Saki Nakae"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40709,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Orokashii Heiki:Otsu:Kou",
          "songArtist": "Emi Evans",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/r4dmuh.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9sieq1.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40710,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Aimai na Kibou/Hisame",
          "songArtist": "Emi Evans",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/g26jqz.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/c1os9j.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40711,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Fukuseisareta Machi(Ver1.1a)",
          "songArtist": "Saki Nakae & Shotaro Seo",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/gz1u03.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/4yr2py.mp3",
          "artists": [
            {
              "id": 15353,
              "names": [
                "Shotaro Seo"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 18125,
              "names": [
                "Saki Nakae"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40712,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Subete o Hakai Suru Kuroki Kyojin/Kaijuu",
          "songArtist": "NieR:Automata Choir",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/1dv32q.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/jnrfwp.mp3",
          "artists": [
            {
              "id": 18896,
              "names": [
                "NieR:Automata Choir"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40713,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Coronal Kyoumei/Eve ni Naru",
          "songArtist": "Saki Nakae & Shotaro Seo",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/tw05c8.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/qhx980.mp3",
          "artists": [
            {
              "id": 15353,
              "names": [
                "Shotaro Seo"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            },
            {
              "id": 18125,
              "names": [
                "Saki Nakae"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40714,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Inishie no Uta/Shokuzai",
          "songArtist": "Emi Evans",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/o31f13.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/oiic5l.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40715,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Houkai no Kyomou/Zenshin(Ver1.1a)",
          "songArtist": "Saki Nakae",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/xq62dd.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/1wqr7t.mp3",
          "artists": [
            {
              "id": 18125,
              "names": [
                "Saki Nakae"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25372,
          "annSongId": 40719,
          "animeENName": "NieR:Automata Ver1.1a",
          "animeJPName": "NieR:Automata Ver1.1a",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Toritsuita Goubyou",
          "songArtist": "Nami Nakagawa",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/xiam5k.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/izntkg.mp3",
          "artists": [
            {
              "id": 5356,
              "names": [
                "Nami Nakagawa"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21996,
          "annSongId": 27474,
          "animeENName": "Plunderer",
          "animeJPName": "Plunderer",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Plunderer",
          "songArtist": "Miku Itou",
          "songDifficulty": 31.71,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/pldynz.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/y5q40o.mp3",
          "artists": [
            {
              "id": 6035,
              "names": [
                "Miku Itou"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5368,
                  "names": [
                    "Sweet Diva"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5374,
                  "names": [
                    "StylipS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6034,
                  "names": [
                    "Nagarekawa Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6664,
                  "names": [
                    "Pyxis"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7132,
                  "names": [
                    "Tokimeki Kanshasai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7607,
                  "names": [
                    "Hello, Happy World!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7652,
                  "names": [
                    "Nakano-ke no Itsutsugo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8063,
                  "names": [
                    "Adachi to Shimamura"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19407,
                  "names": [
                    "MILLIONSTARS Team3rd"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15621,
              "names": [
                "Takuya Ohata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15414,
              "names": [
                "Yuki Kishida"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21996,
          "annSongId": 28854,
          "animeENName": "Plunderer",
          "animeJPName": "Plunderer",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Opening 2",
          "songName": "Kokou no Hikari Lonely dark",
          "songArtist": "Miku Itou",
          "songDifficulty": 30.83,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/uaic4n.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/lp5r49.mp3",
          "artists": [
            {
              "id": 6035,
              "names": [
                "Miku Itou"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5368,
                  "names": [
                    "Sweet Diva"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5374,
                  "names": [
                    "StylipS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6034,
                  "names": [
                    "Nagarekawa Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6664,
                  "names": [
                    "Pyxis"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7132,
                  "names": [
                    "Tokimeki Kanshasai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7607,
                  "names": [
                    "Hello, Happy World!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7652,
                  "names": [
                    "Nakano-ke no Itsutsugo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8063,
                  "names": [
                    "Adachi to Shimamura"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8658,
                  "names": [
                    "MILLIONSTARS",
                    "765 MILLIONSTARS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19407,
                  "names": [
                    "MILLIONSTARS Team3rd"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 12710,
              "names": [
                "Kouji Mase"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11899,
              "names": [
                "Takeharu Nakahata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21996,
          "annSongId": 27475,
          "animeENName": "Plunderer",
          "animeJPName": "Plunderer",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Countless days",
          "songArtist": "Rina Honnizumi",
          "songDifficulty": 16.83,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/t8e5q6.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/zwyokj.mp3",
          "artists": [
            {
              "id": 7383,
              "names": [
                "Rina Honnizumi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7947,
                  "names": [
                    "Shin Koshigaya Koukou Joshi Yakyuu-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8036,
                  "names": [
                    "Konohana wa Otome"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8301,
                  "names": [
                    "MUG-MO"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13468,
              "names": [
                "Motoi Okuda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13468,
              "names": [
                "Motoi Okuda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 21996,
          "annSongId": 28855,
          "animeENName": "Plunderer",
          "animeJPName": "Plunderer",
          "animeAltName": null,
          "animeVintage": "Winter 2020",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Reason of Life",
          "songArtist": "Rina Honnizumi, Ari Ozawa, Shizuka Itou",
          "songDifficulty": 14.66,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/a2shu9.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/97z983.mp3",
          "artists": [
            {
              "id": 3470,
              "names": [
                "Shizuka Itou"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 3484,
                  "names": [
                    "Mahora Gakuen Chuutoubu 2-A",
                    "Mahora Gakuen Chuutoubu 3-A"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 4440,
                  "names": [
                    "Astral no Minasan"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5156,
                  "names": [
                    "Shiratama Chuugakkou Joshi Soft Tennis-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5758,
                  "names": [
                    "Inukko Club"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5782,
                  "names": [
                    "Occult Kenkyuu-bu Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6168,
                  "names": [
                    "Tracy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 6075,
              "names": [
                "Ari Ozawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6187,
                  "names": [
                    "THE ROLLING GIRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6311,
                  "names": [
                    "Gakuen Seikatsu-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6314,
                  "names": [
                    "Houkago Rakuen-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6402,
                  "names": [
                    "Ichinen Fuji-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7574,
                  "names": [
                    "Yuusha Party"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7598,
                  "names": [
                    "Pastel*Palettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7735,
                  "names": [
                    "ortensia"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 7383,
              "names": [
                "Rina Honnizumi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7947,
                  "names": [
                    "Shin Koshigaya Koukou Joshi Yakyuu-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8036,
                  "names": [
                    "Konohana wa Otome"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8301,
                  "names": [
                    "MUG-MO"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15781,
              "names": [
                "Shuhei Tsubota"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15781,
              "names": [
                "Shuhei Tsubota"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18795,
          "annSongId": 16296,
          "animeENName": "Akashic Records of Bastard Magical Instructor",
          "animeJPName": "Rokudenashi Majutsu Koushi to Akashic Records",
          "animeAltName": [
            "RokuAka"
          ],
          "animeVintage": "Spring 2017",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Blow out",
          "songArtist": "Konomi Suzuki",
          "songDifficulty": 55.74,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/7i5d3v.webm",
          "MQ": "https://ladist1.catbox.video/8pyj1a.webm",
          "audio": "https://ladist1.catbox.video/tp9ezy.mp3",
          "artists": [
            {
              "id": 5440,
              "names": [
                "Konomi Suzuki",
                "Koneko Yasagure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5870,
                  "names": [
                    "AG7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14840,
              "names": [
                "Hige Driver"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15070,
              "names": [
                "Yuyoyuppe",
                "DJ'Tekina Something"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 18795,
          "annSongId": 16297,
          "animeENName": "Akashic Records of Bastard Magical Instructor",
          "animeJPName": "Rokudenashi Majutsu Koushi to Akashic Records",
          "animeAltName": [
            "RokuAka"
          ],
          "animeVintage": "Spring 2017",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Precious You☆",
          "songArtist": "Akane Fujita, Yume Miyamoto, Ari Ozawa",
          "songDifficulty": 36.12,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/cxilvp.webm",
          "MQ": "https://ladist1.catbox.video/8jq5vt.webm",
          "audio": "https://ladist1.catbox.video/0fxow3.mp3",
          "artists": [
            {
              "id": 5626,
              "names": [
                "Yume Miyamoto"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7947,
                  "names": [
                    "Shin Koshigaya Koukou Joshi Yakyuu-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7960,
                  "names": [
                    "Anos Fan Union"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 6075,
              "names": [
                "Ari Ozawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6187,
                  "names": [
                    "THE ROLLING GIRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6311,
                  "names": [
                    "Gakuen Seikatsu-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6314,
                  "names": [
                    "Houkago Rakuen-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6402,
                  "names": [
                    "Ichinen Fuji-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7574,
                  "names": [
                    "Yuusha Party"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7598,
                  "names": [
                    "Pastel*Palettes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7735,
                  "names": [
                    "ortensia"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            },
            {
              "id": 6723,
              "names": [
                "Akane Fujita"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7425,
                  "names": [
                    "Tsukikage"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10460,
              "names": [
                "Tokiya Sugishita"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10462,
              "names": [
                "RINZO"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12466,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Kimi ga Yume o Tsuretekita",
          "songArtist": "Pet na Kanojo-tachi",
          "songDifficulty": 52.1,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/6cdp31.webm",
          "MQ": "https://ladist1.catbox.video/f5oli4.webm",
          "audio": "https://ladist1.catbox.video/z80wtl.mp3",
          "artists": [
            {
              "id": 5549,
              "names": [
                "Pet na Kanojo-tachi"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 5005,
                  "names": [
                    "Natsumi Takamori"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5151,
                  "names": [
                    "Ai Kayano"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5546,
                  "names": [
                    "Mariko Nakatsu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 5135,
              "names": [
                "eba"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10458,
              "names": [
                "yamazo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12467,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Opening 2",
          "songName": "Yume no Tsuzuki",
          "songArtist": "Konomi Suzuki",
          "songDifficulty": 48.38,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/78ent5.webm",
          "MQ": "https://ladist1.catbox.video/jti9fe.webm",
          "audio": "https://ladist1.catbox.video/7a5soi.mp3",
          "artists": [
            {
              "id": 5440,
              "names": [
                "Konomi Suzuki",
                "Koneko Yasagure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5870,
                  "names": [
                    "AG7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12674,
              "names": [
                "Taichi Nakamura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12468,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Opening 3",
          "songName": "I call your name again",
          "songArtist": "Mariko Nakatsu",
          "songDifficulty": 39.24,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/96dcmp.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ute1kb.mp3",
          "artists": [
            {
              "id": 5546,
              "names": [
                "Mariko Nakatsu"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5549,
                  "names": [
                    "Pet na Kanojo-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5660,
                  "names": [
                    "Himematsu Koukou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14867,
              "names": [
                "Takeshi Shirabayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 14868,
              "names": [
                "Ippei Anbo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14868,
              "names": [
                "Ippei Anbo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12469,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "DAYS of DASH",
          "songArtist": "Konomi Suzuki",
          "songDifficulty": 53.65,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/k4m1h5.webm",
          "MQ": "https://ladist1.catbox.video/g3ydta.webm",
          "audio": "https://ladist1.catbox.video/625otn.mp3",
          "artists": [
            {
              "id": 5440,
              "names": [
                "Konomi Suzuki",
                "Koneko Yasagure"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5870,
                  "names": [
                    "AG7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12470,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Prime number ~Kimi to Deaeru Hi~",
          "songArtist": "Asuka Ookura",
          "songDifficulty": 41.13,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/1fp6ro.webm",
          "MQ": "https://ladist1.catbox.video/xbnzcg.webm",
          "audio": "https://ladist1.catbox.video/xz5bgs.mp3",
          "artists": [
            {
              "id": 5548,
              "names": [
                "ASCA",
                "Asuka Ookura"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 12849,
              "names": [
                "Tomokazu Tashiro"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 225,
              "names": [
                "Akimitsu Honma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 12471,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Kyou no Hi wa Sayounara",
          "songArtist": "Suimei Koukou Seito Ichidou",
          "songDifficulty": 50.14,
          "songCategory": "Character",
          "HQ": "https://ladist1.catbox.video/ylxhpv.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/v3l3et.mp3",
          "artists": [
            {
              "id": 5547,
              "names": [
                "Suimei Koukou Seito Ichidou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13371,
              "names": [
                "Shoichi Kaneko"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13371,
              "names": [
                "Shoichi Kaneko"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14238,
          "annSongId": 19527,
          "animeENName": "The Pet Girl of Sakurasou",
          "animeJPName": "Sakura-sou no Pet na Kanojo",
          "animeAltName": null,
          "animeVintage": "Fall 2012",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Suimei Geijutsu Daigaku Fuzoku Koutou Gakkou Kouka",
          "songArtist": "Suimei Koukou Seito Ichidou",
          "songDifficulty": 47.34,
          "songCategory": "Character",
          "HQ": "https://ladist1.catbox.video/8cy9i4.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/8rt6bh.mp3",
          "artists": [
            {
              "id": 5547,
              "names": [
                "Suimei Koukou Seito Ichidou"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10640,
              "names": [
                "Yuuzou Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10640,
              "names": [
                "Yuuzou Hayashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 19972,
          "annSongId": 17676,
          "animeENName": "Slow Start",
          "animeJPName": "Slow Start",
          "animeAltName": null,
          "animeVintage": "Winter 2018",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "ne! ne! ne!",
          "songArtist": "STARTails☆",
          "songDifficulty": 31.37,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/pijqdc.webm",
          "MQ": "https://ladist1.catbox.video/op4fq8.webm",
          "audio": "https://ladist1.catbox.video/p1t4e8.mp3",
          "artists": [
            {
              "id": 7239,
              "names": [
                "STARTails☆"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 6429,
                  "names": [
                    "Maria Naganawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7519,
                  "names": [
                    "Ayasa Ito"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7692,
                  "names": [
                    "Reina Kondo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8275,
                  "names": [
                    "Tomomi Mineuchi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14299,
              "names": [
                "Yoshiaki Fujisawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14299,
              "names": [
                "Yoshiaki Fujisawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 19972,
          "annSongId": 17677,
          "animeENName": "Slow Start",
          "animeJPName": "Slow Start",
          "animeAltName": null,
          "animeVintage": "Winter 2018",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Kaze no Koe o Kikinagara",
          "songArtist": "Sangatsu no Phantasia",
          "songDifficulty": 23.14,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/yz6b7x.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/96dhgf.mp3",
          "artists": [
            {
              "id": 6890,
              "names": [
                "Sangatsu no Phantasia"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14445,
              "names": [
                "40mP"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14445,
              "names": [
                "40mP"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 19972,
          "annSongId": 19571,
          "animeENName": "Slow Start",
          "animeJPName": "Slow Start",
          "animeAltName": null,
          "animeVintage": "Winter 2018",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Yuuyake to Issho ni",
          "songArtist": "STARTails☆",
          "songDifficulty": 17.16,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/dafnp9.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/bqe2p3.mp3",
          "artists": [
            {
              "id": 7239,
              "names": [
                "STARTails☆"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 6429,
                  "names": [
                    "Maria Naganawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7519,
                  "names": [
                    "Ayasa Ito"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7692,
                  "names": [
                    "Reina Kondo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8275,
                  "names": [
                    "Tomomi Mineuchi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 11420,
              "names": [
                "Kenichi Maeyamada"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10422,
              "names": [
                "Keita Miyoshi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24810,
          "annSongId": 38572,
          "animeENName": "Sugar Apple Fairy Tale",
          "animeJPName": "Sugar Apple Fairy Tale",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Musical",
          "songArtist": "Minori Suzuki",
          "songDifficulty": 33.94,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/eeakk9.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/z5qldf.mp3",
          "artists": [
            {
              "id": 6596,
              "names": [
                "Minori Suzuki"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6592,
                  "names": [
                    "Walküre"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8007,
                  "names": [
                    "REIJINGSIGNAL"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8154,
                  "names": [
                    "GoGoShinGos!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13926,
                  "names": [
                    "Yami_Q_ray"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17531,
                  "names": [
                    "Umayuru"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 18534,
              "names": [
                "Shuuji Kanayama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 16443,
              "names": [
                "Hinako Tsubakiyama"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24810,
          "annSongId": 38573,
          "animeENName": "Sugar Apple Fairy Tale",
          "animeJPName": "Sugar Apple Fairy Tale",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Kanaeru",
          "songArtist": "Sumire Morohoshi",
          "songDifficulty": 25.44,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/r4ln78.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/iykw76.mp3",
          "artists": [
            {
              "id": 5732,
              "names": [
                "Sumire Morohoshi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7409,
                  "names": [
                    "Electric Show Dancers"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15219,
              "names": [
                "Naohiro Minami"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12568,
              "names": [
                "Naoki-T"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24810,
          "annSongId": 39725,
          "animeENName": "Sugar Apple Fairy Tale",
          "animeJPName": "Sugar Apple Fairy Tale",
          "animeAltName": null,
          "animeVintage": "Winter 2023",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "I Will Go On",
          "songArtist": "Sumire Morohoshi",
          "songDifficulty": 22.01,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/0unu6k.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/j7tcqp.mp3",
          "artists": [
            {
              "id": 5732,
              "names": [
                "Sumire Morohoshi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 7409,
                  "names": [
                    "Electric Show Dancers"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14842,
              "names": [
                "Hiroshi Sasaki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14392,
              "names": [
                "Yusuke Shirato"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 27603,
          "annSongId": 40247,
          "animeENName": "Sugar Apple Fairy Tale",
          "animeJPName": "Sugar Apple Fairy Tale",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Opening 1",
          "songName": "Surprise",
          "songArtist": "Rei Nakashima",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/q9vs6c.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/kzwehx.mp3",
          "artists": [
            {
              "id": 18818,
              "names": [
                "Rei Nakashima"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13346,
              "names": [
                "Wataru Maeguchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 17420,
              "names": [
                "H-Wonder"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 27603,
          "annSongId": 40647,
          "animeENName": "Sugar Apple Fairy Tale",
          "animeJPName": "Sugar Apple Fairy Tale",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Ending 1",
          "songName": "door",
          "songArtist": "Nao Touyama",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/9kuvom.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/08sxv9.mp3",
          "artists": [
            {
              "id": 5072,
              "names": [
                "Nao Touyama",
                "Hack"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5373,
                  "names": [
                    "Shiritsu Lydian Ongakuin Seito Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5717,
                  "names": [
                    "Rhodanthe*"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5816,
                  "names": [
                    "Jupiter no Shimai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5894,
                  "names": [
                    "Gesukawa☆Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6003,
                  "names": [
                    "Kongou-gata Yon Shimai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6432,
                  "names": [
                    "Team Fortuna"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6592,
                  "names": [
                    "Walküre"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6934,
                  "names": [
                    "Mikarina"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7089,
                  "names": [
                    "Shinjugamine Jogakuen Hoshimori Class"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7477,
                  "names": [
                    "Pearly☆Fairy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7684,
                  "names": [
                    "√venustas"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7747,
                  "names": [
                    "Pearly☆Fairy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8331,
                  "names": [
                    "Dai Teikoku Kageki-dan B.L.A.C.K"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8566,
                  "names": [
                    "TWINKle MAGIC"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8586,
                  "names": [
                    "Pokapoka Ion"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13926,
                  "names": [
                    "Yami_Q_ray"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13953,
                  "names": [
                    "Citron"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15120,
              "names": [
                "Yosuke Kurokawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15120,
              "names": [
                "Yosuke Kurokawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41233,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Ending 1",
          "songName": "Kanata Haruka",
          "songArtist": "RADWIMPS",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/6bnirz.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/98t7fy.mp3",
          "artists": [
            {
              "id": 6736,
              "names": [
                "RADWIMPS",
                "Misoshiru's"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14001,
                  "names": [
                    "Yojiro Noda"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14001,
              "names": [
                "Yojiro Noda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14001,
              "names": [
                "Yojiro Noda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41234,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Ending 2",
          "songName": "Suzume",
          "songArtist": "RADWIMPS feat. Toaka",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/dp5tbe.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/1nz1gy.mp3",
          "artists": [
            {
              "id": 19059,
              "names": [
                "Toaka"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14001,
              "names": [
                "Yojiro Noda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6736,
              "names": [
                "RADWIMPS",
                "Misoshiru's"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41230,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Insert Song",
          "songName": "Rouge no Dengon",
          "songArtist": "Yumi Arai",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/o0x6c8.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/twsuv8.mp3",
          "artists": [
            {
              "id": 1134,
              "names": [
                "Yumi Arai",
                "Yumi Matsutoya",
                "Karuho Kureda"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 1134,
              "names": [
                "Yumi Arai",
                "Yumi Matsutoya",
                "Karuho Kureda"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11072,
              "names": [
                "Masataka Matsutouya"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41231,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Insert Song",
          "songName": "SWEET MEMORIES (Re-Mix Version)",
          "songArtist": "Seiko Matsuda",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/wfygez.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/rdzds4.mp3",
          "artists": [
            {
              "id": 614,
              "names": [
                "Seiko Matsuda",
                "Paw Paw"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 11303,
              "names": [
                "Masaaki Oomura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 11303,
              "names": [
                "Masaaki Oomura"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41232,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Insert Song",
          "songName": "Yume no Naka e",
          "songArtist": "Yosui Inoue",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/xj7jwo.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/9la1e0.mp3",
          "artists": [
            {
              "id": 2179,
              "names": [
                "Yosui Inoue"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 2179,
              "names": [
                "Yosui Inoue"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10625,
              "names": [
                "Katsu Hoshi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 25057,
          "annSongId": 41235,
          "animeENName": "Suzume no Tojimari",
          "animeJPName": "Suzume no Tojimari",
          "animeAltName": null,
          "animeVintage": null,
          "animeType": null,
          "songType": "Insert Song",
          "songName": "Kenka o Yamete",
          "songArtist": "Naoko Kawai",
          "songDifficulty": null,
          "songCategory": null,
          "HQ": "https://ladist1.catbox.video/kj5lhm.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/4pyklu.mp3",
          "artists": [
            {
              "id": 1198,
              "names": [
                "Naoko Kawai"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 3800,
              "names": [
                "Mariya Takeuchi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10823,
              "names": [
                "Nobuyuki Shimizu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12753,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "sister's noise",
          "songArtist": "fripSide",
          "songDifficulty": 61.12,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vp0xbp.webm",
          "MQ": "https://ladist1.catbox.video/x6r09x.webm",
          "audio": "https://ladist1.catbox.video/qhpece.mp3",
          "artists": [
            {
              "id": 4647,
              "names": [
                "fripSide",
                "fripSide NAO project"
              ],
              "line_up_id": 2,
              "groups": null,
              "members": [
                {
                  "id": 5484,
                  "names": [
                    "Yoshino Nanjo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12756,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Opening 2",
          "songName": "eternal reality",
          "songArtist": "fripSide",
          "songDifficulty": 51.98,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/g2oa3p.webm",
          "MQ": "https://ladist1.catbox.video/1nomki.webm",
          "audio": "https://ladist1.catbox.video/gfsp2i.mp3",
          "artists": [
            {
              "id": 4647,
              "names": [
                "fripSide",
                "fripSide NAO project"
              ],
              "line_up_id": 2,
              "groups": null,
              "members": [
                {
                  "id": 5484,
                  "names": [
                    "Yoshino Nanjo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12761,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Grow Slowly",
          "songArtist": "Yuka Iguchi",
          "songDifficulty": 20.59,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/309lyj.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/q33leq.mp3",
          "artists": [
            {
              "id": 2934,
              "names": [
                "Yuka Iguchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4856,
                  "names": [
                    "KILLER GIRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5310,
                  "names": [
                    "Tomodachi Tsukuri-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5373,
                  "names": [
                    "Shiritsu Lydian Ongakuin Seito Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5567,
                  "names": [
                    "Ankou Team"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5653,
                  "names": [
                    "RO-KYU-BU!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5816,
                  "names": [
                    "Jupiter no Shimai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5883,
                  "names": [
                    "SAKURA∗TRICK"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8572,
                  "names": [
                    "Rinjin-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13459,
              "names": [
                "Shou Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13445,
              "names": [
                "Teppei Shimizu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12759,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "stand still",
          "songArtist": "Yuka Iguchi",
          "songDifficulty": 19.16,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/983i7r.webm",
          "MQ": "https://ladist1.catbox.video/tpflyy.webm",
          "audio": "https://ladist1.catbox.video/cp43jp.mp3",
          "artists": [
            {
              "id": 2934,
              "names": [
                "Yuka Iguchi"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4856,
                  "names": [
                    "KILLER GIRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5310,
                  "names": [
                    "Tomodachi Tsukuri-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5373,
                  "names": [
                    "Shiritsu Lydian Ongakuin Seito Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5567,
                  "names": [
                    "Ankou Team"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5653,
                  "names": [
                    "RO-KYU-BU!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5816,
                  "names": [
                    "Jupiter no Shimai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5883,
                  "names": [
                    "SAKURA∗TRICK"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6002,
                  "names": [
                    "Kan Musume Tokubetsu Kantai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8572,
                  "names": [
                    "Rinjin-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13459,
              "names": [
                "Shou Watanabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14510,
              "names": [
                "Toshinori Moriya"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12762,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Links",
          "songArtist": "Sachika Misawa",
          "songDifficulty": 18.29,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/fi5cxr.webm",
          "MQ": "https://ladist1.catbox.video/n4c1wb.webm",
          "audio": "https://ladist1.catbox.video/z57dxr.mp3",
          "artists": [
            {
              "id": 5370,
              "names": [
                "Sachika Misawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5959,
                  "names": [
                    "10-nen Kurogumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6034,
                  "names": [
                    "Nagarekawa Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6058,
                  "names": [
                    "Dark Cherries"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7345,
                  "names": [
                    "Magical Twins"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7431,
                  "names": [
                    "Uma Musume",
                    "Uma Musume 2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14532,
              "names": [
                "Naoki Chiba"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14532,
              "names": [
                "Naoki Chiba"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12758,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "Infinia",
          "songArtist": "Sachika Misawa",
          "songDifficulty": 17.17,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/2vxogq.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/2k0xci.mp3",
          "artists": [
            {
              "id": 5370,
              "names": [
                "Sachika Misawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5959,
                  "names": [
                    "10-nen Kurogumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6034,
                  "names": [
                    "Nagarekawa Girls"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6058,
                  "names": [
                    "Dark Cherries"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7345,
                  "names": [
                    "Magical Twins"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7431,
                  "names": [
                    "Uma Musume",
                    "Uma Musume 2"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7606,
                  "names": [
                    "Afterglow"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 4095,
              "names": [
                "Ceui"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            },
            {
              "id": 12952,
              "names": [
                "Kotaro Odaka"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12952,
              "names": [
                "Kotaro Odaka"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12751,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "LEVEL5 -judgelight-",
          "songArtist": "fripSide",
          "songDifficulty": 74.44,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/va0u85.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/eoqgh7.mp3",
          "artists": [
            {
              "id": 4647,
              "names": [
                "fripSide",
                "fripSide NAO project"
              ],
              "line_up_id": 2,
              "groups": null,
              "members": [
                {
                  "id": 5484,
                  "names": [
                    "Yoshino Nanjo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 14853,
          "annSongId": 12752,
          "animeENName": "A Certain Scientific Railgun S",
          "animeJPName": "Toaru Kagaku no Railgun S",
          "animeAltName": null,
          "animeVintage": "Spring 2013",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "future gazer",
          "songArtist": "fripSide",
          "songDifficulty": 60.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/eum3d8.webm",
          "MQ": "https://ladist1.catbox.video/f5o20a.webm",
          "audio": "https://ladist1.catbox.video/ne2myi.mp3",
          "artists": [
            {
              "id": 4647,
              "names": [
                "fripSide",
                "fripSide NAO project"
              ],
              "line_up_id": 2,
              "groups": null,
              "members": [
                {
                  "id": 5484,
                  "names": [
                    "Yoshino Nanjo"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 10382,
              "names": [
                "Satoshi Yaginuma"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 2018,
          "annSongId": 23820,
          "animeENName": "Tokyo Godfathers",
          "animeJPName": "Tokyo Godfathers",
          "animeAltName": null,
          "animeVintage": "Fall 2003",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "No.9",
          "songArtist": "Keiichi Suzuki",
          "songDifficulty": 25.05,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ytz50e.webm",
          "MQ": "https://ladist1.catbox.video/xpabsg.webm",
          "audio": "https://ladist1.catbox.video/21f5r8.mp3",
          "artists": [
            {
              "id": 2582,
              "names": [
                "Keiichi Suzuki"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6110,
              "names": [
                "Ludwig Van Beethoven"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 5193,
              "names": [
                "Moonriders"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 2018,
          "annSongId": 20735,
          "animeENName": "Tokyo Godfathers",
          "animeJPName": "Tokyo Godfathers",
          "animeAltName": null,
          "animeVintage": "Fall 2003",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Kiyoshiko no Yoru",
          "songArtist": "Tokyo Godfathers Gasshou-dan",
          "songDifficulty": 40.82,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/lu7bh4.webm",
          "MQ": "https://ladist1.catbox.video/572xuq.webm",
          "audio": "https://ladist1.catbox.video/qvh9at.mp3",
          "artists": [
            {
              "id": 2580,
              "names": [
                "Tokyo Godfathers Gasshou-dan"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 11729,
              "names": [
                "Franz Xaver Gruber"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 2582,
              "names": [
                "Keiichi Suzuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 2018,
          "annSongId": 20736,
          "animeENName": "Tokyo Godfathers",
          "animeJPName": "Tokyo Godfathers",
          "animeAltName": null,
          "animeVintage": "Fall 2003",
          "animeType": "movie",
          "songType": "Insert Song",
          "songName": "Mauvais Garcon",
          "songArtist": "Yoshiaki Umegaki",
          "songDifficulty": 20.15,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/m0kalq.webm",
          "MQ": "https://ladist1.catbox.video/41khpo.webm",
          "audio": "https://ladist1.catbox.video/04yxgl.mp3",
          "artists": [
            {
              "id": 2581,
              "names": [
                "Yoshiaki Umegaki"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 11871,
              "names": [
                "Adamo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 2582,
              "names": [
                "Keiichi Suzuki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23373,
          "annSongId": 32894,
          "animeENName": "Umibe no Étranger",
          "animeJPName": "Umibe no Étranger",
          "animeAltName": null,
          "animeVintage": "Summer 2020",
          "animeType": "movie",
          "songType": "Ending 1",
          "songName": "Zokkon",
          "songArtist": "MONO NO AWARE",
          "songDifficulty": 20.27,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/avf4my.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/ofhke5.mp3",
          "artists": [
            {
              "id": 7075,
              "names": [
                "MONO NO AWARE"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 14109,
                  "names": [
                    "Shukei Tamaoki"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 14109,
              "names": [
                "Shukei Tamaoki"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 7075,
              "names": [
                "MONO NO AWARE"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23787,
          "annSongId": 32359,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Winter 2021",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Sudachi no Uta",
          "songArtist": "Anemoneria",
          "songDifficulty": 61.18,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bdnr0h.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/h3umvl.mp3",
          "artists": [
            {
              "id": 8372,
              "names": [
                "Anemoneria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14640,
              "names": [
                "Saburou Iwakawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15800,
              "names": [
                "Kyouhei Arahata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23787,
          "annSongId": 32360,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Winter 2021",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Life is Cider",
          "songArtist": "Anemoneria",
          "songDifficulty": 46.74,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vy9c3f.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/zlsc3q.mp3",
          "artists": [
            {
              "id": 8372,
              "names": [
                "Anemoneria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15962,
              "names": [
                "Akiba Koudai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12799,
              "names": [
                "Kazuya Komatsu",
                "Koma2 Kaz"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 23787,
          "annSongId": 33927,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Winter 2021",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Colorful",
          "songArtist": "mito",
          "songDifficulty": 23.95,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/41ar5r.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/mhwpz8.mp3",
          "artists": [
            {
              "id": 6069,
              "names": [
                "mito"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 6069,
              "names": [
                "mito"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 6069,
              "names": [
                "mito"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24211,
          "annSongId": 34213,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Spring 2021",
          "animeType": "special",
          "songType": "Opening 1",
          "songName": "Sudachi no Uta",
          "songArtist": "Anemoneria",
          "songDifficulty": 64.4,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/bdnr0h.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/h3umvl.mp3",
          "artists": [
            {
              "id": 8372,
              "names": [
                "Anemoneria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14640,
              "names": [
                "Saburou Iwakawa"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15800,
              "names": [
                "Kyouhei Arahata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24211,
          "annSongId": 34214,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Spring 2021",
          "animeType": "special",
          "songType": "Ending 1",
          "songName": "Life is Cider",
          "songArtist": "Anemoneria",
          "songDifficulty": 50.68,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/vy9c3f.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/zlsc3q.mp3",
          "artists": [
            {
              "id": 8372,
              "names": [
                "Anemoneria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15962,
              "names": [
                "Akiba Koudai"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 12799,
              "names": [
                "Kazuya Komatsu",
                "Koma2 Kaz"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 24211,
          "annSongId": 34215,
          "animeENName": "Wonder Egg Priority",
          "animeJPName": "Wonder Egg Priority",
          "animeAltName": null,
          "animeVintage": "Spring 2021",
          "animeType": "special",
          "songType": "Insert Song",
          "songName": "anemos",
          "songArtist": "Anemoneria",
          "songDifficulty": 18.48,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/hgzors.webm",
          "MQ": null,
          "audio": "https://ladist1.catbox.video/odpqq2.mp3",
          "artists": [
            {
              "id": 8372,
              "names": [
                "Anemoneria"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15800,
              "names": [
                "Kyouhei Arahata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 15800,
              "names": [
                "Kyouhei Arahata"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 14440,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Opening 1",
          "songName": "Hoshi to Hana",
          "songArtist": "Sanshuu Chuugaku Yuusha-bu",
          "songDifficulty": 44.09,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/0grh9w.webm",
          "MQ": "https://ladist1.catbox.video/k5fqqd.webm",
          "audio": "https://ladist1.catbox.video/2ugvn2.mp3",
          "artists": [
            {
              "id": 6163,
              "names": [
                "Sanshuu Chuugaku Yuusha-bu"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 5155,
                  "names": [
                    "Yumi Uchiyama"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5221,
                  "names": [
                    "Suzuko Mimori"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5671,
                  "names": [
                    "Tomoyo Kurosawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5896,
                  "names": [
                    "Haruka Terui"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7586,
                  "names": [
                    "Juri Nagatsuma"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 14441,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Ending 1",
          "songName": "Aurora Days",
          "songArtist": "Sanshuu Chuugaku Yuusha-bu",
          "songDifficulty": 32.54,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/2b3a68.webm",
          "MQ": "https://ladist1.catbox.video/4e11xs.webm",
          "audio": "https://ladist1.catbox.video/zkdur1.mp3",
          "artists": [
            {
              "id": 6163,
              "names": [
                "Sanshuu Chuugaku Yuusha-bu"
              ],
              "line_up_id": 0,
              "groups": null,
              "members": [
                {
                  "id": 5155,
                  "names": [
                    "Yumi Uchiyama"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5221,
                  "names": [
                    "Suzuko Mimori"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5671,
                  "names": [
                    "Tomoyo Kurosawa"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5896,
                  "names": [
                    "Haruka Terui"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7586,
                  "names": [
                    "Juri Nagatsuma"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ]
            }
          ],
          "composers": [
            {
              "id": 15415,
              "names": [
                "Hajime Mitsumasu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14888,
              "names": [
                "Effy"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 18472,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Ending 2",
          "songName": "Inori no Uta acoustic guitar ver",
          "songArtist": "Tomoyo Kurosawa",
          "songDifficulty": 24.17,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/q5djxy.webm",
          "MQ": "https://ladist1.catbox.video/7fh2qc.webm",
          "audio": "https://ladist1.catbox.video/n6qhm6.mp3",
          "artists": [
            {
              "id": 5671,
              "names": [
                "Tomoyo Kurosawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6095,
                  "names": [
                    "CINDERELLA PROJECT"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6099,
                  "names": [
                    "Dekoration"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6128,
                  "names": [
                    "BRILLIANT4"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6163,
                  "names": [
                    "Sanshuu Chuugaku Yuusha-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6323,
                  "names": [
                    "Kitauji Quartet"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6510,
                  "names": [
                    "AWA² GiRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7607,
                  "names": [
                    "Hello, Happy World!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8056,
                  "names": [
                    "3-choume All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13915,
                  "names": [
                    "Ton Tokoton Staff Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17448,
                  "names": [
                    "Team Ton Tokoton"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17585,
                  "names": [
                    "U149"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19349,
                  "names": [
                    "EVER GOLD"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10452,
              "names": [
                "shilo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14940,
              "names": [
                "Meis Clauson"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 18475,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Ending 3",
          "songName": "Inori no Uta",
          "songArtist": "Tomoyo Kurosawa",
          "songDifficulty": 25.02,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/ciz2rw.webm",
          "MQ": "https://ladist1.catbox.video/xub51b.webm",
          "audio": "https://ladist1.catbox.video/4eme47.mp3",
          "artists": [
            {
              "id": 5671,
              "names": [
                "Tomoyo Kurosawa"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 6095,
                  "names": [
                    "CINDERELLA PROJECT"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6099,
                  "names": [
                    "Dekoration"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6128,
                  "names": [
                    "BRILLIANT4"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6163,
                  "names": [
                    "Sanshuu Chuugaku Yuusha-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6323,
                  "names": [
                    "Kitauji Quartet"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6510,
                  "names": [
                    "AWA² GiRLS"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7607,
                  "names": [
                    "Hello, Happy World!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8056,
                  "names": [
                    "3-choume All Stars"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 13915,
                  "names": [
                    "Ton Tokoton Staff Ichidou"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17448,
                  "names": [
                    "Team Ton Tokoton"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17585,
                  "names": [
                    "U149"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19349,
                  "names": [
                    "EVER GOLD"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 10452,
              "names": [
                "shilo"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14940,
              "names": [
                "Meis Clauson"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 18474,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Ending 4",
          "songName": "Aurora Days",
          "songArtist": "Suzuko Mimori",
          "songDifficulty": 31.83,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/y68aef.webm",
          "MQ": "https://ladist1.catbox.video/7qt773.webm",
          "audio": "https://ladist1.catbox.video/qeapdf.mp3",
          "artists": [
            {
              "id": 5221,
              "names": [
                "Suzuko Mimori"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 4974,
                  "names": [
                    "Milky Holmes"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5045,
                  "names": [
                    "Hakuou Jogakuin no Yacht-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5111,
                  "names": [
                    "Ultra Rare"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5478,
                  "names": [
                    "μ's"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 5998,
                  "names": [
                    "BUSHI★7"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6060,
                  "names": [
                    "Tennyo-tai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6163,
                  "names": [
                    "Sanshuu Chuugaku Yuusha-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6879,
                  "names": [
                    "Glitter*Green"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7384,
                  "names": [
                    "Erabareshi Kodomo-tachi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7414,
                  "names": [
                    "iL'ange"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7477,
                  "names": [
                    "Pearly☆Fairy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7515,
                  "names": [
                    "Starlight Kuku-gumi"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7720,
                  "names": [
                    "All☆Jewel Idols"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 7747,
                  "names": [
                    "Pearly☆Fairy"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8437,
                  "names": [
                    "Mystery Kiss"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 8575,
                  "names": [
                    "Nanamori Chu☆Seitokai"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 19329,
                  "names": [
                    "Shichikage"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15415,
              "names": [
                "Hajime Mitsumasu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14888,
              "names": [
                "Effy"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 18476,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Ending 5",
          "songName": "Aurora Days",
          "songArtist": "Haruka Terui",
          "songDifficulty": 32.66,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/4i8zys.webm",
          "MQ": "https://ladist1.catbox.video/kt47vu.webm",
          "audio": "https://ladist1.catbox.video/vpefqu.mp3",
          "artists": [
            {
              "id": 5896,
              "names": [
                "Haruka Terui"
              ],
              "line_up_id": -1,
              "groups": [
                {
                  "id": 5897,
                  "names": [
                    "Mikakuning!"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6163,
                  "names": [
                    "Sanshuu Chuugaku Yuusha-bu"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 6931,
                  "names": [
                    "A.I.S"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                },
                {
                  "id": 17585,
                  "names": [
                    "U149"
                  ],
                  "line_up_id": null,
                  "groups": null,
                  "members": null
                }
              ],
              "members": null
            }
          ],
          "composers": [
            {
              "id": 15415,
              "names": [
                "Hajime Mitsumasu"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14888,
              "names": [
                "Effy"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 22248,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Yuugao",
          "songArtist": "Emi Evans",
          "songDifficulty": 28.56,
          "songCategory": "Chanting",
          "HQ": "https://ladist1.catbox.video/168zj0.webm",
          "MQ": "https://ladist1.catbox.video/pd2s33.webm",
          "audio": "https://ladist1.catbox.video/9ebszj.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 14542,
              "names": [
                "Keigo Hoashi"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        },
        {
          "annId": 16171,
          "annSongId": 22251,
          "animeENName": "Yuki Yuna is a Hero",
          "animeJPName": "Yuuki Yuuna wa Yuusha de Aru",
          "animeAltName": null,
          "animeVintage": "Fall 2014",
          "animeType": "TV",
          "songType": "Insert Song",
          "songName": "Usuyukisou",
          "songArtist": "Emi Evans",
          "songDifficulty": 25.22,
          "songCategory": "Standard",
          "HQ": "https://ladist1.catbox.video/u4qnqb.webm",
          "MQ": "https://ladist1.catbox.video/qdfjwj.webm",
          "audio": "https://ladist1.catbox.video/nfz8v6.mp3",
          "artists": [
            {
              "id": 6162,
              "names": [
                "Emi Evans"
              ],
              "line_up_id": -1,
              "groups": null,
              "members": null
            }
          ],
          "composers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ],
          "arrangers": [
            {
              "id": 13494,
              "names": [
                "Keichi Okabe"
              ],
              "line_up_id": null,
              "groups": null,
              "members": null
            }
          ]
        }
      ]`

    handleData(JSON.parse(data))
    console.log(songList)
    saveSongs(songList)
}

// start quiz and load first song
function startQuiz() {
    if (!lobby.inLobby) return;
    if (lobby.soloMode) {
        if (!songList.length) return;
    }
    else {
        cslMultiplayer.host = lobby.hostName;
    }
    let song;
    if (lobby.isHost) {
        song = songList[songOrder[1]];
    }
    skipping = false;
    quiz.cslActive = true;
    let date = new Date().toISOString();
    for (let player of Object.values(lobby.players)) {
        score[player.gamePlayerId] = 0;
    }
    // console.log({ showSelection, totalSongs, guessTime, extraGuessTime, fastSkip });
    let data = {
        "gameMode": lobby.soloMode ? "Solo" : "Multiplayer",
        "showSelection": showSelection,
        "groupSlotMap": createGroupSlotMap(Object.keys(lobby.players)),
        "players": [],
        "multipleChoice": false,
        "quizDescription": {
            "quizId": "",
            "startTime": date,
            "roomName": hostModal.$roomName.val()
        }
    };
    Object.values(lobby.players).forEach((player, i) => {
        player.pose = 1;
        player.sore = 0;
        player.position = Math.floor(i / 8) + 1;
        player.positionSlot = i % 8;
        player.teamCaptain = null;
        player.teamNumber = null;
        player.teamPlayer = null;
        data.players.push(player);
    });
    //console.log(data.players);
    fireListener("Game Starting", data);
    setTimeout(() => {
        if (quiz.soloMode) {
            fireListener("quiz next video info", {
                "playLength": guessTime,
                "playbackSpeed": 1,
                "startPont": getStartPoint(),
                "videoInfo": {
                    "id": null,
                    "videoMap": {
                        "catbox": createCatboxLinkObject(song.audio, song.video480, song.video720)
                    },
                    "videoVolumeMap": {
                        "catbox": {
                            "0": -20,
                            "480": -20,
                            "720": -20
                        }
                    }
                }
            });
        }
        else {
            if (quiz.isHost) {
                cslMessage("§CSL3" + btoa(`${1}-${getStartPoint()}-${song.audio || ""}-${/*song.video480 || */""}-${/*song.video720 || */""}`));
            }
        }
    }, 100);
    if (quiz.soloMode) {
        setTimeout(() => {
            fireListener("quiz ready", {
                "numberOfSongs": totalSongs
            });
        }, 200);
        setTimeout(() => {
            fireListener("quiz waiting buffering", {
                "firstSong": true
            });
        }, 300);
        setTimeout(() => {
            previousSongFinished = true;
            readySong(1);
        }, 400);
    }
}

// check if all conditions are met to go to next song
function readySong(songNumber) {
    if (songNumber === currentSong) return;
    // console.log("Ready song: " + songNumber);
    nextVideoReadyInterval = setInterval(() => {
        // console.log({ nextVideoReady, previousSongFinished });
        if (nextVideoReady && !quiz.pauseButton.pauseOn && previousSongFinished) {
            clearInterval(nextVideoReadyInterval);
            nextVideoReady = false;
            previousSongFinished = false;
            if (quiz.soloMode) {
                playSong(songNumber);
            }
            else if (quiz.isHost) {
                cslMessage("§CSL4" + btoa(songNumber));
            }
        }
    }, 100);
}

// play a song
function playSong(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    for (let key of Object.keys(quiz.players)) {
        currentAnswers[key] = "";
        cslMultiplayer.voteSkip[key] = false;
    }
    cslMultiplayer.songInfo = {};
    currentSong = songNumber;
    cslState = 1;
    skipping = false;
    fireListener("play next song", {
        "time": guessTime,
        "extraGuessTime": extraGuessTime,
        "songNumber": songNumber,
        "progressBarState": { "length": guessTime, "played": 0 },
        "onLastSong": songNumber === totalSongs,
        "multipleChoiceNames": null
    });
    if (extraGuessTime) {
        extraGuessTimer = setTimeout(() => {
            fireListener("extra guess time");
        }, guessTime * 1000);
    }
    endGuessTimer = setTimeout(() => {
        if (quiz.soloMode) {
            clearInterval(skipInterval);
            clearTimeout(endGuessTimer);
            clearTimeout(extraGuessTimer);
            endGuessPhase(songNumber);
        }
        else if (quiz.isHost) {
            cslMessage("§CSL92");
        }
    }, (guessTime + extraGuessTime) * 1000);
    if (quiz.soloMode) {
        skipInterval = setInterval(() => {
            if (quiz.skipController._toggled) {
                fireListener("quiz overlay message", "Skipping to Answers");
                clearInterval(skipInterval);
                clearTimeout(endGuessTimer);
                clearTimeout(extraGuessTimer);
                setTimeout(() => {
                    endGuessPhase(songNumber);
                }, fastSkip ? 1000 : 3000);
            }
        }, 100);
    }
    setTimeout(() => {
        if (songNumber < totalSongs) {
            if (quiz.soloMode) {
                readySong(songNumber + 1);
                let nextSong = songList[songOrder[songNumber + 1]];
                fireListener("quiz next video info", {
                    "playLength": guessTime,
                    "playbackSpeed": 1,
                    "startPont": getStartPoint(),
                    "videoInfo": {
                        "id": null,
                        "videoMap": {
                            "catbox": createCatboxLinkObject(nextSong.audio, nextSong.video480, nextSong.video720)
                        },
                        "videoVolumeMap": {
                            "catbox": {
                                "0": -20,
                                "480": -20,
                                "720": -20
                            }
                        }
                    }
                });
            }
            else {
                readySong(songNumber + 1);
                if (quiz.isHost) {
                    let nextSong = songList[songOrder[songNumber + 1]];
                    cslMessage("§CSL3" + btoa(`${songNumber + 1}-${getStartPoint()}-${nextSong.audio || ""}-${/*nextSong.video480 || */""}-${/*nextSong.video720 || */""}`));
                }
            }
        }
    }, 100);
}

// end guess phase and display answer
function endGuessPhase(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    let song;
    if (quiz.isHost) {
        song = songList[songOrder[songNumber]];
    }
    fireListener("guess phase over");
    if (!quiz.soloMode && quiz.inQuiz) {
        cslMessage("§CSL6" + btoa(encodeURIComponent(currentAnswers[quiz.ownGamePlayerId])));
    }
    answerTimer = setTimeout(() => {
        if (!quiz.cslActive || !quiz.inQuiz) return reset();
        cslState = 2;
        skipping = false;
        for (let key of Object.keys(quiz.players)) {
            cslMultiplayer.voteSkip[key] = false;
        }
        let data = {
            "answers": [],
            "progressBarState": null
        };
        for (let player of Object.values(quiz.players)) {
            data.answers.push({
                "gamePlayerId": player.gamePlayerId,
                "pose": 3,
                "answer": currentAnswers[player.gamePlayerId] || ""
            });
        }
        fireListener("player answers", data);
        if (!quiz.soloMode && quiz.isHost) {
            cslMessage("§CSLa" + btoa(encodeURI(song.animeRomajiName || "")));
            cslMessage("§CSLb" + btoa(encodeURI(song.animeEnglishName || "")));
            cslMessage("§CSLc" + btoa(encodeURI(song.songArtist || "")));
            cslMessage("§CSLd" + btoa(encodeURI(song.songName || "")));
            cslMessage("§CSLe" + btoa(`${song.songType || ""}-${song.songTypeNumber || ""}-${song.songDifficulty || ""}-${song.animeType || ""}-${song.animeVintage || ""}-${song.annId || ""}-${song.malId || ""}-${song.kitsuId || ""}-${song.aniListId || ""}`));
            cslMessage("§CSLf" + btoa(encodeURI(song.audio || "")));
        }
        answerTimer = setTimeout(() => {
            if (!quiz.cslActive || !quiz.inQuiz) return reset();
            let correct = {};
            let pose = {};
            if (quiz.isHost) {
                for (let player of Object.values(quiz.players)) {
                    let isCorrect = isCorrectAnswer(songNumber, currentAnswers[player.gamePlayerId]);
                    correct[player.gamePlayerId] = isCorrect;
                    pose[player.gamePlayerId] = currentAnswers[player.gamePlayerId] ? (isCorrect ? 5 : 4) : 6;
                    if (isCorrect) score[player.gamePlayerId]++;
                }
            }
            if (quiz.soloMode) {
                let data = {
                    "players": [],
                    "songInfo": {
                        "animeNames": {
                            "english": song.animeEnglishName,
                            "romaji": song.animeRomajiName
                        },
                        "artist": song.songArtist,
                        "songName": song.songName,
                        "videoTargetMap": {
                            "catbox": {
                                "0": formatTargetUrl(song.audio),
                                "480": formatTargetUrl(song.video480),
                                "720": formatTargetUrl(song.video720)
                            }
                        },
                        "type": song.songType,
                        "typeNumber": song.songTypeNumber,
                        "annId": song.annId,
                        "highRisk": 0,
                        "animeScore": null,
                        "animeType": song.animeType,
                        "vintage": song.animeVintage,
                        "animeDifficulty": song.songDifficulty,
                        "animeTags": song.animeTags,
                        "animeGenre": song.animeGenre,
                        "altAnimeNames": song.altAnimeNames,
                        "altAnimeNamesAnswers": song.altAnimeNamesAnswers,
                        "siteIds": {
                            "annId": song.annId,
                            "malId": song.malId,
                            "kitsuId": song.kitsuId,
                            "aniListId": song.aniListId
                        }
                    },
                    "progressBarState": {
                        "length": 25,
                        "played": 0
                    },
                    "groupMap": createGroupSlotMap(Object.keys(quiz.players)),
                    "watched": false
                };
                for (let player of Object.values(quiz.players)) {
                    data.players.push({
                        "gamePlayerId": player.gamePlayerId,
                        "pose": pose[player.gamePlayerId],
                        "level": quiz.players[player.gamePlayerId].level,
                        "correct": correct[player.gamePlayerId],
                        "score": score[player.gamePlayerId],
                        "listStatus": null,
                        "showScore": null,
                        "position": Math.floor(player.gamePlayerId / 8) + 1,
                        "positionSlot": player.gamePlayerId % 8
                    });
                }
                fireListener("answer results", data);
            }
            else if (quiz.isHost) {
                let list = [];
                for (let id of Object.keys(correct)) {
                    list.push(`${id},${correct[id] ? "1" : "0"},${pose[id]},${score[id]}`);
                }
                cslMessage("§CSL7" + btoa(list.join("-")));
            }
            setTimeout(() => {
                if (!quiz.cslActive || !quiz.inQuiz) return reset();
                if (quiz.soloMode) {
                    skipInterval = setInterval(() => {
                        if (quiz.skipController._toggled) {
                            clearInterval(skipInterval);
                            endReplayPhase(songNumber);
                        }
                    }, 100);
                }
            }, fastSkip ? 1000 : 2000);
        }, fastSkip ? 200 : 3000);
    }, fastSkip ? 100 : 400);
}

// end replay phase
function endReplayPhase(songNumber) {
    if (!quiz.cslActive || !quiz.inQuiz) return reset();
    //console.log(`end replay phase (${songNumber})`);
    if (songNumber < totalSongs) {
        fireListener("quiz overlay message", "Skipping to Next Song");
        setTimeout(() => {
            previousSongFinished = true;
        }, fastSkip ? 1000 : 3000);
    }
    else {
        fireListener("quiz overlay message", "Skipping to Final Standings");
        setTimeout(() => {
            let data = {
                "resultStates": []
            };
            /*"progressBarState": {
                "length": 26.484,
                "played": 6.484
            }*/
            let sortedScores = Array.from(new Set(Object.values(score))).sort((a, b) => b - a);
            for (let id of Object.keys(score)) {
                data.resultStates.push({
                    "gamePlayerId": parseInt(id),
                    "pose": 1,
                    "endPosition": sortedScores.indexOf(score[id]) + 1
                });
            }
            fireListener("quiz end result", data);
        }, fastSkip ? 2000 : 5000);
        setTimeout(() => {
            if (quiz.soloMode) {
                quizOver();
            }
            else if (quiz.isHost) {
                cslMessage("§CSL1");
            }
        }, fastSkip ? 5000 : 12000);
    }
}

// fire all event listeners (including scripts)
function fireListener(type, data) {
    try {
        for (let listener of socket.listners[type]) {
            listener.fire(data);
        }
    }
    catch (error) {
        sendSystemMessage(`CSL Error: "${type}" listener failed`);
        console.error(error);
        // console.log(type);
        // console.log(data);
    }
}

// send csl chat message
function cslMessage(text) {
    if (!isRankedMode()) {
        socket.sendCommand({ type: "lobby", command: "game chat message", data: { msg: String(text), teamMessage: false } });
    }
}

// send a client side message to game chat
function sendSystemMessage(message) {
    if (gameChat.open) {
        setTimeout(() => { gameChat.systemMessage(String(message)) }, 1);
    }
}

// parse message
function parseMessage(content, sender) {
    if (isRankedMode()) return;
    let player;
    if (lobby.inLobby) player = Object.values(lobby.players).find((x) => x._name === sender);
    else if (quiz.inQuiz) player = Object.values(quiz.players).find((x) => x._name === sender);
    let isHost = sender === cslMultiplayer.host;
    if (content.startsWith("§CSL0")) { //start quiz
        if (lobby.inLobby && sender === lobby.hostName && !quiz.cslActive) {
            let split = decodeURI(atob(content.slice(5))).split("-");
            if (split.length === 6) {
                //mode = parseInt(split[0]);
                currentSong = parseInt(split[1]);
                totalSongs = parseInt(split[2]);
                guessTime = parseInt(split[3]);
                extraGuessTime = parseInt(split[4]);
                fastSkip = Boolean(parseInt(split[5]));
                sendSystemMessage(`CSL: starting multiplayer quiz (${totalSongs} songs)`);
                startQuiz();
            }
        }
    }
    else if (quiz.cslActive && quiz.inQuiz && cslMultiplayer.host !== lobby.hostName) {
        sendSystemMessage("client out of sync, quitting CSL");
        quizOver();
    }
    else if (content.startsWith("§CSL1")) { //return to lobby
        if (quiz.cslActive && quiz.inQuiz && (isHost || sender === lobby.hostName)) {
            quizOver();
        }
    }
    else if (content.startsWith("§CSL20")) { //player rejoin
        if (sender === lobby.hostName) {
            let name = atob(content.slice(6));
            if (name === selfName) {
                socket.sendCommand({ type: "lobby", command: "change to player" });
            }
            else if (quiz.cslActive && quiz.inQuiz) {
                let player = Object.values(quiz.players).find((p) => p._name === name);
                if (player) {
                    fireListener("Rejoining Player", { "name": name, "gamePlayerId": player.gamePlayerId });
                }
            }
        }
    }
    else if (content === "§CSL21") { //has autocomplete
        cslMessage("has autocomplete:  " + Boolean(autocomplete.length));
    }
    else if (content === "§CSL22") { //version
        cslMessage("CSL version " + version);
    }
    else if (content.startsWith("§CSL3")) { //next song link
        if (quiz.cslActive && isHost) {
            let split = atob(content.slice(5)).split("-");
            //console.log(split);
            if (split.length === 5) {
                if (!songLinkReceived[split[0]]) {
                    songLinkReceived[split[0]] = true;
                    fireListener("quiz next video info", {
                        "playLength": guessTime,
                        "playbackSpeed": 1,
                        "startPont": parseInt(split[1]),
                        "videoInfo": {
                            "id": null,
                            "videoMap": {
                                "catbox": createCatboxLinkObject(split[2], split[3], split[4])
                            },
                            "videoVolumeMap": {
                                "catbox": {
                                    "0": -20,
                                    "480": -20,
                                    "720": -20
                                }
                            }
                        }
                    });
                    if (Object.keys(songLinkReceived).length === 1) {
                        setTimeout(() => {
                            fireListener("quiz ready", {
                                "numberOfSongs": totalSongs
                            });
                        }, 200);
                        setTimeout(() => {
                            fireListener("quiz waiting buffering", {
                                "firstSong": true
                            });
                        }, 300);
                        setTimeout(() => {
                            previousSongFinished = true;
                            readySong(currentSong + 1);
                        }, 400);
                    }
                }
            }
            else {
                sendSystemMessage(`CSL Multiplayer Error: next song link decode failed`);
            }
        }
    }
    else if (content.startsWith("§CSL4")) { //play song
        if (quiz.cslActive && isHost) {
            let number = parseInt(atob(content.slice(5)));
            //console.log("Play song: " + number);
            if (currentSong !== totalSongs) {
                playSong(number);
            }
        }
    }
    else if (content.startsWith("§CSL5")) { //player submission
        if (quiz.cslActive && player) {
            fireListener("player answered", [player.gamePlayerId]);
        }
    }
    else if (content.startsWith("§CSL6")) { //player final answer
        if (quiz.cslActive && player) {
            currentAnswers[player.gamePlayerId] = decodeURIComponent(atob(content.slice(5)));
        }
    }
    else if (content.startsWith("§CSL7")) { //answer results
        if (quiz.cslActive && isHost) {
            let split = atob(content.slice(5)).split("-");
            //console.log("Answer results: " + atob(content.slice(5)));
            let data = {
                "players": [],
                "songInfo": {
                    "animeNames": {
                        "english": cslMultiplayer.songInfo.animeEnglishName,
                        "romaji": cslMultiplayer.songInfo.animeRomajiName
                    },
                    "artist": cslMultiplayer.songInfo.songArtist,
                    "songName": cslMultiplayer.songInfo.songName,
                    "videoTargetMap": {
                        "catbox": {
                            "0": formatTargetUrl(cslMultiplayer.songInfo.audio) || "",
                            "480": formatTargetUrl(cslMultiplayer.songInfo.video480) || "",
                            "720": formatTargetUrl(cslMultiplayer.songInfo.video720) || ""
                        }
                    },
                    "type": cslMultiplayer.songInfo.songType,
                    "typeNumber": cslMultiplayer.songInfo.songTypeNumber,
                    "annId": cslMultiplayer.songInfo.annId,
                    "highRisk": 0,
                    "animeScore": null,
                    "animeType": cslMultiplayer.songInfo.animeType,
                    "vintage": cslMultiplayer.songInfo.animeVintage,
                    "animeDifficulty": cslMultiplayer.songInfo.songDifficulty || 0,
                    "animeTags": cslMultiplayer.songInfo.animeTags || [],
                    "animeGenre": cslMultiplayer.songInfo.animeGenre || [],
                    "altAnimeNames": cslMultiplayer.songInfo.altAnimeNames || [],
                    "altAnimeNamesAnswers": cslMultiplayer.songInfo.altAnimeNamesAnswers || [],
                    "siteIds": {
                        "annId": cslMultiplayer.songInfo.annId,
                        "malId": cslMultiplayer.songInfo.malId,
                        "kitsuId": cslMultiplayer.songInfo.kitsuId,
                        "aniListId": cslMultiplayer.songInfo.aniListId
                    }
                },
                "progressBarState": {
                    "length": 25,
                    "played": 0
                },
                "groupMap": createGroupSlotMap(Object.keys(quiz.players)),
                "watched": false
            };
            let decodedPlayers = [];
            for (p of split) {
                let playerSplit = p.split(",");
                decodedPlayers.push({
                    id: parseInt(playerSplit[0]),
                    correct: Boolean(parseInt(playerSplit[1])),
                    pose: parseInt(playerSplit[2]),
                    score: parseInt(playerSplit[3])
                });
            }
            decodedPlayers.sort((a, b) => b.score - a.score);
            decodedPlayers.forEach((p, i) => {
                data.players.push({
                    "gamePlayerId": p.id,
                    "pose": p.pose,
                    "level": quiz.players[p.id].level,
                    "correct": p.correct,
                    "score": p.score,
                    "listStatus": null,
                    "showScore": null,
                    "position": Math.floor(i / 8) + 1,
                    "positionSlot": i % 8
                });
            });
            //console.log(data.players);
            fireListener("answer results", data);
        }
    }
    else if (content === "§CSL81") { //pause
        if (isHost) {
            fireListener("quiz pause triggered", {
                "playerName": sender
            });
        }
    }
    else if (content === "§CSL82") { //unpause
        if (isHost) {
            fireListener("quiz unpause triggered", {
                "playerName": sender
            });
        }
    }
    else if (content === "§CSL91") { //vote skip
        if (quiz.isHost && player) {
            cslMultiplayer.voteSkip[player.gamePlayerId] = true;
            if (!skipping && checkVoteSkip()) {
                skipping = true;
                if (cslState === 1) {
                    cslMessage("§CSL92");
                }
                else if (cslState === 2) {
                    cslMessage("§CSL93");
                }
            }
        }
    }
    else if (content === "§CSL92") { //skip guessing phase
        if (isHost) {
            fireListener("quiz overlay message", "Skipping to Answers");
            clearInterval(skipInterval);
            clearTimeout(endGuessTimer);
            clearTimeout(extraGuessTimer);
            setTimeout(() => {
                endGuessPhase(currentSong);
            }, fastSkip ? 1000 : 3000);
        }
    }
    else if (content === "§CSL93") { //skip replay phase
        if (isHost) {
            endReplayPhase(currentSong);
        }
    }
    else if (content.startsWith("§CSLa")) { //animeRomajiName
        if (isHost) {
            cslMultiplayer.songInfo.animeRomajiName = decodeURI(atob(content.slice(5)));
        }
    }
    else if (content.startsWith("§CSLb")) { //animeEnglishName
        if (isHost) {
            cslMultiplayer.songInfo.animeEnglishName = decodeURI(atob(content.slice(5)));
        }
    }
    else if (content.startsWith("§CSLc")) { //songArtist
        if (isHost) {
            cslMultiplayer.songInfo.songArtist = decodeURI(atob(content.slice(5)));
        }
    }
    else if (content.startsWith("§CSLd")) { //songName
        if (isHost) {
            cslMultiplayer.songInfo.songName = decodeURI(atob(content.slice(5)));
        }
    }
    else if (content.startsWith("§CSLe")) { //songType songTypeNumber songDifficulty animeType animeVintage
        if (quiz.cslActive && isHost) {
            let split = atob(content.slice(5)).split("-");
            //console.log(split);
            cslMultiplayer.songInfo.songType = parseInt(split[0]) || null;
            cslMultiplayer.songInfo.songTypeNumber = parseInt(split[1]) || null;
            cslMultiplayer.songInfo.songDifficulty = parseFloat(split[2]) || null;
            cslMultiplayer.songInfo.animeType = parseInt(split[3]) || null;
            cslMultiplayer.songInfo.animeVintage = split[4];
            cslMultiplayer.songInfo.annId = parseInt(split[5]) || null;
            cslMultiplayer.songInfo.malId = parseInt(split[6]) || null;
            cslMultiplayer.songInfo.kitsuId = parseInt(split[7]) || null;
            cslMultiplayer.songInfo.aniListId = parseInt(split[8]) || null;
        }
    }
    else if (content.startsWith("§CSLf")) { //audio
        if (isHost) {
            cslMultiplayer.songInfo.audio = decodeURI(atob(content.slice(5)));
        }
    }
}

function checkVoteSkip() {
    let keys = Object.keys(cslMultiplayer.voteSkip).filter((key) => key in quiz.players && !quiz.players[key].avatarDisabled);
    for (let key of keys) {
        if (!cslMultiplayer.voteSkip[key]) return false;
    }
    return true;
}

// input list of player keys, return group slot map
function createGroupSlotMap(players) {
    players = players.map(Number);
    let map = {};
    let group = 1;
    if (Object.keys(score).length) players.sort((a, b) => score[b] - score[a]);
    for (let i = 0; i < players.length; i += 8) {
        map[group] = players.slice(i, i + 8);
        group++;
    }
    return map;
}

// check if the player's answer is correct
function isCorrectAnswer(songNumber, answer) {
    let song = songList[songOrder[songNumber]];
    if (!answer) {
        reviewSong(song, false)
        return false;
    }
    answer = answer.toLowerCase();
    let correctAnswers = [].concat((song.altAnimeNames || []), (song.altAnimeNamesAnswers || []));
    for (let a1 of correctAnswers) {
        let a2 = replacedAnswers[a1];
        if (a2 && a2.toLowerCase() === answer) {
            reviewSong(song, true)
            return true;
        }
        if (a1.toLowerCase() === answer) {
            reviewSong(song, true)
            return true;
        }
    }
    reviewSong(song, false)
    return false;
}

// get start point value
function getStartPoint() {
    return Math.floor(Math.random() * (startPointRange[1] - startPointRange[0] + 1)) + startPointRange[0];
}

// return true if song type is allowed
function songTypeFilter(song, ops, eds, ins) {
    let type = song.songType;
    if (ops && type === 1) return true;
    if (eds && type === 2) return true;
    if (ins && type === 3) return true;
    return false;
}

// return true if anime type is allowed
function animeTypeFilter(song, tv, movie, ova, ona, special) {
    if (song.animeType) {
        let type = song.animeType.toLowerCase();
        if (tv && type === "tv") return true;
        if (movie && type === "movie") return true;
        if (ova && type === "ova") return true;
        if (ona && type === "ona") return true;
        if (special && type === "special") return true;
        return false;
    }
    else {
        if (tv && movie && ova && ona && special) return true;
        return false;
    }
}

// return true if the song difficulty is in allowed range
function difficultyFilter(song, low, high) {
    if (low === 0 && high === 100) return true;
    let dif = parseFloat(song.songDifficulty);
    if (isNaN(dif)) return false;
    if (dif >= low && dif <= high) return true;
    return false;
}

// return true if guess type is allowed
function guessTypeFilter(song, correctGuesses, incorrectGuesses) {
    if (correctGuesses && song.correctGuess) return true;
    if (incorrectGuesses && song.incorrectGuess) return true;
    return false;
}

// clear all intervals and timeouts
function clearTimeEvents() {
    clearInterval(nextVideoReadyInterval);
    clearInterval(skipInterval);
    clearTimeout(endGuessTimer);
    clearTimeout(extraGuessTimer);
    clearTimeout(answerTimer);
}

// reset variables from this script
function reset() {
    clearTimeEvents();
    quiz.cslActive = false;
    cslMultiplayer = { host: "", songInfo: {}, voteSkip: {} };
    cslState = 0;
    currentSong = 0;
    currentAnswers = {};
    score = {};
    previousSongFinished = false;
    fastSkip = false;
    skipping = false;
    songLinkReceived = {};
}

// end quiz and set up lobby
function quizOver() {
    reset();
    let data = {
        "spectators": [],
        "inLobby": true,
        "settings": hostModal.getSettings(),
        "soloMode": quiz.soloMode,
        "inQueue": [],
        "hostName": lobby.hostName,
        "gameId": lobby.gameId,
        "players": [],
        "numberOfTeams": 0,
        "teamFullMap": {}
    };
    for (let player of Object.values(quiz.players)) {
        if (gameChat.spectators.some((spectator) => spectator.name === player._name)) {
            data.spectators.push({
                "name": player._name,
                "gamePlayerId": null
            });
        }
        else if (!player.avatarDisabled) {
            data.players.push({
                "name": player._name,
                "gamePlayerId": player.gamePlayerId,
                "level": player.level,
                "avatar": player.avatarInfo,
                "ready": true,
                "inGame": true,
                "teamNumber": null,
                "multipleChoice": false
            });
        }
    }
    lobby.setupLobby(data, gameChat.spectators.some((spectator) => spectator.name === selfName));
    viewChanger.changeView("lobby", { supressServerMsg: true, keepChatOpen: true });
}

// open custom song list settings modal
function openSettingsModal() {
    if (lobby.inLobby) {
        if (autocomplete.length) {
            $("#cslgAutocompleteButton").removeClass("btn-danger").addClass("btn-success disabled");
        }
        $("#cslgSettingsModal").modal("show");
    }
}

// when you click the go button
function anisongdbDataSearch() {
    let mode = $("#cslgAnisongdbModeSelect").val().toLowerCase();
    let query = $("#cslgAnisongdbQueryInput").val();
    let ops = $("#cslgAnisongdbOPCheckbox").prop("checked");
    let eds = $("#cslgAnisongdbEDCheckbox").prop("checked");
    let ins = $("#cslgAnisongdbINCheckbox").prop("checked");
    let partial = $("#cslgAnisongdbPartialCheckbox").prop("checked");
    let ignoreDuplicates = $("#cslgAnisongdbIgnoreDuplicatesCheckbox").prop("checked");
    let maxOtherPeople = parseInt($("#cslgAnisongdbMaxOtherPeopleInput").val());
    let minGroupMembers = parseInt($("#cslgAnisongdbMinGroupMembersInput").val());
    if (query && !isNaN(maxOtherPeople) && !isNaN(minGroupMembers)) {
        getAnisongdbData(mode, query, ops, eds, ins, partial, ignoreDuplicates, maxOtherPeople, minGroupMembers);
    }
}

// send anisongdb request
function getAnisongdbData(mode, query, ops, eds, ins, partial, ignoreDuplicates, maxOtherPeople, minGroupMembers) {
    $("#cslgSongListCount").text("Loading...");
    $("#cslgSongListTable tbody").empty();
    let json = {
        and_logic: false,
        ignore_duplicate: ignoreDuplicates,
        opening_filter: ops,
        ending_filter: eds,
        insert_filter: ins
    };
    if (mode === "anime") {
        json.anime_search_filter = {
            search: query,
            partial_match: partial
        };
    }
    else if (mode === "artist") {
        json.artist_search_filter = {
            search: query,
            partial_match: partial,
            group_granularity: minGroupMembers,
            max_other_artist: maxOtherPeople
        };
    }
    else if (mode === "song") {
        json.song_name_search_filter = {
            search: query,
            partial_match: partial
        };
    }
    else if (mode === "composer") {
        json.composer_search_filter = {
            search: query,
            partial_match: partial,
            arrangement: false
        };
    }
    fetch("https://anisongdb.com/api/search_request", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(json)
    }).then(res => res.json()).then(json => {
        handleData(json);
        setSongListTableSort();
        if (songList.length === 0 && (ranked.currentState === ranked.RANKED_STATE_IDS.RUNNING || ranked.currentState === ranked.RANKED_STATE_IDS.CHAMP_RUNNING)) {
            $("#cslgSongListCount").text("Total Songs: 0");
            $("#cslgMergeCurrentCount").text("Found 0 songs in the current song list");
            $("#cslgSongListTable tbody").empty();
            $("#cslgSongListWarning").text("AnisongDB is not available during ranked");
        }
        else {
            createSongListTable();
        }
        createAnswerTable();
    }).catch(res => {
        songList = [];
        setSongListTableSort();
        $("#cslgSongListCount").text("Total Songs: 0");
        $("#cslgMergeCurrentCount").text("Found 0 songs in the current song list");
        $("#cslgSongListTable tbody").empty();
        $("#cslgSongListWarning").text(res.toString());
    });
}

function handleData(newData) {
    songList = loadSongs();

    if (!newData) return;

    if (Array.isArray(newData) && newData.length && newData[0].animeJPName) {
        // Create a Set of unique identifiers (video720 keys) from the new data
        const newDataKeys = new Set(newData.map(song => song.HQ));

        // Filter the songList to keep only songs that appear in the new data
        songList = songList.filter(song => newDataKeys.has(song.video720));

        // Iterate over new data to merge with existing songList
        for (let newSong of newData) {
            let existingSongIndex = songList.findIndex(song => song.video720 === newSong.HQ);
            if (existingSongIndex !== -1) {
                // Merge new data into existing song, preserving `weight` and `reviewState`
                let existingSong = songList[existingSongIndex];
                songList[existingSongIndex] = {
                    ...existingSong, // Preserve existing data, including `weight` and `reviewState`
                    ...newSong, // Overwrite with new values where applicable
                };
            } else {
                // Add new song, since it doesn't exist in the current songList
                songList.push({
                    animeRomajiName: newSong.animeJPName,
                    animeEnglishName: newSong.animeENName,
                    altAnimeNames: [].concat(newSong.animeJPName, newSong.animeENName, newSong.animeAltName || []),
                    altAnimeNamesAnswers: [],
                    songArtist: newSong.songArtist,
                    songName: newSong.songName,
                    songType: Object({ O: 1, E: 2, I: 3 })[newSong.songType[0]],
                    songTypeNumber: newSong.songType[0] === "I" ? null : parseInt(newSong.songType.split(" ")[1]),
                    songDifficulty: newSong.songDifficulty,
                    animeType: newSong.animeType,
                    animeVintage: newSong.animeVintage,
                    annId: newSong.annId,
                    malId: null,
                    kitsuId: null,
                    aniListId: null,
                    animeTags: [],
                    animeGenre: [],
                    startPoint: null,
                    audio: newSong.audio,
                    video480: newSong.MQ,
                    video720: newSong.HQ,
                    correctGuess: true,
                    incorrectGuess: true
                });
            }
        }
    }
    // official amq song export structure
    else if (typeof data === "object" && data.roomName && data.startTime && data.songs) {
        for (let song of data.songs) {
            songList.push({
                animeRomajiName: song.songInfo.animeNames.romaji,
                animeEnglishName: song.songInfo.animeNames.english,
                altAnimeNames: song.songInfo.altAnimeNames || [song.songInfo.animeNames.romaji, song.songInfo.animeNames.english],
                altAnimeNamesAnswers: song.songInfo.altAnimeNamesAnswers || [],
                songArtist: song.songInfo.artist,
                songName: song.songInfo.songName,
                songType: song.songInfo.type,
                songTypeNumber: song.songInfo.typeNumber,
                songDifficulty: song.songInfo.animeDifficulty,
                animeType: song.songInfo.animeType,
                animeVintage: song.songInfo.vintage,
                annId: song.songInfo.siteIds.annId,
                malId: song.songInfo.siteIds.malId,
                kitsuId: song.songInfo.siteIds.kitsuId,
                aniListId: song.songInfo.siteIds.aniListId,
                animeTags: song.songInfo.animeTags,
                animeGenre: song.songInfo.animeGenre,
                startPoint: song.startPoint,
                audio: String(song.videoUrl).endsWith(".mp3") ? song.videoUrl : null,
                video480: null,
                video720: String(song.videoUrl).endsWith(".webm") ? song.videoUrl : null,
                correctGuess: song.correctGuess,
                incorrectGuess: song.wrongGuess
            });
        }
    }
    // joseph song export script structure
    else if (Array.isArray(data) && data.length && data[0].gameMode) {
        for (let song of data) {
            songList.push({
                animeRomajiName: song.anime.romaji,
                animeEnglishName: song.anime.english,
                altAnimeNames: song.altAnswers || [song.anime.romaji, song.anime.english],
                altAnimeNamesAnswers: [],
                songArtist: song.artist,
                songName: song.name,
                songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
                songTypeNumber: song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
                songDifficulty: parseFloat(song.difficulty),
                animeType: song.animeType,
                animeVintage: song.vintage,
                annId: song.siteIds.annId,
                malId: song.siteIds.malId,
                kitsuId: song.siteIds.kitsuId,
                aniListId: song.siteIds.aniListId,
                animeTags: song.tags,
                animeGenre: song.genre,
                startPoint: song.startSample,
                audio: song.urls.catbox?.[0] ?? song.urls.openingsmoe?.[0] ?? null,
                video480: song.urls.catbox?.[480] ?? song.urls.openingsmoe?.[480] ?? null,
                video720: song.urls.catbox?.[720] ?? song.urls.openingsmoe?.[720] ?? null,
                correctGuess: song.correct,
                incorrectGuess: !song.correct
            });
        }
    }
    // blissfulyoshi ranked data export structure
    else if (Array.isArray(data) && data.length && data[0].animeRomaji) {
        for (let song of data) {
            songList.push({
                animeRomajiName: song.animeRomaji,
                animeEnglishName: song.animeEng,
                altAnimeNames: [song.animeRomaji, song.animeEng],
                altAnimeNamesAnswers: [],
                songArtist: song.artist,
                songName: song.songName,
                songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
                songTypeNumber: song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
                songDifficulty: song.songDifficulty,
                animeType: null,
                animeVintage: song.vintage,
                annId: song.annId,
                malId: song.malId,
                kitsuId: song.kitsuId,
                aniListId: song.aniListId,
                animeTags: [],
                animeGenre: [],
                startPoint: null,
                audio: song.LinkMp3,
                video480: null,
                video720: song.LinkVideo,
                correctGuess: true,
                incorrectGuess: true
            });
        }
    }
    // this script structure
    else if (Array.isArray(data) && data.length && data[0].animeRomajiName) {
        songList = data;
    }
    songList = songList.filter((song) => song.audio || song.video480 || song.video720);
}

// create song list table
function createSongListTable() {
    $("#cslgSongListCount").text("Total Songs: " + songList.length);
    $("#cslgMergeCurrentCount").text(`Found ${songList.length} song${songList.length === 1 ? "" : "s"} in the current song list`);
    $("#cslgSongListWarning").text("");
    let $thead = $("#cslgSongListTable thead");
    let $tbody = $("#cslgSongListTable tbody");
    $thead.empty();
    $tbody.empty();
    if (songListTableSort[0] === 1) { //song name ascending
        songList.sort((a, b) => (a.songName || "").localeCompare((b.songName || "")));
    }
    else if (songListTableSort[0] === 2) { //song name descending
        songList.sort((a, b) => (b.songName || "").localeCompare((a.songName || "")));
    }
    else if (songListTableSort[1] === 1) { //artist ascending
        songList.sort((a, b) => (a.songArtist || "").localeCompare((b.songArtist || "")));
    }
    else if (songListTableSort[1] === 2) { //artist descending
        songList.sort((a, b) => (b.songArtist || "").localeCompare((a.songArtist || "")));
    }
    else if (songListTableSort[2] === 1) { //difficulty ascending
        songList.sort((a, b) => a.songDifficulty - b.songDifficulty);
    }
    else if (songListTableSort[2] === 2) { //difficulty descending
        songList.sort((a, b) => b.songDifficulty - a.songDifficulty);
    }
    else if (songListTableSort[3] === 1) { //anime ascending
        options.useRomajiNames
            ? songList.sort((a, b) => (a.animeRomajiName || "").localeCompare((b.animeRomajiName || "")))
            : songList.sort((a, b) => (a.animeEnglishName || "").localeCompare((b.animeEnglishName || "")));
    }
    else if (songListTableSort[3] === 2) { //anime descending
        options.useRomajiNames
            ? songList.sort((a, b) => (b.animeRomajiName || "").localeCompare((a.animeRomajiName || "")))
            : songList.sort((a, b) => (b.animeEnglishName || "").localeCompare((a.animeEnglishName || "")));
    }
    else if (songListTableSort[4] === 1) { //song type ascending
        songList.sort((a, b) => songTypeSortValue(a.songType, a.songTypeNumber) - songTypeSortValue(b.songType, b.songTypeNumber));
    }
    else if (songListTableSort[4] === 2) { //song type descending
        songList.sort((a, b) => songTypeSortValue(b.songType, b.songTypeNumber) - songTypeSortValue(a.songType, a.songTypeNumber));
    }
    else if (songListTableSort[5] === 1) { //vintage ascending
        songList.sort((a, b) => vintageSortValue(a.animeVintage) - vintageSortValue(b.animeVintage));
    }
    else if (songListTableSort[5] === 2) { //vintage descending
        songList.sort((a, b) => vintageSortValue(b.animeVintage) - vintageSortValue(a.animeVintage));
    }
    else if (songListTableSort[6] === 1) { //mp3 link ascending
        songList.sort((a, b) => (a.audio || "").localeCompare((b.audio || "")));
    }
    else if (songListTableSort[6] === 2) { //mp3 link descending
        songList.sort((a, b) => (b.audio || "").localeCompare((a.audio || "")));
    }
    else if (songListTableSort[7] === 1) { //480 link ascending
        songList.sort((a, b) => (a.video480 || "").localeCompare((b.video480 || "")));
    }
    else if (songListTableSort[7] === 2) { //480 link descending
        songList.sort((a, b) => (b.video480 || "").localeCompare((a.video480 || "")));
    }
    else if (songListTableSort[8] === 1) { //720 link ascending
        songList.sort((a, b) => (a.video720 || "").localeCompare((b.video720 || "")));
    }
    else if (songListTableSort[8] === 2) { //720 link descending
        songList.sort((a, b) => (b.video720 || "").localeCompare((a.video720 || "")));
    }
    if (songListTableMode === 0) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append($(`<th class="song clickAble">Song</th>`).click(() => {
            setSongListTableSort(0);
            createSongListTable();
        }));
        $row.append($(`<th class="artist clickAble">Artist</th>`).click(() => {
            setSongListTableSort(1);
            createSongListTable();
        }));
        $row.append($(`<th class="difficulty clickAble">Dif</th>`).click(() => {
            setSongListTableSort(2);
            createSongListTable();
        }));
        $row.append($(`<th class="trash"></th>`));
        $thead.append($row);
        songList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append($("<td></td>").addClass("number").text(i + 1));
            $row.append($("<td></td>").addClass("song").text(song.songName));
            $row.append($("<td></td>").addClass("artist").text(song.songArtist));
            $row.append($("<td></td>").addClass("difficulty").text(Number.isFinite(song.songDifficulty) ? Math.floor(song.songDifficulty) : ""));
            $row.append($("<td></td>").addClass("trash clickAble").append(`<i class="fa fa-trash" aria-hidden="true"></i>`));
            $tbody.append($row);
        });
    }
    else if (songListTableMode === 1) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append($(`<th class="anime clickAble">Anime</th>`).click(() => {
            setSongListTableSort(3);
            createSongListTable();
        }));
        $row.append($(`<th class="songType clickAble">Type</th>`).click(() => {
            setSongListTableSort(4);
            createSongListTable();
        }));
        $row.append($(`<th class="vintage clickAble">Vintage</th>`).click(() => {
            setSongListTableSort(5);
            createSongListTable();
        }));
        $row.append($(`<th class="trash"></th>`));
        $thead.append($row);
        songList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append($("<td></td>").addClass("number").text(i + 1));
            $row.append($("<td></td>").addClass("anime").text(options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName));
            $row.append($("<td></td>").addClass("songType").text(songTypeText(song.songType, song.songTypeNumber)));
            $row.append($("<td></td>").addClass("vintage").text(song.animeVintage));
            $row.append($("<td></td>").addClass("trash clickAble").append(`<i class="fa fa-trash" aria-hidden="true"></i>`));
            $tbody.append($row);
        });
    }
    else if (songListTableMode === 2) {
        let $row = $("<tr></tr>");
        $row.append($(`<th class="number">#</th>`));
        $row.append($(`<th class="link clickAble">MP3</th>`).click(() => {
            setSongListTableSort(6);
            createSongListTable();
        }));
        $row.append($(`<th class="link clickAble">480</th>`).click(() => {
            setSongListTableSort(7);
            createSongListTable();
        }));
        $row.append($(`<th class="link clickAble">720</th>`).click(() => {
            setSongListTableSort(8);
            createSongListTable();
        }));
        $row.append($(`<th class="trash"></th>`));
        $thead.append($row);
        songList.forEach((song, i) => {
            let $row = $("<tr></tr>");
            $row.append($("<td></td>").addClass("number").text(i + 1));
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.audio)));
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.video480)));
            $row.append($("<td></td>").addClass("link").append(createLinkElement(song.video720)));
            $row.append($("<td></td>").addClass("trash clickAble").append(`<i class="fa fa-trash" aria-hidden="true"></i>`));
            $tbody.append($row);
        });
    }
}

// create answer table
function createAnswerTable() {
    let $tbody = $("#cslgAnswerTable tbody");
    $tbody.empty();
    if (songList.length === 0) {
        $("#cslgAnswerText").text("No list loaded");
    }
    else if (autocomplete.length === 0) {
        $("#cslgAnswerText").text("Fetch autocomplete first");
    }
    else {
        let animeList = new Set();
        let missingAnimeList = [];
        for (let song of songList) {
            let answers = [song.animeEnglishName, song.animeRomajiName].concat(song.altAnimeNames, song.altAnimeNamesAnswers);
            answers.forEach((x) => animeList.add(x));
        }
        for (let anime of animeList) {
            if (!autocomplete.includes(anime.toLowerCase())) {
                missingAnimeList.push(anime);
            }
        }
        missingAnimeList.sort((a, b) => a.localeCompare(b));
        $("#cslgAnswerText").text(`Found ${missingAnimeList.length} anime missing from AMQ's autocomplete`);
        for (let anime of missingAnimeList) {
            let $row = $("<tr></tr>");
            $row.append($("<td></td>").addClass("oldName").text(anime));
            $row.append($("<td></td>").addClass("newName").text(replacedAnswers[anime] || ""));
            $row.append($("<td></td>").addClass("edit").append(`<i class="fa fa-pencil clickAble" aria-hidden="true"></i>`));
            $tbody.append($row);
        }
    }
}

// create link element for song list table
function createLinkElement(link) {
    if (!link) return "";
    let $a = $("<a></a>");
    if (link.startsWith("http")) {
        $a.text(link.includes("catbox") ? link.split("/").slice(-1)[0] : link);
        $a.attr("href", link);
    }
    else if (/[a-z0-9]+\.(mp3|webm|mp4|avi|ogg|flac|wav)/i.test(link)) {
        $a.text(link);
        if (fileHostOverride === "0") {
            $a.attr("href", "https://ladist1.catbox.video/" + link);
        }
        else {
            $a.attr("href", "https://" + catboxHostDict[fileHostOverride] + "/" + link);
        }
    }
    return $a;
}

// reset all values in table sort options and toggle specified index
function setSongListTableSort(index) {
    if (Number.isInteger(index)) {
        let value = songListTableSort[index];
        songListTableSort.forEach((x, i) => { songListTableSort[i] = 0 });
        songListTableSort[index] = value === 1 ? 2 : 1;
    }
    else {
        songListTableSort.forEach((x, i) => { songListTableSort[i] = 0 });
    }
}

// get sorting value for anime vintage
function vintageSortValue(vintage) {
    if (!vintage) return 0;
    let split = vintage.split(" ");
    let year = parseInt(split[1]);
    if (isNaN(year)) return 0;
    let season = Object({ "Winter": .1, "Spring": .2, "Summer": .3, "Fall": .4 })[split[0]];
    if (!season) return 0;
    return year + season;
}

// get sorting value for song type
function songTypeSortValue(type, typeNumber) {
    return (type || 0) * 1000 + (typeNumber || 0);
}

// reset all tabs
function tabReset() {
    $("#cslgSongListTab").removeClass("selected");
    $("#cslgQuizSettingsTab").removeClass("selected");
    $("#cslgAnswerTab").removeClass("selected");
    $("#cslgMergeTab").removeClass("selected");
    $("#cslgMultiplayerTab").removeClass("selected");
    $("#cslgInfoTab").removeClass("selected");
    $("#cslgSongListContainer").hide();
    $("#cslgQuizSettingsContainer").hide();
    $("#cslgAnswerContainer").hide();
    $("#cslgMergeContainer").hide();
    $("#cslgMultiplayerContainer").hide();
    $("#cslgInfoContainer").hide();
}

// convert full url to target data
function formatTargetUrl(url) {
    if (url && url.startsWith("http")) {
        return url.split("/").slice(-1)[0];
    }
    return url;
}

// translate type and typeNumber ids to shortened type text
function songTypeText(type, typeNumber) {
    if (type === 1) return "OP" + typeNumber;
    if (type === 2) return "ED" + typeNumber;
    if (type === 3) return "IN";
    return "";
};

// input 3 links, return formatted catbox link object
function createCatboxLinkObject(audio, video480, video720) {
    let links = {};
    if (fileHostOverride === "0") {
        if (audio) links["0"] = audio;
        if (video480) links["480"] = video480;
        if (video720) links["720"] = video720;
    }
    else {
        if (audio) links["0"] = "https://" + catboxHostDict[fileHostOverride] + "/" + audio.split("/").slice(-1)[0];
        if (video480) links["480"] = "https://" + catboxHostDict[fileHostOverride] + "/" + video480.split("/").slice(-1)[0];
        if (video720) links["720"] = "https://" + catboxHostDict[fileHostOverride] + "/" + video720.split("/").slice(-1)[0];
    }
    return links;
}

// return true if you are in a ranked lobby or quiz
function isRankedMode() {
    return (lobby.inLobby && lobby.settings.gameMode === "Ranked") || (quiz.inQuiz && quiz.gameMode === "Ranked");
}

// validate json data in local storage
function validateLocalStorage(item) {
    try {
        return JSON.parse(localStorage.getItem(item)) || {};
    }
    catch {
        return {};
    }
}

// save settings
function saveSettings() {
    localStorage.setItem("customSongListGame", JSON.stringify({
        replacedAnswers: replacedAnswers,
        CSLButtonCSS: CSLButtonCSS,
        debug: debug
    }));
}

// apply styles
function applyStyles() {
    $("#customSongListStyle").remove();
    let style = document.createElement("style");
    style.type = "text/css";
    style.id = "customSongListStyle";
    let text = `
        #lnCustomSongListButton {
            right: ${CSLButtonCSS};
            width: 80px;
        }
        #cslgSongListContainer input[type="radio"] {
            width: 20px;
            height: 20px;
            margin-left: 3px;
            vertical-align: -5px;
            cursor: pointer;
        }
        #cslgAnisongdbSearchRow input[type="checkbox"] {
            width: 20px;
            height: 20px;
            margin-left: 3px;
            vertical-align: -5px;
            cursor: pointer;
        }
        #cslgTableModeButton:hover {
            opacity: .8;
        }
        #cslgSongListTable {
            width: 100%;
            table-layout: fixed;
        }
        #cslgSongListTable thead tr {
            background-color: #282828;
            font-weight: bold;
        }
        #cslgSongListTable .number {
            width: 30px;
        }
        #cslgSongListTable .difficulty {
            width: 30px;
        }
        #cslgSongListTable .songType {
            width: 45px;
        }
        #cslgSongListTable .vintage {
            width: 100px;
        }
        #cslgSongListTable .trash {
            width: 20px;
        }
        #cslgSongListTable tbody i.fa-trash:hover {
            opacity: .8;
        }
        #cslgSongListTable th, #cslgSongListTable td {
            padding: 0 4px;
        }
        #cslgSongListTable tbody tr:nth-child(odd) {
            background-color: #424242;
        }
        #cslgSongListTable tbody tr:nth-child(even) {
            background-color: #353535;
        }
        #cslgQuizSettingsContainer input[type="text"] {
            color: black;
            font-weight: normal;
            margin-left: 3px;
        }
        #cslgQuizSettingsContainer input[type="checkbox"] {
            width: 20px;
            height: 20px;
            margin-left: 3px;
            vertical-align: -5px;
            cursor: pointer;
        }
        #cslgQuizSettingsContainer input[type="radio"] {
            width: 20px;
            height: 20px;
            margin-left: 3px;
            vertical-align: -5px;
            cursor: pointer;
        }
        #cslgAnswerTable {
            width: 100%;
            table-layout: fixed;
        }
        #cslgAnswerTable thead tr {
            background-color: #282828;
            font-weight: bold;
        }
        #cslgAnswerTable .edit {
            width: 20px;
        }
        #cslgAnswerTable tbody i.fa-pencil:hover {
            opacity: .8;
        }
        #cslgAnswerTable th, #cslgAnswerTable td {
            padding: 0 4px;
        }
        #cslgAnswerTable tbody tr:nth-child(odd) {
            background-color: #424242;
        }
        #cslgAnswerTable tbody tr:nth-child(even) {
            background-color: #353535;
        }
    `;
    style.appendChild(document.createTextNode(text));
    document.head.appendChild(style);
}
