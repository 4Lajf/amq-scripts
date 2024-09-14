// ==UserScript==
// @name         AMQ Training Mode
// @namespace    https://github.com/4Lajf
// @version      0.69
// @description  Extended version of kempanator's Custom Song List Game Training mode allows you to practice your songs efficiently something line anki or other memory card software. It's goal is to give you songs that you don't recozniged mixed with some songs that you do recognize to solidify them in your memory.
// @match        https://animemusicquiz.com/*
// @author       4Lajf & kempanator
// @grant        GM_xmlhttpRequest
// @connect      myanimelist.net
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/main/amqTrainingMode.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/main/amqTrainingMode.user.js
// ==/UserScript==

/*
How to start a custom song list game:
  1. create a solo lobby
  2. click the CSL button in the top right
  3. click the autocomplete button if it is red
  4. create or upload a list in the song list tab
  5. change settings in the settings tab
  6. fix any invalid answers in the answer tab
  7. click training mode to start the quiz

Supported upload files:
  1. anisongdb json
  2. official AMQ song history export
  3. joseph song list script export
  4. blissfulyoshi ranked song list

Some considerations:
  1. anisongdb is unavailable during ranked, please prepare some json files in advance
  2. anime titles that were changed recently in AMQ will be incorrect if anisongdb never updated it
  3. no automatic volume equalizing
  4. If the song exists in multiple anime only anime in your list are being counted as acceptable answers.
*/

'use strict';
if (typeof Listener === 'undefined') return;
let loadInterval = setInterval(() => {
  if ($('#loadingScreen').hasClass('hidden')) {
    clearInterval(loadInterval);
    setup();
  }
}, 500);

let statsModal;
let maxNewSongs24Hours = 0;
let newSongsAdded24Hours = 0;
let lastResetTime = Date.now();
let potentialNewSongs = new Set();
const version = '0.69';
const saveData = validateLocalStorage('customSongListGame');
const catboxHostDict = { 1: 'nl.catbox.video', 2: 'ladist1.catbox.video', 3: 'vhdist1.catbox.video' };
let currentProfile;
let profiles;
let isTraining = false;
let CSLButtonCSS = saveData.CSLButtonCSS || 'calc(25% - 250px)';
let showCSLMessages = saveData.showCSLMessages ?? false;
let replacedAnswers = saveData.replacedAnswers || {};
let malClientId = saveData.malClientId ?? '';
let hotKeys = saveData.hotKeys ?? {};
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
let songListTableSort = [0, 0, 0, 0, 0, 0, 0, 0, 0]; //song, artist, difficulty, anime, type, vintage, mp3, 480, 720 (0: off, 1: ascending, 2: descending)
let songList = [];
let songOrder = {}; //{song#: index#, ...}
let mergedSongList = [];
let importedSongList = [];
let songOrderType = 'random';
let startPointRange = [0, 100];
let difficultyRange = [0, 100];
let previousSongFinished = false;
let skipInterval;
let nextVideoReadyInterval;
let answerTimer;
let extraGuessTimer;
let endGuessTimer;
let fileHostOverride = 0;
let autocomplete = []; //store lowercase version for faster compare speed
let autocompleteInput;
let cslMultiplayer = { host: '', songInfo: {}, voteSkip: {} };
let cslState = 0; //0: none, 1: guessing phase, 2: answer phase
let songLinkReceived = {};
let skipping = false;
let answerChunks = {}; //store player answer chunks, ids are keys
let resultChunk;
let songInfoChunk;
let nextSongChunk;
let importRunning = false;

hotKeys.start = saveData.hotKeys?.start ?? { altKey: false, ctrlKey: false, key: '' };
hotKeys.stop = saveData.hotKeys?.stop ?? { altKey: false, ctrlKey: false, key: '' };
hotKeys.startTraining = saveData.hotKeys?.startTraining ?? { altKey: false, ctrlKey: false, key: '' };
hotKeys.stopTraining = saveData.hotKeys?.stopTraining ?? { altKey: false, ctrlKey: false, key: '' };
hotKeys.cslgWindow = saveData.hotKeys?.cslgWindow ?? { altKey: false, ctrlKey: false, key: '' };
//hotKeys.mergeAll = saveData.hotKeys?.mergeAll ?? {altKey: false, ctrlKey: false, key: ""};

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function saveProfiles() {
  localStorage.setItem('cslProfiles', JSON.stringify(profiles));
}

function loadProfiles() {
  const savedProfiles = localStorage.getItem('cslProfiles');
  if (savedProfiles) {
    profiles = JSON.parse(savedProfiles);
    if (!profiles.includes('default')) {
      profiles.unshift('default');
    }
  } else {
    // If no profiles exist in localStorage, initialize with default
    profiles = ['default'];
  }
  // Ensure currentProfile is set
  if (!profiles.includes(currentProfile)) {
    currentProfile = 'default';
  }
  // Save the profiles in case we made any changes
  saveProfiles();
}

// Function to select a profile
function selectProfile(profileName) {
  if (profiles.includes(profileName)) {
    currentProfile = profileName;
    updateProfileSelect();
    // Load the review data for the selected profile
    loadReviewData();
    console.log(`Selected profile: ${profileName}`);
  } else {
    console.error(`Profile ${profileName} does not exist`);
  }
}

// Function to add a new profile
function addProfile(profileName) {
  if (!profiles.includes(profileName)) {
    profiles.push(profileName);
    saveProfiles();
    updateProfileSelect();
    console.log(`Added new profile: ${profileName}`);
  } else {
    console.error(`Profile ${profileName} already exists`);
  }
}

// Function to delete a profile
function deleteProfile(profileName) {
  profiles = profiles.filter((p) => p !== profileName);
  localStorage.removeItem(`spacedRepetitionData_${profileName}`);
  saveProfiles();
  if (currentProfile === profileName) {
    selectProfile('default');
  } else {
    updateProfileSelect();
  }
  console.log(`Deleted profile: ${profileName}`);
}

function updateProfileSelect() {
  const $select = $('#cslgProfileSelect');
  $select.empty();
  profiles.forEach((profile) => {
    $select.append($('<option></option>').val(profile).text(profile));
  });
  $select.val(currentProfile);
}

$('#gameContainer').append(
  $(`
    <div class="modal fade tab-modal" id="cslgSettingsModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document" style="width: 680px">
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
                        <div id="cslgMergeTab" class="tab clickAble">
                            <h5>Merge</h5>
                        </div>
                        <div id="cslgAnswerTab" class="tab clickAble">
                            <h5>Answers</h5>
                        </div>
                        <div id="cslgHotkeyTab" class="tab clickAble">
                            <h5>Hotkey</h5>
                        </div>
                        <div id="cslgListImportTab" class="tab clickAble">
                            <h5>List Import</h5>
                        </div>
                        <div id="cslgInfoTab" class="tab clickAble" style="width: 45px; margin-right: -10px; padding-right: 8px; float: right;">
                            <h5><i class="fa fa-info-circle" aria-hidden="true"></i></h5>
                        </div>
                    </div>
                </div>
                <div class="modal-body" style="overflow-y: auto; max-height: calc(100vh - 150px);">
                    <div id="cslgSongListContainer">
                        <div id="cslgSongListTopRow" style="margin: 2px 0 3px 0;">
                            <span style="font-size: 20px; font-weight: bold;">Mode</span>
                            <select id="cslgSongListModeSelect" style="color: black; margin-left: 2px; padding: 3px 0;">
                                <option value="Anisongdb">Anisongdb</option>
                                <option value="Load File">Load File</option>
                            </select>
                            <i id="cslgMergeAllButton" class="fa fa-plus clickAble" aria-hidden="true" style="font-size: 20px; margin-left: 100px;"></i>
                            <i id="cslgClearSongListButton" class="fa fa-trash clickAble" aria-hidden="true" style="font-size: 20px; margin-left: 10px;"></i>
                            <i id="cslgTransferSongListButton" class="fa fa-exchange clickAble" aria-hidden="true" style="font-size: 20px; margin-left: 10px;"></i>
                            <i id="cslgTableModeButton" class="fa fa-table clickAble" aria-hidden="true" style="font-size: 20px; margin-left: 10px;"></i>
                            <span id="cslgSongListCount" style="font-size: 20px; font-weight: bold; margin-left: 20px;">Songs: 0</span>
                            <span id="cslgMergedSongListCount" style="font-size: 20px; font-weight: bold; margin-left: 20px;">Merged: 0</span>
                        </div>
                        <div id="cslgFileUploadRow">
                            <label style="vertical-align: -4px"><input id="cslgFileUpload" type="file" style="width: 600px"></label>
                        </div>
                        <div id="cslgAnisongdbSearchRow">
                            <div>
                                <select id="cslgAnisongdbModeSelect" style="color: black; padding: 3px 0;">
                                    <option>Anime</option>
                                    <option>Artist</option>
                                    <option>Song</option>
                                    <option>Composer</option>
                                    <option>Season</option>
                                    <option>Ann Id</option>
                                    <option>Mal Id</option>
                                </select>
                                <input id="cslgAnisongdbQueryInput" type="text" style="color: black; width: 250px;">
                                <button id="cslgAnisongdbSearchButtonGo" style="color: black">Go</button>
                                <label class="clickAble" style="margin-left: 7px">Partial<input id="cslgAnisongdbPartialCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">OP<input id="cslgAnisongdbOPCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">ED<input id="cslgAnisongdbEDCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 7px">IN<input id="cslgAnisongdbINCheckbox" type="checkbox"></label>
                            </div>
                            <div>
                                <label class="clickAble">Max Other People<input id="cslgAnisongdbMaxOtherPeopleInput" type="text" style="color: black; font-weight: normal; width: 40px; margin-left: 3px;"></label>
                                <label class="clickAble" style="margin-left: 10px">Min Group Members<input id="cslgAnisongdbMinGroupMembersInput" type="text" style="color: black; font-weight: normal; width: 40px; margin-left: 3px;"></label>
                                <label class="clickAble" style="margin-left: 10px">Ignore Duplicates<input id="cslgAnisongdbIgnoreDuplicatesCheckbox" type="checkbox"></label>
                                <label class="clickAble" style="margin-left: 10px">Arrangement<input id="cslgAnisongdbArrangementCheckbox" type="checkbox"></label>
                            </div>
                        </div>
                        <div style="height: 400px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgSongListTable" class="styledTable">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="song">Song</th>
                                        <th class="artist">Artist</th>
                                        <th class="difficulty">Dif</th>
                                        <th class="action"></th>
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
                                <option value="1">nl.catbox.video</option>
                                <option value="2">ladist1.catbox.video</option>
                                <option value="3">vhdist1.catbox.video</option>

                            </select>
                            <br>
                            <span style="font-size: 18px; font-weight: bold; margin: 0 10px 0 40px;">Max new songs (24 hour period):</span>
                            <input id="cslgSettingsMaxNewSongs" type="text" style="width: 70px">
                            <button id="cslSettingsResetMaxNewSongs" class="btn btn-danger">Reset</button>
                        </div>
                        <p style="margin-top: 20px">Normal room settings are ignored. Only these settings will apply.</p>
                    </div>
                    <div id="cslgAnswerContainer">
                        <span style="font-size: 16px; font-weight: bold;">Old:</span>
                        <input id="cslgOldAnswerInput" type="text" style="width: 240px; color: black; margin: 10px 0;">
                        <span style="font-size: 16px; font-weight: bold; margin-left: 10px;">New:</span>
                        <input id="cslgNewAnswerInput" type="text" style="width: 240px; color: black; margin: 10px 0;">
                        <button id="cslgAnswerButtonAdd" style="color: black; margin-left: 10px;">Add</button>
                        <div id="cslgAnswerText" style="font-size: 16px; font-weight: bold;">No list loaded</div>
                        <div style="height: 300px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgAnswerTable" class="styledTable">
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
                        <h4 style="text-align: center; margin-bottom: 10px;">Merge multiple song lists into 1 JSON file</h4>
                        <div style="width: 400px; display: inline-block;">
                            <div id="cslgMergeCurrentCount" style="font-size: 16px; font-weight: bold;">Current song list: 0 songs</div>
                            <div id="cslgMergeTotalCount" style="font-size: 16px; font-weight: bold;">Merged song list: 0 songs</div>
                        </div>
                        <div style="display: inline-block; vertical-align: 13px">
                            <button id="cslgMergeButton" class="btn btn-default">Merge</button>
                            <button id="cslgMergeClearButton" class="btn btn-warning">Clear</button>
                            <button id="cslgMergeDownloadButton" class="btn btn-success">Download</button>
                        </div>
                        <div style="height: 400px; margin: 5px 0; overflow-y: scroll;">
                            <table id="cslgMergedSongListTable" class="styledTable">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="anime">Anime</th>
                                        <th class="songType">Type</th>
                                        <th class="action"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                        </div>
                        <p style="margin-top: 30px; display: none;">1. Load some songs into the table in the song list tab<br>2. Come back to this tab<br>3. Click "merge" to add everything from that list to a new combined list<br>4. Repeat steps 1-3 as many times as you want<br>5. Click "download" to download the new json file<br>6. Upload the file in the song list tab and play</p>
                    </div>
                    <div id="cslgHotkeyContainer">
                        <table id="cslgHotkeyTable">
                            <thead>
                                <tr>
                                    <th>Action</th>
                                    <th>Modifier</th>
                                    <th>Key</th>
                                </tr>
                            </thead>
                            <tbody>
                            </tbody>
                        </table>
                    </div>
                    <div id="cslgListImportContainer" style="text-align: center; margin: 10px 0;">
                        <h4 style="">Import list from username</h4>
                        <div>
                            <select id="cslgListImportSelect" style="padding: 3px 0; color: black;">
                                <option>myanimelist</option>
                                <option>anilist</option>
                            </select>
                            <input id="cslgListImportUsernameInput" type="text" placeholder="username" style="width: 200px; color: black;">
                            <button id="cslgListImportStartButton" style="color: black;">Go</button>
                        </div>
                        <div style="margin-top: 5px">
                            <label class="clickAble">Watching<input id="cslgListImportWatchingCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Completed<input id="cslgListImportCompletedCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">On Hold<input id="cslgListImportHoldCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Dropped<input id="cslgListImportDroppedCheckbox" type="checkbox" checked></label>
                            <label class="clickAble" style="margin-left: 10px">Planning<input id="cslgListImportPlanningCheckbox" type="checkbox" checked></label>
                        </div>
                        <h4 id="cslgListImportText" style="margin-top: 10px;"></h4>
                        <div id="cslgListImportActionContainer" style="display: none;">
                            <button id="cslgListImportMoveButton" style="color: black;">Move To Song List</button>
                            <button id="cslgListImportDownloadButton" style="color: black;">Download</button>
                        </div>
                    </div>
                    <div id="cslgInfoContainer" style="text-align: center; margin: 10px 0;">
                        <h4>Script Info</h4>
                        <div>Created by: kempanator (training mode by 4Lajf)</div>
                        <div>Version: ${version}</div>
                        <div><a href="https://github.com/kempanator/amq-scripts/blob/main/amqCustomSongListGame.user.js" target="blank">Github</a> <a href="https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js" target="blank">Install</a></div>
                        <h4 style="margin-top: 20px;">Custom CSS</h4>
                        <div><span style="font-size: 15px; margin-right: 17px;">#lnCustomSongListButton </span>right: <input id="cslgCSLButtonCSSInput" type="text" style="width: 150px; color: black;"></div>
                        <div style="margin: 10px 0"><button id="cslgResetCSSButton" style="color: black; margin-right: 10px;">Reset</button><button id="cslgApplyCSSButton" style="color: black;">Save</button></div>
                        <h4 style="margin-top: 20px;">Prompt All Players</h4>
                        <div style="margin: 10px 0"><button id="cslgPromptAllAutocompleteButton" style="color: black; margin-right: 10px;">Autocomplete</button><button id="cslgPromptAllVersionButton" style="color: black;">Version</button></div>
                        <div style="margin-top: 15px"><span style="font-size: 16px; margin-right: 10px; vertical-align: middle;">Show CSL Messages</span><div class="customCheckbox" style="vertical-align: middle"><input type="checkbox" id="cslgShowCSLMessagesCheckbox"><label for="cslgShowCSLMessagesCheckbox"><i class="fa fa-check" aria-hidden="true"></i></label></div></div>
                        <div style="margin: 10px 0"><input id="cslgMalClientIdInput" type="text" placeholder="MAL Client ID" style="width: 300px; color: black;"></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <div style="float: left; margin-right: 10px;">
                        <select id="cslgProfileSelect" style="color: black; margin-right: 5px;"></select>
                        <button id="cslgLoadProfileButton" class="btn btn-default">Load</button>
                        <button id="cslgAddProfileButton" class="btn btn-success">Add</button>
                        <button id="cslgDeleteProfileButton" class="btn btn-danger">Delete</button>
                    </div>
                    <button id="cslgAutocompleteButton" class="btn btn-danger" style="float: left">Autocomplete</button>
                    <button id="cslgStartButton" class="btn btn-primary">Normal</button>
                    <button id="cslTrainingModeButton" class="btn btn-primary" >Training</button>
                </div>
            </div>
        </div>
    </div>
    `)
);

loadProfiles(); // Load saved profiles
updateProfileSelect(); // Populate profile select

$('#cslgSettingsMaxNewSongs').on('input', function () {
  maxNewSongs24Hours = parseInt($(this).val()) || 0;
  saveNewSongsSettings();
});

$('#cslSettingsResetMaxNewSongs').on('click', function () {
  resetNewSongsCount();
  alert('New songs count has been reset for the next 24 hours.');
});

// Load saved settings
loadNewSongsSettings();
$('#cslgSettingsMaxNewSongs').val(maxNewSongs24Hours);

// Load profile button
$('#cslgLoadProfileButton').click(() => {
  const selectedProfile = $('#cslgProfileSelect').val();
  if (selectedProfile) {
    selectProfile(selectedProfile);
    alert(`Loaded profile: ${selectedProfile}`);
  }
});

// Add profile button
$('#cslgAddProfileButton').click(() => {
  const profileName = prompt('Enter new profile name:');
  if (profileName) {
    addProfile(profileName);
    alert(`Added new profile: ${profileName}`);
  }
});

// Delete profile button
$('#cslgDeleteProfileButton').click(() => {
  const selectedProfile = $('#cslgProfileSelect').val();
  if (confirm(`Are you sure you want to delete the profile "${selectedProfile}"?`)) {
    deleteProfile(selectedProfile);
    alert(`Deleted profile: ${selectedProfile}`);
  }
});

createHotkeyElement('Start CSL', 'start', 'cslgStartHotkeySelect', 'cslgStartHotkeyInput');
createHotkeyElement('Stop CSL', 'stop', 'cslgStopHotkeySelect', 'cslgStopHotkeyInput');
createHotkeyElement('Start Training', 'startTraining', 'cslgStartTrainingHotkeySelect', 'cslgStartTrainingHotkeyInput');
createHotkeyElement('Stop Training', 'stopTraining', 'cslgStopTrainingHotkeySelect', 'cslgStopTrainingHotkeyInput');
createHotkeyElement('Open Window', 'cslgWindow', 'cslgWindowHotkeySelect', 'cslgWindowHotkeyInput');
//createHotkeyElement("Merge All", "mergeAll", "cslgMergeAllHotkeySelect", "cslgMergeAllHotkeyInput");

function validateTrainingStart() {
  isTraining = true;
  if (!lobby.inLobby) return;
  songOrder = {};
  if (!lobby.isHost) {
    return messageDisplayer.displayMessage('Unable to start', 'must be host');
  }
  if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
    return messageDisplayer.displayMessage('Unable to start', 'all players must be ready');
  }
  if (!songList || !songList.length) {
    return messageDisplayer.displayMessage('Unable to start', 'no songs');
  }
  if (autocomplete.length === 0) {
    return messageDisplayer.displayMessage('Unable to start', 'autocomplete list empty');
  }
  let numSongs = parseInt($('#cslgSettingsSongs').val());
  if (isNaN(numSongs) || numSongs < 1) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid number of songs');
  }
  guessTime = parseInt($('#cslgSettingsGuessTime').val());
  if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid guess time');
  }
  extraGuessTime = parseInt($('#cslgSettingsExtraGuessTime').val());
  if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid extra guess time');
  }
  let startPointText = $('#cslgSettingsStartPoint').val().trim();
  if (/^[0-9]+$/.test(startPointText)) {
    startPointRange = [parseInt(startPointText), parseInt(startPointText)];
  } else if (/^[0-9]+[\s-]+[0-9]+$/.test(startPointText)) {
    let regex = /^([0-9]+)[\s-]+([0-9]+)$/.exec(startPointText);
    startPointRange = [parseInt(regex[1]), parseInt(regex[2])];
  } else {
    return messageDisplayer.displayMessage('Unable to start', 'song start sample must be a number or range 0-100');
  }
  if (
    startPointRange[0] < 0 ||
    startPointRange[0] > 100 ||
    startPointRange[1] < 0 ||
    startPointRange[1] > 100 ||
    startPointRange[0] > startPointRange[1]
  ) {
    return messageDisplayer.displayMessage('Unable to start', 'song start sample must be a number or range 0-100');
  }
  let difficultyText = $('#cslgSettingsDifficulty').val().trim();
  if (/^[0-9]+[\s-]+[0-9]+$/.test(difficultyText)) {
    let regex = /^([0-9]+)[\s-]+([0-9]+)$/.exec(difficultyText);
    difficultyRange = [parseInt(regex[1]), parseInt(regex[2])];
  } else {
    return messageDisplayer.displayMessage('Unable to start', 'difficulty must be a range 0-100');
  }
  if (
    difficultyRange[0] < 0 ||
    difficultyRange[0] > 100 ||
    difficultyRange[1] < 0 ||
    difficultyRange[1] > 100 ||
    difficultyRange[0] > difficultyRange[1]
  ) {
    return messageDisplayer.displayMessage('Unable to start', 'difficulty must be a range 0-100');
  }
  let ops = $('#cslgSettingsOPCheckbox').prop('checked');
  let eds = $('#cslgSettingsEDCheckbox').prop('checked');
  let ins = $('#cslgSettingsINCheckbox').prop('checked');
  let tv = $('#cslgSettingsTVCheckbox').prop('checked');
  let movie = $('#cslgSettingsMovieCheckbox').prop('checked');
  let ova = $('#cslgSettingsOVACheckbox').prop('checked');
  let ona = $('#cslgSettingsONACheckbox').prop('checked');
  let special = $('#cslgSettingsSpecialCheckbox').prop('checked');
  let correctGuesses = $('#cslgSettingsCorrectGuessCheckbox').prop('checked');
  let incorrectGuesses = $('#cslgSettingsIncorrectGuessCheckbox').prop('checked');

  let songKeys = Object.keys(songList)
    .filter((key) => songTypeFilter(songList[key], ops, eds, ins))
    .filter((key) => animeTypeFilter(songList[key], tv, movie, ova, ona, special))
    .filter((key) => difficultyFilter(songList[key], difficultyRange[0], difficultyRange[1]))
    .filter((key) => guessTypeFilter(songList[key], correctGuesses, incorrectGuesses));

  if (songKeys.length === 0) {
    return messageDisplayer.displayMessage('Unable to start', 'no songs match the selected criteria');
  }

  // Prepare the playlist from the filtered song keys
  let playlist = prepareSongForTraining(songKeys, numSongs);

  // Create songOrder based on the playlist
  playlist.forEach((songKey, i) => {
    songOrder[i + 1] = parseInt(songKey);
  });

  totalSongs = Object.keys(songOrder).length;
  if (totalSongs === 0) {
    return messageDisplayer.displayMessage('Unable to start', 'no songs');
  }
  fastSkip = $('#cslgSettingsFastSkip').prop('checked');
  $('#cslgSettingsModal').modal('hide');
  console.log('song order: ', songOrder);
  if (lobby.soloMode) {
    console.log(songList);
    startQuiz();
  } else if (lobby.isHost) {
    cslMessage(
      '§CSL0' + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
    );
  }
}

$('#cslTrainingModeButton').click(() => {
  validateTrainingStart();
});

$('#lobbyPage .topMenuBar').append(
  `<div id="lnStatsButton" class="clickAble topMenuButton topMenuMediumButton"><h3>Stats</h3></div>`
);
$('#lnStatsButton').click(() => {
  console.log('Stats Button Clicked');
  openStatsModal();
});
$('#lobbyPage .topMenuBar').append(
  `<div id="lnCustomSongListButton" class="clickAble topMenuButton topMenuMediumButton"><h3>CSL</h3></div>`
);
$('#lnCustomSongListButton').click(() => {
  console.log('CSL Button Clicked');
  openSettingsModal();
});
$('#cslgSongListTab').click(() => {
  tabReset();
  $('#cslgSongListTab').addClass('selected');
  $('#cslgSongListContainer').show();
});
$('#cslgQuizSettingsTab').click(() => {
  tabReset();
  $('#cslgQuizSettingsTab').addClass('selected');
  $('#cslgQuizSettingsContainer').show();
});
$('#cslgAnswerTab').click(() => {
  tabReset();
  $('#cslgAnswerTab').addClass('selected');
  $('#cslgAnswerContainer').show();
});
$('#cslgMergeTab').click(() => {
  tabReset();
  $('#cslgMergeTab').addClass('selected');
  $('#cslgMergeContainer').show();
});
$('#cslgHotkeyTab').click(() => {
  tabReset();
  $('#cslgHotkeyTab').addClass('selected');
  $('#cslgHotkeyContainer').show();
});
$('#cslgListImportTab').click(() => {
  tabReset();
  $('#cslgListImportTab').addClass('selected');
  $('#cslgListImportContainer').show();
});
$('#cslgInfoTab').click(() => {
  tabReset();
  $('#cslgInfoTab').addClass('selected');
  $('#cslgInfoContainer').show();
});
$('#cslgAnisongdbSearchButtonGo').click(() => {
  anisongdbDataSearch();
});
$('#cslgAnisongdbQueryInput').keypress((event) => {
  if (event.which === 13) {
    anisongdbDataSearch();
  }
});
$('#cslgFileUpload').on('change', function () {
  if (this.files.length) {
    this.files[0].text().then((data) => {
      try {
        handleData(JSON.parse(data));
        if (songList.length === 0) {
          messageDisplayer.displayMessage('0 song links found');
        }
      } catch (error) {
        songList = [];
        $(this).val('');
        console.error(error);
        messageDisplayer.displayMessage('Upload Error');
      }
      setSongListTableSort();
      createSongListTable();
      createAnswerTable();
    });
  }
});
$('#cslgMergeAllButton')
  .click(() => {
    mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) =>
      JSON.parse(x)
    );
    createMergedSongListTable();
  })
  .popover({
    content: 'Add all to merged',
    trigger: 'hover',
    placement: 'bottom',
  });
$('#cslgClearSongListButton')
  .click(() => {
    songList = [];
    createSongListTable();
  })
  .popover({
    content: 'Clear song list',
    trigger: 'hover',
    placement: 'bottom',
  });
$('#cslgTransferSongListButton')
  .click(() => {
    songList = Array.from(mergedSongList);
    createSongListTable();
  })
  .popover({
    content: 'Transfer from merged',
    trigger: 'hover',
    placement: 'bottom',
  });
$('#cslgTableModeButton')
  .click(() => {
    songListTableMode = (songListTableMode + 1) % 3;
    createSongListTable();
  })
  .popover({
    content: 'Table mode',
    trigger: 'hover',
    placement: 'bottom',
  });
$('#cslgSongOrderSelect').on('change', function () {
  songOrderType = this.value;
});
$('#cslgHostOverrideSelect').on('change', function () {
  fileHostOverride = parseInt(this.value);
});
$('#cslgMergeButton').click(() => {
  mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) =>
    JSON.parse(x)
  );
  createMergedSongListTable();
});
$('#cslgMergeClearButton').click(() => {
  mergedSongList = [];
  createMergedSongListTable();
});
$('#cslgMergeDownloadButton').click(() => {
  if (mergedSongList.length) {
    let data = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(mergedSongList));
    let element = document.createElement('a');
    element.setAttribute('href', data);
    element.setAttribute('download', 'merged.json');
    document.body.appendChild(element);
    element.click();
    element.remove();
  } else {
    messageDisplayer.displayMessage('No songs', 'add some songs to the merged song list');
  }
});
$('#cslgAutocompleteButton').click(() => {
  if (lobby.soloMode) {
    $('#cslgSettingsModal').modal('hide');
    socket.sendCommand({ type: 'lobby', command: 'start game' });
    let autocompleteListener = new Listener('get all song names', () => {
      autocompleteListener.unbindListener();
      viewChanger.changeView('main');
      setTimeout(() => {
        hostModal.displayHostSolo();
      }, 200);
      setTimeout(() => {
        let returnListener = new Listener('Host Game', (payload) => {
          returnListener.unbindListener();
          if (songList.length) createAnswerTable();
          setTimeout(() => {
            openSettingsModal();
          }, 10);
        });
        returnListener.bindListener();
        roomBrowser.host();
      }, 400);
    });
    autocompleteListener.bindListener();
  } else {
    messageDisplayer.displayMessage('Autocomplete', 'For multiplayer, just start the quiz normally and immediately lobby');
  }
});
$('#cslgListImportUsernameInput').keypress((event) => {
  if (event.which === 13) {
    startImport();
  }
});
$('#cslgListImportStartButton').click(() => {
  startImport();
});
$('#cslgListImportMoveButton').click(() => {
  if (!importedSongList.length) return;
  handleData(importedSongList);
  setSongListTableSort();
  createSongListTable();
  createAnswerTable();
});
$('#cslgListImportDownloadButton').click(() => {
  if (!importedSongList.length) return;
  let listType = $('#cslgListImportSelect').val();
  let username = $('#cslgListImportUsernameInput').val().trim();
  let date = new Date();
  let dateFormatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, 0)}-${String(date.getDate()).padStart(
    2,
    0
  )}`;
  let data = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(importedSongList));
  let element = document.createElement('a');
  element.setAttribute('href', data);
  element.setAttribute('download', `${username} ${listType} ${dateFormatted} song list.json`);
  document.body.appendChild(element);
  element.click();
  element.remove();
});
$('#cslgStartButton').click(() => {
  validateStart();
});
$('#cslgSongListTable')
  .on('click', 'i.fa-trash', (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector('td.number').innerText) - 1;
    songList.splice(index, 1);
    createSongListTable();
    createAnswerTable();
  })
  .on('mouseenter', 'i.fa-trash', (event) => {
    event.target.parentElement.parentElement.classList.add('selected');
  })
  .on('mouseleave', 'i.fa-trash', (event) => {
    event.target.parentElement.parentElement.classList.remove('selected');
  });
$('#cslgSongListTable')
  .on('click', 'i.fa-plus', (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector('td.number').innerText) - 1;
    mergedSongList.push(songList[index]);
    mergedSongList = Array.from(new Set(mergedSongList.map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
    createMergedSongListTable();
  })
  .on('mouseenter', 'i.fa-plus', (event) => {
    event.target.parentElement.parentElement.classList.add('selected');
  })
  .on('mouseleave', 'i.fa-plus', (event) => {
    event.target.parentElement.parentElement.classList.remove('selected');
  });
$('#cslgAnswerButtonAdd').click(() => {
  let oldName = $('#cslgOldAnswerInput').val().trim();
  let newName = $('#cslgNewAnswerInput').val().trim();
  if (oldName) {
    newName ? (replacedAnswers[oldName] = newName) : delete replacedAnswers[oldName];
    saveSettings();
    createAnswerTable();
  }
  console.log('replaced answers: ', replacedAnswers);
});
$('#cslgAnswerTable').on('click', 'i.fa-pencil', (event) => {
  let oldName = event.target.parentElement.parentElement.querySelector('td.oldName').innerText;
  let newName = event.target.parentElement.parentElement.querySelector('td.newName').innerText;
  $('#cslgOldAnswerInput').val(oldName);
  $('#cslgNewAnswerInput').val(newName);
});
$('#cslgMergedSongListTable')
  .on('click', 'i.fa-chevron-up', (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector('td.number').innerText) - 1;
    if (index !== 0) {
      [mergedSongList[index], mergedSongList[index - 1]] = [mergedSongList[index - 1], mergedSongList[index]];
      createMergedSongListTable();
    }
  })
  .on('mouseenter', 'i.fa-chevron-up', (event) => {
    event.target.parentElement.parentElement.classList.add('selected');
  })
  .on('mouseleave', 'i.fa-chevron-up', (event) => {
    event.target.parentElement.parentElement.classList.remove('selected');
  });
$('#cslgMergedSongListTable')
  .on('click', 'i.fa-chevron-down', (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector('td.number').innerText) - 1;
    if (index !== mergedSongList.length - 1) {
      [mergedSongList[index], mergedSongList[index + 1]] = [mergedSongList[index + 1], mergedSongList[index]];
      createMergedSongListTable();
    }
  })
  .on('mouseenter', 'i.fa-chevron-down', (event) => {
    event.target.parentElement.parentElement.classList.add('selected');
  })
  .on('mouseleave', 'i.fa-chevron-down', (event) => {
    event.target.parentElement.parentElement.classList.remove('selected');
  });
$('#cslgMergedSongListTable')
  .on('click', 'i.fa-trash', (event) => {
    let index = parseInt(event.target.parentElement.parentElement.querySelector('td.number').innerText) - 1;
    mergedSongList.splice(index, 1);
    createMergedSongListTable();
  })
  .on('mouseenter', 'i.fa-trash', (event) => {
    event.target.parentElement.parentElement.classList.add('selected');
  })
  .on('mouseleave', 'i.fa-trash', (event) => {
    event.target.parentElement.parentElement.classList.remove('selected');
  });
$('#cslgSongListModeSelect')
  .val('Anisongdb')
  .on('change', function () {
    songList = [];
    $('#cslgSongListTable tbody').empty();
    $('#cslgMergeCurrentCount').text('Current song list: 0 songs');
    $('#cslgSongListCount').text('Songs: 0');
    if (this.value === 'Anisongdb') {
      $('#cslgFileUploadRow').hide();
      $('#cslgAnisongdbSearchRow').show();
      $('#cslgFileUploadRow input').val('');
    } else if (this.value === 'Load File') {
      $('#cslgAnisongdbSearchRow').hide();
      $('#cslgFileUploadRow').show();
      $('#cslgAnisongdbQueryInput').val('');
    }
  });
$('#cslgAnisongdbModeSelect').val('Artist');
/*$("#cslgAnisongdbModeSelect").val("Artist").on("change", function() {
    if (this.value === "Composer") {
        $("#cslgAnisongdbArrangementCheckbox").parent().show();
    }
    else {
        $("#cslgAnisongdbArrangementCheckbox").parent().hide();
    }
});*/
$('#cslgAnisongdbPartialCheckbox').prop('checked', true);
$('#cslgAnisongdbOPCheckbox').prop('checked', true);
$('#cslgAnisongdbEDCheckbox').prop('checked', true);
$('#cslgAnisongdbINCheckbox').prop('checked', true);
$('#cslgAnisongdbMaxOtherPeopleInput').val('99');
$('#cslgAnisongdbMinGroupMembersInput').val('0');
//$("#cslgAnisongdbArrangementCheckbox").parent().hide();
$('#cslgSettingsSongs').val('20');
$('#cslgSettingsGuessTime').val('20');
$('#cslgSettingsExtraGuessTime').val('0');
$('#cslgSettingsOPCheckbox').prop('checked', true);
$('#cslgSettingsEDCheckbox').prop('checked', true);
$('#cslgSettingsINCheckbox').prop('checked', true);
$('#cslgSettingsCorrectGuessCheckbox').prop('checked', true);
$('#cslgSettingsIncorrectGuessCheckbox').prop('checked', true);
$('#cslgSettingsTVCheckbox').prop('checked', true);
$('#cslgSettingsMovieCheckbox').prop('checked', true);
$('#cslgSettingsOVACheckbox').prop('checked', true);
$('#cslgSettingsONACheckbox').prop('checked', true);
$('#cslgSettingsSpecialCheckbox').prop('checked', true);
$('#cslgSettingsStartPoint').val('0-100');
$('#cslgSettingsDifficulty').val('0-100');
$('#cslgSettingsMaxNewSongs').val('25');
$('#cslgSettingsFastSkip').prop('checked', false);
$('#cslgFileUploadRow').hide();
$('#cslgCSLButtonCSSInput').val(CSLButtonCSS);
$('#cslgResetCSSButton').click(() => {
  CSLButtonCSS = 'calc(25% - 250px)';
  $('#cslgCSLButtonCSSInput').val(CSLButtonCSS);
});
$('#cslgApplyCSSButton').click(() => {
  let val = $('#cslgCSLButtonCSSInput').val();
  if (val) {
    CSLButtonCSS = val;
    saveSettings();
    applyStyles();
  } else {
    messageDisplayer.displayMessage('Error');
  }
});
$('#cslgShowCSLMessagesCheckbox')
  .prop('checked', showCSLMessages)
  .click(() => {
    showCSLMessages = !showCSLMessages;
  });
$('#cslgPromptAllAutocompleteButton').click(() => {
  cslMessage('§CSL21');
});
$('#cslgPromptAllVersionButton').click(() => {
  cslMessage('§CSL22');
});
$('#cslgMalClientIdInput')
  .val(malClientId)
  .on('change', function () {
    malClientId = this.value;
    saveSettings();
  });
tabReset();
$('#cslgSongListTab').addClass('selected');
$('#cslgSongListContainer').show();

function saveReviewData(reviewData) {
  localStorage.setItem(`spacedRepetitionData_${currentProfile}`, JSON.stringify(reviewData));
}

function loadReviewData() {
  const data = localStorage.getItem(`spacedRepetitionData_${currentProfile}`);
  return data ? JSON.parse(data) : {};
}

function saveNewSongsSettings() {
  localStorage.setItem(
    `newSongsSettings_${currentProfile}`,
    JSON.stringify({
      maxNewSongs24Hours,
      newSongsAdded24Hours,
      lastResetTime,
    })
  );
}

// Add this function to load the new songs settings
function loadNewSongsSettings() {
  const settings = localStorage.getItem(`newSongsSettings_${currentProfile}`);
  if (settings) {
    const parsed = JSON.parse(settings);
    maxNewSongs24Hours = parsed.maxNewSongs24Hours;
    newSongsAdded24Hours = parsed.newSongsAdded24Hours;
    lastResetTime = parsed.lastResetTime;
  }
}

function updateEFactor(oldEFactor, qualityOfResponse) {
  // Ensure that the quality of response is between 0 and 5
  qualityOfResponse = Math.max(0, Math.min(qualityOfResponse, 5));

  // Adjust the rate of E-Factor decrease for incorrect answers to be less severe
  const incorrectResponseFactor = 0.06; // Was 0.08 in the original formula
  const incorrectResponseSlope = 0.01; // Was 0.02 in the original formula

  // Adjust the rate of E-Factor increase for correct answers to be more substantial
  const correctResponseBonus = 0.15; // Was 0.1 in the original formula, can be increased if needed

  let newEFactor =
    oldEFactor +
    (correctResponseBonus -
      (5 - qualityOfResponse) * (incorrectResponseFactor + (5 - qualityOfResponse) * incorrectResponseSlope));

  newEFactor = Math.max(Math.min(newEFactor, 5), 1);

  return newEFactor;
}

function getReviewState(track) {
  const reviewData = loadReviewData();
  const songKey = `${track.songArtist}_${track.songName}`;
  const lastReview = reviewData[songKey] || {
    date: Date.now(),
    efactor: 2.5,
    successCount: 0,
    successStreak: 0,
    failureCount: 0,
    failureStreak: 0,
    isLastTryCorrect: false,
    weight: 9999, // Default weight for new songs
  };

  return {
    ...track,
    reviewState: {
      date: lastReview.lastReviewDate || Date.now(),
      efactor: lastReview.efactor,
      successCount: lastReview.successCount,
      successStreak: lastReview.successStreak,
      failureCount: lastReview.failureCount,
      failureStreak: lastReview.failureStreak,
      isLastTryCorrect: lastReview.isLastTryCorrect,
      weight: lastReview.weight,
    },
    weight: lastReview.weight,
  };
}

function updateNewSongsCount(songKey) {
  console.log('SONG KEY', songKey);
  console.log('POT NEW SONGS', potentialNewSongs);
  if (potentialNewSongs.has(songKey)) {
    console.log('NEW SONG INCREMENTED');
    newSongsAdded24Hours++;
    potentialNewSongs.delete(songKey);
    console.log(`New song played: ${songKey}. Total new songs in 24 hours: ${newSongsAdded24Hours}`);
    saveNewSongsSettings();
  }
}

// Update the reviewSong function
function reviewSong(song, success) {
  console.log(song);
  if (!isTraining) return;
  let reviewData = loadReviewData();
  const songKey = `${song.songArtist}_${song.songName}`; // Use a unique identifier for the song

  if (!reviewData[songKey]) {
    reviewData[songKey] = {
      date: Date.now(),
      efactor: 2.5,
      successCount: 0,
      successStreak: 0,
      failureCount: 0,
      failureStreak: 0,
      isLastTryCorrect: false,
      weight: 9999, // Initial weight for new songs
    };
  }

  const grade = success ? 5 : 0;
  const lastReview = reviewData[songKey];
  lastReview.efactor = updateEFactor(lastReview.efactor, grade);

  if (success) {
    lastReview.failureStreak = 0;
    lastReview.successStreak++;
    lastReview.successCount++;
  } else {
    lastReview.successStreak = 0;
    lastReview.failureStreak++;
    lastReview.failureCount++;
  }

  lastReview.isLastTryCorrect = success;
  lastReview.lastReviewDate = Date.now();

  // Calculate and store the new weight
  lastReview.weight = calculateWeight({
    reviewState: lastReview,
  });

  saveReviewData(reviewData);

  // Update new songs count after the song has been reviewed
  updateNewSongsCount(songKey);
}

let appearanceCounter = {};

function calculateWeight(track) {
  if (!isTraining) return;
  const OVERDUE_FACTOR_PERCENTAGE = 0.1;
  const LAST_PERFORMANCE_PERCENTAGE = 0.05;
  const EFACTOR_IMPACT_PERCENTAGE = 0.6;
  const CORRECT_GUESSES_PERCENTAGE_INFLUENCE = 0.15;
  const SUCCESS_STREAK_INFLUENCE = -0.2; // Negative influence to represent lower urgency with successive successes
  const FAILURE_STREAK_INFLUENCE = 0.2; // Positive influence to represent higher urgency with successive failures

  const currentDate = Date.now();
  const reviewState = track.reviewState;
  const reviewDate = reviewState.date;
  const efactor = reviewState.efactor;
  const successCount = reviewState.successCount;
  const failureCount = reviewState.failureCount;
  const successStreak = reviewState.successStreak;
  const failureStreak = reviewState.failureStreak;
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

  let successStreakImpact;
  if (successStreak === 1) {
    successStreakImpact = -0.1;
  } else {
    successStreakImpact = calculateSuccessStreakImpact(successStreak, SUCCESS_STREAK_INFLUENCE, 4, 2);
  }

  let failureStreakImpact;
  if (failureStreak === 1) {
    failureStreakImpact = 0.1;
  } else {
    failureStreakImpact = calculateFailureStreakImpact(failureStreak, FAILURE_STREAK_INFLUENCE, 4, 2);
  }

  // Calculate the percentage of correct guesses
  const totalAttempts = successCount + failureCount;
  let correctGuessPercentage = totalAttempts > 0 ? successCount / totalAttempts : 1;

  // Using logarithmic function to control the growth of the interval increase factor
  const MIN_EFACTOR = 1.0; // The minimum efactor to prevent intervals from being too short
  const successCountEffect = successCount > 0 ? Math.log(successCount) / Math.log(2) : 0;
  const intervalIncreaseFactor = Math.max(MIN_EFACTOR, efactor) * Math.pow(correctGuessPercentage, successCountEffect);

  // Calculate the ideal review date based on the interval increase factor
  // console.log(reviewDate, intervalIncreaseFactor)
  const idealReviewDate = reviewDate + intervalIncreaseFactor * (24 * 60 * 60 * 1000) - 2 * (24 * 60 * 60 * 1000);
  // console.log(idealReviewDate)
  let overdueFactor = Math.max(0, (currentDate - idealReviewDate) / (24 * 60 * 60 * 1000));
  overdueFactor /= 10;

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
  weight *= 100;
  weight += 100;

  console.log(track);
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
  const centerWeight = 145;

  const candidatesArray = reviewCandidates.map((candidate) => {
    return {
      ...candidate,
      adjustedWeight: adjustWeight(candidate.reviewState.weight),
    };
  });

  function adjustWeight(weight) {
    const weightDifferenceRatio = (weight - centerWeight) / centerWeight;
    return weight * Math.pow(2, weightDifferenceRatio);
  }

  let totalAdjustedWeight = candidatesArray.reduce((total, candidate) => total + candidate.adjustedWeight, 0);

  const selectRandomly = () => {
    let r = Math.random() * totalAdjustedWeight;
    for (let i = 0; i < candidatesArray.length; i++) {
      r -= candidatesArray[i].adjustedWeight;
      if (r <= 0) {
        return candidatesArray[i];
      }
    }
  };

  const selections = [];
  for (let i = 0; i < maxSongs; i++) {
    const selectedCandidate = selectRandomly();
    if (!selectedCandidate) continue;
    selections.push(selectedCandidate);
    totalAdjustedWeight -= selectedCandidate.adjustedWeight;
    candidatesArray.splice(candidatesArray.indexOf(selectedCandidate), 1);
  }
  return selections;
}

function penalizeDuplicateRomajiNames(selectedTracks, reviewCandidates) {
  console.log(`penalizeDuplicateRomajiNames started with ${selectedTracks.length} tracks`);

  const MAX_ITERATIONS = 1000;
  let iterations = 0;
  let index = 0;
  let totalReplacements = 0;

  while (index < selectedTracks.length && iterations < MAX_ITERATIONS) {
    iterations++;
    let duplicateIndexes = [];

    for (let i = index + 1; i < selectedTracks.length; i++) {
      if (songList[selectedTracks[i].key].animeRomajiName === songList[selectedTracks[index].key].animeRomajiName) {
        if (i - index <= 7) {
          duplicateIndexes.push(i);
        }
      }
    }

    console.log(`Iteration ${iterations}: Found ${duplicateIndexes.length} duplicates at index ${index}`);

    while (duplicateIndexes.length > 0 && selectedTracks.length > 1) {
      let randomChance = Math.random() * 10;
      if (randomChance >= 3) {
        let dupeIndex = duplicateIndexes.pop();
        let duplicateTrack = selectedTracks[dupeIndex];
        selectedTracks.splice(dupeIndex, 1);

        let newTrack;
        let attempts = 0;
        do {
          attempts++;
          let selectionResult = weightedRandomSelection(reviewCandidates, 1);
          newTrack = selectionResult[0];
        } while (
          selectedTracks.some((track) => songList[track.key].animeRomajiName === songList[newTrack.key].animeRomajiName) &&
          attempts < 100
        );

        if (attempts < 100) {
          selectedTracks.splice(dupeIndex, 0, newTrack);
          totalReplacements++;
          console.log(`Replaced duplicate at index ${dupeIndex} after ${attempts} attempts:`);
          console.log(
            `  Removed: "${songList[duplicateTrack.key].animeRomajiName}" (${songList[duplicateTrack.key].songName} by ${
              songList[duplicateTrack.key].songArtist
            })`
          );
          console.log(
            `  Added:   "${songList[newTrack.key].animeRomajiName}" (${songList[newTrack.key].songName} by ${
              songList[newTrack.key].songArtist
            })`
          );
        } else {
          console.log(`Failed to find non-duplicate replacement after 100 attempts for:`);
          console.log(
            `  "${songList[duplicateTrack.key].animeRomajiName}" (${songList[duplicateTrack.key].songName} by ${
              songList[duplicateTrack.key].songArtist
            })`
          );
        }
      } else {
        let skippedIndex = duplicateIndexes.pop();
        console.log(`Skipped replacement due to random chance for duplicate at index ${skippedIndex}:`);
        console.log(
          `  "${songList[selectedTracks[skippedIndex].key].animeRomajiName}" (${
            songList[selectedTracks[skippedIndex].key].songName
          } by ${songList[selectedTracks[skippedIndex].key].songArtist})`
        );
      }
    }

    if (duplicateIndexes.length === 0) {
      index++;
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(`penalizeDuplicateRomajiNames reached maximum iterations (${MAX_ITERATIONS})`);
  }

  console.log(`penalizeDuplicateRomajiNames completed after ${iterations} iterations`);
  console.log(`Total replacements made: ${totalReplacements}`);
  console.log(`Final track count: ${selectedTracks.length}`);
}

function penalizeAndAdjustSelection(selectedCandidates, reviewCandidates, maxSongs) {
  let adjustedSelection = [...selectedCandidates];
  let remainingCandidates = reviewCandidates.filter((c) => !selectedCandidates.includes(c));

  // Separate new songs and regular songs
  let newSongs = adjustedSelection.filter((c) => c.weight === 9999);
  let regularSongs = adjustedSelection.filter((c) => c.weight !== 9999);

  penalizeDuplicateRomajiNames(regularSongs, remainingCandidates);

  // If we removed any new songs during penalization, try to replace them with other new songs first
  let newSongsNeeded = selectedCandidates.filter((c) => c.weight === 9999).length - newSongs.length;
  let availableNewSongs = remainingCandidates.filter((c) => c.weight === 9999);

  while (newSongsNeeded > 0 && availableNewSongs.length > 0) {
    let randomNewSong = availableNewSongs.splice(Math.floor(Math.random() * availableNewSongs.length), 1)[0];
    newSongs.push(randomNewSong);
    remainingCandidates = remainingCandidates.filter((c) => c !== randomNewSong);
    newSongsNeeded--;
  }

  // Combine new songs and regular songs
  adjustedSelection = [...newSongs, ...regularSongs];

  // Fill remaining slots with regular songs if needed
  while (adjustedSelection.length < maxSongs && remainingCandidates.length > 0) {
    let regularCandidates = remainingCandidates.filter((c) => c.weight !== 9999);
    if (regularCandidates.length > 0) {
      let selected = weightedRandomSelection(regularCandidates, 1)[0];
      adjustedSelection.push(selected);
      remainingCandidates = remainingCandidates.filter((c) => c !== selected);
    } else {
      break;
    }
  }

  return adjustedSelection.slice(0, maxSongs);
}

let usedNewSongs = new Set(); // Global variable to track used new songs across game sessions

function resetNewSongsCount() {
  newSongsAdded24Hours = 0;
  lastResetTime = Date.now();
  saveNewSongsSettings();
}

function prepareSongForTraining(songKeys, maxSongs) {
  console.log(`prepareSongForTraining started with ${songKeys.length} tracks and maxSongs: ${maxSongs}`);
  console.log(`Current Profile: ${currentProfile}`);

  loadNewSongsSettings();

  // Check if 24 hours have passed since the last reset
  if (Date.now() - lastResetTime > 24 * 60 * 60 * 1000) {
    console.log('24 hours have passed. Resetting new songs count.');
    resetNewSongsCount();
  }

  console.log(
    `Current settings: maxNewSongs24Hours = ${maxNewSongs24Hours}, newSongsAdded24Hours = ${newSongsAdded24Hours}`
  );

  let reviewCandidates = songKeys.map((key) => {
    let track = songList[key];
    let reviewState = getReviewState(track);
    return {
      ...reviewState,
      key: key,
    };
  });

  let newSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight === 9999);
  let regularSongs = reviewCandidates.filter((candidate) => candidate.reviewState.weight !== 9999);

  newSongs = shuffleArray(newSongs);

  console.log(`Found ${newSongs.length} new songs and ${regularSongs.length} regular songs`);

  let selectedCandidates = [];
  let newSongsToAdd = Math.min(maxNewSongs24Hours - newSongsAdded24Hours, maxSongs, newSongs.length);

  console.log(`Calculated newSongsToAdd: ${newSongsToAdd}`);

  if (newSongsToAdd > 0) {
    selectedCandidates = newSongs.slice(0, newSongsToAdd);
    // Instead of incrementing newSongsAdded24Hours, we add these to potentialNewSongs
    selectedCandidates.forEach((song) => potentialNewSongs.add(`${song.songArtist}_${song.songName}`));
    console.log(`Added ${selectedCandidates.length} potential new songs.`);
  } else {
    console.log('No new songs added in this session.');
  }

  let remainingSlots = maxSongs - selectedCandidates.length;
  console.log(`Remaining slots for regular songs: ${remainingSlots}`);

  let regularSelections = weightedRandomSelection(regularSongs, remainingSlots);
  console.log(`Selected ${regularSelections.length} regular songs`);

  selectedCandidates = selectedCandidates.concat(regularSelections);

  console.log(`Total selected candidates: ${selectedCandidates.length}`);

  console.log('Starting penalizeAndAdjustSelection');
  selectedCandidates = penalizeAndAdjustSelection(selectedCandidates, reviewCandidates, maxSongs);
  console.log(`penalizeAndAdjustSelection returned ${selectedCandidates.length} candidates`);

  let finalNewSongs = selectedCandidates.filter((candidate) => candidate.reviewState.weight === 9999);
  let finalRegularSongs = selectedCandidates.filter((candidate) => candidate.reviewState.weight !== 9999);
  console.log(`Final selection: ${finalNewSongs.length} potential new songs, ${finalRegularSongs.length} regular songs`);

  console.log('prepareSongForTraining completed');

  return shuffleArray(selectedCandidates).map((candidate) => candidate.key);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function resetUsedNewSongs() {
  usedNewSongs.clear();
}

// setup
function setup() {
  new Listener('New Player', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find((p) => p._name === payload.name);
      if (player) {
        sendSystemMessage(`CSL: reconnecting ${payload.name}`);
        cslMessage(
          '§CSL0' +
            btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
        );
      } else {
        cslMessage(`CSL game in progress, removing ${payload.name}`);
        lobby.changeToSpectator(payload.name);
      }
    }
  }).bindListener();
  new Listener('New Spectator', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find((p) => p._name === payload.name);
      if (player) {
        sendSystemMessage(`CSL: reconnecting ${payload.name}`);
        cslMessage('§CSL17' + btoa(payload.name));
      } else {
        cslMessage(
          '§CSL0' +
            btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
        );
      }
      setTimeout(() => {
        let song = songList[songOrder[currentSong]];
        let message = `${currentSong}§${getStartPoint()}§${song.audio || ''}§${song.video480 || ''}§${song.video720 || ''}`;
        splitIntoChunks(btoa(message) + '$', 144).forEach((item, index) => {
          cslMessage('§CSL3' + base10to36(index % 36) + item);
        });
      }, 300);
    }
  }).bindListener();
  new Listener('Spectator Change To Player', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find((p) => p._name === payload.name);
      if (player) {
        cslMessage(
          '§CSL0' +
            btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
        );
      } else {
        cslMessage(`CSL game in progress, removing ${payload.name}`);
        lobby.changeToSpectator(payload.name);
      }
    }
  }).bindListener();
  new Listener('Player Change To Spectator', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find((p) => p._name === payload.name);
      if (player) {
        cslMessage('§CSL17' + btoa(payload.name));
      } else {
        cslMessage(
          '§CSL0' +
            btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
        );
      }
    }
  }).bindListener();
  new Listener('Host Promotion', (payload) => {
    if (quiz.cslActive && quiz.inQuiz) {
      sendSystemMessage('CSL host changed, ending quiz');
      quizOver();
    }
  }).bindListener();
  new Listener('Player Left', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && payload.player.name === cslMultiplayer.host) {
      sendSystemMessage('CSL host left, ending quiz');
      quizOver();
    }
  }).bindListener();
  new Listener('Spectator Left', (payload) => {
    if (quiz.cslActive && quiz.inQuiz && payload.spectator === cslMultiplayer.host) {
      sendSystemMessage('CSL host left, ending quiz');
      quizOver();
    }
  }).bindListener();
  new Listener('game closed', (payload) => {
    if (quiz.cslActive && quiz.inQuiz) {
      reset();
      messageDisplayer.displayMessage('Room Closed', payload.reason);
      lobby.leave({ supressServerMsg: true });
    }
  }).bindListener();
  new Listener('game chat update', (payload) => {
    for (let message of payload.messages) {
      if (message.message.startsWith('§CSL')) {
        if (!showCSLMessages) {
          setTimeout(() => {
            let $message = gameChat.$chatMessageContainer.find('.gcMessage').last();
            if ($message.text().startsWith('§CSL')) $message.parent().remove();
          }, 0);
        }
        parseMessage(message.message, message.sender);
      } else if (debug && message.sender === selfName && message.message.startsWith('/csl')) {
        try {
          cslMessage(JSON.stringify(eval(message.message.slice(5))));
        } catch {
          cslMessage('ERROR');
        }
      }
    }
  }).bindListener();
  new Listener('Game Chat Message', (payload) => {
    if (payload.message.startsWith('§CSL')) {
      parseMessage(message.message, message.sender);
    }
  }).bindListener();
  new Listener('Game Starting', (payload) => {
    clearTimeEvents();
  }).bindListener();
  new Listener('Join Game', (payload) => {
    reset();
  }).bindListener();
  new Listener('Spectate Game', (payload) => {
    reset();
  }).bindListener();
  new Listener('Host Game', (payload) => {
    reset();
    $('#cslgSettingsModal').modal('hide');
  }).bindListener();
  new Listener('get all song names', () => {
    setTimeout(() => {
      let list = quiz.answerInput.typingInput.autoCompleteController.list;
      if (list.length) {
        autocomplete = list.map((x) => x.toLowerCase());
        autocompleteInput = new AmqAwesomeplete(document.querySelector('#cslgNewAnswerInput'), { list: list }, true);
      }
    }, 10);
  }).bindListener();
  new Listener('update all song names', () => {
    setTimeout(() => {
      let list = quiz.answerInput.typingInput.autoCompleteController.list;
      if (list.length) {
        autocomplete = list.map((x) => x.toLowerCase());
        autocompleteInput.list = list;
      }
    }, 10);
  }).bindListener();

  quiz.pauseButton.$button.off('click').click(() => {
    if (quiz.cslActive) {
      if (quiz.soloMode) {
        if (quiz.pauseButton.pauseOn) {
          fireListener('quiz unpause triggered', {
            playerName: selfName,
          });
          /*fireListener("quiz unpause triggered", {
                        "playerName": selfName,
                        "doCountDown": true,
                        "countDownLength": 3000
                    });*/
        } else {
          fireListener('quiz pause triggered', {
            playerName: selfName,
          });
        }
      } else {
        if (quiz.pauseButton.pauseOn) {
          cslMessage('§CSL12');
        } else {
          cslMessage('§CSL11');
        }
      }
    } else {
      socket.sendCommand({ type: 'quiz', command: quiz.pauseButton.pauseOn ? 'quiz unpause' : 'quiz pause' });
    }
  });

  const oldSendSkipVote = quiz.skipController.sendSkipVote;
  quiz.skipController.sendSkipVote = function () {
    if (quiz.cslActive) {
      if (quiz.soloMode) {
        clearTimeout(this.autoVoteTimeout);
      } else if (!skipping) {
        cslMessage('§CSL14');
      }
    } else {
      oldSendSkipVote.apply(this, arguments);
    }
  };

  const oldLeave = quiz.leave;
  quiz.leave = function () {
    reset();
    oldLeave.apply(this, arguments);
  };

  const oldStartReturnLobbyVote = quiz.startReturnLobbyVote;
  quiz.startReturnLobbyVote = function () {
    if (quiz.cslActive && quiz.inQuiz) {
      if (quiz.soloMode) {
        quizOver();
      } else if (quiz.isHost) {
        cslMessage('§CSL10');
      }
    } else {
      oldStartReturnLobbyVote.apply(this, arguments);
    }
  };

  const oldSubmitAnswer = QuizTypeAnswerInputController.prototype.submitAnswer;
  QuizTypeAnswerInputController.prototype.submitAnswer = function (answer) {
    if (quiz.cslActive) {
      currentAnswers[quiz.ownGamePlayerId] = answer;
      this.skipController.highlight = true;
      fireListener('quiz answer', {
        answer: answer,
        success: true,
      });
      if (quiz.soloMode) {
        fireListener('player answered', [0]);
        if (options.autoVoteSkipGuess) {
          this.skipController.voteSkip();
          fireListener('quiz overlay message', 'Skipping to Answers');
        }
      } else {
        cslMessage('§CSL13');
        if (options.autoVoteSkipGuess) {
          this.skipController.voteSkip();
        }
      }
    } else {
      oldSubmitAnswer.apply(this, arguments);
    }
  };

  const oldVideoReady = quiz.videoReady;
  quiz.videoReady = function (songId) {
    if (quiz.cslActive && this.inQuiz) {
      nextVideoReady = true;
    } else {
      oldVideoReady.apply(this, arguments);
    }
  };

  const oldHandleError = MoeVideoPlayer.prototype.handleError;
  MoeVideoPlayer.prototype.handleError = function () {
    if (quiz.cslActive) {
      gameChat.systemMessage(`CSL Error: couldn't load song ${currentSong + 1}`);
      nextVideoReady = true;
    } else {
      oldHandleError.apply(this, arguments);
    }
  };

  document.body.addEventListener('keydown', (event) => {
    const key = event.key;
    const altKey = event.altKey;
    const ctrlKey = event.ctrlKey;
    if (testHotkey('start', key, altKey, ctrlKey)) {
      validateStart();
    }
    if (testHotkey('stop', key, altKey, ctrlKey)) {
      quizOver();
    }

    if (testHotkey('startTraining', key, altKey, ctrlKey)) {
      validateTrainingStart()
    }
    if (testHotkey('stopTraining', key, altKey, ctrlKey)) {
      quizOver();
    }

    if (testHotkey('cslgWindow', key, altKey, ctrlKey)) {
      if ($('#cslgSettingsModal').is(':visible')) {
        $('#cslgSettingsModal').modal('hide');
      } else {
        openSettingsModal();
      }
    }
    /*if (testHotkey("mergeAll", key, altKey, ctrlKey)) {
            mergedSongList = Array.from(new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))).map((x) => JSON.parse(x));
            createMergedSongListTable();
        }*/
  });

  resultChunk = new Chunk();
  songInfoChunk = new Chunk();
  nextSongChunk = new Chunk();

  AMQ_addScriptData({
    name: 'Custom Song List Game',
    author: 'kempanator',
    version: version,
    link: 'https://github.com/kempanator/amq-scripts/raw/main/amqCustomSongListGame.user.js',
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
        `,
  });
  applyStyles();
}

// validate all settings and attempt to start csl quiz
function validateStart() {
  isTraining = false;
  if (!lobby.inLobby) return;
  songOrder = {};
  if (!lobby.isHost) {
    return messageDisplayer.displayMessage('Unable to start', 'must be host');
  }
  if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
    return messageDisplayer.displayMessage('Unable to start', 'all players must be ready');
  }
  if (!songList || !songList.length) {
    return messageDisplayer.displayMessage('Unable to start', 'no songs');
  }
  if (autocomplete.length === 0) {
    return messageDisplayer.displayMessage('Unable to start', 'autocomplete list empty');
  }
  let numSongs = parseInt($('#cslgSettingsSongs').val());
  if (isNaN(numSongs) || numSongs < 1) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid number of songs');
  }
  guessTime = parseInt($('#cslgSettingsGuessTime').val());
  if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid guess time');
  }
  extraGuessTime = parseInt($('#cslgSettingsExtraGuessTime').val());
  if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
    return messageDisplayer.displayMessage('Unable to start', 'invalid extra guess time');
  }
  let startPointText = $('#cslgSettingsStartPoint').val().trim();
  if (/^[0-9]+$/.test(startPointText)) {
    startPointRange = [parseInt(startPointText), parseInt(startPointText)];
  } else if (/^[0-9]+[\s-]+[0-9]+$/.test(startPointText)) {
    let regex = /^([0-9]+)[\s-]+([0-9]+)$/.exec(startPointText);
    startPointRange = [parseInt(regex[1]), parseInt(regex[2])];
  } else {
    return messageDisplayer.displayMessage('Unable to start', 'song start sample must be a number or range 0-100');
  }
  if (
    startPointRange[0] < 0 ||
    startPointRange[0] > 100 ||
    startPointRange[1] < 0 ||
    startPointRange[1] > 100 ||
    startPointRange[0] > startPointRange[1]
  ) {
    return messageDisplayer.displayMessage('Unable to start', 'song start sample must be a number or range 0-100');
  }
  let difficultyText = $('#cslgSettingsDifficulty').val().trim();
  if (/^[0-9]+[\s-]+[0-9]+$/.test(difficultyText)) {
    let regex = /^([0-9]+)[\s-]+([0-9]+)$/.exec(difficultyText);
    difficultyRange = [parseInt(regex[1]), parseInt(regex[2])];
  } else {
    return messageDisplayer.displayMessage('Unable to start', 'difficulty must be a range 0-100');
  }
  if (
    difficultyRange[0] < 0 ||
    difficultyRange[0] > 100 ||
    difficultyRange[1] < 0 ||
    difficultyRange[1] > 100 ||
    difficultyRange[0] > difficultyRange[1]
  ) {
    return messageDisplayer.displayMessage('Unable to start', 'difficulty must be a range 0-100');
  }
  let ops = $('#cslgSettingsOPCheckbox').prop('checked');
  let eds = $('#cslgSettingsEDCheckbox').prop('checked');
  let ins = $('#cslgSettingsINCheckbox').prop('checked');
  let tv = $('#cslgSettingsTVCheckbox').prop('checked');
  let movie = $('#cslgSettingsMovieCheckbox').prop('checked');
  let ova = $('#cslgSettingsOVACheckbox').prop('checked');
  let ona = $('#cslgSettingsONACheckbox').prop('checked');
  let special = $('#cslgSettingsSpecialCheckbox').prop('checked');
  let correctGuesses = $('#cslgSettingsCorrectGuessCheckbox').prop('checked');
  let incorrectGuesses = $('#cslgSettingsIncorrectGuessCheckbox').prop('checked');
  let songKeys = Object.keys(songList)
    .filter((key) => songTypeFilter(songList[key], ops, eds, ins))
    .filter((key) => animeTypeFilter(songList[key], tv, movie, ova, ona, special))
    .filter((key) => difficultyFilter(songList[key], difficultyRange[0], difficultyRange[1]))
    .filter((key) => guessTypeFilter(songList[key], correctGuesses, incorrectGuesses));

  if (songOrderType === 'random') {
    shuffleArray(songList);
  } else if (songOrderType === 'descending') {
    songList.reverse();
  }

  songKeys.slice(0, numSongs).forEach((key, i) => {
    songOrder[i + 1] = parseInt(key);
  });
  totalSongs = Object.keys(songOrder).length;
  if (totalSongs === 0) {
    return messageDisplayer.displayMessage('Unable to start', 'no songs');
  }
  fastSkip = $('#cslgSettingsFastSkip').prop('checked');
  $('#cslgSettingsModal').modal('hide');
  console.log('song order: ', songOrder);
  if (lobby.soloMode) {
    startQuiz();
  } else if (lobby.isHost) {
    cslMessage(
      '§CSL0' + btoa(`${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${fastSkip ? '1' : '0'}`)
    );
  }
}

// start quiz and load first song
function startQuiz() {
  if (!lobby.inLobby) return;
  if (lobby.soloMode) {
    if (!songList.length) return;
  } else {
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
  //console.log({showSelection, totalSongs, guessTime, extraGuessTime, fastSkip});
  let data = {
    gameMode: lobby.soloMode ? 'Solo' : 'Multiplayer',
    showSelection: showSelection,
    groupSlotMap: createGroupSlotMap(Object.keys(lobby.players)),
    players: [],
    multipleChoice: false,
    quizDescription: {
      quizId: '',
      startTime: date,
      roomName: hostModal.$roomName.val(),
    },
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
  fireListener('Game Starting', data);
  setTimeout(() => {
    if (quiz.soloMode) {
      fireListener('quiz next video info', {
        playLength: guessTime,
        playbackSpeed: 1,
        startPont: getStartPoint(),
        videoInfo: {
          id: null,
          videoMap: {
            catbox: createCatboxLinkObject(song.audio, song.video480, song.video720),
          },
          videoVolumeMap: {
            catbox: {
              0: -20,
              480: -20,
              720: -20,
            },
          },
        },
      });
    } else {
      if (quiz.isHost) {
        let message = `1§${getStartPoint()}§${song.audio || ''}§${song.video480 || ''}§${song.video720 || ''}`;
        splitIntoChunks(btoa(encodeURIComponent(message)) + '$', 144).forEach((item, index) => {
          cslMessage('§CSL3' + base10to36(index % 36) + item);
        });
      }
    }
  }, 100);
  if (quiz.soloMode) {
    setTimeout(() => {
      fireListener('quiz ready', {
        numberOfSongs: totalSongs,
      });
    }, 200);
    setTimeout(() => {
      fireListener('quiz waiting buffering', {
        firstSong: true,
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
  //console.log("Ready song: " + songNumber);
  nextVideoReadyInterval = setInterval(() => {
    //console.log({nextVideoReady, previousSongFinished});
    if (nextVideoReady && !quiz.pauseButton.pauseOn && previousSongFinished) {
      clearInterval(nextVideoReadyInterval);
      nextVideoReady = false;
      previousSongFinished = false;
      if (quiz.soloMode) {
        playSong(songNumber);
      } else if (quiz.isHost) {
        cslMessage('§CSL4' + btoa(songNumber));
      }
    }
  }, 100);
}

// play a song
function playSong(songNumber) {
  if (!quiz.cslActive || !quiz.inQuiz) return reset();
  for (let key of Object.keys(quiz.players)) {
    currentAnswers[key] = '';
    cslMultiplayer.voteSkip[key] = false;
  }
  answerChunks = {};
  resultChunk = new Chunk();
  songInfoChunk = new Chunk();
  cslMultiplayer.songInfo = {};
  currentSong = songNumber;
  cslState = 1;
  skipping = false;
  fireListener('play next song', {
    time: guessTime,
    extraGuessTime: extraGuessTime,
    songNumber: songNumber,
    progressBarState: { length: guessTime, played: 0 },
    onLastSong: songNumber === totalSongs,
    multipleChoiceNames: null,
  });
  if (extraGuessTime) {
    extraGuessTimer = setTimeout(() => {
      fireListener('extra guess time');
    }, guessTime * 1000);
  }
  endGuessTimer = setTimeout(() => {
    if (quiz.soloMode) {
      clearInterval(skipInterval);
      clearTimeout(endGuessTimer);
      clearTimeout(extraGuessTimer);
      endGuessPhase(songNumber);
    } else if (quiz.isHost) {
      cslMessage('§CSL15');
    }
  }, (guessTime + extraGuessTime) * 1000);
  if (quiz.soloMode) {
    skipInterval = setInterval(() => {
      if (quiz.skipController._toggled) {
        fireListener('quiz overlay message', 'Skipping to Answers');
        clearInterval(skipInterval);
        clearTimeout(endGuessTimer);
        clearTimeout(extraGuessTimer);
        setTimeout(
          () => {
            endGuessPhase(songNumber);
          },
          fastSkip ? 1000 : 3000
        );
      }
    }, 100);
  }
  setTimeout(() => {
    if (songNumber < totalSongs) {
      if (quiz.soloMode) {
        readySong(songNumber + 1);
        let nextSong = songList[songOrder[songNumber + 1]];
        fireListener('quiz next video info', {
          playLength: guessTime,
          playbackSpeed: 1,
          startPont: getStartPoint(),
          videoInfo: {
            id: null,
            videoMap: {
              catbox: createCatboxLinkObject(nextSong.audio, nextSong.video480, nextSong.video720),
            },
            videoVolumeMap: {
              catbox: {
                0: -20,
                480: -20,
                720: -20,
              },
            },
          },
        });
      } else {
        readySong(songNumber + 1);
        if (quiz.isHost) {
          let nextSong = songList[songOrder[songNumber + 1]];
          let message = `${songNumber + 1}§${getStartPoint()}§${nextSong.audio || ''}§${nextSong.video480 || ''}§${
            nextSong.video720 || ''
          }`;
          splitIntoChunks(btoa(encodeURIComponent(message)) + '$', 144).forEach((item, index) => {
            cslMessage('§CSL3' + base10to36(index % 36) + item);
          });
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
  fireListener('guess phase over');
  if (!quiz.soloMode && quiz.inQuiz && !quiz.isSpectator) {
    let answer = currentAnswers[quiz.ownGamePlayerId];
    if (answer) {
      splitIntoChunks(btoa(encodeURIComponent(answer)) + '$', 144).forEach((item, index) => {
        cslMessage('§CSL5' + base10to36(index % 36) + item);
      });
    }
  }
  answerTimer = setTimeout(
    () => {
      if (!quiz.cslActive || !quiz.inQuiz) return reset();
      cslState = 2;
      skipping = false;
      if (!quiz.soloMode) {
        for (let player of Object.values(quiz.players)) {
          currentAnswers[player.gamePlayerId] = answerChunks[player.gamePlayerId]
            ? answerChunks[player.gamePlayerId].decode()
            : '';
        }
      }
      for (let key of Object.keys(quiz.players)) {
        cslMultiplayer.voteSkip[key] = false;
      }
      let data = {
        answers: [],
        progressBarState: null,
      };
      for (let player of Object.values(quiz.players)) {
        data.answers.push({
          gamePlayerId: player.gamePlayerId,
          pose: 3,
          answer: currentAnswers[player.gamePlayerId] || '',
        });
      }
      fireListener('player answers', data);
      if (!quiz.soloMode && quiz.isHost) {
        let message = `${song.animeRomajiName || ''}\n${song.animeEnglishName || ''}\n${(song.altAnimeNames || []).join(
          '\t'
        )}\n${(song.altAnimeNamesAnswers || []).join('\t')}\n${song.songArtist || ''}\n${song.songName || ''}\n${
          song.songType || ''
        }\n${song.songTypeNumber || ''}\n${song.songDifficulty || ''}\n${song.animeType || ''}\n${
          song.animeVintage || ''
        }\n${song.annId || ''}\n${song.malId || ''}\n${song.kitsuId || ''}\n${song.aniListId || ''}\n${
          Array.isArray(song.animeTags) ? song.animeTags.join(',') : ''
        }\n${Array.isArray(song.animeGenre) ? song.animeGenre.join(',') : ''}\n${song.audio || ''}\n${
          song.video480 || ''
        }\n${song.video720 || ''}`;
        splitIntoChunks(btoa(encodeURIComponent(message)) + '$', 144).forEach((item, index) => {
          cslMessage('§CSL7' + base10to36(index % 36) + item);
        });
      }
      answerTimer = setTimeout(
        () => {
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
              players: [],
              songInfo: {
                animeNames: {
                  english: song.animeEnglishName,
                  romaji: song.animeRomajiName,
                },
                artist: song.songArtist,
                songName: song.songName,
                videoTargetMap: {
                  catbox: {
                    0: formatTargetUrl(song.audio),
                    480: formatTargetUrl(song.video480),
                    720: formatTargetUrl(song.video720),
                  },
                },
                type: song.songType,
                typeNumber: song.songTypeNumber,
                annId: song.annId,
                highRisk: 0,
                animeScore: null,
                animeType: song.animeType,
                vintage: song.animeVintage,
                animeDifficulty: song.songDifficulty,
                animeTags: song.animeTags,
                animeGenre: song.animeGenre,
                altAnimeNames: song.altAnimeNames,
                altAnimeNamesAnswers: song.altAnimeNamesAnswers,
                rebroadcast: song.rebroadcast,
                dub: song.dub,
                siteIds: {
                  annId: song.annId,
                  malId: song.malId,
                  kitsuId: song.kitsuId,
                  aniListId: song.aniListId,
                },
              },
              progressBarState: {
                length: 25,
                played: 0,
              },
              groupMap: createGroupSlotMap(Object.keys(quiz.players)),
              watched: false,
            };
            for (let player of Object.values(quiz.players)) {
              data.players.push({
                gamePlayerId: player.gamePlayerId,
                pose: pose[player.gamePlayerId],
                level: quiz.players[player.gamePlayerId].level,
                correct: correct[player.gamePlayerId],
                score: score[player.gamePlayerId],
                listStatus: null,
                showScore: null,
                position: Math.floor(player.gamePlayerId / 8) + 1,
                positionSlot: player.gamePlayerId % 8,
              });
            }
            fireListener('answer results', data);
          } else if (quiz.isHost) {
            let list = [];
            for (let id of Object.keys(correct)) {
              list.push(`${id},${correct[id] ? '1' : '0'},${pose[id]},${score[id]}`);
            }
            splitIntoChunks(btoa(encodeURIComponent(list.join('§'))) + '$', 144).forEach((item, index) => {
              cslMessage('§CSL6' + base10to36(index % 36) + item);
            });
          }
          setTimeout(
            () => {
              if (!quiz.cslActive || !quiz.inQuiz) return reset();
              if (quiz.soloMode) {
                skipInterval = setInterval(() => {
                  if (quiz.skipController._toggled) {
                    clearInterval(skipInterval);
                    endReplayPhase(songNumber);
                  }
                }, 100);
              }
            },
            fastSkip ? 1000 : 2000
          );
        },
        fastSkip ? 200 : 3000
      );
    },
    fastSkip ? 100 : 400
  );
}

// end replay phase
function endReplayPhase(songNumber) {
  if (!quiz.cslActive || !quiz.inQuiz) return reset();
  //console.log(`end replay phase (${songNumber})`);
  if (songNumber < totalSongs) {
    fireListener('quiz overlay message', 'Skipping to Next Song');
    setTimeout(
      () => {
        previousSongFinished = true;
      },
      fastSkip ? 1000 : 3000
    );
  } else {
    fireListener('quiz overlay message', 'Skipping to Final Standings');
    setTimeout(
      () => {
        let data = {
          resultStates: [],
        };
        /*"progressBarState": {
                "length": 26.484,
                "played": 6.484
            }*/
        let sortedScores = Array.from(new Set(Object.values(score))).sort((a, b) => b - a);
        for (let id of Object.keys(score)) {
          data.resultStates.push({
            gamePlayerId: parseInt(id),
            pose: 1,
            endPosition: sortedScores.indexOf(score[id]) + 1,
          });
        }
        fireListener('quiz end result', data);
      },
      fastSkip ? 2000 : 5000
    );
    setTimeout(
      () => {
        if (quiz.soloMode) {
          quizOver();
        } else if (quiz.isHost) {
          cslMessage('§CSL10');
        }
      },
      fastSkip ? 5000 : 12000
    );
  }
}

// fire all event listeners (including scripts)
function fireListener(type, data) {
  try {
    for (let listener of socket.listners[type]) {
      listener.fire(data);
    }
  } catch (error) {
    sendSystemMessage(`CSL Error: "${type}" listener failed`);
    console.error(error);
    console.log(type);
    console.log(data);
  }
}

// send csl chat message
function cslMessage(text) {
  if (!isRankedMode()) {
    socket.sendCommand({ type: 'lobby', command: 'game chat message', data: { msg: String(text), teamMessage: false } });
  }
}

// send a client side message to game chat
function sendSystemMessage(message) {
  if (gameChat.open) {
    setTimeout(() => {
      gameChat.systemMessage(String(message));
    }, 1);
  }
}

// parse message
function parseMessage(content, sender) {
  if (isRankedMode()) return;
  let player;
  if (lobby.inLobby) player = Object.values(lobby.players).find((x) => x._name === sender);
  else if (quiz.inQuiz) player = Object.values(quiz.players).find((x) => x._name === sender);
  let isHost = sender === cslMultiplayer.host;
  if (content.startsWith('§CSL0')) {
    //start quiz
    if (lobby.inLobby && sender === lobby.hostName && !quiz.cslActive) {
      let split = atob(content.slice(5)).split('§');
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
  } else if (quiz.cslActive && quiz.inQuiz && cslMultiplayer.host !== lobby.hostName) {
    sendSystemMessage('client out of sync, quitting CSL');
    quizOver();
  } else if (content === '§CSL10') {
    //return to lobby
    if (quiz.cslActive && quiz.inQuiz && (isHost || sender === lobby.hostName)) {
      quizOver();
    }
  } else if (content === '§CSL11') {
    //pause
    if (quiz.cslActive && isHost) {
      fireListener('quiz pause triggered', {
        playerName: sender,
      });
    }
  } else if (content === '§CSL12') {
    //unpause
    if (quiz.cslActive && isHost) {
      fireListener('quiz unpause triggered', {
        playerName: sender,
      });
    }
  } else if (content === '§CSL13') {
    //player answered
    if (quiz.cslActive && player) {
      fireListener('player answered', [player.gamePlayerId]);
    }
  } else if (content === '§CSL14') {
    //vote skip
    if (quiz.cslActive && quiz.isHost && player) {
      cslMultiplayer.voteSkip[player.gamePlayerId] = true;
      if (!skipping && checkVoteSkip()) {
        skipping = true;
        if (cslState === 1) {
          cslMessage('§CSL15');
        } else if (cslState === 2) {
          cslMessage('§CSL16');
        }
      }
    }
  } else if (content === '§CSL15') {
    //skip guessing phase
    if (quiz.cslActive && isHost) {
      fireListener('quiz overlay message', 'Skipping to Answers');
      clearInterval(skipInterval);
      clearTimeout(endGuessTimer);
      clearTimeout(extraGuessTimer);
      setTimeout(
        () => {
          endGuessPhase(currentSong);
        },
        fastSkip ? 1000 : 3000
      );
    }
  } else if (content === '§CSL16') {
    //skip replay phase
    if (quiz.cslActive && isHost) {
      endReplayPhase(currentSong);
    }
  } else if (content.startsWith('§CSL17')) {
    //player rejoin
    if (sender === lobby.hostName) {
      let name = atob(content.slice(6));
      if (name === selfName) {
        socket.sendCommand({ type: 'lobby', command: 'change to player' });
      } else if (quiz.cslActive && quiz.inQuiz) {
        let player = Object.values(quiz.players).find((p) => p._name === name);
        if (player) {
          fireListener('Rejoining Player', { name: name, gamePlayerId: player.gamePlayerId });
        }
      }
    }
  } else if (content === '§CSL21') {
    //has autocomplete
    cslMessage(`Autocomplete: ${autocomplete.length ? '✅' : '⛔'}`);
  } else if (content === '§CSL22') {
    //version
    cslMessage(`CSL version ${version}`);
  } else if (content.startsWith('§CSL3')) {
    //next song link
    if (quiz.cslActive && isHost) {
      //§CSL3#songNumber§startPoint§mp3§480§720
      nextSongChunk.append(content);
      if (nextSongChunk.isComplete) {
        let split = nextSongChunk.decode().split('§');
        nextSongChunk = new Chunk();
        if (split.length === 5) {
          if (!songLinkReceived[split[0]]) {
            songLinkReceived[split[0]] = true;
            fireListener('quiz next video info', {
              playLength: guessTime,
              playbackSpeed: 1,
              startPont: parseInt(split[1]),
              videoInfo: {
                id: null,
                videoMap: {
                  catbox: createCatboxLinkObject(split[2], split[3], split[4]),
                },
                videoVolumeMap: {
                  catbox: {
                    0: -20,
                    480: -20,
                    720: -20,
                  },
                },
              },
            });
            if (Object.keys(songLinkReceived).length === 1) {
              setTimeout(() => {
                fireListener('quiz ready', {
                  numberOfSongs: totalSongs,
                });
              }, 200);
              setTimeout(() => {
                fireListener('quiz waiting buffering', {
                  firstSong: true,
                });
              }, 300);
              setTimeout(() => {
                previousSongFinished = true;
                readySong(currentSong + 1);
              }, 400);
            }
          }
        } else {
          sendSystemMessage(`CSL Error: next song link decode failed`);
        }
      }
    }
  } else if (content.startsWith('§CSL4')) {
    //play song
    if (quiz.cslActive && isHost) {
      let number = parseInt(atob(content.slice(5)));
      //console.log("Play song: " + number);
      if (currentSong !== totalSongs) {
        playSong(number);
      }
    }
  } else if (content.startsWith('§CSL5')) {
    //player final answer
    if (quiz.cslActive && player) {
      if (!answerChunks[player.gamePlayerId]) answerChunks[player.gamePlayerId] = new Chunk();
      answerChunks[player.gamePlayerId].append(content);
    }
  } else if (content.startsWith('§CSL6')) {
    //answer results
    if (quiz.cslActive && isHost) {
      resultChunk.append(content);
      if (resultChunk.isComplete) {
        let split = resultChunk.decode().split('§');
        let data = {
          players: [],
          songInfo: {
            animeNames: {
              english: cslMultiplayer.songInfo.animeEnglishName,
              romaji: cslMultiplayer.songInfo.animeRomajiName,
            },
            artist: cslMultiplayer.songInfo.songArtist,
            songName: cslMultiplayer.songInfo.songName,
            videoTargetMap: {
              catbox: {
                0: formatTargetUrl(cslMultiplayer.songInfo.audio) || '',
                480: formatTargetUrl(cslMultiplayer.songInfo.video480) || '',
                720: formatTargetUrl(cslMultiplayer.songInfo.video720) || '',
              },
            },
            type: cslMultiplayer.songInfo.songType,
            typeNumber: cslMultiplayer.songInfo.songTypeNumber,
            annId: cslMultiplayer.songInfo.annId,
            highRisk: 0,
            animeScore: null,
            animeType: cslMultiplayer.songInfo.animeType,
            vintage: cslMultiplayer.songInfo.animeVintage,
            animeDifficulty: cslMultiplayer.songInfo.songDifficulty || 0,
            animeTags: cslMultiplayer.songInfo.animeTags || [],
            animeGenre: cslMultiplayer.songInfo.animeGenre || [],
            altAnimeNames: cslMultiplayer.songInfo.altAnimeNames || [],
            altAnimeNamesAnswers: cslMultiplayer.songInfo.altAnimeNamesAnswers || [],
            siteIds: {
              annId: cslMultiplayer.songInfo.annId,
              malId: cslMultiplayer.songInfo.malId,
              kitsuId: cslMultiplayer.songInfo.kitsuId,
              aniListId: cslMultiplayer.songInfo.aniListId,
            },
          },
          progressBarState: {
            length: 25,
            played: 0,
          },
          groupMap: createGroupSlotMap(Object.keys(quiz.players)),
          watched: false,
        };
        let decodedPlayers = [];
        for (p of split) {
          let playerSplit = p.split(',');
          decodedPlayers.push({
            id: parseInt(playerSplit[0]),
            correct: Boolean(parseInt(playerSplit[1])),
            pose: parseInt(playerSplit[2]),
            score: parseInt(playerSplit[3]),
          });
        }
        decodedPlayers.sort((a, b) => b.score - a.score);
        decodedPlayers.forEach((p, i) => {
          data.players.push({
            gamePlayerId: p.id,
            pose: p.pose,
            level: quiz.players[p.id].level,
            correct: p.correct,
            score: p.score,
            listStatus: null,
            showScore: null,
            position: Math.floor(i / 8) + 1,
            positionSlot: i % 8,
          });
        });
        //console.log(data.players);
        fireListener('answer results', data);
      }
    }
  } else if (content.startsWith('§CSL7')) {
    songInfoChunk.append(content);
    if (songInfoChunk.isComplete) {
      let split = preventCodeInjection(songInfoChunk.decode()).split('\n');
      cslMultiplayer.songInfo.animeRomajiName = split[0];
      cslMultiplayer.songInfo.animeEnglishName = split[1];
      cslMultiplayer.songInfo.altAnimeNames = split[2].split('\t').filter(Boolean);
      cslMultiplayer.songInfo.altAnimeNamesAnswers = split[3].split('\t').filter(Boolean);
      cslMultiplayer.songInfo.songArtist = split[4];
      cslMultiplayer.songInfo.songName = split[5];
      cslMultiplayer.songInfo.songType = parseInt(split[6]) || null;
      cslMultiplayer.songInfo.songTypeNumber = parseInt(split[7]) || null;
      cslMultiplayer.songInfo.songDifficulty = parseFloat(split[8]) || null;
      cslMultiplayer.songInfo.animeType = split[9];
      cslMultiplayer.songInfo.animeVintage = split[10];
      cslMultiplayer.songInfo.annId = parseInt(split[11]) || null;
      cslMultiplayer.songInfo.malId = parseInt(split[12]) || null;
      cslMultiplayer.songInfo.kitsuId = parseInt(split[13]) || null;
      cslMultiplayer.songInfo.aniListId = parseInt(split[14]) || null;
      cslMultiplayer.songInfo.animeTags = split[15].split(',');
      cslMultiplayer.songInfo.animeGenre = split[16].split(',');
      cslMultiplayer.songInfo.audio = split[17];
      cslMultiplayer.songInfo.video480 = split[18];
      cslMultiplayer.songInfo.video720 = split[19];
      console.log(split);
    }
  }
}

function checkVoteSkip() {
  let keys = Object.keys(cslMultiplayer.voteSkip).filter(
    (key) => quiz.players.hasOwnProperty(key) && !quiz.players[key].avatarDisabled
  );
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
    reviewSong(song, false);
    return false;
  }
  answer = answer.toLowerCase();
  let correctAnswers = [].concat(song.altAnimeNames || [], song.altAnimeNamesAnswers || []);
  for (let a1 of correctAnswers) {
    let a2 = replacedAnswers[a1];
    if (a2 && a2.toLowerCase() === answer) {
      reviewSong(song, true);
      return true;
    }
    if (a1.toLowerCase() === answer) {
      reviewSong(song, true);
      return true;
    }
  }
  reviewSong(song, false);
  return false;
}

// get start point value (0-100)
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
    if (tv && type === 'tv') return true;
    if (movie && type === 'movie') return true;
    if (ova && type === 'ova') return true;
    if (ona && type === 'ona') return true;
    if (special && type === 'special') return true;
    return false;
  } else {
    return tv && movie && ova && ona && special;
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
  cslMultiplayer = { host: '', songInfo: {}, voteSkip: {} };
  cslState = 0;
  currentSong = 0;
  currentAnswers = {};
  score = {};
  previousSongFinished = false;
  fastSkip = false;
  skipping = false;
  songLinkReceived = {};
  answerChunks = {};
  songInfoChunk = new Chunk();
  nextSongChunk = new Chunk();
}

// end quiz and set up lobby
function quizOver() {
  reset();
  let data = {
    spectators: [],
    inLobby: true,
    settings: hostModal.getSettings(),
    soloMode: quiz.soloMode,
    inQueue: [],
    hostName: lobby.hostName,
    gameId: lobby.gameId,
    players: [],
    numberOfTeams: 0,
    teamFullMap: {},
  };
  for (let player of Object.values(quiz.players)) {
    if (gameChat.spectators.some((spectator) => spectator.name === player._name)) {
      data.spectators.push({
        name: player._name,
        gamePlayerId: null,
      });
    } else if (!player.avatarDisabled) {
      data.players.push({
        name: player._name,
        gamePlayerId: player.gamePlayerId,
        level: player.level,
        avatar: player.avatarInfo,
        ready: true,
        inGame: true,
        teamNumber: null,
        multipleChoice: false,
      });
    }
  }
  lobby.setupLobby(
    data,
    gameChat.spectators.some((spectator) => spectator.name === selfName)
  );
  viewChanger.changeView('lobby', { supressServerMsg: true, keepChatOpen: true });
}

function openStatsModal() {
  console.log('Tried to open Stats Modal');
  console.log(statsModal);
  if (!statsModal) {
    createStatsModal();
  }
  updateStatsContent();
  statsModal.modal('show');
}

function createStatsModal() {
  console.log('Creating Stats Modal');
  statsModal = $(`
    <div class="modal fade" id="statsModal" tabindex="-1" role="dialog">
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title">Song Statistics</h4>
          </div>
          <div class="modal-body">
            <!-- Content will be dynamically inserted here -->
          </div>
        </div>
      </div>
    </div>
  `);
  $('#gameContainer').append(statsModal);
}

function updateStatsContent() {
  console.log('Updating Stats Content');
  const reviewData = JSON.parse(localStorage.getItem(`spacedRepetitionData_${currentProfile}`)) || {};
  const $modalBody = $('#statsModal .modal-body');
  $modalBody.empty();

  // Overall statistics
  const totalSongs = Object.keys(reviewData).length;
  const correctSongs = Object.values(reviewData).filter((song) => song.isLastTryCorrect).length;
  const incorrectSongs = totalSongs - correctSongs;

  // Most difficult songs
  const difficultSongs = Object.entries(reviewData)
    .sort((a, b) => b[1].failureCount - a[1].failureCount)
    .slice(0, 10);

  // Recently reviewed songs
  const recentSongs = Object.entries(reviewData)
    .sort((a, b) => b[1].lastReviewDate - a[1].lastReviewDate)
    .slice(0, 10);

  // E-Factor distribution
  const efactorRanges = {
    '1.0 - 1.5': 0,
    '1.5 - 2.0': 0,
    '2.0 - 2.5': 0,
    '2.5 - 3.0': 0,
    '3.0+': 0,
  };

  Object.values(reviewData).forEach((song) => {
    if (song.efactor < 1.5) efactorRanges['1.0 - 1.5']++;
    else if (song.efactor < 2.0) efactorRanges['1.5 - 2.0']++;
    else if (song.efactor < 2.5) efactorRanges['2.0 - 2.5']++;
    else if (song.efactor < 3.0) efactorRanges['2.5 - 3.0']++;
    else efactorRanges['3.0+']++;
  });

  $modalBody.append(`
      <div class="stats-section">
        <h3>Overall Statistics</h3>
        <p>Total Songs: ${totalSongs}</p>
        <p>Correct Guesses: ${correctSongs}</p>
        <p>Incorrect Guesses: ${incorrectSongs}</p>
        <p>Accuracy: ${((correctSongs / totalSongs) * 100).toFixed(2)}%</p>
      </div>
    `);

  $modalBody.append(`
      <div class="stats-section">
        <h3>E-Factor Distribution</h3>
        <h5>Higher means better recognized</h5>
        <table class="stats-table">
          <tr>
            <th>E-Factor Range</th>
            <th>Number of Songs</th>
          </tr>
          ${Object.entries(efactorRanges)
            .map(
              ([range, count]) => `
            <tr>
              <td>${range}</td>
              <td>${count}</td>
            </tr>
          `
            )
            .join('')}
        </table>
      </div>
    `);

  $modalBody.append(`
    <div class="stats-section">
      <h3>Most Difficult Songs</h3>
      <table class="stats-table">
        <tr>
          <th>Song</th>
          <th>Failures</th>
          <th>Successes</th>
          <th>Last Correct</th>
        </tr>
        ${difficultSongs
          .map(
            ([song, data]) => `
          <tr>
            <td>${song}</td>
            <td>${data.failureCount}</td>
            <td>${data.successCount}</td>
            <td>${data.isLastTryCorrect ? 'Yes' : 'No'}</td>
          </tr>
        `
          )
          .join('')}
      </table>
    </div>
  `);

  $modalBody.append(`
    <div class="stats-section">
      <h3>Recently Reviewed Songs</h3>
      <table class="stats-table">
        <tr>
          <th>Song</th>
          <th>Last Review Date</th>
          <th>Result</th>
        </tr>
        ${recentSongs
          .map(
            ([song, data]) => `
          <tr>
            <td>${song}</td>
            <td>${new Date(data.lastReviewDate).toLocaleString()}</td>
            <td>${data.isLastTryCorrect ? 'Correct' : 'Incorrect'}</td>
          </tr>
        `
          )
          .join('')}
      </table>
    </div>
  `);
}

// open custom song list settings modal
function openSettingsModal() {
  if (lobby.inLobby) {
    if (autocomplete.length) {
      $('#cslgAutocompleteButton').removeClass('btn-danger').addClass('btn-success disabled');
    }
    $('#cslgSettingsModal').modal('show');
  }
}

// when you click the go button
function anisongdbDataSearch() {
  let mode = $('#cslgAnisongdbModeSelect').val().toLowerCase();
  let query = $('#cslgAnisongdbQueryInput').val();
  let ops = $('#cslgAnisongdbOPCheckbox').prop('checked');
  let eds = $('#cslgAnisongdbEDCheckbox').prop('checked');
  let ins = $('#cslgAnisongdbINCheckbox').prop('checked');
  let partial = $('#cslgAnisongdbPartialCheckbox').prop('checked');
  let ignoreDuplicates = $('#cslgAnisongdbIgnoreDuplicatesCheckbox').prop('checked');
  let arrangement = $('#cslgAnisongdbArrangementCheckbox').prop('checked');
  let maxOtherPeople = parseInt($('#cslgAnisongdbMaxOtherPeopleInput').val());
  let minGroupMembers = parseInt($('#cslgAnisongdbMinGroupMembersInput').val());
  if (query && !isNaN(maxOtherPeople) && !isNaN(minGroupMembers)) {
    getAnisongdbData(mode, query, ops, eds, ins, partial, ignoreDuplicates, arrangement, maxOtherPeople, minGroupMembers);
  }
}

// send anisongdb request
function getAnisongdbData(
  mode,
  query,
  ops,
  eds,
  ins,
  partial,
  ignoreDuplicates,
  arrangement,
  maxOtherPeople,
  minGroupMembers
) {
  $('#cslgSongListCount').text('Loading...');
  $('#cslgSongListTable tbody').empty();
  let url, data;
  let json = {
    and_logic: false,
    ignore_duplicate: ignoreDuplicates,
    opening_filter: ops,
    ending_filter: eds,
    insert_filter: ins,
  };
  if (mode === 'anime') {
    url = 'https://anisongdb.com/api/search_request';
    json.anime_search_filter = {
      search: query,
      partial_match: partial,
    };
  } else if (mode === 'artist') {
    url = 'https://anisongdb.com/api/search_request';
    json.artist_search_filter = {
      search: query,
      partial_match: partial,
      group_granularity: minGroupMembers,
      max_other_artist: maxOtherPeople,
    };
  } else if (mode === 'song') {
    url = 'https://anisongdb.com/api/search_request';
    json.song_name_search_filter = {
      search: query,
      partial_match: partial,
    };
  } else if (mode === 'composer') {
    url = 'https://anisongdb.com/api/search_request';
    json.composer_search_filter = {
      search: query,
      partial_match: partial,
      arrangement: arrangement,
    };
  } else if (mode === 'season') {
    query = query.trim();
    query = query.charAt(0).toUpperCase() + query.slice(1).toLowerCase();
    url = `https://anisongdb.com/api/filter_season?${new URLSearchParams({ season: query })}`;
  } else if (mode === 'ann id') {
    url = 'https://anisongdb.com/api/annId_request';
    json.annId = parseInt(query);
  } else if (mode === 'mal id') {
    url = 'https://anisongdb.com/api/malIDs_request';
    json.malIds = query
      .split(/[, ]+/)
      .map((n) => parseInt(n))
      .filter((n) => !isNaN(n));
  }
  if (mode === 'season') {
    data = {
      method: 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    };
  } else {
    data = {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    };
  }
  fetch(url, data)
    .then((res) => res.json())
    .then((json) => {
      handleData(json);
      songList = songList.filter((song) => songTypeFilter(song, ops, eds, ins));
      setSongListTableSort();
      if (!Array.isArray(json)) {
        $('#cslgSongListCount').text('Songs: 0');
        $('#cslgMergeCurrentCount').text('Current song list: 0 songs');
        $('#cslgSongListTable tbody').empty();
        $('#cslgSongListWarning').text(JSON.stringify(json));
      } else if (
        songList.length === 0 &&
        (ranked.currentState === ranked.RANKED_STATE_IDS.RUNNING ||
          ranked.currentState === ranked.RANKED_STATE_IDS.CHAMP_RUNNING)
      ) {
        $('#cslgSongListCount').text('Songs: 0');
        $('#cslgMergeCurrentCount').text('Current song list: 0 songs');
        $('#cslgSongListTable tbody').empty();
        $('#cslgSongListWarning').text('AnisongDB is not available during ranked');
      } else {
        createSongListTable();
      }
      createAnswerTable();
    })
    .catch((res) => {
      songList = [];
      setSongListTableSort();
      $('#cslgSongListCount').text('Songs: 0');
      $('#cslgMergeCurrentCount').text('Current song list: 0 songs');
      $('#cslgSongListTable tbody').empty();
      $('#cslgSongListWarning').text(res.toString());
    });
}

function handleData(data) {
  songList = [];
  if (!data) return;
  // anisongdb structure
  if (Array.isArray(data) && data.length && data[0].animeJPName) {
    data = data.filter((song) => song.audio || song.MQ || song.HQ);
    for (let song of data) {
      songList.push({
        animeRomajiName: song.animeJPName,
        animeEnglishName: song.animeENName,
        altAnimeNames: [].concat(song.animeJPName, song.animeENName, song.animeAltName || []),
        altAnimeNamesAnswers: [],
        songArtist: song.songArtist,
        songName: song.songName,
        songType: Object({ O: 1, E: 2, I: 3 })[song.songType[0]],
        songTypeNumber: song.songType[0] === 'I' ? null : parseInt(song.songType.split(' ')[1]),
        songDifficulty: song.songDifficulty,
        animeType: song.animeType,
        animeVintage: song.animeVintage,
        annId: song.annId,
        malId: song.linked_ids?.myanimelist,
        kitsuId: song.linked_ids?.kitsu,
        aniListId: song.linked_ids?.anilist,
        animeTags: [],
        animeGenre: [],
        rebroadcast: null,
        dub: null,
        startPoint: null,
        audio: song.audio,
        video480: song.MQ,
        video720: song.HQ,
        correctGuess: true,
        incorrectGuess: true,
      });
    }
    for (let song of songList) {
      let otherAnswers = new Set();
      for (let s of songList) {
        if (s.songName === song.songName && s.songArtist === song.songArtist) {
          s.altAnimeNames.forEach((x) => otherAnswers.add(x));
        }
      }
      song.altAnimeNamesAnswers = Array.from(otherAnswers).filter((x) => !song.altAnimeNames.includes(x));
    }
  }
  // official amq song export structure
  else if (typeof data === 'object' && data.roomName && data.startTime && data.songs) {
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
        rebroadcast: song.songInfo.rebroadcast || null,
        dub: song.songInfo.dub || null,
        startPoint: song.startPoint,
        audio: String(song.videoUrl).endsWith('.mp3') ? song.videoUrl : null,
        video480: null,
        video720: String(song.videoUrl).endsWith('.webm') ? song.videoUrl : null,
        correctGuess: song.correctGuess,
        incorrectGuess: song.wrongGuess,
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
        songTypeNumber: song.type[0] === 'I' ? null : parseInt(song.type.split(' ')[1]),
        songDifficulty: parseFloat(song.difficulty),
        animeType: song.animeType,
        animeVintage: song.vintage,
        annId: song.siteIds.annId,
        malId: song.siteIds.malId,
        kitsuId: song.siteIds.kitsuId,
        aniListId: song.siteIds.aniListId,
        animeTags: song.tags,
        animeGenre: song.genre,
        rebroadcast: null,
        dub: null,
        startPoint: song.startSample,
        audio: song.urls?.catbox?.[0] ?? song.urls?.openingsmoe?.[0] ?? null,
        video480: song.urls?.catbox?.[480] ?? song.urls?.openingsmoe?.[480] ?? null,
        video720: song.urls?.catbox?.[720] ?? song.urls?.openingsmoe?.[720] ?? null,
        correctGuess: song.correct,
        incorrectGuess: !song.correct,
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
        songTypeNumber: song.type[0] === 'I' ? null : parseInt(song.type.split(' ')[1]),
        songDifficulty: song.songDifficulty,
        animeType: null,
        animeVintage: song.vintage,
        annId: song.annId,
        malId: song.malId,
        kitsuId: song.kitsuId,
        aniListId: song.aniListId,
        animeTags: [],
        animeGenre: [],
        rebroadcast: null,
        dub: null,
        startPoint: null,
        audio: song.LinkMp3,
        video480: null,
        video720: song.LinkVideo,
        correctGuess: true,
        incorrectGuess: true,
      });
    }
  }
  // kempanator answer stats script export structure
  else if (typeof data === 'object' && data.songHistory && data.playerInfo) {
    for (let song of Object.values(data.songHistory)) {
      songList.push({
        animeRomajiName: song.animeRomajiName,
        animeEnglishName: song.animeEnglishName,
        altAnimeNames: song.altAnimeNames || [],
        altAnimeNamesAnswers: song.altAnimeNamesAnswers || [],
        songArtist: song.songArtist,
        songName: song.songName,
        songType: song.songType,
        songTypeNumber: song.songTypeNumber,
        songDifficulty: song.songDifficulty,
        animeType: song.animeType,
        animeVintage: song.animeVintage,
        annId: song.annId,
        malId: song.malId,
        kitsuId: song.kitsuId,
        aniListId: song.aniListId,
        animeTags: song.animeTags || [],
        animeGenre: song.animeGenre || [],
        rebroadcast: song.rebroadcast || null,
        dub: song.dub || null,
        startPoint: null,
        audio: song.audio,
        video480: song.video480,
        video720: song.video720,
        correctGuess: true,
        incorrectGuess: true,
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
  $('#cslgSongListCount').text('Songs: ' + songList.length);
  $('#cslgMergeCurrentCount').text(`Current song list: ${songList.length} song${songList.length === 1 ? '' : 's'}`);
  $('#cslgSongListWarning').text('');
  let $thead = $('#cslgSongListTable thead');
  let $tbody = $('#cslgSongListTable tbody');
  $thead.empty();
  $tbody.empty();
  if (songListTableSort[0] === 1) {
    //song name ascending
    songList.sort((a, b) => (a.songName || '').localeCompare(b.songName || ''));
  } else if (songListTableSort[0] === 2) {
    //song name descending
    songList.sort((a, b) => (b.songName || '').localeCompare(a.songName || ''));
  } else if (songListTableSort[1] === 1) {
    //artist ascending
    songList.sort((a, b) => (a.songArtist || '').localeCompare(b.songArtist || ''));
  } else if (songListTableSort[1] === 2) {
    //artist descending
    songList.sort((a, b) => (b.songArtist || '').localeCompare(a.songArtist || ''));
  } else if (songListTableSort[2] === 1) {
    //difficulty ascending
    songList.sort((a, b) => a.songDifficulty - b.songDifficulty);
  } else if (songListTableSort[2] === 2) {
    //difficulty descending
    songList.sort((a, b) => b.songDifficulty - a.songDifficulty);
  } else if (songListTableSort[3] === 1) {
    //anime ascending
    options.useRomajiNames
      ? songList.sort((a, b) => (a.animeRomajiName || '').localeCompare(b.animeRomajiName || ''))
      : songList.sort((a, b) => (a.animeEnglishName || '').localeCompare(b.animeEnglishName || ''));
  } else if (songListTableSort[3] === 2) {
    //anime descending
    options.useRomajiNames
      ? songList.sort((a, b) => (b.animeRomajiName || '').localeCompare(a.animeRomajiName || ''))
      : songList.sort((a, b) => (b.animeEnglishName || '').localeCompare(a.animeEnglishName || ''));
  } else if (songListTableSort[4] === 1) {
    //song type ascending
    songList.sort(
      (a, b) => songTypeSortValue(a.songType, a.songTypeNumber) - songTypeSortValue(b.songType, b.songTypeNumber)
    );
  } else if (songListTableSort[4] === 2) {
    //song type descending
    songList.sort(
      (a, b) => songTypeSortValue(b.songType, b.songTypeNumber) - songTypeSortValue(a.songType, a.songTypeNumber)
    );
  } else if (songListTableSort[5] === 1) {
    //vintage ascending
    songList.sort((a, b) => vintageSortValue(a.animeVintage) - vintageSortValue(b.animeVintage));
  } else if (songListTableSort[5] === 2) {
    //vintage descending
    songList.sort((a, b) => vintageSortValue(b.animeVintage) - vintageSortValue(a.animeVintage));
  } else if (songListTableSort[6] === 1) {
    //mp3 link ascending
    songList.sort((a, b) => (a.audio || '').localeCompare(b.audio || ''));
  } else if (songListTableSort[6] === 2) {
    //mp3 link descending
    songList.sort((a, b) => (b.audio || '').localeCompare(a.audio || ''));
  } else if (songListTableSort[7] === 1) {
    //480 link ascending
    songList.sort((a, b) => (a.video480 || '').localeCompare(b.video480 || ''));
  } else if (songListTableSort[7] === 2) {
    //480 link descending
    songList.sort((a, b) => (b.video480 || '').localeCompare(a.video480 || ''));
  } else if (songListTableSort[8] === 1) {
    //720 link ascending
    songList.sort((a, b) => (a.video720 || '').localeCompare(b.video720 || ''));
  } else if (songListTableSort[8] === 2) {
    //720 link descending
    songList.sort((a, b) => (b.video720 || '').localeCompare(a.video720 || ''));
  }
  if (songListTableMode === 0) {
    let $row = $('<tr></tr>');
    $row.append($(`<th class="number">#</th>`));
    $row.append(
      $(`<th class="song clickAble">Song</th>`).click(() => {
        setSongListTableSort(0);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="artist clickAble">Artist</th>`).click(() => {
        setSongListTableSort(1);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="difficulty clickAble">Dif</th>`).click(() => {
        setSongListTableSort(2);
        createSongListTable();
      })
    );
    $row.append($(`<th class="action"></th>`));
    $thead.append($row);
    songList.forEach((song, i) => {
      let $row = $('<tr></tr>');
      $row.append(
        $('<td></td>')
          .addClass('number')
          .text(i + 1)
      );
      $row.append($('<td></td>').addClass('song').text(song.songName));
      $row.append($('<td></td>').addClass('artist').text(song.songArtist));
      $row.append(
        $('<td></td>')
          .addClass('difficulty')
          .text(Number.isFinite(song.songDifficulty) ? Math.floor(song.songDifficulty) : '')
      );
      $row.append(
        $('<td></td>')
          .addClass('action')
          .append(
            `<i class="fa fa-plus clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`
          )
      );
      $tbody.append($row);
    });
  } else if (songListTableMode === 1) {
    let $row = $('<tr></tr>');
    $row.append($(`<th class="number">#</th>`));
    $row.append(
      $(`<th class="anime clickAble">Anime</th>`).click(() => {
        setSongListTableSort(3);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="songType clickAble">Type</th>`).click(() => {
        setSongListTableSort(4);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="vintage clickAble">Vintage</th>`).click(() => {
        setSongListTableSort(5);
        createSongListTable();
      })
    );
    $row.append($(`<th class="action"></th>`));
    $thead.append($row);
    songList.forEach((song, i) => {
      let $row = $('<tr></tr>');
      $row.append(
        $('<td></td>')
          .addClass('number')
          .text(i + 1)
      );
      $row.append(
        $('<td></td>')
          .addClass('anime')
          .text(options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName)
      );
      $row.append($('<td></td>').addClass('songType').text(songTypeText(song.songType, song.songTypeNumber)));
      $row.append($('<td></td>').addClass('vintage').text(song.animeVintage));
      $row.append(
        $('<td></td>')
          .addClass('action')
          .append(
            `<i class="fa fa-plus clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`
          )
      );
      $tbody.append($row);
    });
  } else if (songListTableMode === 2) {
    let $row = $('<tr></tr>');
    $row.append($(`<th class="number">#</th>`));
    $row.append(
      $(`<th class="link clickAble">MP3</th>`).click(() => {
        setSongListTableSort(6);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="link clickAble">480</th>`).click(() => {
        setSongListTableSort(7);
        createSongListTable();
      })
    );
    $row.append(
      $(`<th class="link clickAble">720</th>`).click(() => {
        setSongListTableSort(8);
        createSongListTable();
      })
    );
    $row.append($(`<th class="action"></th>`));
    $thead.append($row);
    songList.forEach((song, i) => {
      let $row = $('<tr></tr>');
      $row.append(
        $('<td></td>')
          .addClass('number')
          .text(i + 1)
      );
      $row.append($('<td></td>').addClass('link').append(createLinkElement(song.audio)));
      $row.append($('<td></td>').addClass('link').append(createLinkElement(song.video480)));
      $row.append($('<td></td>').addClass('link').append(createLinkElement(song.video720)));
      $row.append(
        $('<td></td>')
          .addClass('action')
          .append(
            `<i class="fa fa-plus clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`
          )
      );
      $tbody.append($row);
    });
  }
}

// create merged song list table
function createMergedSongListTable() {
  $('#cslgMergedSongListCount').text('Merged: ' + mergedSongList.length);
  $('#cslgMergeTotalCount').text(`Merged song list: ${mergedSongList.length} song${mergedSongList.length === 1 ? '' : 's'}`);
  let $tbody = $('#cslgMergedSongListTable tbody');
  $tbody.empty();
  mergedSongList.forEach((song, i) => {
    let $row = $('<tr></tr>');
    $row.append(
      $('<td></td>')
        .addClass('number')
        .text(i + 1)
    );
    $row.append(
      $('<td></td>')
        .addClass('anime')
        .text(options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName)
    );
    $row.append($('<td></td>').addClass('songType').text(songTypeText(song.songType, song.songTypeNumber)));
    $row.append(
      $('<td></td>')
        .addClass('action')
        .append(
          `<i class="fa fa-chevron-up clickAble" aria-hidden="true"></i><i class="fa fa-chevron-down clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`
        )
    );
    $tbody.append($row);
  });
}

// create answer table
function createAnswerTable() {
  let $tbody = $('#cslgAnswerTable tbody');
  $tbody.empty();
  if (songList.length === 0) {
    $('#cslgAnswerText').text('No list loaded');
  } else if (autocomplete.length === 0) {
    $('#cslgAnswerText').text('Fetch autocomplete first');
  } else {
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
    $('#cslgAnswerText').text(`Found ${missingAnimeList.length} anime missing from AMQ's autocomplete`);
    for (let anime of missingAnimeList) {
      let $row = $('<tr></tr>');
      $row.append($('<td></td>').addClass('oldName').text(anime));
      $row.append(
        $('<td></td>')
          .addClass('newName')
          .text(replacedAnswers[anime] || '')
      );
      $row.append($('<td></td>').addClass('edit').append(`<i class="fa fa-pencil clickAble" aria-hidden="true"></i>`));
      $tbody.append($row);
    }
  }
}

// create link element for song list table
function createLinkElement(link) {
  if (!link) return '';
  let $a = $('<a></a>');
  if (link.startsWith('http')) {
    $a.text(link.includes('catbox') ? link.split('/').slice(-1)[0] : link);
    $a.attr('href', link);
  } else if (/^\w+\.\w{3,4}$/.test(link)) {
    $a.text(link);
    if (fileHostOverride) {
      $a.attr('href', 'https://' + catboxHostDict[fileHostOverride] + '/' + link);
    } else {
      $a.attr('href', 'https://ladist1.catbox.video/' + link);
    }
  }
  $a.attr('target', '_blank');
  return $a;
}

// reset all values in table sort options and toggle specified index
function setSongListTableSort(index) {
  if (Number.isInteger(index)) {
    let value = songListTableSort[index];
    songListTableSort.forEach((x, i) => {
      songListTableSort[i] = 0;
    });
    songListTableSort[index] = value === 1 ? 2 : 1;
  } else {
    songListTableSort.forEach((x, i) => {
      songListTableSort[i] = 0;
    });
  }
}

// get sorting value for anime vintage
function vintageSortValue(vintage) {
  if (!vintage) return 0;
  let split = vintage.split(' ');
  let year = parseInt(split[1]);
  if (isNaN(year)) return 0;
  let season = Object({ Winter: 0.1, Spring: 0.2, Summer: 0.3, Fall: 0.4 })[split[0]];
  if (!season) return 0;
  return year + season;
}

// get sorting value for song type
function songTypeSortValue(type, typeNumber) {
  return (type || 0) * 1000 + (typeNumber || 0);
}

// reset all tabs
function tabReset() {
  $('#cslgSongListTab').removeClass('selected');
  $('#cslgQuizSettingsTab').removeClass('selected');
  $('#cslgAnswerTab').removeClass('selected');
  $('#cslgMergeTab').removeClass('selected');
  $('#cslgHotkeyTab').removeClass('selected');
  $('#cslgListImportTab').removeClass('selected');
  $('#cslgInfoTab').removeClass('selected');
  $('#cslgSongListContainer').hide();
  $('#cslgQuizSettingsContainer').hide();
  $('#cslgAnswerContainer').hide();
  $('#cslgMergeContainer').hide();
  $('#cslgHotkeyContainer').hide();
  $('#cslgListImportContainer').hide();
  $('#cslgInfoContainer').hide();
}

// convert full url to target data
function formatTargetUrl(url) {
  if (url && url.startsWith('http')) {
    return url.split('/').slice(-1)[0];
  }
  return url;
}

// translate type and typeNumber ids to shortened type text
function songTypeText(type, typeNumber) {
  if (type === 1) return 'OP' + typeNumber;
  if (type === 2) return 'ED' + typeNumber;
  if (type === 3) return 'IN';
  return '';
}

// input 3 links, return formatted catbox link object
function createCatboxLinkObject(audio, video480, video720) {
  let links = {};
  if (fileHostOverride) {
    if (audio) links['0'] = 'https://' + catboxHostDict[fileHostOverride] + '/' + audio.split('/').slice(-1)[0];
    if (video480) links['480'] = 'https://' + catboxHostDict[fileHostOverride] + '/' + video480.split('/').slice(-1)[0];
    if (video720) links['720'] = 'https://' + catboxHostDict[fileHostOverride] + '/' + video720.split('/').slice(-1)[0];
  } else {
    if (audio) links['0'] = audio;
    if (video480) links['480'] = video480;
    if (video720) links['720'] = video720;
  }
  return links;
}

// create hotkey element
function createHotkeyElement(title, key, selectID, inputID) {
  let $select = $(`<select id="${selectID}" style="padding: 3px 0;"></select>`)
    .append(`<option>ALT</option>`)
    .append(`<option>CTRL</option>`)
    .append(`<option>CTRL ALT</option>`)
    .append(`<option>-</option>`);
  let $input = $(`<input id="${inputID}" type="text" maxlength="1" style="width: 40px;">`).val(hotKeys[key].key);
  $select.on('change', () => {
    hotKeys[key] = {
      altKey: $select.val().includes('ALT'),
      ctrlKey: $select.val().includes('CTRL'),
      key: $input.val().toLowerCase(),
    };
    saveSettings();
  });
  $input.on('change', () => {
    hotKeys[key] = {
      altKey: $select.val().includes('ALT'),
      ctrlKey: $select.val().includes('CTRL'),
      key: $input.val().toLowerCase(),
    };
    saveSettings();
  });
  if (hotKeys[key].altKey && hotKeys[key].ctrlKey) $select.val('CTRL ALT');
  else if (hotKeys[key].altKey) $select.val('ALT');
  else if (hotKeys[key].ctrlKey) $select.val('CTRL');
  else $select.val('-');
  $('#cslgHotkeyTable tbody').append(
    $(`<tr></tr>`)
      .append($(`<td></td>`).text(title))
      .append($(`<td></td>`).append($select))
      .append($(`<td></td>`).append($input))
  );
}

// test hotkey
function testHotkey(action, key, altKey, ctrlKey) {
  let hotkey = hotKeys[action];
  return key === hotkey.key && altKey === hotkey.altKey && ctrlKey === hotkey.ctrlKey;
}

// return true if you are in a ranked lobby or quiz
function isRankedMode() {
  return (lobby.inLobby && lobby.settings.gameMode === 'Ranked') || (quiz.inQuiz && quiz.gameMode === 'Ranked');
}

// safeguard against people putting valid javascript in the song json
function preventCodeInjection(text) {
  if (/<script/i.test(text)) {
    cslMessage('⚠️ code injection attempt detected, ending quiz');
    quizOver();
    console.warn('CSL CODE INJECTION ATTEMPT:\n' + text);
    return '';
  }
  return text;
}

// split a string into chunks
function splitIntoChunks(str, chunkSize) {
  let chunks = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.slice(i, i + chunkSize));
  }
  return chunks;
}

// convert base 10 number to base 36
function base10to36(number) {
  if (number === 0) return 0;
  let digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  while (number > 0) {
    let remainder = number % 36;
    result = digits[remainder] + result;
    number = Math.floor(number / 36);
  }
  return result;
}

// convert base 36 number to base 10
function base36to10(number) {
  number = String(number);
  let digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = digits.indexOf(number[i]);
    if (digit === -1) return null;
    result = result * 36 + digit;
  }
  return result;
}

// manage data for split messages
class Chunk {
  constructor() {
    this.chunkMap = {};
    this.isComplete = false;
  }
  append(text) {
    let regex = /^§CSL\w(\w)/.exec(text);
    if (regex) {
      let index = base36to10(regex[1]);
      if (text.endsWith('$')) {
        this.chunkMap[index] = text.slice(6, -1);
        this.isComplete = true;
      } else {
        this.chunkMap[index] = text.slice(6);
      }
    } else {
      console.log('CSL ERROR: bad chunk\n' + text);
    }
  }
  decode() {
    if (this.isComplete) {
      let result = Object.values(this.chunkMap).reduce((a, b) => a + b);
      try {
        return decodeURIComponent(atob(result));
      } catch {
        sendSystemMessage('CSL chunk decode error');
        console.log('CSL ERROR: could not decode\n' + result);
      }
    } else {
      sendSystemMessage('CSL incomplete chunk');
      console.log('CSL ERROR: incomplete chunk\n', this.chunkMap);
    }
    return '';
  }
}

// input myanimelist username, return list of mal ids
async function getMalIdsFromMyanimelist(username) {
  let malIds = [];
  let statuses = [];
  if ($('#cslgListImportWatchingCheckbox').prop('checked')) {
    statuses.push('watching');
  }
  if ($('#cslgListImportCompletedCheckbox').prop('checked')) {
    statuses.push('completed');
  }
  if ($('#cslgListImportHoldCheckbox').prop('checked')) {
    statuses.push('on_hold');
  }
  if ($('#cslgListImportDroppedCheckbox').prop('checked')) {
    statuses.push('dropped');
  }
  if ($('#cslgListImportPlanningCheckbox').prop('checked')) {
    statuses.push('plan_to_watch');
  }
  for (let status of statuses) {
    $('#cslgListImportText').text(`Retrieving Myanimelist: ${status}`);
    let nextPage = `https://api.myanimelist.net/v2/users/${username}/animelist?offset=0&limit=1000&nsfw=true&status=${status}`;
    while (nextPage) {
      let result = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: nextPage,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-MAL-CLIENT-ID': malClientId },
          onload: (res) => resolve(JSON.parse(res.response)),
          onerror: (res) => reject(res),
        });
      });
      if (result.error) {
        nextPage = false;
        $('#cslgListImportText').text(`MAL API Error: ${result.error}`);
      } else {
        for (let anime of result.data) {
          malIds.push(anime.node.id);
        }
        nextPage = result.paging.next;
      }
    }
  }
  return malIds;
}

// input anilist username, return list of mal ids
async function getMalIdsFromAnilist(username) {
  let pageNumber = 1;
  let malIds = [];
  let statuses = [];
  if ($('#cslgListImportWatchingCheckbox').prop('checked')) {
    statuses.push('CURRENT');
  }
  if ($('#cslgListImportCompletedCheckbox').prop('checked')) {
    statuses.push('COMPLETED');
  }
  if ($('#cslgListImportHoldCheckbox').prop('checked')) {
    statuses.push('PAUSED');
  }
  if ($('#cslgListImportDroppedCheckbox').prop('checked')) {
    statuses.push('DROPPED');
  }
  if ($('#cslgListImportPlanningCheckbox').prop('checked')) {
    statuses.push('PLANNING');
  }
  $('#cslgListImportText').text(`Retrieving Anilist: ${statuses}`);
  let hasNextPage = true;
  while (hasNextPage) {
    let data = await getAnilistData(username, statuses, pageNumber);
    if (data) {
      for (let item of data.mediaList) {
        if (item.media.idMal) {
          malIds.push(item.media.idMal);
        }
      }
      if (data.pageInfo.hasNextPage) {
        pageNumber += 1;
      } else {
        hasNextPage = false;
      }
    } else {
      $('#cslgListImportText').text('Anilist API Error');
      hasNextPage = false;
    }
  }
  return malIds;
}

// input username, status, and page number
function getAnilistData(username, statuses, pageNumber) {
  let query = `
        query {
            Page (page: ${pageNumber}, perPage: 50) {
                pageInfo {
                    currentPage
                    hasNextPage
                }
                mediaList (userName: "${username}", type: ANIME, status_in: [${statuses}]) {
                    status
                    media {
                        id
                        idMal
                    }
                }
            }
        }
    `;
  console.log(query)
  let data = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: query }),
  };
  return fetch('https://graphql.anilist.co', data)
    .then((res) => res.json())
    .then((json) => json?.data?.Page)
    .catch((error) => console.log(error));
}

async function getSongListFromMalIds(malIds) {
  if (!malIds) malIds = [];
  importedSongList = [];
  $('#cslgListImportText').text(`Anime: 0 / ${malIds.length} | Songs: ${importedSongList.length}`);
  if (malIds.length === 0) return;
  let url = 'https://anisongdb.com/api/malIDs_request';
  let idsProcessed = 0;
  for (let i = 0; i < malIds.length; i += 500) {
    let segment = malIds.slice(i, i + 500);
    idsProcessed += segment.length;
    let data = {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ malIds: segment }),
    };
    await fetch(url, data)
      .then((res) => res.json())
      .then((json) => {
        if (Array.isArray(json)) {
          importedSongList = importedSongList.concat(json);
          $('#cslgListImportText').text(`Anime: ${idsProcessed} / ${malIds.length} | Songs: ${importedSongList.length}`);
        } else {
          $('#cslgListImportText').text('anisongdb error');
          console.log(json);
          throw new Error('did not receive an array from anisongdb');
        }
      })
      .catch((res) => {
        importedSongList = [];
        $('#cslgListImportText').text('anisongdb error');
        console.log(res);
      });
  }
}

// start list import process
async function startImport() {
  if (importRunning) return;
  importRunning = true;
  $('#cslgListImportStartButton').addClass('disabled');
  $('#cslgListImportActionContainer').hide();
  if ($('#cslgListImportSelect').val() === 'myanimelist') {
    if (malClientId) {
      let username = $('#cslgListImportUsernameInput').val().trim();
      if (username) {
        let malIds = await getMalIdsFromMyanimelist(username);
        await getSongListFromMalIds(malIds);
      } else {
        $('#cslgListImportText').text('Input Myanimelist Username');
      }
    } else {
      $('#cslgListImportText').text('Missing MAL Client ID');
    }
  } else if ($('#cslgListImportSelect').val() === 'anilist') {
    let username = $('#cslgListImportUsernameInput').val().trim();
    if (username) {
      let malIds = await getMalIdsFromAnilist(username);
      await getSongListFromMalIds(malIds);
    } else {
      $('#cslgListImportText').text('Input Anilist Username');
    }
  }
  if (importedSongList.length) $('#cslgListImportActionContainer').show();
  $('#cslgListImportStartButton').removeClass('disabled');
  importRunning = false;
}

// validate json data in local storage
function validateLocalStorage(item) {
  try {
    return JSON.parse(localStorage.getItem(item)) || {};
  } catch {
    return {};
  }
}

// save settings
function saveSettings() {
  localStorage.setItem(
    'customSongListGame',
    JSON.stringify({
      replacedAnswers,
      CSLButtonCSS,
      debug,
      hotKeys,
      malClientId,
    })
  );
}

function applyStyles() {
  $('#customSongListStyle').remove();
  let tableHighlightColor =
    getComputedStyle(document.documentElement).getPropertyValue('--accentColorContrast') || '#4497ea';
  let style = document.createElement('style');
  style.type = 'text/css';
  style.id = 'customSongListStyle';
  let text = `
    #lnCustomSongListButton, #lnStatsButton {
      left: calc(25%);
      width: 80px;
    }
    #lnStatsButton {
      left: calc(25% + 90px);
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
    #cslgSongListTopRow i.fa:hover {
      opacity: .7;
    }
    #cslgSongListTable {
      width: 100%;
      table-layout: fixed;
    }
    #cslgSongListTable thead tr {
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
    #cslgSongListTable .action {
      width: 35px;
    }
    #cslgSongListTable .action i.fa-plus:hover {
      color: #5cb85c;
    }
    #cslgSongListTable .action i.fa-trash:hover {
      color: #d9534f;
    }
    #cslgSongListTable th, #cslgSongListTable td {
      padding: 0 4px;
    }
    #cslgSongListTable tr.selected td:not(.action) {
      color: ${tableHighlightColor};
    }
    #cslgMergedSongListTable {
      width: 100%;
      table-layout: fixed;
    }
    #cslgMergedSongListTable thead tr {
      font-weight: bold;
    }
    #cslgMergedSongListTable .number {
      width: 30px;
    }
    #cslgMergedSongListTable .songType {
      width: 45px;
    }
    #cslgMergedSongListTable .action {
      width: 55px;
    }
    #cslgMergedSongListTable .action i.fa-chevron-up:hover, #cslgMergedSongListTable .action i.fa-chevron-down:hover {
      color: #f0ad4e;
    }
    #cslgMergedSongListTable .action i.fa-trash:hover {
      color: #d9534f;
    }
    #cslgMergedSongListTable th, #cslgMergedSongListTable td {
      padding: 0 4px;
    }
    #cslgMergedSongListTable tr.selected td:not(.action) {
      color: ${tableHighlightColor};
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
    #cslgHotkeyTable th {
      font-weight: bold;
      padding: 0 20px 5px 0;
    }
    #cslgHotkeyTable td {
      padding: 2px 20px 2px 0;
    }
    #cslgHotkeyTable select, #cslgHotkeyTable input {
      color: black;
    }
    table.styledTable thead tr {
      background-color: #282828;
    }
    table.styledTable tbody tr:nth-child(odd) {
      background-color: #424242;
    }
    table.styledTable tbody tr:nth-child(even) {
      background-color: #353535;
    }
    #cslgListImportContainer input[type="checkbox"] {
      width: 20px;
      height: 20px;
      margin-left: 3px;
      vertical-align: -5px;
      cursor: pointer;
    }
    #statsModal .modal-dialog {
      width: 800px;
    }
    #statsModal .modal-body {
      max-height: 600px;
      overflow-y: auto;
    }
    .stats-section {
      margin-bottom: 20px;
    }
    .stats-section h3 {
      margin-bottom: 10px;
    }
    .stats-table {
      width: 100%;
      border-collapse: collapse;
    }
    .stats-table th, .stats-table td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    .stats-table th {
      background-color: #282828;
      color: white;
    }
    .stats-table td {
      background-color: #424242;
      color: #ffffff;
    }
    .stats-table tr:nth-child(even) td {
      background-color: #353535;
    }
  `;
  style.appendChild(document.createTextNode(text));
  document.head.appendChild(style);
}
