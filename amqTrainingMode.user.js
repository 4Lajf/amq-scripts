// ==UserScript==
// @name         AMQ Training Mode
// @namespace    https://github.com/4Lajf
// @version      0.84
// @description  Extended version of kempanator's Custom Song List Game Training mode allows you to practice your songs efficiently something line anki or other memory card software. It's goal is to give you songs that you don't recozniged mixed with some songs that you do recognize to solidify them in your memory.
// @match        https://*.animemusicquiz.com/*
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

"use strict";

//@ts-expect-error
if (typeof Listener === "undefined") return;

let loadInterval = setInterval(() => {
  if ($("#loadingScreen").hasClass("hidden")) {
    clearInterval(loadInterval);
    setup();
  }
}, 500);

/** @type {null | ({ songKey: string } & import('./types.js').ReviewDataItem)} */
let previousAttemptData = null;

let isSearchMode = true;

/** @type {import('./types.js').Song[]} */
let mySongList = [];

/** @type {import('./types.js').Song[]} */
let finalSongList = [];
let correctSongsPerGame = 0;

/** @type {number | null} */
let originalWeight = null;

/** @type {string | null} */
let currentSongKey = null;
let incorrectSongsPerGame = 0;
let trainingLinkadded = false;

/** @type {import('./types.js').Song[]} */
let ignoredSongs = [];

let currentSearchFilter = "";
let buttonContainerAdded = false;

/** @type {any} */
let statsModal;
let maxNewSongs24Hours = 20;
let newSongsAdded24Hours = 0;
let lastResetTime = Date.now();
let selectedSetNewSongs = new Set();
const version = "0.76";
const saveData = validateLocalStorage("customSongListGame");
const catboxHostDict = {
  1: "https://nawdist.animemusicquiz.com/",
  2: "https://naedist.animemusicquiz.com/",
  3: "https://eudist.animemusicquiz.com/",
};

/** @type {string} */
let currentProfile;

/** @type {string[]} */
let profiles;

let isTraining = false;
let CSLButtonCSS = saveData.CSLButtonCSS || "calc(25% - 250px)";
let showCSLMessages = saveData.showCSLMessages ?? false;
let replacedAnswers = saveData.replacedAnswers || {};
let malClientId = saveData.malClientId ?? "";
let hotKeys = saveData.hotKeys ?? {};
let debug = Boolean(saveData.debug);
let fastSkip = false;
let nextVideoReady = false;
let showSelection = 1;
let guessTime = 20;
let extraGuessTime = 0;
let currentSong = 0;
let totalSongs = 0;

/**
 * @type {Record<number, string>} GamePlayerId -> Answer
 */
let currentAnswers = {};

/**
 * @type {Record<number, number>} GamePlayerId -> Score
 */
let score = {};
let songListTableMode = 0; //0: song + artist, 1: anime + song type + vintage, 2: catbox links
let songListTableSort = [0, 0, 0, 0, 0, 0, 0, 0, 0]; //song, artist, difficulty, anime, type, vintage, mp3, 480, 720 (0: off, 1: ascending, 2: descending)

/** @type {import('./types.js').Song[]} */
let songList = [];

/** @type {Record<string, number>} */
let songOrder = {}; //{song#: index#, ...}

/** @type {import('./types.js').Song[]} */
let mergedSongList = [];

/** @type {import('./types.js').Song[]} */
let importedSongList = [];

let songOrderType = "random";
let startPointRange = [0, 100];
let difficultyRange = [0, 100];
let previousSongFinished = false;

/** @type {number} */
let skipInterval;

/** @type {number} */
let nextVideoReadyInterval;

/** @type {number} */
let answerTimer;

/** @type {number} */
let extraGuessTimer;

/** @type {number} */
let endGuessTimer;

/** @type {keyof catboxHostDict | 0} */
let fileHostOverride = 0;

/** @type {string[]} */
let autocomplete = []; //store lowercase version for faster compare speed

/** @type {any} */
let autocompleteInput;

/** @type {import('./types.js').CSLMultiplayer} */
let cslMultiplayer = { host: "", songInfo: {}, voteSkip: {} };
let cslState = 0; //0: none, 1: guessing phase, 2: answer phase

/** @type {Record<string, boolean>} */
let songLinkReceived = {};

let skipping = false;

/** @type {Record<number, Chunk>} */
let answerChunks = {}; //store player answer chunks, ids are gamePlayerId

/** @type {Chunk} */
let resultChunk;

/** @type {Chunk} */
let songInfoChunk;

/** @type {Chunk} */
let nextSongChunk;

let importRunning = false;

hotKeys.start = saveData.hotKeys?.start ?? {
  altKey: false,
  ctrlKey: false,
  key: "",
};
hotKeys.stop = saveData.hotKeys?.stop ?? {
  altKey: false,
  ctrlKey: false,
  key: "",
};
hotKeys.startTraining = saveData.hotKeys?.startTraining ?? {
  altKey: false,
  ctrlKey: false,
  key: "",
};
hotKeys.stopTraining = saveData.hotKeys?.stopTraining ?? {
  altKey: false,
  ctrlKey: false,
  key: "",
};
hotKeys.cslgWindow = saveData.hotKeys?.cslgWindow ?? {
  altKey: false,
  ctrlKey: false,
  key: "",
};

function handleRepeatModeToggle() {
  $("#cslgSettingsRepeatMode").change(function () {
    const isEnabled = $(this).prop("checked");
    $(
      "#cslgSettingsRepeatModeSlider, #cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax"
    ).prop("disabled", !isEnabled);
    $(
      "#cslgSettingsMaxNewSongs, #cslgSettingsMaxNewSongsRange, #cslgSettingsIncorrectSongs, #cslgSettingsIncorrectSongsRange, #cslgSettingsCorrectSongs, #cslgSettingsCorrectSongsRange"
    ).prop("disabled", isEnabled);
  });
}

function initializeSettingsContainer() {
  initializeSingleHandleSliders();
  initializeTwoWaySliders();
  loadTwoWaySliderSettings();
  initializeSliders();
  loadSettings();
  initializePopovers();
  handleRepeatModeToggle();

  // Event listener for the reset button
  $("#cslSettingsResetMaxNewSongs").click(function () {
    resetNewSongsCount();
    $("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);
    $("#cslgSettingsMaxNewSongsRange").val(maxNewSongs24Hours);
    alert("New songs count has been reset for the next 24 hours.");
  });
}

function initializeTwoWaySliders() {
  $("#cslgSettingsStartPoint")
    .slider({
      min: 0,
      max: 100,
      value: [0, 100],
      range: true,
      tooltip: "hide",
    })
    .on(
      //@ts-ignore
      "change",
      function (/** @type {import('./types.js').SliderRangeChangeEvent} */ e) {
        startPointRange = e.value.newValue;
        $("#cslgSettingsStartPointMin").val(e.value.newValue[0]);
        $("#cslgSettingsStartPointMax").val(e.value.newValue[1]);
      }
    );

  $("#cslgSettingsStartPointMin, #cslgSettingsStartPointMax").on(
    "change",
    function () {
      let minVal = Math.max(
        0,
        parseInt(String($("#cslgSettingsStartPointMin").val())) || 0
      );
      let maxVal = Math.max(
        0,
        parseInt(String($("#cslgSettingsStartPointMax").val())) || 0
      );

      if (minVal > maxVal) {
        minVal = maxVal;
      }

      $("#cslgSettingsStartPointMin").val(minVal);
      $("#cslgSettingsStartPointMax").val(maxVal);
      $("#cslgSettingsStartPoint").slider("setValue", [minVal, maxVal]);
      startPointRange = [minVal, maxVal];
    }
  );

  // Difficulty Range (2-way slider)
  $("#cslgSettingsDifficulty")
    .slider({
      min: 0,
      max: 100,
      value: [0, 100],
      range: true,
      tooltip: "hide",
    })
    .on(
      //@ts-ignore
      "change",
      function (/** @type {import('./types.js').SliderRangeChangeEvent} */ e) {
        difficultyRange = e.value.newValue;
        $("#cslgSettingsDifficultyMin").val(e.value.newValue[0]);
        $("#cslgSettingsDifficultyMax").val(e.value.newValue[1]);
      }
    );

  $("#cslgSettingsDifficultyMin, #cslgSettingsDifficultyMax").on(
    "change",
    function () {
      let minVal = Math.max(
        0,
        parseInt(String($("#cslgSettingsDifficultyMin").val())) || 0
      );
      let maxVal = Math.max(
        0,
        parseInt(String($("#cslgSettingsDifficultyMax").val())) || 0
      );

      if (minVal > maxVal) {
        minVal = maxVal;
      }

      $("#cslgSettingsDifficultyMin").val(minVal);
      $("#cslgSettingsDifficultyMax").val(maxVal);
      $("#cslgSettingsDifficulty").slider("setValue", [minVal, maxVal]);
      difficultyRange = [minVal, maxVal];
    }
  );

  // Repeat Mode (2-way slider)
  $("#cslgSettingsRepeatMode")
    .slider({
      min: 1,
      max: 5,
      value: [1, 5],
      step: 0.01,
      range: true,
      tooltip: "hide",
    })
    .on(
      //@ts-ignore
      "change",
      function (/** @type {import('./types.js').SliderRangeChangeEvent} */ e) {
        $("#cslgSettingsRepeatModeMin").val(e.value.newValue[0].toFixed(2));
        $("#cslgSettingsRepeatModeMax").val(e.value.newValue[1].toFixed(2));
        // Update the repeat mode range in your settings
      }
    );

  $("#cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax").on(
    "change",
    function () {
      let minVal = Math.max(
        1,
        Math.min(
          5,
          parseFloat(String($("#cslgSettingsRepeatModeMin").val())) || 1
        )
      );
      let maxVal = Math.max(
        1,
        Math.min(
          5,
          parseFloat(String($("#cslgSettingsRepeatModeMax").val())) || 5
        )
      );

      if (minVal > maxVal) {
        minVal = maxVal;
      }

      $("#cslgSettingsRepeatModeMin").val(minVal.toFixed(2));
      $("#cslgSettingsRepeatModeMax").val(maxVal.toFixed(2));
      $("#cslgSettingsRepeatMode").slider("setValue", [minVal, maxVal]);
      // Update the repeat mode range in your settings
    }
  );
  initializeRepeatModeSwitch();
}

function initializeSingleHandleSliders() {
  const sliders = [
    {
      sliderId: "#cslgSettingsSongs",
      inputId: "#cslgSettingsSongsInput",
      min: 1,
      max: 100,
      defaultValue: 20,
      allowHigherInput: true,
    },
    {
      sliderId: "#cslgSettingsGuessTime",
      inputId: "#cslgSettingsGuessTimeInput",
      min: 1,
      max: 99,
      defaultValue: 20,
      allowHigherInput: false,
    },
    {
      sliderId: "#cslgSettingsExtraGuessTime",
      inputId: "#cslgSettingsExtraGuessTimeInput",
      min: 0,
      max: 15,
      defaultValue: 0,
      allowHigherInput: false,
    },
    {
      sliderId: "#cslgSettingsMaxNewSongs",
      inputId: "#cslgSettingsMaxNewSongsInput",
      min: 0,
      max: 100,
      defaultValue: 20,
      allowHigherInput: true,
    },
    {
      sliderId: "#cslgSettingsIncorrectSongs",
      inputId: "#cslgSettingsIncorrectSongsInput",
      min: 0,
      max: 20,
      defaultValue: 0,
      allowHigherInput: true,
    },
    {
      sliderId: "#cslgSettingsCorrectSongs",
      inputId: "#cslgSettingsCorrectSongsInput",
      min: 0,
      max: 20,
      defaultValue: 0,
      allowHigherInput: true,
    },
  ];

  sliders.forEach((slider) => {
    const $slider = $(slider.sliderId);
    const $input = $(slider.inputId);

    $slider
      .slider({
        min: slider.min,
        max: slider.max,
        value: parseInt(String($input.val())) || slider.defaultValue,
        tooltip: "hide",
      })
      .on("slide", function (e) {
        $input.val(/** @type {number} */ (e.value));
        saveSettings();
      })
      .on(
        //@ts-ignore
        "change",
        function (/** @type {import('./types.js').SliderChangeEvent} */ e) {
          $input.val(e.value.newValue);
          saveSettings();
        }
      );

    $input.on("change", function () {
      let value = parseInt(String($(this).val()));
      if (slider.allowHigherInput) {
        value = Math.max(slider.min, value);
      } else {
        value = Math.max(slider.min, Math.min(slider.max, value));
      }
      $(this).val(value);
      $slider.slider("setValue", value);
      saveSettings();
    });

    // Set initial value
    const initialValue = $input.val() || slider.defaultValue;
    $slider.slider("setValue", initialValue);
    $input.val(initialValue);
  });
}

/**
 * @param {string} sliderId
 * @param {string} inputId
 * @returns {number}
 */
function getSliderValue(sliderId, inputId) {
  /** @type {number} */
  const sliderValue = /** @type {any} */ ($(sliderId).slider("getValue"));
  const inputValue = parseInt(String($(inputId).val()));
  return Math.max(sliderValue, inputValue);
}

function initializeSliders() {
  // Song Order (slider with specific data points)
  $("#cslgSongOrder")
    .slider({
      ticks: [1, 2, 3],
      ticks_labels: ["Random", "Ascending", "Descending"],
      ticks_positions: [0, 50, 100], // Add this line
      min: 1,
      max: 3,
      step: 1,
      value: 1,
      tooltip: "hide",
    })
    .on(
      //@ts-ignore
      "change",
      function (/** @type {import('./types.js').SliderChangeEvent} */ e) {
        songOrderType = ["random", "ascending", "descending"][
          e.value.newValue - 1
        ];
      }
    );

  // Override URL (slider with specific data points)
  $("#cslgHostOverride")
    .slider({
      ticks: [0, 1, 2, 3],
      ticks_labels: ["Default", "nl", "ladist1", "vhdist1"],
      ticks_positions: [0, 33, 66, 100], // Add this line
      min: 0,
      max: 3,
      step: 1,
      value: 0,
      tooltip: "hide",
    })
    .on(
      //@ts-ignore
      "change",
      function (/** @type {import('./types.js').SliderChangeEvent} */ e) {
        fileHostOverride = /** @type {1 | 2 | 3} */ (e.value.newValue);
      }
    );

  setTimeout(function () {
    $("#cslgSongOrder, #cslgHostOverride").slider("refresh");
  }, 0);
}

function initializeRepeatModeSwitch() {
  const $repeatModeSwitch = $("#cslgSettingsRepeatModeSwitch");
  const $repeatModeSlider = $("#cslgSettingsRepeatMode");
  const $repeatModeInputs = $(
    "#cslgSettingsRepeatModeMin, #cslgSettingsRepeatModeMax"
  );
  const $maxNewSongsSlider = $("#cslgSettingsMaxNewSongs");
  const $incorrectSongsSlider = $("#cslgSettingsIncorrectSongs");
  const $correctSongsSlider = $("#cslgSettingsCorrectSongs");

  function updateControlStates() {
    const isRepeatModeEnabled = $repeatModeSwitch.prop("checked");

    // Enable/disable Repeat Mode slider and inputs
    $repeatModeSlider.slider(isRepeatModeEnabled ? "enable" : "disable");
    $repeatModeInputs.prop("disabled", !isRepeatModeEnabled);

    // Enable/disable other sliders
    $maxNewSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");
    $incorrectSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");
    $correctSongsSlider.slider(isRepeatModeEnabled ? "disable" : "enable");

    // Update visual state
    $repeatModeSlider
      .closest(".form-group")
      .toggleClass("disabled", !isRepeatModeEnabled);
    $maxNewSongsSlider
      .closest(".form-group")
      .toggleClass("disabled", isRepeatModeEnabled);
    $incorrectSongsSlider
      .closest(".form-group")
      .toggleClass("disabled", isRepeatModeEnabled);
    $correctSongsSlider
      .closest(".form-group")
      .toggleClass("disabled", isRepeatModeEnabled);
  }

  $repeatModeSwitch.on("change", updateControlStates);

  // Initial state setup
  updateControlStates();
}

function loadTwoWaySliderSettings() {
  $("#cslgSettingsStartPoint").slider("setValue", startPointRange);
  $("#cslgSettingsStartPointMin").val(startPointRange[0]);
  $("#cslgSettingsStartPointMax").val(startPointRange[1]);

  $("#cslgSettingsDifficulty").slider("setValue", difficultyRange);
  $("#cslgSettingsDifficultyMin").val(difficultyRange[0]);
  $("#cslgSettingsDifficultyMax").val(difficultyRange[1]);

  $("#cslgSettingsRepeatModeSwitch").prop("checked", false);
  $("#cslgSettingsRepeatMode").slider("setValue", [1, 5]);
  $("#cslgSettingsRepeatModeMin").val("1.00");
  $("#cslgSettingsRepeatModeMax").val("5.00");
}

function loadSettings() {
  $("#cslgSettingsSongs").slider("setValue", totalSongs || 20);
  $("#cslgSettingsSongsInput").val(totalSongs || 20);

  $("#cslgSettingsGuessTime").slider("setValue", guessTime);
  $("#cslgSettingsGuessTimeInput").val(guessTime);

  $("#cslgSettingsExtraGuessTime").slider("setValue", extraGuessTime);
  $("#cslgSettingsExtraGuessTimeInput").val(extraGuessTime);

  $("#cslgSettingsFastSkip").prop("checked", fastSkip);

  $("#cslgSettingsOPCheckbox").prop("checked", true);
  $("#cslgSettingsEDCheckbox").prop("checked", true);
  $("#cslgSettingsINCheckbox").prop("checked", true);
  $("#cslgSettingsTVCheckbox").prop("checked", true);
  $("#cslgSettingsMovieCheckbox").prop("checked", true);
  $("#cslgSettingsOVACheckbox").prop("checked", true);
  $("#cslgSettingsONACheckbox").prop("checked", true);
  $("#cslgSettingsSpecialCheckbox").prop("checked", true);

  $("#cslgSettingsStartPoint").slider("setValue", startPointRange);
  $("#cslgSettingsDifficulty").slider("setValue", difficultyRange);
  $("#cslgSongOrder").slider(
    "setValue",
    ["random", "ascending", "descending"].indexOf(songOrderType) + 1
  );
  $("#cslgHostOverride").slider("setValue", fileHostOverride);

  $("#cslgSettingsMaxNewSongs").slider("setValue", maxNewSongs24Hours || 20);
  $("#cslgSettingsMaxNewSongsInput").val(maxNewSongs24Hours || 20);

  $("#cslgSettingsIncorrectSongs").slider("setValue", incorrectSongsPerGame);
  $("#cslgSettingsIncorrectSongsInput").val(incorrectSongsPerGame);

  $("#cslgSettingsCorrectSongs").slider("setValue", correctSongsPerGame);
  $("#cslgSettingsCorrectSongsInput").val(correctSongsPerGame);

  $("#cslgSettingsRepeatModeSwitch").prop("checked", false);
  $("#cslgSettingsRepeatMode").slider("setValue", [1, 5]);
}

function saveSettings() {
  localStorage.setItem(
    "customSongListGame",
    JSON.stringify({
      replacedAnswers,
      CSLButtonCSS,
      debug,
      hotKeys,
      malClientId,
    })
  );

  totalSongs = getSliderValue("#cslgSettingsSongs", "#cslgSettingsSongsInput");
  guessTime = getSliderValue(
    "#cslgSettingsGuessTime",
    "#cslgSettingsGuessTimeInput"
  );
  extraGuessTime = getSliderValue(
    "#cslgSettingsExtraGuessTime",
    "#cslgSettingsExtraGuessTimeInput"
  );
  maxNewSongs24Hours = getSliderValue(
    "#cslgSettingsMaxNewSongs",
    "#cslgSettingsMaxNewSongsInput"
  );
  incorrectSongsPerGame = getSliderValue(
    "#cslgSettingsIncorrectSongs",
    "#cslgSettingsIncorrectSongsInput"
  );
  correctSongsPerGame = getSliderValue(
    "#cslgSettingsCorrectSongs",
    "#cslgSettingsCorrectSongsInput"
  );
  fastSkip = $("#cslgSettingsFastSkip").prop("checked");
  startPointRange = /** @type {any} */ (
    $("#cslgSettingsStartPoint").slider("getValue")
  );
  difficultyRange = /** @type {any} */ (
    $("#cslgSettingsDifficulty").slider("getValue")
  );
  songOrderType = ["random", "ascending", "descending"][
    /** @type {any} */ ($("#cslgSongOrder").slider("getValue")) - 1
  ];
  fileHostOverride = /** @type {any} */ (
    $("#cslgHostOverride").slider("getValue")
  );
  saveNewSongsSettings();
}

function loadNewSongsSettings() {
  const settings = localStorage.getItem(`newSongsSettings_${currentProfile}`);
  if (settings) {
    const parsed = JSON.parse(settings);
    maxNewSongs24Hours = parsed.maxNewSongs24Hours;
    newSongsAdded24Hours = parsed.newSongsAdded24Hours;
    lastResetTime = parsed.lastResetTime;
    incorrectSongsPerGame = parsed.incorrectSongsPerGame || 0;
    correctSongsPerGame = parsed.correctSongsPerGame || 0;
  }
}

function createTrainingInfoPopup() {
  const popupHtml = /*html*/ `
        <div id="trainingInfoPopup" class="modal fade">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title">What's Training Mode?</h4>
                        <button type="button" class="close" data-dismiss="modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p>Training mode is a feature in CSL that allows you to practice and improve your anime song recognition skills. Here's how it works:</p>
                        <ul>
                            <li>Load songs you want to train on in the "Song List" tab.</li>
                            <li>The game selects songs based on a spaced repetition algorithm, prioritizing songs you need more practice with.</li>
                            <li>You receive immediate feedback on your answers, and the system adjusts song difficulty accordingly.</li>
                            <li>Your progress is recorded and used to optimize future training sessions.</li>
                            <li>You can manually adjust the frequency of specific songs appearing.</li>
                            <li>You can also "banish" a song by clicking the block button on the "Song List" menu.</li>
                            <li>That will cause the song to not play ever again and won't appear in the search results.</li>
                            <li>You can bring it back by checking "Show Banished Songs" and clicking the tick near the appropriate song.</li>
                            <li>Click on My Songs / Song Search button to swtich between modes.</li>
                            <li>In Song Search mode you can search for songs and add them to your My Songs list by clicking the Plus (+) icon.</li>
                            <li>If you click on the Plus (+) icon in My Songs mode than you will add it to Merge tab.</li>
                            <li>Use the big buttons to perform mass actions like adding all songs to My Songs all deleting every song from the list.</li>
                            <li>You can also change the table view by clicking the table icon.</li>
                            <li>Additionally you can customize your search by clicking Search Options</li>
                        </ul>
                        <p>Use training mode to efficiently improve your recognition of anime songs, focusing on those you find challenging!</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
  `;

  $("body").append(popupHtml);
}

function showTrainingInfo() {
  if (!$("#trainingInfoPopup").length) {
    createTrainingInfoPopup();
  }
  $("#trainingInfoPopup").modal("show");
}

function loadIgnoredSongs() {
  const savedIgnoredSongs = localStorage.getItem(
    `ignoredSongs_${currentProfile}`
  );
  if (savedIgnoredSongs) {
    ignoredSongs = JSON.parse(savedIgnoredSongs);
  }
}

function saveIgnoredSongs() {
  localStorage.setItem(
    `ignoredSongs_${currentProfile}`,
    JSON.stringify(ignoredSongs)
  );
}

/**
 * @param {import('./types.js').Song} song
 */
function blockSong(song) {
  if (isSearchMode) {
    songList = songList.filter((s) => s !== song);
  } else {
    mySongList = mySongList.filter((s) => s !== song);
  }
  ignoredSongs.push(song);
  saveIgnoredSongs();
  updateSongListDisplay();
}

/**
 * @param {import('./types.js').Song} song
 */
function unblockSong(song) {
  ignoredSongs = ignoredSongs.filter((s) => s !== song);
  if (isSearchMode) {
    songList.push(song);
  } else {
    mySongList.push(song);
  }
  saveIgnoredSongs();
  updateSongListDisplay();
}

function filterSongList() {
  if (currentSearchFilter) {
    const searchCriteria = $("#cslgSearchCriteria").val();
    return songList.filter((song) => {
      const lowerCaseFilter = currentSearchFilter.toLowerCase();
      switch (searchCriteria) {
        case "songName":
          return song.songName.toLowerCase().includes(lowerCaseFilter);
        case "songArtist":
          return song.songArtist.toLowerCase().includes(lowerCaseFilter);
        case "animeName":
          return (
            song.animeRomajiName.toLowerCase().includes(lowerCaseFilter) ||
            song.animeEnglishName.toLowerCase().includes(lowerCaseFilter)
          );
        case "songType":
          return songTypeText(song.songType, song.typeNumber ?? 0)
            .toLowerCase()
            .includes(lowerCaseFilter);
        case "animeVintage":
          return song.animeVintage?.toLowerCase().includes(lowerCaseFilter);
        case "all":
        default:
          return (
            song.songName.toLowerCase().includes(lowerCaseFilter) ||
            song.songArtist.toLowerCase().includes(lowerCaseFilter) ||
            song.animeRomajiName.toLowerCase().includes(lowerCaseFilter) ||
            song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) ||
            songTypeText(song.songType, song.typeNumber ?? 0)
              .toLowerCase()
              .includes(lowerCaseFilter) ||
            song.animeVintage?.toLowerCase().includes(lowerCaseFilter)
          );
      }
    });
  }
  return songList;
}

/**
 * Shuffle the elements of an array in place.
 *
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function saveProfiles() {
  localStorage.setItem("cslProfiles", JSON.stringify(profiles));
}

function loadProfiles() {
  const savedProfiles = localStorage.getItem("cslProfiles");
  if (savedProfiles) {
    profiles = JSON.parse(savedProfiles);
    if (!profiles.includes("default")) {
      profiles.unshift("default");
    }
  } else {
    // If no profiles exist in localStorage, initialize with default
    profiles = ["default"];
  }
  // Ensure currentProfile is set
  if (!profiles.includes(currentProfile)) {
    currentProfile = "default";
  }
  // Save the profiles in case we made any changes
  saveProfiles();
}

/**
 * Function to select a profile
 *
 * @param {string} profileName
 */
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

/**
 * Function to add a new profile
 *
 * @param {string} profileName
 */
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

/**
 * Function to delete a profile
 *
 * @param {string} profileName
 */
function deleteProfile(profileName) {
  profiles = profiles.filter((p) => p !== profileName);
  localStorage.removeItem(`spacedRepetitionData_${profileName}`);
  saveProfiles();
  if (currentProfile === profileName) {
    selectProfile("default");
  } else {
    updateProfileSelect();
  }
  console.log(`Deleted profile: ${profileName}`);
}

function updateProfileSelect() {
  const $select = $("#cslgProfileSelect");
  $select.empty();
  profiles.forEach((profile) => {
    $select.append($("<option></option>").val(profile).text(profile));
  });
  $select.val(currentProfile);
}

$("#gameContainer").append(
  $(/*html*/ `
    <div class="modal fade tab-modal" id="cslgSettingsModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document" style="width: 800px">
            <div class="modal-content">
					<div class="modal-header" style="padding: 3px 0 0 0">
						<div class="modal-header-content">
							<span id="trainingInfoLink" class="training-info-link">What's Training?</span>
							<h4 class="modal-title">Custom Song List Game</h4>
							<button type="button" class="close" data-dismiss="modal" aria-label="Close">
								<span aria-hidden="true">×</span>
							</button>
						</div>
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
                    <div id="cslgSongListContainer" class="dark-theme">
                        <div class="cslg-header">
							<div class="cslg-header-row">
								<div class="cslg-mode-selector">
									<button id="cslgToggleModeButton" class="btn btn-primary btn-sm">Song Search</button>
									<label for="cslgFileUpload" class="btn btn-outline-light btn-sm ml-2">
										<i class="fa fa-upload"></i> Upload List
										<input id="cslgFileUpload" type="file" style="display:none;">
									</label>
								</div>
								<div class="cslg-actions">
									<button id="cslgAddAllButton" class="btn-icon"><i class="fa fa-plus-square"></i></button>
									<button id="cslgClearSongListButton" class="btn-icon"><i class="fa fa-trash"></i></button>
									<button id="cslgTransferSongListButton" class="btn-icon"><i class="fa fa-exchange"></i></button>
									<button id="cslgTableModeButton" class="btn-icon""><i class="fa fa-table"></i></button>
								</div>
							</div>
							<div class="cslg-header-row">
								<div class="cslg-search">
									<select id="cslgSearchCriteria" class="form-control form-control-sm bg-dark text-light">
										<option value="all">All</option>
										<option value="songName">Song Name</option>
										<option value="songArtist">Song Artist</option>
										<option value="animeName">Anime Name</option>
										<option value="songType">Song Type</option>
										<option value="animeVintage">Anime Vintage</option>
									</select>
									<input id="cslgSearchInput" type="text" class="form-control form-control-sm bg-dark text-light" placeholder="filter songs...">
								</div>
								<div class="cslg-counts">
									<span id="cslgSongListCount" class="badge bg-secondary">Songs: 0</span>
									<span id="cslgMergedSongListCount" class="badge bg-secondary">Merged: 0</span>
								</div>
							</div>
							<div class="cslg-header-row anisongdb-search-row">
								<div class="cslg-anisongdb-search">
									<select id="cslgAnisongdbModeSelect" class="form-control form-control-sm bg-dark text-light">
										<option>Anime</option>
										<option>Artist</option>
										<option>Song</option>
										<option>Composer</option>
										<option>Season</option>
										<option>Ann Id</option>
										<option>Mal Id</option>
									</select>
									<input id="cslgAnisongdbQueryInput" type="text" class="form-control form-control-sm bg-dark text-light" placeholder="Add songs..." />
								</div>
								<div class="cslg-options">
									<button id="songOptionsButton" class="btn btn-secondary btn-sm">Search Options</button>
								</div>

								<div class="song-options-backdrop"></div>
								<div class="song-options-popup">
									<span class="song-options-close">&times;</span>
									<h6>Song Types</h6>
									<div class="checkbox-group">
										<label><input id="cslgAnisongdbOPCheckbox" type="checkbox" checked> OP</label>
										<label><input id="cslgAnisongdbEDCheckbox" type="checkbox" checked> ED</label>
										<label><input id="cslgAnisongdbINCheckbox" type="checkbox" checked> IN</label>
									</div>
									<h6>Search Options</h6>
									<div class="checkbox-group">
										<label><input id="cslgAnisongdbPartialCheckbox" type="checkbox" checked> Partial Match</label>
										<label><input id="cslgAnisongdbIgnoreDuplicatesCheckbox" type="checkbox"> Ignore Duplicates</label>
										<label><input id="cslgAnisongdbArrangementCheckbox" type="checkbox"> Arrangement</label>
									</div>
								</div>
							</div>
							<div class="cslg-header-row anisongdb-search-row">
								<div class="cslg-advanced-options">
									<label class="input-group input-group-sm">
										<span class="input-group-text bg-dark text-light">Max Other</span>
										<input id="cslgAnisongdbMaxOtherPeopleInput" type="number" class="form-control form-control-sm bg-dark text-light" min="0" max="99" value="99">
									</label>
									<label class="input-group input-group-sm">
										<span class="input-group-text bg-dark text-light">Min Group</span>
										<input id="cslgAnisongdbMinGroupMembersInput" type="number" class="form-control form-control-sm bg-dark text-light" min="0" max="99" value="0">
									</label>
								</div>
								<div class="cslg-show-ignored">
									<button id="cslgShowIgnoredButton" class="btn btn-secondary btn-sm">Show Banished Songs</button>
								</div>
							</div>
						</div>
                        <div class="cslg-table-container">
                            <table id="cslgSongListTable" class="table table-dark table-striped table-hover">
                                <thead>
                                    <tr>
                                        <th class="number">#</th>
                                        <th class="song">Song</th>
                                        <th class="artist">Artist</th>
                                        <th class="difficulty">Dif</th>
                                        <th class="action">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                </tbody>
                            </table>
                            <div id="cslgSongListWarning"></div>
                        </div>
                    </div>
						<div id="cslgQuizSettingsContainer" class="container-fluid">
                            <div class="row">
                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Quiz Settings</h3>
                                    <div class="form-group">
                                        <label for="cslgSettingsSongs">Number of Songs:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsSongs" type="text" data-slider-min="1" data-slider-max="100" data-slider-step="1" data-slider-value="20" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsGuessTime">Guess Time (seconds):</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsGuessTime" type="text" data-slider-min="1" data-slider-max="99" data-slider-step="1" data-slider-value="20" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsGuessTimeInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsExtraGuessTime">Extra Time (seconds):</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <div style="flex-grow: 1; margin-right: 10px;">
                                            <input id="cslgSettingsExtraGuessTime" type="text" data-slider-min="0" data-slider-max="15" data-slider-step="1" data-slider-value="0" style="width: 250px;"/>
                                            </div>
                                            <input type="number" id="cslgSettingsExtraGuessTimeInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                        </div>
                                    <div class="form-group">
                                    <div class="custom-control custom-switch">
                                        <input type="checkbox" class="custom-control-input" id="cslgSettingsFastSkip">
                                        <label class="custom-control-label" for="cslgSettingsFastSkip">Fast Skip</label>
                                    </div>
                                    </div>
                                </div>
                                </div>

                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Song Selection</h3>
                                    <div class="form-group">
                                        <label for="cslgSettingsStartPoint">Sample Range:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <input type="number" class="number-to-text" id="cslgSettingsStartPointMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            <div style="flex-grow: 1; margin: 0 10px;">
                                            <input id="cslgSettingsStartPoint" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="[0,100]" style="width: 100%;"/>
                                            </div>
                                            <input type="number" class="number-to-text" id="cslgSettingsStartPointMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="cslgSettingsDifficulty">Difficulty Range:</label>
                                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                            <input type="number" class="number-to-text" id="cslgSettingsDifficultyMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            <div style="flex-grow: 1; margin: 0 10px;">
                                            <input id="cslgSettingsDifficulty" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="[0,100]" style="width: 100%;"/>
                                            </div>
                                            <input type="number" class="number-to-text" id="cslgSettingsDifficultyMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                        </div>
                                    </div>
                                    <div class="cslg-setting-row" style="display: flex; align-items: center; margin-bottom: 5px;">
                                        <label style="flex: 0 0 100px; margin-bottom: 0;">Song Types:</label>
                                        <div style="display: flex; align-items: center;">
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsOPCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">OP</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsEDCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">ED</span>
                                            </label>
                                            <label style="display: flex; align-items: center;">
                                                <input id="cslgSettingsINCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">IN</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div class="cslg-setting-row" style="display: flex; align-items: center;">
                                        <label style="flex: 0 0 100px; margin-bottom: 0;">Anime Types:</label>
                                        <div style="display: flex; align-items: center;">
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsTVCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">TV</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsMovieCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">Movie</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsOVACheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">OVA</span>
                                            </label>
                                            <label style="margin-right: 8px; display: flex; align-items: center;">
                                                <input id="cslgSettingsONACheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">ONA</span>
                                            </label>
                                            <label style="display: flex; align-items: center;">
                                                <input id="cslgSettingsSpecialCheckbox" type="checkbox" checked style="width: 12px; height: 12px; margin-right: 2px;">
                                                <span style="font-size: 11px;">Special</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Advanced Settings</h3>
                                    <div class="form-group">
                                    <label for="cslgSongOrder">Song Order:</label>
                                    <input id="cslgSongOrder" type="text" style="width: 250px;" data-slider-ticks="[1, 2, 3]" data-slider-ticks-labels='["Random", "Ascending", "Descending"]' data-slider-min="1" data-slider-max="3" data-slider-step="1" data-slider-value="1"/>
                                    </div>
                                    <div class="form-group">
                                    <label for="cslgHostOverride">Override URL:</label>
                                    <input id="cslgHostOverride" type="text" style="width: 250px;" data-slider-ticks="[0, 1, 2, 3]" data-slider-ticks-labels='["Default", "nl", "ladist1", "vhdist1"]' data-slider-min="0" data-slider-max="3" data-slider-step="1" data-slider-value="0"/>
                                    </div>
                                </div>
                                </div>

                                <div class="col-md-6">
                                <div class="cslg-settings-section">
                                    <h3>Training Mode Settings</h3>
                                    <div class="form-group">
                                            <label for="cslgSettingsMaxNewSongs">Max New Songs (24h):</label>
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <div style="flex-grow: 1; margin-right: 10px;">
                                                    <input id="cslgSettingsMaxNewSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="100" data-slider-step="1" data-slider-value="25"/>
                                                </div>
                                                <input type="number" id="cslgSettingsMaxNewSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                                <button id="cslSettingsResetMaxNewSongs" class="btn btn-sm" style="margin-left: 10px;">Reset</button>
                                            </div>
                                            <i class="fa fa-info-circle" id="maxNewSongsInfo" aria-hidden="true"></i>
                                        </div>
                                        <div class="form-group">
                                            <label for="cslgSettingsIncorrectSongs">Incorrect Songs per Game:</label>
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <div style="flex-grow: 1; margin-right: 10px;">
                                                    <input id="cslgSettingsIncorrectSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="20" data-slider-step="1" data-slider-value="0"/>
                                                </div>
                                                <input type="number" id="cslgSettingsIncorrectSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                            </div>
                                            <i class="fa fa-info-circle" id="incorrectSongsInfo" aria-hidden="true"></i>
                                        </div>
                                            <div class="form-group">
                                                <label for="cslgSettingsCorrectSongs">Correct Songs per Game:</label>
                                                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                    <div style="flex-grow: 1; margin-right: 10px;">
                                                        <input id="cslgSettingsCorrectSongs" style="width: 250px;" type="text" data-slider-min="0" data-slider-max="20" data-slider-step="1" data-slider-value="0"/>
                                                    </div>
                                                    <input type="number" id="cslgSettingsCorrectSongsInput" class="number-to-text" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;">
                                                </div>
                                                <i class="fa fa-info-circle" id="correctSongsInfo" aria-hidden="true"></i>
                                            </div>
                                        <label for="cslgSettingsRepeatMode">Repeat Mode:</label>
                                            <div class="custom-control custom-switch mb-2">
                                                <input type="checkbox" class="custom-control-input" id="cslgSettingsRepeatModeSwitch">
                                                <label class="custom-control-label" for="cslgSettingsRepeatModeSwitch">Enable</label>
                                                <i class="fa fa-info-circle" id="repeatModeInfo" aria-hidden="true" style="margin-left: 5px;"></i>
                                            </div>
                                    <div class="form-group">
                                            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                                <input type="number" class="number-to-text" id="cslgSettingsRepeatModeMin" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;" step="0.01">
                                                <div style="flex-grow: 1; margin: 0 10px;">
                                                <input id="cslgSettingsRepeatMode" type="text" data-slider-min="1" data-slider-max="5" data-slider-step="0.01" data-slider-value="[1,5]" style="width: 100%;"/>
                                                </div>
                                                <input type="number" class="number-to-text" id="cslgSettingsRepeatModeMax" style="width: 40px; height: calc(1.5em + 0.5rem + 2px); padding: 0.25rem 0.5rem; font-size: 1.2rem; line-height: 1.5; border-radius: 0.2rem;" step="0.01">
                                            </div>
                                        </div>
                                </div>
                                </div>
                            </div>
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

// Load saved settings
loadNewSongsSettings();
$("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);

// Load profile button
$("#cslgLoadProfileButton").click(() => {
  const selectedProfile = String($("#cslgProfileSelect").val());
  if (selectedProfile) {
    selectProfile(selectedProfile);
    alert(`Loaded profile: ${selectedProfile}`);
  }
});

// Add profile button
$("#cslgAddProfileButton").click(() => {
  const profileName = prompt("Enter new profile name:");
  if (profileName) {
    addProfile(profileName);
    alert(`Added new profile: ${profileName}`);
  }
});

// Delete profile button
$("#cslgDeleteProfileButton").click(() => {
  const selectedProfile = String($("#cslgProfileSelect").val());
  if (
    confirm(`Are you sure you want to delete the profile "${selectedProfile}"?`)
  ) {
    deleteProfile(selectedProfile);
    alert(`Deleted profile: ${selectedProfile}`);
  }
});

createHotkeyElement(
  "Start CSL",
  "start",
  "cslgStartHotkeySelect",
  "cslgStartHotkeyInput"
);
createHotkeyElement(
  "Stop CSL",
  "stop",
  "cslgStopHotkeySelect",
  "cslgStopHotkeyInput"
);
createHotkeyElement(
  "Start Training",
  "startTraining",
  "cslgStartTrainingHotkeySelect",
  "cslgStartTrainingHotkeyInput"
);
createHotkeyElement(
  "Stop Training",
  "stopTraining",
  "cslgStopTrainingHotkeySelect",
  "cslgStopTrainingHotkeyInput"
);
createHotkeyElement(
  "Open Window",
  "cslgWindow",
  "cslgWindowHotkeySelect",
  "cslgWindowHotkeyInput"
);
//createHotkeyElement("Merge All", "mergeAll", "cslgMergeAllHotkeySelect", "cslgMergeAllHotkeyInput");

function validateTrainingStart() {
  isTraining = true;
  if (!lobby.inLobby) return;
  songOrder = {};
  if (!lobby.isHost) {
    return messageDisplayer.displayMessage("Unable to start", "must be host");
  }
  if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "all players must be ready"
    );
  }
  if (!mySongList || !mySongList.length) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "no songs in My Songs list"
    );
  }
  if (autocomplete.length === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "autocomplete list empty"
    );
  }
  let numSongs = getSliderValue(
    "#cslgSettingsSongs",
    "#cslgSettingsSongsInput"
  );
  if (isNaN(numSongs) || numSongs < 1) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid number of songs"
    );
  }
  guessTime = getSliderValue(
    "#cslgSettingsGuessTime",
    "#cslgSettingsGuessTimeInput"
  );
  if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid guess time"
    );
  }
  extraGuessTime = getSliderValue(
    "#cslgSettingsExtraGuessTime",
    "#cslgSettingsExtraGuessTimeInput"
  );
  if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid extra guess time"
    );
  }
  startPointRange = /** @type {any} */ (
    $("#cslgSettingsStartPoint").slider("getValue")
  );
  if (
    startPointRange[0] < 0 ||
    startPointRange[0] > 100 ||
    startPointRange[1] < 0 ||
    startPointRange[1] > 100 ||
    startPointRange[0] > startPointRange[1]
  ) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "song start sample must be a range 0-100"
    );
  }
  difficultyRange = /** @type {any} */ (
    $("#cslgSettingsDifficulty").slider("getValue")
  );
  if (
    difficultyRange[0] < 0 ||
    difficultyRange[0] > 100 ||
    difficultyRange[1] < 0 ||
    difficultyRange[1] > 100 ||
    difficultyRange[0] > difficultyRange[1]
  ) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "difficulty must be a range 0-100"
    );
  }

  let repeatMode = $("#cslgSettingsRepeatModeSwitch").prop("checked");
  if (repeatMode) {
    /** @type {[number, number]} */
    let range = /** @type {any} */ (
      $("#cslgSettingsRepeatMode").slider("getValue")
    );
    if (range[0] >= range[1]) {
      return messageDisplayer.displayMessage(
        "Unable to start",
        "invalid difficulty range for Repeat Mode"
      );
    }
  } else {
    incorrectSongsPerGame = getSliderValue(
      "#cslgSettingsIncorrectSongs",
      "#cslgSettingsIncorrectSongsInput"
    );
    correctSongsPerGame = getSliderValue(
      "#cslgSettingsCorrectSongs",
      "#cslgSettingsCorrectSongsInput"
    );
    if (incorrectSongsPerGame + correctSongsPerGame > numSongs) {
      let adjustedIncorrect = Math.floor(numSongs / 2);
      let adjustedCorrect = numSongs - adjustedIncorrect;
      incorrectSongsPerGame = adjustedIncorrect;
      correctSongsPerGame = adjustedCorrect;
      $("#cslgSettingsIncorrectSongs").slider("setValue", adjustedIncorrect);
      $("#cslgSettingsCorrectSongs").slider("setValue", adjustedCorrect);
      saveNewSongsSettings();
      console.log(
        `Adjusted incorrectSongsPerGame to ${adjustedIncorrect} and correctSongsPerGame to ${adjustedCorrect} to match total songs per game`
      );
    }
  }

  currentSearchFilter = "";
  $("#cslgSearchInput").val("");
  $("#cslgSearchCriteria").val("all");
  let ops = $("#cslgSettingsOPCheckbox").prop("checked");
  let eds = $("#cslgSettingsEDCheckbox").prop("checked");
  let ins = $("#cslgSettingsINCheckbox").prop("checked");
  let tv = $("#cslgSettingsTVCheckbox").prop("checked");
  let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
  let ova = $("#cslgSettingsOVACheckbox").prop("checked");
  let ona = $("#cslgSettingsONACheckbox").prop("checked");
  let special = $("#cslgSettingsSpecialCheckbox").prop("checked");

  let filteredSongs = mySongList.filter((song) => {
    // Type check for song.songType (can be either string or number)
    let passesTypeFilter = false;
    if (typeof song.songType === "number") {
      // Handle as a number (assuming 1 = Opening, 2 = Ending, 3 = Insert)
      passesTypeFilter =
        (ops && song.songType === 1) ||
        (eds && song.songType === 2) ||
        (ins && song.songType === 3);
    } else if (typeof song.songType === "string") {
      // Handle as a string (check if it contains "Opening", "Ending", or "Insert")
      let songType = String(song.songType); // Ensure it's a string
      passesTypeFilter =
        (ops && songType.includes("Opening")) ||
        (eds && songType.includes("Ending")) ||
        (ins && songType.includes("Insert"));
    } else {
      console.log("Unknown songType format:", song.songType);
    }
    let passesAnimeTypeFilter =
      (tv && song.animeType === "TV") ||
      (movie && song.animeType === "Movie") ||
      (ova && song.animeType === "OVA") ||
      (ona && song.animeType === "ONA") ||
      (special && song.animeType === "Special");
    return (
      passesTypeFilter &&
      passesAnimeTypeFilter &&
      difficultyFilter(song, difficultyRange[0], difficultyRange[1])
    );
  });

  if (filteredSongs.length === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "no songs match the specified criteria"
    );
  }

  // Prepare the playlist from the filtered songs
  let playlist = prepareSongForTraining(filteredSongs, numSongs);

  // Create songOrder based on the playlist
  playlist.forEach((song, i) => {
    songOrder[i + 1] = mySongList.indexOf(song); // Store the index in mySongList
  });

  totalSongs = Object.keys(songOrder).length;
  if (totalSongs === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "no songs match the specified criteria"
    );
  }
  fastSkip = $("#cslgSettingsFastSkip").prop("checked");
  $("#cslgSettingsModal").modal("hide");
  console.log("song order: ", songOrder);
  if (lobby.soloMode) {
    startQuiz();
  } else if (lobby.isHost) {
    cslMessage(
      "§CSL0" +
        btoa(
          `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
            fastSkip ? "1" : "0"
          }`
        )
    );
  }
}

$("#cslgAddAllButton")
  .on("click", () => {
    if (isSearchMode) {
      // Add all search results to My Songs
      const newSongs = songList.filter(
        (song) =>
          !mySongList.some(
            (mySong) =>
              mySong.songName === song.songName &&
              mySong.songArtist === song.songArtist &&
              mySong.animeRomajiName === song.animeRomajiName
          )
      );
      mySongList = mySongList.concat(newSongs);
      gameChat.systemMessage(
        `Added ${newSongs.length} songs to My Songs list.`
      );
    } else {
      // Add all My Songs to merged list (original functionality)
      mergedSongList = Array.from(
        new Set(mergedSongList.concat(mySongList).map((x) => JSON.stringify(x)))
      ).map((x) => JSON.parse(x));
      createMergedSongListTable();
      gameChat.systemMessage(
        `Added ${mySongList.length} songs to the merged list.`
      );
    }
  })
  .popover({
    content: () => (isSearchMode ? "Add all to My Songs" : "Add all to merged"),
    trigger: "hover",
    placement: "bottom",
  });

// Update the popover content when switching modes
$("#cslgToggleModeButton").on("click", function () {
  isSearchMode = !isSearchMode;
  updateModeDisplay();

  // Clear search input and reset filter when switching modes
  $("#cslgSearchInput").val("");
  currentSearchFilter = "";

  // Additional actions when switching to My Songs mode
  if (!isSearchMode) {
    $("#cslgAnisongdbQueryInput").val("");
    // You might want to clear or reset other search-related fields here
  }

  // Refresh the song list display
  updateSongListDisplay();
});

$("#cslTrainingModeButton").on("click", () => {
  validateTrainingStart();
});

$("#cslgSettingsModal").on("shown.bs.modal", function () {
  updateModeDisplay();
});

$("#lobbyPage .topMenuBar").append(
  `<div id="lnStatsButton" class="clickAble topMenuButton topMenuMediumButton"><h3>Stats</h3></div>`
);
$("#lnStatsButton").on("click", () => {
  console.log("Stats Button Clicked");
  openStatsModal();
});
$("#lobbyPage .topMenuBar").append(
  `<div id="lnCustomSongListButton" class="clickAble topMenuButton topMenuMediumButton"><h3>CSL</h3></div>`
);
$("#lnCustomSongListButton").on("click", () => {
  console.log("CSL Button Clicked");
  openSettingsModal();
});
$("#cslgSongListTab").on("click", () => {
  tabReset();
  $("#cslgSongListTab").addClass("selected");
  $("#cslgSongListContainer").show();
});
$("#cslgQuizSettingsTab").on("click", () => {
  tabReset();
  $("#cslgQuizSettingsTab").addClass("selected");
  $("#cslgQuizSettingsContainer").show();
});
$("#cslgAnswerTab").on("click", () => {
  tabReset();
  $("#cslgAnswerTab").addClass("selected");
  $("#cslgAnswerContainer").show();
});
$("#cslgMergeTab").on("click", () => {
  tabReset();
  $("#cslgMergeTab").addClass("selected");
  $("#cslgMergeContainer").show();
});
$("#cslgHotkeyTab").on("click", () => {
  tabReset();
  $("#cslgHotkeyTab").addClass("selected");
  $("#cslgHotkeyContainer").show();
});
$("#cslgListImportTab").on("click", () => {
  tabReset();
  $("#cslgListImportTab").addClass("selected");
  $("#cslgListImportContainer").show();
});
$("#cslgInfoTab").on("click", () => {
  tabReset();
  $("#cslgInfoTab").addClass("selected");
  $("#cslgInfoContainer").show();
});
$("#cslgAnisongdbSearchButtonGo").on("click", () => {
  anisongdbDataSearch();
});
$("#cslgAnisongdbQueryInput").on("keypress", (event) => {
  if (event.which === 13) {
    anisongdbDataSearch();
  }
});

$("#cslgFileUpload").on(
  "change",
  /**
   * @this {HTMLInputElement & { files: FileList }}
   */
  function () {
    if (this.files.length) {
      this.files[0].text().then((data) => {
        try {
          mySongList = [];
          handleData(JSON.parse(data));
          mySongList = finalSongList;
          songList = [];
          if (mySongList.length === 0) {
            messageDisplayer.displayMessage("0 song links found");
          }
        } catch (error) {
          mySongList = [];
          $(this).val("");
          console.error(error);
          messageDisplayer.displayMessage("Upload Error");
        }
        setSongListTableSort();
        isSearchMode = false;
        $("#cslgToggleModeButton").text("My Songs");
        updateSongListDisplay();
        createAnswerTable();
      });
    }
  }
);

$("#cslgMergeAllButton")
  .on("click", () => {
    mergedSongList = Array.from(
      new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))
    ).map((x) => JSON.parse(x));
    createMergedSongListTable();
  })
  .popover({
    content: "Add all to merged",
    trigger: "hover",
    placement: "bottom",
  });

function clearSongList() {
  const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
  if (showIgnored) {
    ignoredSongs = [];
    saveIgnoredSongs();
  } else if (isSearchMode) {
    songList = [];
  } else {
    mySongList = [];
  }
  updateSongListDisplay();
}

$("#cslgShowIgnoredButton").on("click", function () {
  let isShowing = $(this).text() === "Hide Banished Songs";
  $(this).text(isShowing ? "Show Banished Songs" : "Hide Banished Songs");
});

$("#cslgClearSongListButton")
  .on("click", clearSongList)
  .popover({
    content: () =>
      $("#cslgShowIgnoredCheckbox").prop("checked")
        ? "Clear banished songs"
        : "Clear song list",
    trigger: "hover",
    placement: "bottom",
  });
$("#cslgTransferSongListButton")
  .on("click", () => {
    if (isSearchMode) {
      // Transfer merged songs to search results
      songList = Array.from(mergedSongList);
      gameChat.systemMessage(
        `Transferred ${mergedSongList.length} songs from merged list to search results.`
      );
    } else {
      // Transfer merged songs to My Songs
      const newSongs = mergedSongList.filter(
        (song) =>
          !mySongList.some(
            (mySong) =>
              mySong.songName === song.songName &&
              mySong.songArtist === song.songArtist &&
              mySong.animeRomajiName === song.animeRomajiName
          )
      );
      mySongList = mySongList.concat(newSongs);
      gameChat.systemMessage(
        `Transferred ${newSongs.length} new songs from merged list to My Songs.`
      );
    }
    updateSongListDisplay();
  })
  .popover({
    content: () =>
      isSearchMode
        ? "Transfer from merged to search results"
        : "Transfer from merged to My Songs",
    trigger: "hover",
    placement: "bottom",
  });
$("#cslgTableModeButton")
  .on("click", () => {
    songListTableMode = (songListTableMode + 1) % 3;
    createSongListTable();
  })
  .popover({
    content: "Table mode",
    trigger: "hover",
    placement: "bottom",
  });
$("#cslgSongOrderSelect").on("change", function () {
  songOrderType = String($(this).val());
});
$("#cslgHostOverrideSelect").on("change", function () {
  fileHostOverride = /** @type {1 | 2 | 3} */ (parseInt(String($(this).val())));
});
$("#cslgMergeButton").on("click", () => {
  mergedSongList = Array.from(
    new Set(mergedSongList.concat(songList).map((x) => JSON.stringify(x)))
  ).map((x) => JSON.parse(x));
  createMergedSongListTable();
});
$("#cslgMergeClearButton").on("click", () => {
  mergedSongList = [];
  createMergedSongListTable();
});
$("#cslgMergeDownloadButton").on("click", () => {
  if (mergedSongList.length) {
    let data =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(mergedSongList));
    let element = document.createElement("a");
    element.setAttribute("href", data);
    element.setAttribute("download", "merged.json");
    document.body.appendChild(element);
    element.click();
    element.remove();
  } else {
    messageDisplayer.displayMessage(
      "No songs",
      "add some songs to the merged song list"
    );
  }
});
$("#cslgAutocompleteButton").on("click", () => {
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
    messageDisplayer.displayMessage(
      "Autocomplete",
      "For multiplayer, just start the quiz normally and immediately lobby"
    );
  }
});
$("#cslgListImportUsernameInput").on("keypress", (event) => {
  if (event.which === 13) {
    startImport();
  }
});
$("#cslgListImportStartButton").on("click", () => {
  startImport();
});
$("#cslgListImportMoveButton").on("click", () => {
  if (!importedSongList.length) return;
  handleData(importedSongList);
  setSongListTableSort();
  createSongListTable();
  createAnswerTable();
});
$("#cslgListImportDownloadButton").on("click", () => {
  if (!importedSongList.length) return;
  let listType = $("#cslgListImportSelect").val();
  let username = String($("#cslgListImportUsernameInput").val()).trim();
  let date = new Date();
  let dateFormatted = `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  let data =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(importedSongList));
  let element = document.createElement("a");
  element.setAttribute("href", data);
  element.setAttribute(
    "download",
    `${username} ${listType} ${dateFormatted} song list.json`
  );
  document.body.appendChild(element);
  element.click();
  element.remove();
});
$("#cslgStartButton").on("click", () => {
  validateStart();
});

$("#cslgSearchCriteria, #cslgSearchInput").on("change input", function () {
  currentSearchFilter = String($("#cslgSearchInput").val()).toLowerCase();
  createSongListTable();
});

$("#cslgShowIgnoredButton").on("click", function () {
  $(this).toggleClass("active");
  let isShowing = $(this).hasClass("active");
  $(this).text(isShowing ? "Hide Banished Songs" : "Show Banished Songs");
  createSongListTable();
});

$("#cslgSongListTable").on("click", "i.clickAble", function (event) {
  const $row = $(this).closest("tr");
  const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
  const currentList = showIgnored
    ? ignoredSongs
    : isSearchMode
    ? songList
    : mySongList;
  const index = $row.index();
  const song = currentList[index];

  if (!song) {
    console.error("Song not found");
    return;
  }

  if ($(this).hasClass("fa-ban")) {
    blockSong(song);
  } else if ($(this).hasClass("fa-check")) {
    unblockSong(song);
  } else if ($(this).hasClass("fa-trash")) {
    if (showIgnored) {
      ignoredSongs = ignoredSongs.filter((s) => s !== song);
      saveIgnoredSongs();
    } else if (isSearchMode) {
      songList = songList.filter((s) => s !== song);
    } else {
      mySongList = mySongList.filter((s) => s !== song);
    }
  } else if ($(this).hasClass("fa-plus")) {
    if (isSearchMode) {
      if (
        !mySongList.some(
          (s) =>
            s.songName === song.songName &&
            s.songArtist === song.songArtist &&
            s.animeRomajiName === song.animeRomajiName
        )
      ) {
        mySongList.push(song);
        gameChat.systemMessage(`Added "${song.songName}" to My Songs list.`);
      } else {
        gameChat.systemMessage(
          `"${song.songName}" is already in My Songs list.`
        );
      }
    } else {
      mergedSongList.push(song);
      mergedSongList = Array.from(
        new Set(mergedSongList.map((x) => JSON.stringify(x)))
      ).map((x) => JSON.parse(x));
      createMergedSongListTable();
    }
  }

  updateSongListDisplay();
});

$("#cslgSongListTable")
  .on("mouseenter", "i.fa-trash", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-trash", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  })
  .on("mouseenter", "i.fa-ban", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-ban", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  })
  .on("mouseenter", "i.fa-check", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-check", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  });

$("#cslgSongListTable")
  .on("mouseenter", "i.fa-plus", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-plus", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  });
$("#cslgAnswerButtonAdd").click(() => {
  let oldName = String($("#cslgOldAnswerInput").val()).trim();
  let newName = String($("#cslgNewAnswerInput").val()).trim();
  if (oldName) {
    newName
      ? (replacedAnswers[oldName] = newName)
      : delete replacedAnswers[oldName];
    saveSettings();
    createAnswerTable();
  }
  console.log("replaced answers: ", replacedAnswers);
});
$("#cslgAnswerTable").on("click", "i.fa-pencil", (event) => {
  let oldName =
    event.target.parentElement.parentElement.querySelector(
      "td.oldName"
    ).innerText;
  let newName =
    event.target.parentElement.parentElement.querySelector(
      "td.newName"
    ).innerText;
  $("#cslgOldAnswerInput").val(oldName);
  $("#cslgNewAnswerInput").val(newName);
});
$("#cslgMergedSongListTable")
  .on("click", "i.fa-chevron-up", (event) => {
    let index =
      parseInt(
        event.target.parentElement.parentElement.querySelector("td.number")
          .innerText
      ) - 1;
    if (index !== 0) {
      [mergedSongList[index], mergedSongList[index - 1]] = [
        mergedSongList[index - 1],
        mergedSongList[index],
      ];
      createMergedSongListTable();
    }
  })
  .on("mouseenter", "i.fa-chevron-up", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-chevron-up", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  });
$("#cslgMergedSongListTable")
  .on("click", "i.fa-chevron-down", (event) => {
    let index =
      parseInt(
        event.target.parentElement.parentElement.querySelector("td.number")
          .innerText
      ) - 1;
    if (index !== mergedSongList.length - 1) {
      [mergedSongList[index], mergedSongList[index + 1]] = [
        mergedSongList[index + 1],
        mergedSongList[index],
      ];
      createMergedSongListTable();
    }
  })
  .on("mouseenter", "i.fa-chevron-down", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-chevron-down", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  });
$("#cslgMergedSongListTable")
  .on("click", "i.fa-trash", (event) => {
    let index =
      parseInt(
        event.target.parentElement.parentElement.querySelector("td.number")
          .innerText
      ) - 1;
    mergedSongList.splice(index, 1);
    createMergedSongListTable();
  })
  .on("mouseenter", "i.fa-trash", (event) => {
    event.target.parentElement.parentElement.classList.add("selected");
  })
  .on("mouseleave", "i.fa-trash", (event) => {
    event.target.parentElement.parentElement.classList.remove("selected");
  });
$("#cslgSongListModeSelect")
  .val("Anisongdb")
  .on(
    "change",
    /**
     * @this {HTMLSelectElement}
     */
    function () {
      songList = [];
      $("#cslgSongListTable tbody").empty();
      $("#cslgMergeCurrentCount").text("Current song list: 0 songs");
      $("#cslgSongListCount").text("Songs: 0");
      if (this.value === "Anisongdb") {
        $("#cslgFileUploadRow").hide();
        $("#cslgAnisongdbSearchRow").show();
        $("#cslgFileUploadRow input").val("");
      } else if (this.value === "Load File") {
        $("#cslgAnisongdbSearchRow").hide();
        $("#cslgFileUploadRow").show();
        $("#cslgAnisongdbQueryInput").val("");
      }
    }
  );
$("#cslgAnisongdbModeSelect").val("Artist");
/*$("#cslgAnisongdbModeSelect").val("Artist").on("change", function() {
    if (this.value === "Composer") {
        $("#cslgAnisongdbArrangementCheckbox").parent().show();
    }
    else {
        $("#cslgAnisongdbArrangementCheckbox").parent().hide();
    }
});*/
$("#cslgAnisongdbPartialCheckbox").prop("checked", true);
$("#cslgAnisongdbOPCheckbox").prop("checked", true);
$("#cslgAnisongdbEDCheckbox").prop("checked", true);
$("#cslgAnisongdbINCheckbox").prop("checked", true);
$("#cslgAnisongdbMaxOtherPeopleInput").val("99");
$("#cslgAnisongdbMinGroupMembersInput").val("0");
//$("#cslgAnisongdbArrangementCheckbox").parent().hide();
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
$("#cslgSettingsMaxNewSongs").val("25");
$("#cslgSettingsFastSkip").prop("checked", false);
$("#cslgFileUploadRow").hide();
$("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
$("#cslgResetCSSButton").on("click", () => {
  CSLButtonCSS = "calc(25% - 250px)";
  $("#cslgCSLButtonCSSInput").val(CSLButtonCSS);
});
$("#cslgApplyCSSButton").on("click", () => {
  let val = $("#cslgCSLButtonCSSInput").val();
  if (val) {
    CSLButtonCSS = String(val);
    saveSettings();
    applyStyles();
  } else {
    messageDisplayer.displayMessage("Error");
  }
});
$("#cslgShowCSLMessagesCheckbox")
  .prop("checked", showCSLMessages)
  .on("click", () => {
    showCSLMessages = !showCSLMessages;
  });
$("#cslgPromptAllAutocompleteButton").on("click", () => {
  cslMessage("§CSL21");
});
$("#cslgPromptAllVersionButton").on("click", () => {
  cslMessage("§CSL22");
});
$("#cslgMalClientIdInput")
  .val(malClientId)
  .on(
    "change",
    /** @this {HTMLInputElement}  */
    function () {
      malClientId = this.value;
      saveSettings();
    }
  );
tabReset();
$("#cslgSongListTab").addClass("selected");
$("#cslgSongListContainer").show();

/**
 * @param {import('./types.js').ReviewData} reviewData
 */
function saveReviewData(reviewData) {
  localStorage.setItem(
    `spacedRepetitionData_${currentProfile}`,
    JSON.stringify(reviewData)
  );
}

/**
 * @returns {import('./types.js').ReviewData}
 */
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
      incorrectSongsPerGame,
      correctSongsPerGame,
    })
  );
}

/**
 * @param {number} oldEFactor
 * @param {number} qualityOfResponse
 * @returns
 */
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
      (5 - qualityOfResponse) *
        (incorrectResponseFactor +
          (5 - qualityOfResponse) * incorrectResponseSlope));

  newEFactor = Math.max(Math.min(newEFactor, 5), 1);

  return newEFactor;
}

/**
 * @param {import('./types.js').Song} track
 */
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
    weight: 9999,
    lastFiveTries: [],
    manualWeightAdjustment: 1,
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
      lastFiveTries: lastReview.lastFiveTries,
      manualWeightAdjustment: lastReview.manualWeightAdjustment,
    },
    weight: lastReview.weight,
  };
}

/**
 * @param {string} songKey
 */
function updateNewSongsCount(songKey) {
  if (selectedSetNewSongs.has(songKey)) {
    newSongsAdded24Hours++;
    selectedSetNewSongs.delete(songKey);
    console.log(
      `New song played: ${songKey}. Total new songs in 24 hours: ${newSongsAdded24Hours}`
    );
    saveNewSongsSettings();
  }
}

/**
 * Update the reviewSong function
 *
 * @param {import('./types.js').Song} song
 * @param {boolean} success
 */
function reviewSong(song, success) {
  console.log(song);
  if (!isTraining) return;
  let reviewData = loadReviewData();
  const songKey = `${song.songArtist}_${song.songName}`;

  if (!reviewData[songKey]) {
    reviewData[songKey] = {
      date: Date.now(),
      efactor: 2.5,
      successCount: 0,
      successStreak: 0,
      failureCount: 0,
      failureStreak: 0,
      isLastTryCorrect: false,
      weight: 9999,
      lastFiveTries: [],
      manualWeightAdjustment: 1,
    };
  }

  // Store the previous attempt data
  previousAttemptData = {
    songKey: songKey,
    ...JSON.parse(JSON.stringify(reviewData[songKey])), // Deep copy of the current state
  };

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

  // Update lastFiveTries
  lastReview.lastFiveTries.push(success);
  if (lastReview.lastFiveTries.length > 5) {
    lastReview.lastFiveTries.shift();
  }

  // Calculate and store the new weight
  (lastReview.weight = calculateWeight(lastReview)), console.log(reviewData);
  saveReviewData(reviewData);

  // Update new songs count after the song has been reviewed
  updateNewSongsCount(songKey);
}

let appearanceCounter = {};

/**
 * @param {import('./types.js').ReviewDataItem} reviewData
 * @returns
 */
function calculateWeight(reviewData) {
  const OVERDUE_FACTOR_PERCENTAGE = 0.1;
  const LAST_PERFORMANCE_PERCENTAGE = 0.15;
  const EFACTOR_IMPACT_PERCENTAGE = 0.5;
  const CORRECT_GUESSES_PERCENTAGE_INFLUENCE = 0.25;
  const SUCCESS_STREAK_INFLUENCE = -0.2;
  const FAILURE_STREAK_INFLUENCE = 0.3;

  const currentDate = Date.now();

  const reviewDate = reviewData.date;
  const efactor = reviewData.efactor;
  const successStreak = reviewData.successStreak;
  const failureStreak = reviewData.failureStreak;

  // Focus on last 5 tries
  const last5Tries = reviewData.lastFiveTries || [];
  const attemptCount = last5Tries.length;
  const recentCorrectRatio =
    attemptCount > 0
      ? last5Tries.filter((attempt) => attempt).length / attemptCount
      : 0;

  /**
   * @param {number} successStreak
   * @param {number} influence
   * @param {number} cap
   */
  function calculateSuccessStreakImpact(successStreak, influence, cap) {
    let multiplier = Math.pow(2, successStreak);
    multiplier = Math.min(multiplier, cap);
    return multiplier * influence;
  }

  /**
   * @param {number} failureStreak
   * @param {number} influence
   * @param {number} cap
   */
  function calculateFailureStreakImpact(failureStreak, influence, cap) {
    let multiplier = Math.pow(2, failureStreak);
    multiplier = Math.min(multiplier, cap);
    return multiplier * influence;
  }

  let successStreakImpact = calculateSuccessStreakImpact(
    successStreak,
    SUCCESS_STREAK_INFLUENCE,
    4
  );
  let failureStreakImpact = calculateFailureStreakImpact(
    failureStreak,
    FAILURE_STREAK_INFLUENCE,
    4
  );

  const MIN_EFACTOR = 1.0;
  const intervalIncreaseFactor =
    Math.max(MIN_EFACTOR, efactor) * (1 + recentCorrectRatio);

  const idealReviewDate =
    reviewDate +
    intervalIncreaseFactor * (24 * 60 * 60 * 1000) -
    2 * (24 * 60 * 60 * 1000);
  let overdueFactor = Math.max(
    0,
    (currentDate - idealReviewDate) / (24 * 60 * 60 * 1000)
  );
  overdueFactor /= 10;

  const lastPerformance = reviewData.isLastTryCorrect ? 1 : 0;

  const efactorImpact = (5 - efactor) / 4;

  // Scale down the importance based on the number of attempts
  const scaleFactor = Math.min(1, attemptCount / 5);
  let correctGuessPercentageInfluence =
    (1 - recentCorrectRatio) *
    CORRECT_GUESSES_PERCENTAGE_INFLUENCE *
    scaleFactor;

  let weight =
    overdueFactor * OVERDUE_FACTOR_PERCENTAGE +
    (1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE +
    efactorImpact * EFACTOR_IMPACT_PERCENTAGE +
    successStreakImpact +
    failureStreakImpact +
    correctGuessPercentageInfluence;
  weight *= 100;
  weight += 100;

  weight *= reviewData.manualWeightAdjustment;

  console.log(`
    Ideal review date: ${new Date(idealReviewDate).toISOString()}
    OverdueFactor: ${overdueFactor * OVERDUE_FACTOR_PERCENTAGE}
    LastPerformance: ${(1 - lastPerformance) * LAST_PERFORMANCE_PERCENTAGE}
    EFactorImpact: ${efactorImpact * EFACTOR_IMPACT_PERCENTAGE}
    SuccessStreakImpact: ${successStreakImpact}
    FailureStreakImpact: ${failureStreakImpact}
    CorrectGuessPercentage: ${correctGuessPercentageInfluence}
    RecentCorrectRatio: ${recentCorrectRatio}
    AttemptCount: ${attemptCount}
    ScaleFactor: ${scaleFactor}
    ManualWeightAdjustment: ${reviewData.manualWeightAdjustment}
    FINAL WEIGHT: ${weight / 100}`);

  return weight;
}

// function weightedRandomSelection(reviewCandidates, maxSongs) {
//   const centerWeight = 175;

//   const candidatesArray = reviewCandidates.map((candidate) => {
//     return {
//       ...candidate,
//       adjustedWeight: adjustWeight(candidate.reviewState.weight),
//     };
//   });

//   function adjustWeight(weight) {
//     const weightDifferenceRatio = (weight - centerWeight) / centerWeight;
//     return weight * Math.pow(2, weightDifferenceRatio);
//   }

//   let totalAdjustedWeight = candidatesArray.reduce(
//     (total, candidate) => total + candidate.adjustedWeight,
//     0
//   );

//   const selectRandomly = () => {
//     let r = Math.random() * totalAdjustedWeight;
//     for (let i = 0; i < candidatesArray.length; i++) {
//       r -= candidatesArray[i].adjustedWeight;
//       if (r <= 0) {
//         return candidatesArray[i];
//       }
//     }
//   };

//   const selections = [];
//   for (let i = 0; i < maxSongs; i++) {
//     const selectedCandidate = selectRandomly();
//     if (!selectedCandidate) continue;
//     selections.push(selectedCandidate);
//     totalAdjustedWeight -= selectedCandidate.adjustedWeight;
//     candidatesArray.splice(candidatesArray.indexOf(selectedCandidate), 1);
//   }
//   return selections;
// }

// function penalizeDuplicateRomajiNames(selectedTracks, reviewCandidates) {
//   console.log(
//     `penalizeDuplicateRomajiNames started with ${selectedTracks.length} tracks`
//   );

//   const MAX_ITERATIONS = 1000;
//   let iterations = 0;
//   let index = 0;
//   let totalReplacements = 0;

//   while (index < selectedTracks.length && iterations < MAX_ITERATIONS) {
//     iterations++;
//     let duplicateIndexes = [];

//     for (let i = index + 1; i < selectedTracks.length; i++) {
//       if (
//         selectedTracks[index] &&
//         selectedTracks[i] &&
//         songList[selectedTracks[index].key] &&
//         songList[selectedTracks[i].key] &&
//         songList[selectedTracks[index].key].animeRomajiName ===
//           songList[selectedTracks[i].key].animeRomajiName
//       ) {
//         if (i - index <= 7) {
//           duplicateIndexes.push(i);
//         }
//       }
//     }

//     console.log(
//       `Iteration ${iterations}: Found ${duplicateIndexes.length} duplicates at index ${index}`
//     );

//     while (duplicateIndexes.length > 0 && selectedTracks.length > 1) {
//       let randomChance = Math.random() * 10;
//       if (randomChance >= 3) {
//         let dupeIndex = duplicateIndexes.pop();
//         let duplicateTrack = selectedTracks[dupeIndex];
//         selectedTracks.splice(dupeIndex, 1);

//         let newTrack;
//         let attempts = 0;
//         do {
//           attempts++;
//           let selectionResult = weightedRandomSelection(reviewCandidates, 1);
//           newTrack = selectionResult[0];
//         } while (
//           newTrack &&
//           songList[newTrack.key] &&
//           selectedTracks.some(
//             (track) =>
//               track &&
//               songList[track.key] &&
//               songList[track.key].animeRomajiName ===
//                 songList[newTrack.key].animeRomajiName
//           ) &&
//           attempts < 100
//         );

//         if (attempts < 100 && newTrack && songList[newTrack.key]) {
//           selectedTracks.splice(dupeIndex, 0, newTrack);
//           totalReplacements++;
//           console.log(
//             `Replaced duplicate at index ${dupeIndex} after ${attempts} attempts:`
//           );
//           console.log(
//             `  Removed: "${songList[duplicateTrack.key].animeRomajiName}" (${
//               songList[duplicateTrack.key].songName
//             } by ${songList[duplicateTrack.key].songArtist})`
//           );
//           console.log(
//             `  Added:   "${songList[newTrack.key].animeRomajiName}" (${
//               songList[newTrack.key].songName
//             } by ${songList[newTrack.key].songArtist})`
//           );
//         } else {
//           console.log(
//             `Failed to find non-duplicate replacement after 100 attempts for:`
//           );
//           console.log(
//             `  "${songList[duplicateTrack.key].animeRomajiName}" (${
//               songList[duplicateTrack.key].songName
//             } by ${songList[duplicateTrack.key].songArtist})`
//           );
//         }
//       } else {
//         let skippedIndex = duplicateIndexes.pop();
//         console.log(
//           `Skipped replacement due to random chance for duplicate at index ${skippedIndex}:`
//         );
//         console.log(
//           `  "${songList[selectedTracks[skippedIndex].key].animeRomajiName}" (${
//             songList[selectedTracks[skippedIndex].key].songName
//           } by ${songList[selectedTracks[skippedIndex].key].songArtist})`
//         );
//       }
//     }

//     if (duplicateIndexes.length === 0) {
//       index++;
//     }
//   }

//   if (iterations >= MAX_ITERATIONS) {
//     console.warn(
//       `penalizeDuplicateRomajiNames reached maximum iterations (${MAX_ITERATIONS})`
//     );
//   }

//   console.log(
//     `penalizeDuplicateRomajiNames completed after ${iterations} iterations`
//   );
//   console.log(`Total replacements made: ${totalReplacements}`);
//   console.log(`Final track count: ${selectedTracks.length}`);

//   // Remove any undefined or invalid tracks
//   selectedTracks = selectedTracks.filter(
//     (track) => track && songList[track.key]
//   );

//   return selectedTracks;
// }

// function penalizeAndAdjustSelection(
//   selectedCandidates,
//   reviewCandidates,
//   maxSongs
// ) {
//   let adjustedSelection = [...selectedCandidates];
//   let remainingCandidates = reviewCandidates.filter(
//     (c) => !selectedCandidates.includes(c)
//   );

//   // Separate new songs and regular songs
//   let newSongs = adjustedSelection.filter((c) => c.weight === 9999);
//   let regularSongs = adjustedSelection.filter((c) => c.weight !== 9999);

//   penalizeDuplicateRomajiNames(regularSongs, remainingCandidates);

//   // If we removed any regular songs during penalization, try to replace them with other regular songs
//   let regularSongsNeeded =
//     Math.min(
//       Math.floor(maxSongs / 2),
//       selectedCandidates.filter((c) => c.weight !== 9999).length
//     ) - regularSongs.length;
//   let availableRegularSongs = remainingCandidates.filter(
//     (c) => c.weight !== 9999
//   );

//   while (regularSongsNeeded > 0 && availableRegularSongs.length > 0) {
//     let randomRegularSong = weightedRandomSelection(
//       availableRegularSongs,
//       1
//     )[0];
//     regularSongs.push(randomRegularSong);
//     availableRegularSongs = availableRegularSongs.filter(
//       (c) => c !== randomRegularSong
//     );
//     regularSongsNeeded--;
//   }

//   // Combine new songs and regular songs
//   adjustedSelection = [...newSongs, ...regularSongs];

//   return adjustedSelection.slice(0, maxSongs);
// }

function addWeightAdjustmentButtons() {
  if (!quiz.cslActive || !isTraining || buttonContainerAdded) return;

  // Create the container for weight adjustment buttons
  const $weightAdjustmentContainer = $(/*html*/ `
		<div id="qpWeightAdjustmentContainer" class="container-fluid">
			<div class="row">
				<div class="col-xs-12">
					<h5 class="text-center" style="margin-bottom: 8px; color: #f2f2f2; font-size: 14px;">Song Appearance Rate</h5>
				</div>
			</div>
			<div class="row">
				<div class="col-xs-5 text-right" style="padding-right: 5px;">
					<button id="qpWeightBoostButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-chevron-up" aria-hidden="true"></i> Boost
					</button>
				</div>
				<div class="col-xs-2 text-center" style="padding-left: 2px; padding-right: 2px;">
					<button id="qpWeightResetButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-refresh" aria-hidden="true"></i>
					</button>
				</div>
				<div class="col-xs-5 text-left" style="padding-left: 5px;">
					<button id="qpWeightLowerButton" class="btn btn-sm" style="width: 100%;">
						<i class="fa fa-chevron-down" aria-hidden="true"></i> Lower
					</button>
				</div>
			</div>
			<div class="row" style="margin-top: 5px;">
				<div class="col-xs-12">
					<button id="qpWeightRevertButton" class="btn btn-info btn-sm" style="width: 100%;">
						Revert
					</button>
				</div>
			</div>
		</div>
      `);

  // Add click handlers
  $weightAdjustmentContainer
    .find("#qpWeightBoostButton")
    .click(() => adjustWeightOnUserInteraction(1.5));
  $weightAdjustmentContainer
    .find("#qpWeightResetButton")
    .click(() => adjustWeightOnUserInteraction(1));
  $weightAdjustmentContainer
    .find("#qpWeightLowerButton")
    .click(() => adjustWeightOnUserInteraction(0.5));
  $weightAdjustmentContainer
    .find("#qpWeightRevertButton")
    .click(() => revertWeight());

  // Insert the container after qpSongInfoContainer
  $weightAdjustmentContainer.insertAfter("#qpSongInfoContainer");
  buttonContainerAdded = true;

  // Add some custom CSS
  $("<style>")
    .prop("type", "text/css")
    .html(
      /*css*/ `
      #qpWeightAdjustmentContainer {
          background-color: rgba(0, 0, 0, 0.3);
          border-radius: 5px;
          padding: 4px;
          margin-top: 4px;
          margin-bottom: 4px;
          max-width: 280px;
          margin-left: auto;
          margin-right: auto;
          width: 21rem;
      }
      #qpWeightAdjustmentContainer .btn {
          transition: all 0.3s ease;
          opacity: 0.7;
          padding: 3px 6px;
          font-size: 12px;
      }
      #qpWeightAdjustmentContainer .btn:hover {
          transform: scale(1.05);
          opacity: 1;
      }
      #qpWeightLowerButton {
          background-color: rgba(70, 70, 70, 0.7);
          border-color: rgba(50, 50, 50, 0.7);
      }
      #qpWeightBoostButton {
          background-color: rgba(100, 100, 100, 0.7);
          border-color: rgba(80, 80, 80, 0.7);
      }
      #qpWeightResetButton {
          background-color: rgba(85, 85, 85, 0.7);
          border-color: rgba(65, 65, 65, 0.7);
      }
        #qpWeightRevertButton {
          background-color: rgba(85, 85, 85, 0.7);
          border-color: rgba(65, 65, 65, 0.7);
      }
      #qpWeightLowerButton:hover {
          background-color: rgba(60, 60, 60, 0.8);
          border-color: rgba(40, 40, 40, 0.8);
      }
      #qpWeightBoostButton:hover {
          background-color: rgba(110, 110, 110, 0.8);
          border-color: rgba(90, 90, 90, 0.8);
      }
      #qpWeightResetButton:hover {
          background-color: rgba(95, 95, 95, 0.8);
          border-color: rgba(75, 75, 75, 0.8);
      }
        #qpWeightRevertButton:hover {
          background-color: rgba(95, 95, 95, 0.8);
          border-color: rgba(75, 75, 75, 0.8);
      }

      #cslSettingsResetMaxNewSongs {
          background-color: rgba(100, 100, 100, 0.7);
          border-color: rgba(80, 80, 80, 0.7);
      }

        #cslSettingsResetMaxNewSongs:hover {
          background-color: rgba(110, 110, 110, 0.8);
          border-color: rgba(90, 90, 90, 0.8);
      }
      `
    )
    .appendTo("head");
}

/**
 * @param {number} factor
 */
function adjustWeightOnUserInteraction(factor) {
  if (!quiz.cslActive || !isTraining) return;

  const currentSongNumber =
    document.querySelector("#qpCurrentSongCount")?.textContent ?? "0";
  const currentSongListIndex = songOrder[currentSongNumber];

  if (currentSongListIndex === undefined) {
    console.error("Current song index not found in songOrder");
    return;
  }

  const currentSongData = mySongList[currentSongListIndex];

  if (!currentSongData) {
    console.error("Current song data not found");
    return;
  }

  const songKey = `${currentSongData.songArtist}_${currentSongData.songName}`;

  // Store the current song key
  if (songKey !== currentSongKey) {
    currentSongKey = songKey;
    originalWeight = null;
  }

  let reviewData = loadReviewData();
  if (reviewData[songKey]) {
    // Store the original weight if it hasn't been stored yet
    if (originalWeight === null) {
      originalWeight = reviewData[songKey].weight;
    }

    const previousWeight = reviewData[songKey].weight;

    reviewData[songKey].manualWeightAdjustment = factor;
    reviewData[songKey].weight = calculateWeight(reviewData[songKey]);

    const newWeight = reviewData[songKey].weight;
    console.log(previousWeight, factor, newWeight);

    saveReviewData(reviewData);

    const actionWord = factor > 1 ? "increased" : "decreased";
    gameChat.systemMessage(
      `Song weight ${actionWord} for "${currentSongData.songName}"`
    );
    console.log(
      `Song weight ${actionWord} for "${
        currentSongData.songName
      }" New: ${newWeight.toFixed(2)} | Old: ${previousWeight.toFixed(2)}`,
      reviewData[songKey]
    );
  } else {
    console.error("Review data not found for song:", songKey);
  }
}

function revertWeight() {
  if (!isTraining || !previousAttemptData) {
    console.log(
      "Cannot revert weight: No previous attempt data available or not in training mode."
    );
    return;
  }

  let reviewData = loadReviewData();
  const songKey = previousAttemptData.songKey;

  if (reviewData[songKey]) {
    const oldWeight = reviewData[songKey].weight;
    const newWeight = previousAttemptData.weight;

    // Restore the previous state
    const { songKey: _, ...previousReviewData } = previousAttemptData;
    reviewData[songKey] = { ...previousReviewData };

    saveReviewData(reviewData);

    const currentSongNumber =
      document.querySelector("#qpCurrentSongCount")?.textContent ?? "0";
    const currentSongListIndex = songOrder[currentSongNumber];
    const currentSongData = finalSongList[currentSongListIndex];

    gameChat.systemMessage(
      `Song weight reverted for "${currentSongData.songName}"`
    );
    console.log(
      `Song weight reverted for "${
        currentSongData.songName
      }". Old: ${oldWeight.toFixed(2)} | New: ${newWeight.toFixed(2)}`,
      reviewData[songKey]
    );

    // Clear the previousAttemptData after reverting
    previousAttemptData = null;
  } else {
    console.error("Review data not found for song:", songKey);
  }
}

let usedNewSongs = new Set(); // Global variable to track used new songs across game sessions

function resetNewSongsCount() {
  newSongsAdded24Hours = 0;
  lastResetTime = Date.now();
  saveNewSongsSettings();
}

/**
 * @param {import('./types.js').Song[]} songKeys
 * @param {number} maxSongs
 * @returns
 */
function prepareSongForTraining(songKeys, maxSongs) {
  console.log(`=== prepareSongForTraining START ===`);
  console.log(`Input: ${songKeys.length} tracks, maxSongs: ${maxSongs}`);
  console.log(`Current Profile: ${currentProfile}`);

  loadNewSongsSettings();
  console.log(
    `Loaded settings: maxNewSongs24Hours = ${maxNewSongs24Hours}, newSongsAdded24Hours = ${newSongsAdded24Hours}, incorrectSongsPerGame = ${incorrectSongsPerGame}, correctSongsPerGame = ${correctSongsPerGame}`
  );

  // Check if 24 hours have passed since the last reset
  if (Date.now() - lastResetTime > 24 * 60 * 60 * 1000) {
    console.log("24 hours have passed. Resetting new songs count.");
    resetNewSongsCount();
    console.log(
      `After reset: newSongsAdded24Hours = ${newSongsAdded24Hours}, lastResetTime = ${new Date(
        lastResetTime
      )}`
    );
  }

  let repeatMode = $("#cslgSettingsRepeatModeSwitch").prop("checked");

  /** @type {[number, number]} */
  let repeatModeRange = /** @type {any} */ (
    $("#cslgSettingsRepeatMode").slider("getValue")
  );

  console.log(`Repeat Mode: ${repeatMode ? "Enabled" : "Disabled"}`);
  if (repeatMode) {
    console.log(
      `Repeat Mode Range: ${repeatModeRange[0]} - ${repeatModeRange[1]}`
    );
    gameChat.systemMessage(
      "Warning: Repeat Mode is enabled. Max New Songs, Incorrect Songs per Game, and Correct Songs per Game settings are ignored."
    );
  }

  console.log(`Creating review candidates...`);
  let reviewCandidates = songKeys.map((song) => {
    let reviewState = getReviewState(song);
    return {
      ...reviewState,
      song: song,
    };
  });
  console.log(`Created ${reviewCandidates.length} review candidates`);

  if (repeatMode) {
    console.log(`Applying Repeat Mode filtering...`);
    reviewCandidates = reviewCandidates.filter((candidate) => {
      let passes =
        candidate.reviewState.efactor >= repeatModeRange[0] &&
        candidate.reviewState.efactor <= repeatModeRange[1] &&
        candidate.reviewState.weight !== 9999;
      if (passes) {
        console.log(
          `Candidate passed: ${candidate.song.songName} (E-Factor: ${candidate.reviewState.efactor}, Weight: ${candidate.reviewState.weight})`
        );
      }
      return passes;
    });
    console.log(
      `After Repeat Mode filtering: ${reviewCandidates.length} candidates`
    );
    reviewCandidates = shuffleArray(reviewCandidates).slice(0, maxSongs);
    console.log(
      `After shuffle and slice: ${reviewCandidates.length} candidates`
    );
  } else {
    console.log(`Normal mode selection...`);
    console.log(" review candidates : ", reviewCandidates);
    // By default isLastTryCorrect is set to False to be sure that the song is not correct we have to check that it is not a new song also
    let incorrectSongs = reviewCandidates.filter(
      (candidate) =>
        candidate.reviewState.isLastTryCorrect === false &&
        candidate.reviewState.weight != 9999
    );
    console.log(" incorrectSongs : ", incorrectSongs);
    let newSongs = reviewCandidates.filter(
      (candidate) => candidate.reviewState.weight === 9999
    );
    console.log(" newSongs : ", newSongs);
    let correctSongs = reviewCandidates.filter(
      (candidate) => candidate.reviewState.isLastTryCorrect === true
    );
    console.log(" correctSongs : ", correctSongs);
    let regularSongs = reviewCandidates.filter(
      (candidate) => candidate.reviewState.weight != 9999
    );
    console.log(" regularSongs : ", regularSongs);
    console.log(
      `Initial counts: ${incorrectSongs.length} incorrect, ${newSongs.length} new, ${correctSongs.length} correct, ${regularSongs.length} regular`
    );

    incorrectSongs = shuffleArray(incorrectSongs);
    newSongs = shuffleArray(newSongs);
    correctSongs = shuffleArray(correctSongs);
    regularSongs = shuffleArray(regularSongs);

    let maxIncorrectSongsToAdd = incorrectSongsPerGame;
    console.log(`Max incorrect songs to add: ${maxIncorrectSongsToAdd}`);

    let selectedIncorrectSongs = incorrectSongs.slice(
      0,
      maxIncorrectSongsToAdd
    );
    console.log(`Selected incorrect songs: ${selectedIncorrectSongs.length}`);

    let maxCorrectSongsToAdd = correctSongsPerGame;
    console.log(`Max correct songs to add: ${maxCorrectSongsToAdd}`);

    let selectedCorrectSongs = correctSongs.slice(0, maxCorrectSongsToAdd);
    console.log(`Selected incorrect songs: ${selectedCorrectSongs.length}`);

    console.log(`Adding new songs...`);
    let minLimitNewSong = Math.max(
      0,
      maxNewSongs24Hours - newSongsAdded24Hours
    );
    let maxUserSettingNewSong =
      maxSongs - (incorrectSongsPerGame + correctSongsPerGame);
    let maxNewSongsToAdd = Math.min(minLimitNewSong, maxUserSettingNewSong);
    console.log(`Max new songs to add: ${maxNewSongsToAdd}`);
    let selectedNewSongs = newSongs.slice(0, maxNewSongsToAdd);
    console.log(`Selected new songs: ${selectedNewSongs.length}`);

    // Initialize the set to store  new songs
    selectedSetNewSongs = new Set();

    // Iterate over selectedNewSongs and add to the set
    selectedNewSongs.forEach((song) => {
      // Assuming `song` has properties `songArtist` and `songName`
      selectedSetNewSongs.add(`${song.songArtist}_${song.songName}`);
    });

    reviewCandidates = [
      ...selectedNewSongs,
      ...selectedCorrectSongs,
      ...selectedIncorrectSongs,
    ];
    console.log(`Total selected candidates: ${reviewCandidates.length}`);
  }

  if (reviewCandidates.length < maxSongs) {
    console.warn(
      `Warning: Only ${reviewCandidates.length} songs selected out of ${maxSongs} requested. There may not be enough songs in the specified categories or difficulty range.`
    );
  }

  let finalIncorrectSongs = reviewCandidates.filter(
    (candidate) =>
      candidate.reviewState.isLastTryCorrect === false &&
      candidate.reviewState.weight != 9999
  );
  let finalNewSongs = reviewCandidates.filter(
    (candidate) => candidate.reviewState.weight === 9999
  );
  let finalCorrectSongs = reviewCandidates.filter(
    (candidate) => candidate.reviewState.isLastTryCorrect === true
  );
  let finalRegularSongs = reviewCandidates.filter(
    (candidate) => candidate.reviewState.weight !== 9999
  );

  console.log(`Final selection breakdown:`);
  console.log(`- Incorrect songs: ${finalIncorrectSongs.length}`);
  console.log(`- Potential new songs: ${finalNewSongs.length}`);
  console.log(`- Correct songs: ${finalCorrectSongs.length}`);
  console.log(`- Regular songs: ${finalRegularSongs.length}`);

  let finalSelection = shuffleArray(reviewCandidates).map(
    (candidate) => candidate.song
  );

  console.log(`Final selection songs:`);
  finalSelection.forEach((song, index) => {
    console.log(
      `${index + 1}. "${song.songName}" by ${song.songArtist} (Anime: ${
        song.animeRomajiName
      })`
    );
  });

  console.log(`=== prepareSongForTraining END ===`);
  return finalSelection;
}

function resetUsedNewSongs() {
  usedNewSongs.clear();
}

// setup
function setup() {
  initializeSettingsContainer();
  loadIgnoredSongs();
  new Listener("New Player", (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find(
        (p) => p.name === payload.name
      );
      if (player) {
        sendSystemMessage(`CSL: reconnecting ${payload.name}`);
        cslMessage(
          "§CSL0" +
            btoa(
              `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
                fastSkip ? "1" : "0"
              }`
            )
        );
      } else {
        cslMessage(`CSL game in progress, removing ${payload.name}`);
        lobby.changeToSpectator(payload.name);
      }
    }
  }).bindListener();
  new Listener("New Spectator", (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find(
        (p) => p.name === payload.name
      );
      if (player) {
        sendSystemMessage(`CSL: reconnecting ${payload.name}`);
        cslMessage("§CSL17" + btoa(payload.name));
      } else {
        cslMessage(
          "§CSL0" +
            btoa(
              `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
                fastSkip ? "1" : "0"
              }`
            )
        );
      }
      setTimeout(() => {
        let song = songList[songOrder[currentSong]];
        let message = `${currentSong}§${getStartPoint()}§${song.audio || ""}§${
          song.video480 || ""
        }§${song.video720 || ""}`;
        splitIntoChunks(btoa(message) + "$", 144).forEach((item, index) => {
          cslMessage("§CSL3" + base10to36(index % 36) + item);
        });
      }, 300);
    }
  }).bindListener();
  new Listener("Spectator Change To Player", (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find(
        (p) => p.name === payload.name
      );
      if (player) {
        cslMessage(
          "§CSL0" +
            btoa(
              `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
                fastSkip ? "1" : "0"
              }`
            )
        );
      } else {
        cslMessage(`CSL game in progress, removing ${payload.name}`);
        lobby.changeToSpectator(payload.name);
      }
    }
  }).bindListener();
  new Listener("Player Change To Spectator", (payload) => {
    if (quiz.cslActive && quiz.inQuiz && quiz.isHost) {
      let player = Object.values(quiz.players).find(
        (p) => p.name === payload.playerDescription.name
      );
      if (player) {
        cslMessage("§CSL17" + btoa(payload.playerDescription.name));
      } else {
        cslMessage(
          "§CSL0" +
            btoa(
              `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
                fastSkip ? "1" : "0"
              }`
            )
        );
      }
    }
  }).bindListener();
  new Listener("Host Promotion", () => {
    if (quiz.cslActive && quiz.inQuiz) {
      sendSystemMessage("CSL host changed, ending quiz");
      quizOver();
    }
  }).bindListener();
  new Listener("Player Left", (payload) => {
    if (
      quiz.cslActive &&
      quiz.inQuiz &&
      payload.player.name === cslMultiplayer.host
    ) {
      sendSystemMessage("CSL host left, ending quiz");
      quizOver();
    }
  }).bindListener();
  new Listener("Spectator Left", (payload) => {
    if (
      quiz.cslActive &&
      quiz.inQuiz &&
      payload.spectator === cslMultiplayer.host
    ) {
      sendSystemMessage("CSL host left, ending quiz");
      quizOver();
    }
  }).bindListener();
  new Listener("game closed", (payload) => {
    if (quiz.cslActive && quiz.inQuiz) {
      reset();
      messageDisplayer.displayMessage("Room Closed", payload.reason);
      lobby.leave({ supressServerMsg: true });
    }
  }).bindListener();
  new Listener("game chat update", (payload) => {
    for (let message of payload.messages) {
      if (message.message.startsWith("§CSL")) {
        if (!showCSLMessages) {
          setTimeout(() => {
            let $message = gameChat.$chatMessageContainer
              .find(".gcMessage")
              .last();
            if ($message.text().startsWith("§CSL")) $message.parent().remove();
          }, 0);
        }
        parseMessage(message.message, message.sender);
      } else if (
        debug &&
        message.sender === selfName &&
        message.message.startsWith("/csl")
      ) {
        try {
          cslMessage(JSON.stringify(eval(message.message.slice(5))));
        } catch {
          cslMessage("ERROR");
        }
      }
    }
  }).bindListener();
  // new Listener("Game Chat Message", (payload) => {
  //   if (payload.message.startsWith("§CSL")) {
  //     parseMessage(message.message, message.sender);
  //   }
  // }).bindListener();
  new Listener("Game Starting", () => {
    clearTimeEvents();
  }).bindListener();
  new Listener("Join Game", () => {
    reset();
  }).bindListener();
  new Listener("Spectate Game", () => {
    reset();
  }).bindListener();
  new Listener("Host Game", () => {
    reset();
    $("#cslgSettingsModal").modal("hide");
  }).bindListener();
  new Listener("get all song names", () => {
    setTimeout(() => {
      let list = quiz.answerInput.typingInput.autoCompleteController.list;
      if (list.length) {
        autocomplete = list.map((x) => x.toLowerCase());
        autocompleteInput = new AmqAwesomeplete(
          /** @type {HTMLInputElement} **/ (
            document.querySelector("#cslgNewAnswerInput")
          ),
          { list: list },
          true
        );
      }
    }, 10);
  }).bindListener();
  new Listener("update all song names", () => {
    setTimeout(() => {
      let list = quiz.answerInput.typingInput.autoCompleteController.list;
      if (list.length) {
        autocomplete = list.map((x) => x.toLowerCase());
        autocompleteInput.list = list;
      }
    }, 10);
  }).bindListener();

  quiz.pauseButton.$button.off("click").on("click", () => {
    if (quiz.cslActive) {
      if (quiz.soloMode) {
        if (quiz.pauseButton.pauseOn) {
          fireListener("quiz unpause triggered", {
            playerName: selfName,
          });
          /*fireListener("quiz unpause triggered", {
                        "playerName": selfName,
                        "doCountDown": true,
                        "countDownLength": 3000
                    });*/
        } else {
          fireListener("quiz pause triggered", {
            playerName: selfName,
            noPlayerPause: null,
          });
        }
      } else {
        if (quiz.pauseButton.pauseOn) {
          cslMessage("§CSL12");
        } else {
          cslMessage("§CSL11");
        }
      }
    } else {
      socket.sendCommand({
        type: "quiz",
        command: quiz.pauseButton.pauseOn ? "quiz unpause" : "quiz pause",
      });
    }
  });

  const oldSendSkipVote = quiz.skipController.sendSkipVote;
  quiz.skipController.sendSkipVote = function () {
    if (quiz.cslActive) {
      if (quiz.soloMode) {
        clearTimeout(this.autoVoteTimeout);
      } else if (!skipping) {
        cslMessage("§CSL14");
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
        cslMessage("§CSL10");
      }
    } else {
      oldStartReturnLobbyVote.apply(this, arguments);
    }
  };

  const oldSubmitAnswer = QuizTypeAnswerInputController.prototype.submitAnswer;
  QuizTypeAnswerInputController.prototype.submitAnswer = function (
    /** @type {string} */ answer
  ) {
    if (quiz.cslActive) {
      currentAnswers[quiz.ownGamePlayerId ?? 0] = answer;
      this.skipController.highlight = true;
      fireListener("quiz answer", {
        answer: answer,
        success: true,
      });
      if (quiz.soloMode) {
        fireListener("player answered", [0]);
        if (options.autoVoteSkipGuess) {
          this.skipController.voteSkip();
          fireListener("quiz overlay message", "Skipping to Answers");
        }
      } else {
        cslMessage("§CSL13");
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
      gameChat.systemMessage(
        `CSL Error: couldn't load song ${currentSong + 1}`
      );
      nextVideoReady = true;
    } else {
      oldHandleError.apply(this, arguments);
    }
  };

  document.body.addEventListener("keydown", (event) => {
    const key = event.key;
    const altKey = event.altKey;
    const ctrlKey = event.ctrlKey;
    if (testHotkey("start", key, altKey, ctrlKey)) {
      validateStart();
    }
    if (testHotkey("stop", key, altKey, ctrlKey)) {
      quizOver();
    }

    if (testHotkey("startTraining", key, altKey, ctrlKey)) {
      validateTrainingStart();
    }
    if (testHotkey("stopTraining", key, altKey, ctrlKey)) {
      quizOver();
    }

    if (testHotkey("cslgWindow", key, altKey, ctrlKey)) {
      if ($("#cslgSettingsModal").is(":visible")) {
        $("#cslgSettingsModal").modal("hide");
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
    return messageDisplayer.displayMessage("Unable to start", "must be host");
  }
  if (lobby.numberOfPlayers !== lobby.numberOfPlayersReady) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "all players must be ready"
    );
  }
  if (!mySongList || !mySongList.length) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "no songs in My Songs list"
    );
  }
  if (autocomplete.length === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "autocomplete list empty"
    );
  }
  let numSongs = getSliderValue(
    "#cslgSettingsSongs",
    "#cslgSettingsSongsInput"
  );
  if (isNaN(numSongs) || numSongs < 1) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid number of songs"
    );
  }
  guessTime = getSliderValue(
    "#cslgSettingsGuessTime",
    "#cslgSettingsGuessTimeInput"
  );
  if (isNaN(guessTime) || guessTime < 1 || guessTime > 99) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid guess time"
    );
  }
  extraGuessTime = getSliderValue(
    "#cslgSettingsExtraGuessTime",
    "#cslgSettingsExtraGuessTimeInput"
  );
  if (isNaN(extraGuessTime) || extraGuessTime < 0 || extraGuessTime > 15) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "invalid extra guess time"
    );
  }
  /** @type {[number, number]} */
  startPointRange = /** @type {any} */ (
    $("#cslgSettingsStartPoint").slider("getValue")
  );
  if (
    startPointRange[0] < 0 ||
    startPointRange[0] > 100 ||
    startPointRange[1] < 0 ||
    startPointRange[1] > 100 ||
    startPointRange[0] > startPointRange[1]
  ) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "song start sample must be a range 0-100"
    );
  }

  /** @type {[number, number]} */
  difficultyRange = /** @type {any} */ (
    $("#cslgSettingsDifficulty").slider("getValue")
  );
  if (
    difficultyRange[0] < 0 ||
    difficultyRange[0] > 100 ||
    difficultyRange[1] < 0 ||
    difficultyRange[1] > 100 ||
    difficultyRange[0] > difficultyRange[1]
  ) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "difficulty must be a range 0-100"
    );
  }
  let ops = $("#cslgSettingsOPCheckbox").prop("checked");
  let eds = $("#cslgSettingsEDCheckbox").prop("checked");
  let ins = $("#cslgSettingsINCheckbox").prop("checked");
  let tv = $("#cslgSettingsTVCheckbox").prop("checked");
  let movie = $("#cslgSettingsMovieCheckbox").prop("checked");
  let ova = $("#cslgSettingsOVACheckbox").prop("checked");
  let ona = $("#cslgSettingsONACheckbox").prop("checked");
  let special = $("#cslgSettingsSpecialCheckbox").prop("checked");

  let filteredSongs = mySongList.filter((song) => {
    // Type check for song.songType (can be either string or number)
    let passesTypeFilter = false;
    if (typeof song.songType === "number") {
      // Handle as a number (assuming 1 = Opening, 2 = Ending, 3 = Insert)
      passesTypeFilter =
        (ops && song.songType === 1) ||
        (eds && song.songType === 2) ||
        (ins && song.songType === 3);
    } else if (typeof song.songType === "string") {
      // Handle as a string (check if it contains "Opening", "Ending", or "Insert")
      let songType = String(song.songType); // Ensure it's a string
      passesTypeFilter =
        (ops && songType.includes("Opening")) ||
        (eds && songType.includes("Ending")) ||
        (ins && songType.includes("Insert"));
    } else {
      console.log("Unknown songType format:", song.songType);
    }
    let passesAnimeTypeFilter =
      (tv && song.animeType === "TV") ||
      (movie && song.animeType === "Movie") ||
      (ova && song.animeType === "OVA") ||
      (ona && song.animeType === "ONA") ||
      (special && song.animeType === "Special");
    return (
      passesTypeFilter &&
      passesAnimeTypeFilter &&
      difficultyFilter(song, difficultyRange[0], difficultyRange[1])
    );
  });

  if (filteredSongs.length === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "0 songs match the specified criteria"
    );
  }

  if (songOrderType === "random") {
    shuffleArray(filteredSongs);
  } else if (songOrderType === "descending") {
    filteredSongs.reverse();
  }

  filteredSongs.slice(0, numSongs).forEach((song, i) => {
    songOrder[i + 1] = mySongList.indexOf(song); // Store the index in mySongList
  });

  totalSongs = Object.keys(songOrder).length;
  if (totalSongs === 0) {
    return messageDisplayer.displayMessage(
      "Unable to start",
      "no songs match the specified criteria"
    );
  }
  fastSkip = $("#cslgSettingsFastSkip").prop("checked");
  $("#cslgSettingsModal").modal("hide");
  console.log("song order: ", songOrder);
  if (lobby.soloMode) {
    startQuiz();
  } else if (lobby.isHost) {
    cslMessage(
      "§CSL0" +
        btoa(
          `${showSelection}§${currentSong}§${totalSongs}§${guessTime}§${extraGuessTime}§${
            fastSkip ? "1" : "0"
          }`
        )
    );
  }
}

// start quiz and load first song
function startQuiz() {
  if (!lobby.inLobby) return;
  if (lobby.soloMode) {
    if (mySongList.length) {
      finalSongList = mySongList;
    } else if (songList.length) {
      finalSongList = songList;
    } else {
      return;
    }
  } else {
    cslMultiplayer.host = lobby.hostName;
  }

  /** @type {import('./types.js').Song} */
  let song;

  if (lobby.isHost) {
    song = finalSongList[songOrder[1]];
  }
  skipping = false;
  quiz.cslActive = true;
  addWeightAdjustmentButtons();
  let date = new Date().toISOString();
  for (let player of Object.values(lobby.players)) {
    score[player.gamePlayerId] = 0;
  }

  /** @type {import('./types.js').GameStartingPayload} */
  let data = {
    gameMode: /** @type {import('./types.js').Gamemode} */ (
      lobby.soloMode ? "Solo" : "Multiplayer"
    ),
    showSelection: showSelection,
    groupSlotMap: createGroupSlotMap(Object.keys(lobby.players).map(Number)),
    players: Object.values(lobby.players).map((player, i) => ({
      name: player.name,
      level: player.level,
      gamePlayerId: player.gamePlayerId,
      hasMultiChoiceActive: player.hasMultiChoiceActive,
      host: player.host,
      avatarInfo: player.avatarInfo,
      inGame: player.inGame,
      pose: 1,
      score: 0,
      position: Math.floor(i / 8) + 1,
      positionSlot: i % 8,
      teamCaptain: null,
      teamNumber: null,
      teamPlayer: null,
    })),
    multipleChoice: false,
    quizDescription: {
      quizId: "",
      startTime: date,
      roomName: hostModal.$roomName.val(),
    },
  };
  fireListener("Game Starting", data);
  setTimeout(() => {
    if (quiz.soloMode) {
      fireListener("quiz next video info", {
        playLength: guessTime,
        playbackSpeed: 1,
        startPoint: getStartPoint(),
        videoInfo: {
          id: -1,
          videoMap: {
            catbox: createCatboxLinkObject(
              song.audio,
              song.video480,
              song.video720
            ),
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
        let message = `1§${getStartPoint()}§${song.audio || ""}§${
          song.video480 || ""
        }§${song.video720 || ""}`;
        splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach(
          (item, index) => {
            cslMessage("§CSL3" + base10to36(index % 36) + item);
          }
        );
      }
    }
  }, 100);

  if (quiz.soloMode) {
    setTimeout(() => {
      fireListener("quiz ready", {
        numberOfSongs: totalSongs,
      });
    }, 200);
    setTimeout(() => {
      fireListener("quiz waiting buffering", {
        firstSong: true,
      });
    }, 300);
    setTimeout(() => {
      previousSongFinished = true;
      readySong(1);
    }, 400);
  }
}

/**
 * Check if all conditions are met to go to next song
 * @param {number} songNumber
 */
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
        cslMessage("§CSL4" + btoa(String(songNumber)));
      }
    }
  }, 100);
}

/**
 * Play a song
 * @param {number} songNumber
 */
function playSong(songNumber) {
  if (!quiz.cslActive || !quiz.inQuiz) return reset();
  for (const player of Object.values(quiz.players)) {
    currentAnswers[player.gamePlayerId] = "";
    cslMultiplayer.voteSkip[player.gamePlayerId] = false;
  }
  answerChunks = {};
  resultChunk = new Chunk();
  songInfoChunk = new Chunk();
  cslMultiplayer.songInfo = {};
  currentSong = songNumber;
  cslState = 1;
  skipping = false;
  fireListener("play next song", {
    time: guessTime,
    extraGuessTime: extraGuessTime,
    songNumber: songNumber,
    progressBarState: { length: guessTime, played: 0 },
    onLastSong: songNumber === totalSongs,
    multipleChoiceNames: null,
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
    } else if (quiz.isHost) {
      cslMessage("§CSL15");
    }
  }, (guessTime + extraGuessTime) * 1000);
  if (quiz.soloMode) {
    skipInterval = setInterval(() => {
      if (quiz.skipController.toggled) {
        fireListener("quiz overlay message", "Skipping to Answers");
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
        let nextSong = finalSongList[songOrder[songNumber + 1]];
        fireListener("quiz next video info", {
          playLength: guessTime,
          playbackSpeed: 1,
          startPoint: getStartPoint(),
          videoInfo: {
            id: -1,
            videoMap: {
              catbox: createCatboxLinkObject(
                nextSong.audio,
                nextSong.video480,
                nextSong.video720
              ),
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
          let nextSong = finalSongList[songOrder[songNumber + 1]];
          let message = `${songNumber + 1}§${getStartPoint()}§${
            nextSong.audio || ""
          }§${nextSong.video480 || ""}§${nextSong.video720 || ""}`;
          splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach(
            (item, index) => {
              cslMessage("§CSL3" + base10to36(index % 36) + item);
            }
          );
        }
      }
    }
  }, 100);
}

/**
 * end guess phase and display answer
 *
 * @param {number} songNumber
 */
function endGuessPhase(songNumber) {
  if (!quiz.cslActive || !quiz.inQuiz) return reset();

  /** @type {import('./types.js').Song} */
  let song;
  if (quiz.isHost) {
    song = finalSongList[songOrder[songNumber]];
    console.log("song found ", song);
  }
  fireListener("guess phase over");
  if (
    !quiz.soloMode &&
    quiz.inQuiz &&
    !quiz.isSpectator &&
    quiz.ownGamePlayerId != null
  ) {
    let answer = currentAnswers[quiz.ownGamePlayerId];
    if (answer) {
      splitIntoChunks(btoa(encodeURIComponent(answer)) + "$", 144).forEach(
        (item, index) => {
          cslMessage("§CSL5" + base10to36(index % 36) + item);
        }
      );
    }
  }
  answerTimer = setTimeout(
    () => {
      if (!quiz.cslActive || !quiz.inQuiz) return reset();
      cslState = 2;
      skipping = false;
      if (!quiz.soloMode) {
        for (let player of Object.values(quiz.players)) {
          currentAnswers[player.gamePlayerId] = answerChunks[
            player.gamePlayerId
          ]
            ? answerChunks[player.gamePlayerId].decode()
            : "";
        }
      }
      for (const player of Object.values(quiz.players)) {
        cslMultiplayer.voteSkip[player.gamePlayerId] = false;
      }
      let data = {
        answers: Object.values(quiz.players).map((player) => ({
          gamePlayerId: player.gamePlayerId,
          pose: 3,
          answer: currentAnswers[player.gamePlayerId] || "",
        })),
        progressBarState: null,
      };
      fireListener("player answers", data);
      if (!quiz.soloMode && quiz.isHost) {
        let message = `${song.animeRomajiName || ""}\n${
          song.animeEnglishName || ""
        }\n${(song.altAnimeNames || []).join("\t")}\n${(
          song.altAnimeNamesAnswers || []
        ).join("\t")}\n${song.songArtist || ""}\n${song.songName || ""}\n${
          song.songType || ""
        }\n${song.typeNumber || ""}\n${song.songDifficulty || ""}\n${
          song.animeType || ""
        }\n${song.animeVintage || ""}\n${song.annId || ""}\n${
          song.malId || ""
        }\n${song.kitsuId || ""}\n${song.aniListId || ""}\n${
          Array.isArray(song.animeTags) ? song.animeTags.join(",") : ""
        }\n${
          Array.isArray(song.animeGenre) ? song.animeGenre.join(",") : ""
        }\n${song.audio || ""}\n${song.video480 || ""}\n${song.video720 || ""}`;
        splitIntoChunks(btoa(encodeURIComponent(message)) + "$", 144).forEach(
          (item, index) => {
            cslMessage("§CSL7" + base10to36(index % 36) + item);
          }
        );
      }
      answerTimer = setTimeout(
        () => {
          if (!quiz.cslActive || !quiz.inQuiz) return reset();
          /** @type {Record<number, boolean>} */
          let correct = {};

          /** @type {Record<number, number>} */
          let pose = {};

          if (quiz.isHost) {
            for (let player of Object.values(quiz.players)) {
              let isCorrect = isCorrectAnswer(
                songNumber,
                currentAnswers[player.gamePlayerId]
              );
              correct[player.gamePlayerId] = isCorrect;
              pose[player.gamePlayerId] = currentAnswers[player.gamePlayerId]
                ? isCorrect
                  ? 5
                  : 4
                : 6;
              if (isCorrect) score[player.gamePlayerId]++;
            }
          }
          if (quiz.soloMode) {
            let data = {
              players: Object.values(quiz.players).map((player) => ({
                gamePlayerId: player.gamePlayerId,
                pose: pose[player.gamePlayerId],
                level: quiz.players[player.gamePlayerId].level,
                correct: correct[player.gamePlayerId],
                score: score[player.gamePlayerId],
                listStatus: null,
                showScore: null,
                position: Math.floor(player.gamePlayerId / 8) + 1,
                positionSlot: player.gamePlayerId % 8,
              })),
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
                typeNumber: song.typeNumber,
                annId: song.annId,
                highRisk: 0,
                animeScore: song.rating,
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
              groupMap: createGroupSlotMap(
                Object.keys(quiz.players).map(Number)
              ),
              watched: false,
            };

            fireListener("answer results", data);
          } else if (quiz.isHost) {
            let list = [];
            for (let id of Object.keys(correct)) {
              const numId = parseInt(id);
              list.push(
                `${id},${correct[numId] ? "1" : "0"},${pose[numId]},${
                  score[numId]
                }`
              );
            }
            splitIntoChunks(
              btoa(encodeURIComponent(list.join("§"))) + "$",
              144
            ).forEach((item, index) => {
              cslMessage("§CSL6" + base10to36(index % 36) + item);
            });
          }
          // Set a flag to prevent multiple calls to endReplayPhase
          let replayPhaseEnded = false;
          // Set a time limit after which the replay phase will end automatically
          const autoEndTime = 25000; // Example: 1 second for fastSkip, 2 seconds otherwise

          // Timeout to automatically end replay phase
          const timeoutId = setTimeout(() => {
            if (!replayPhaseEnded) {
              // Only call if replay phase hasn't ended yet
              replayPhaseEnded = true;
              endReplayPhase(songNumber); // Automatically end replay phase
              clearInterval(skipInterval);
              clearTimeout(timeoutId);
            }
          }, autoEndTime);

          setTimeout(
            () => {
              if (!quiz.cslActive || !quiz.inQuiz) {
                clearTimeout(timeoutId); // Clear the timeout as well
                return reset();
              }
              if (quiz.soloMode) {
                skipInterval = setInterval(() => {
                  if (fastSkip || quiz.skipController.toggled) {
                    if (!replayPhaseEnded) {
                      clearInterval(skipInterval);
                      clearTimeout(timeoutId); // Cancel the automatic timeout
                      replayPhaseEnded = true;
                      endReplayPhase(songNumber);
                    }
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

/**
 * End replay phase
 *
 * @param {number} songNumber
 */
function endReplayPhase(songNumber) {
  if (!quiz.cslActive || !quiz.inQuiz) return reset();
  //console.log(`end replay phase (${songNumber})`);
  if (songNumber < totalSongs) {
    fireListener("quiz overlay message", "Skipping to Next Song");
    setTimeout(
      () => {
        previousSongFinished = true;
      },
      fastSkip ? 1000 : 3000
    );
  } else {
    fireListener("quiz overlay message", "Skipping to Final Standings");
    setTimeout(
      () => {
        let sortedScores = Array.from(new Set(Object.values(score))).sort(
          (a, b) => b - a
        );
        let data = {
          resultStates: Object.values(score).map((score, i) => ({
            gamePlayerId: i,
            pose: 1,
            endPosition: sortedScores.indexOf(score) + 1,
          })),
        };
        fireListener("quiz end result", data);
      },
      fastSkip ? 2000 : 5000
    );
    setTimeout(
      () => {
        if (quiz.soloMode) {
          quizOver();
        } else if (quiz.isHost) {
          cslMessage("§CSL10");
        }
      },
      fastSkip ? 5000 : 12000
    );
  }
}

/**
 * @overload
 * @param {"Game Starting"} type
 * @param {import('./types.js').GameStartingPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz unpause triggered"} type
 * @param {import('./types.js').QuizUnpausedPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz pause triggered"} type
 * @param {import('./types.js').QuizPausedPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"player answered"} type
 * @param {number[]} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz overlay message"} type
 * @param {string} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz next video info"} type
 * @param {import('./types.js').QuizNextVideoInfoPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz ready"} type
 * @param {import('./types.js').QuizReadyPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz waiting buffering"} type
 * @param {import('./types.js').QuizWaitingBufferingPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"play next song"} type
 * @param {import('./types.js').QuizPlayNextSong} data
 * @return {void}
 */

/**
 * @overload
 * @param {"extra guess time"} type
 * @param {void} data
 * @return {void}
 */

/**
 * @overload
 * @param {"guess phase over"} type
 * @param {void} data
 * @return {void}
 */

/**
 * @overload
 * @param {"player answers"} type
 * @param {any} data
 * @return {void}
 */

/**
 * @overload
 * @param {"Rejoining Player"} type
 * @param {import('./types').PlayerRejoinPayload} data
 * @return {void}
 */

/**
 * @overload
 * @param {"answer results"} type
 * @param {any} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz end result"} type
 * @param {any} data
 * @return {void}
 */

/**
 * @overload
 * @param {"quiz answer"} type
 * @param {any} data
 * @return {void}
 */

/**
 * Fire all event listeners (including scripts)
 *
 * @param {string} type
 * @param {any} data
 */
function fireListener(type, data = undefined) {
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

/**
 * Send csl chat message
 *
 * @param {string} text
 */
function cslMessage(text) {
  if (!isRankedMode()) {
    socket.sendCommand({
      type: "lobby",
      command: "game chat message",
      data: { msg: String(text), teamMessage: false },
    });
  }
}

/**
 * Send a client side message to game chat
 *
 * @param {string} message
 */
function sendSystemMessage(message) {
  if (gameChat.open) {
    setTimeout(() => {
      gameChat.systemMessage(String(message));
    }, 1);
  }
}

/**
 * Parse message
 *
 * @param {string} content
 * @param {string} sender
 */
function parseMessage(content, sender) {
  if (isRankedMode()) return;
  let player;
  if (lobby.inLobby)
    player = Object.values(lobby.players).find((x) => x.name === sender);
  else if (quiz.inQuiz)
    player = Object.values(quiz.players).find((x) => x.name === sender);
  let isHost = sender === cslMultiplayer.host;
  if (content.startsWith("§CSL0")) {
    //start quiz
    if (lobby.inLobby && sender === lobby.hostName && !quiz.cslActive) {
      let split = atob(content.slice(5)).split("§");
      if (split.length === 6) {
        //mode = parseInt(split[0]);
        currentSong = parseInt(split[1]);
        totalSongs = parseInt(split[2]);
        guessTime = parseInt(split[3]);
        extraGuessTime = parseInt(split[4]);
        fastSkip = Boolean(parseInt(split[5]));
        sendSystemMessage(
          `CSL: starting multiplayer quiz (${totalSongs} songs)`
        );
        startQuiz();
      }
    }
  } else if (
    quiz.cslActive &&
    quiz.inQuiz &&
    cslMultiplayer.host !== lobby.hostName
  ) {
    sendSystemMessage("client out of sync, quitting CSL");
    quizOver();
  } else if (content === "§CSL10") {
    //return to lobby
    if (
      quiz.cslActive &&
      quiz.inQuiz &&
      (isHost || sender === lobby.hostName)
    ) {
      quizOver();
    }
  } else if (content === "§CSL11") {
    //pause
    if (quiz.cslActive && isHost) {
      fireListener("quiz pause triggered", {
        playerName: sender,
        noPlayerPause: null,
      });
    }
  } else if (content === "§CSL12") {
    //unpause
    if (quiz.cslActive && isHost) {
      fireListener("quiz unpause triggered", {
        playerName: sender,
      });
    }
  } else if (content === "§CSL13") {
    //player answered
    if (quiz.cslActive && player) {
      fireListener("player answered", [player.gamePlayerId]);
    }
  } else if (content === "§CSL14") {
    //vote skip
    if (quiz.cslActive && quiz.isHost && player) {
      cslMultiplayer.voteSkip[player.gamePlayerId] = true;
      if (!skipping && checkVoteSkip()) {
        skipping = true;
        if (cslState === 1) {
          cslMessage("§CSL15");
        } else if (cslState === 2) {
          cslMessage("§CSL16");
        }
      }
    }
  } else if (content === "§CSL15") {
    //skip guessing phase
    if (quiz.cslActive && isHost) {
      fireListener("quiz overlay message", "Skipping to Answers");
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
  } else if (content === "§CSL16") {
    //skip replay phase
    if (quiz.cslActive && isHost) {
      endReplayPhase(currentSong);
    }
  } else if (content.startsWith("§CSL17")) {
    //player rejoin
    if (sender === lobby.hostName) {
      let name = atob(content.slice(6));
      if (name === selfName) {
        socket.sendCommand({ type: "lobby", command: "change to player" });
      } else if (quiz.cslActive && quiz.inQuiz) {
        let player = Object.values(quiz.players).find((p) => p.name === name);
        if (player) {
          fireListener("Rejoining Player", {
            name: name,
            gamePlayerId: player.gamePlayerId,
          });
        }
      }
    }
  } else if (content === "§CSL21") {
    //has autocomplete
    cslMessage(`Autocomplete: ${autocomplete.length ? "✅" : "⛔"}`);
  } else if (content === "§CSL22") {
    //version
    cslMessage(`CSL version ${version}`);
  } else if (content.startsWith("§CSL3")) {
    //next song link
    if (quiz.cslActive && isHost) {
      //§CSL3#songNumber§startPoint§mp3§480§720
      nextSongChunk.append(content);
      if (nextSongChunk.isComplete) {
        let split = nextSongChunk.decode().split("§");
        nextSongChunk = new Chunk();
        if (split.length === 5) {
          if (!songLinkReceived[split[0]]) {
            songLinkReceived[split[0]] = true;
            fireListener("quiz next video info", {
              playLength: guessTime,
              playbackSpeed: 1,
              startPoint: parseInt(split[1]),
              videoInfo: {
                id: -1,
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
                fireListener("quiz ready", {
                  numberOfSongs: totalSongs,
                });
              }, 200);
              setTimeout(() => {
                fireListener("quiz waiting buffering", {
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
  } else if (content.startsWith("§CSL4")) {
    //play song
    if (quiz.cslActive && isHost) {
      let number = parseInt(atob(content.slice(5)));
      //console.log("Play song: " + number);
      if (currentSong !== totalSongs) {
        playSong(number);
      }
    }
  } else if (content.startsWith("§CSL5")) {
    //player final answer
    if (quiz.cslActive && player) {
      if (!answerChunks[player.gamePlayerId])
        answerChunks[player.gamePlayerId] = new Chunk();
      answerChunks[player.gamePlayerId].append(content);
    }
  } else if (content.startsWith("§CSL6")) {
    //answer results
    if (quiz.cslActive && isHost) {
      resultChunk.append(content);
      if (resultChunk.isComplete) {
        let split = resultChunk.decode().split("§");
        let decodedPlayers = [];
        for (const p of split) {
          let playerSplit = p.split(",");
          decodedPlayers.push({
            id: parseInt(playerSplit[0]),
            correct: Boolean(parseInt(playerSplit[1])),
            pose: parseInt(playerSplit[2]),
            score: parseInt(playerSplit[3]),
          });
        }
        decodedPlayers.sort((a, b) => b.score - a.score);
        let data = {
          players: decodedPlayers.map((p, i) => ({
            gamePlayerId: p.id,
            pose: p.pose,
            level: quiz.players[p.id].level,
            correct: p.correct,
            score: p.score,
            listStatus: null,
            showScore: null,
            position: Math.floor(i / 8) + 1,
            positionSlot: i % 8,
          })),
          songInfo: {
            animeNames: {
              english: cslMultiplayer.songInfo.animeEnglishName,
              romaji: cslMultiplayer.songInfo.animeRomajiName,
            },
            artist: cslMultiplayer.songInfo.songArtist,
            songName: cslMultiplayer.songInfo.songName,
            videoTargetMap: {
              catbox: {
                0: formatTargetUrl(cslMultiplayer.songInfo.audio) || "",
                480: formatTargetUrl(cslMultiplayer.songInfo.video480) || "",
                720: formatTargetUrl(cslMultiplayer.songInfo.video720) || "",
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
            altAnimeNamesAnswers:
              cslMultiplayer.songInfo.altAnimeNamesAnswers || [],
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
          groupMap: createGroupSlotMap(Object.keys(quiz.players).map(Number)),
          watched: false,
        };

        fireListener("answer results", data);
      }
    }
  } else if (content.startsWith("§CSL7")) {
    songInfoChunk.append(content);
    if (songInfoChunk.isComplete) {
      let split = preventCodeInjection(songInfoChunk.decode()).split("\n");
      cslMultiplayer.songInfo.animeRomajiName = split[0];
      cslMultiplayer.songInfo.animeEnglishName = split[1];
      cslMultiplayer.songInfo.altAnimeNames = split[2]
        .split("\t")
        .filter(Boolean);
      cslMultiplayer.songInfo.altAnimeNamesAnswers = split[3]
        .split("\t")
        .filter(Boolean);
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
      cslMultiplayer.songInfo.animeTags = split[15].split(",");
      cslMultiplayer.songInfo.animeGenre = split[16].split(",");
      cslMultiplayer.songInfo.audio = split[17];
      cslMultiplayer.songInfo.video480 = split[18];
      cslMultiplayer.songInfo.video720 = split[19];
      console.log(split);
    }
  }
}

function checkVoteSkip() {
  return Object.entries(cslMultiplayer.voteSkip)
    .filter(
      ([key, value]) =>
        quiz.players.hasOwnProperty(key) &&
        !quiz.players[parseInt(key)].avatarDisabled
    )
    .every(([, x]) => x);
}

/**
 * Input list of player keys, return group slot map
 *
 * @param {number[]} players
 */
function createGroupSlotMap(players) {
  players = players.map(Number);

  /** @type {Record<number, number[]>} */
  let map = {};

  let group = 1;
  if (Object.keys(score).length) players.sort((a, b) => score[b] - score[a]);
  for (let i = 0; i < players.length; i += 8) {
    map[group] = players.slice(i, i + 8);
    group++;
  }
  return map;
}

/**
 * Check if the player's answer is correct
 *
 * @param {number} songNumber
 * @param {string | null} answer
 */
function isCorrectAnswer(songNumber, answer) {
  let song = finalSongList[songOrder[songNumber]];
  if (!answer) {
    reviewSong(song, false);
    return false;
  }
  answer = answer.toLowerCase();
  let correctAnswers = [
    ...(song.altAnimeNames || []),
    ...(song.altAnimeNamesAnswers || []),
  ];
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

/**
 * Get start point value (0-100)
 */
function getStartPoint() {
  return (
    Math.floor(Math.random() * (startPointRange[1] - startPointRange[0] + 1)) +
    startPointRange[0]
  );
}

/**
 * Return true if song type is allowed
 *
 * @param {import('./types.js').Song} song
 * @param {boolean} ops
 * @param {boolean} eds
 * @param {boolean} ins
 */
function songTypeFilter(song, ops, eds, ins) {
  let type = song.songType;
  if (ops && type === 1) return true;
  if (eds && type === 2) return true;
  if (ins && type === 3) return true;
  return false;
}

/**
 * Return true if anime type is allowed
 *
 * @param {import('./types.js').Song} song
 * @param {boolean} tv
 * @param {boolean} movie
 * @param {boolean} ova
 * @param {boolean} ona
 * @param {boolean} special
 */
function animeTypeFilter(song, tv, movie, ova, ona, special) {
  if (song.animeType) {
    let type = song.animeType.toLowerCase();
    if (tv && type === "tv") return true;
    if (movie && type === "movie") return true;
    if (ova && type === "ova") return true;
    if (ona && type === "ona") return true;
    if (special && type === "special") return true;
    return false;
  } else {
    return tv && movie && ova && ona && special;
  }
}

/**
 * Return true if the song difficulty is in allowed range
 *
 * @param {import('./types.js').Song} song
 * @param {number} low
 * @param {number} high
 */
function difficultyFilter(song, low, high) {
  if (low === 0 && high === 100) return true;
  let dif = song.songDifficulty ?? NaN;
  if (isNaN(dif)) return false;
  if (dif >= low && dif <= high) return true;
  return false;
}

/**
 * Return true if guess type is allowed
 *
 * @param {import('./types.js').Song} song
 * @param {boolean} correctGuesses
 * @param {boolean} incorrectGuesses
 */
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
  answerChunks = {};
  songInfoChunk = new Chunk();
  nextSongChunk = new Chunk();
}

/**
 * End quiz and set up lobby
 */
function quizOver() {
  reset();
  let data = {
    spectators: gameChat.spectators.map((s) => ({
      name: s.name,
      gamePlayerId: null,
    })),
    inLobby: true,
    settings: hostModal.getSettings(),
    soloMode: quiz.soloMode,
    inQueue: [],
    hostName: lobby.hostName,
    gameId: lobby.gameId,
    players: Object.values(quiz.players)
      .filter(
        (p) =>
          !p.avatarDisabled &&
          !gameChat.spectators.some((s) => s.name === p.name)
      )
      .map((p) => ({
        name: p.name,
        gamePlayerId: p.gamePlayerId,
        level: p.level,
        avatar: p.avatarInfo,
        ready: true,
        inGame: true,
        teamNumber: null,
        multipleChoice: false,
      })),
    numberOfTeams: 0,
    teamFullMap: {},
  };

  lobby.setupLobby(
    data,
    gameChat.spectators.some((spectator) => spectator.name === selfName)
  );
  viewChanger.changeView("lobby", {
    supressServerMsg: true,
    keepChatOpen: true,
  });
}

function openStatsModal() {
  console.log("Tried to open Stats Modal");
  console.log(statsModal);
  if (!statsModal) {
    createStatsModal();
  }
  updateStatsContent();
  statsModal.modal("show");
}

function createStatsModal() {
  console.log("Creating Stats Modal");
  statsModal = $(/*html*/ `
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
  $("#gameContainer").append(statsModal);
}

function updateStatsContent() {
  console.log("Updating Stats Content");
  const reviewData = JSON.parse(
    localStorage.getItem(`spacedRepetitionData_${currentProfile}`) ?? "{}"
  );
  const $modalBody = $("#statsModal .modal-body");
  $modalBody.empty();

  // Overall statistics
  const totalSongs = Object.keys(reviewData).length;
  const correctSongs = Object.values(reviewData).filter(
    (song) => song.isLastTryCorrect
  ).length;
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
    "1.0 - 1.5": 0,
    "1.5 - 2.0": 0,
    "2.0 - 2.5": 0,
    "2.5 - 3.0": 0,
    "3.0+": 0,
  };

  Object.values(reviewData).forEach((song) => {
    if (song.efactor < 1.5) efactorRanges["1.0 - 1.5"]++;
    else if (song.efactor < 2.0) efactorRanges["1.5 - 2.0"]++;
    else if (song.efactor < 2.5) efactorRanges["2.0 - 2.5"]++;
    else if (song.efactor < 3.0) efactorRanges["2.5 - 3.0"]++;
    else efactorRanges["3.0+"]++;
  });

  $modalBody.append(/*html*/ `
      <div class="stats-section">
        <h3>Overall Statistics</h3>
        <p>Total Songs: ${totalSongs}</p>
        <p>Correct Guesses: ${correctSongs}</p>
        <p>Incorrect Guesses: ${incorrectSongs}</p>
        <p>Accuracy: ${((correctSongs / totalSongs) * 100).toFixed(2)}%</p>
      </div>
    `);

  $modalBody.append(/*html*/ `
      <div class="stats-section">
        <h3>Difficulty Distribution</h3>
        <h5>Higher means better recognized</h5>
        <table class="stats-table">
          <tr>
            <th>Difficulty Range</th>
            <th>Number of Songs</th>
          </tr>
          ${Object.entries(efactorRanges)
            .map(
              ([range, count]) => /*html*/ `
            <tr>
              <td>${range}</td>
              <td>${count}</td>
            </tr>
          `
            )
            .join("")}
        </table>
      </div>
    `);

  $modalBody.append(/*html*/ `
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
            ([song, data]) => /*html*/ `
          <tr>
            <td>${song}</td>
            <td>${data.failureCount}</td>
            <td>${data.successCount}</td>
            <td>${data.isLastTryCorrect ? "Yes" : "No"}</td>
          </tr>
        `
          )
          .join("")}
      </table>
    </div>
  `);

  $modalBody.append(/*html*/ `
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
            ([song, data]) => /*html*/ `
          <tr>
            <td>${song}</td>
            <td>${new Date(data.lastReviewDate).toLocaleString()}</td>
            <td>${data.isLastTryCorrect ? "Correct" : "Incorrect"}</td>
          </tr>
        `
          )
          .join("")}
      </table>
    </div>
  `);
}

function initializePopovers() {
  $("#maxNewSongsInfo").popover({
    trigger: "hover",
    placement: "auto",
    content: "Maximum number of new songs to introduce in a 24-hour period.",
  });

  $("#incorrectSongsInfo").popover({
    trigger: "hover",
    placement: "auto",
    content:
      "Number of songs you previously got incorrect to include in each game.",
  });

  $("#correctSongsInfo").popover({
    trigger: "hover",
    placement: "auto",
    content:
      "Number of songs you previously got correct to include in each game.",
  });

  $("#repeatModeInfo").popover({
    trigger: "hover",
    placement: "auto",
    html: true,
    content: /*html*/ `
            <p>When enabled, only songs played earlier with difficulty in the specified range will be selected.</p>
            <p>Max New Songs, Incorrect Songs per Game, and Correct Songs per Game settings are ignored in this mode.</p>
            <p>Difficulty range: 1.0 (most difficult) to 5.0 (easiest)</p>
        `,
  });
}

function setupRepeatMode() {
  $("#cslgSettingsRepeatMode").on("change", function () {
    const checked = $(this).prop("checked");
    $("#cslgSettingsRepeatModeRange").prop("disabled", !checked);
    if (checked) {
      $(
        "#cslgSettingsMaxNewSongs, #cslgSettingsIncorrectSongs, #cslgSettingsCorrectSongs"
      ).prop("disabled", true);
    } else {
      $(
        "#cslgSettingsMaxNewSongs, #cslgSettingsIncorrectSongs, #cslgSettingsCorrectSongs"
      ).prop("disabled", false);
    }
  });

  $("#cslgSettingsRepeatModeRange").on("input", function () {
    let range = String($(this).val()).split("-");
    if (
      range.length === 2 &&
      !isNaN(parseFloat(range[0])) &&
      !isNaN(parseFloat(range[1]))
    ) {
      $(this).css("background-color", "");
    } else {
      $(this).css("background-color", "#ffcccc");
    }
  });
}

function updateSongListDisplay() {
  updateModeDisplay();
  const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");
  const displayList = showIgnored
    ? ignoredSongs
    : isSearchMode
    ? songList
    : mySongList;
  createSongListTable(displayList);
}

function miscSetup() {
  const songOptionsButton = $("#songOptionsButton");
  const songOptionsPopup = $(".song-options-popup");
  const songOptionsBackdrop = $(".song-options-backdrop");
  const songOptionsClose = $(".song-options-close");

  songOptionsButton.on("click", function () {
    songOptionsPopup.addClass("show");
    songOptionsBackdrop.addClass("show");
  });

  function closeSongOptions() {
    songOptionsPopup.removeClass("show");
    songOptionsBackdrop.removeClass("show");
  }

  songOptionsClose.on("click", closeSongOptions);
  songOptionsBackdrop.on("click", closeSongOptions);

  $(document).on("keydown", function (e) {
    if (e.key === "Escape") {
      closeSongOptions();
    }
  });

  songOptionsPopup.on("click", function (e) {
    e.stopPropagation();
  });

  $("#trainingInfoLink").on("click", function (e) {
    e.preventDefault();
    showTrainingInfo();
  });
}

// open custom song list settings modal
function openSettingsModal() {
  $(
    "#cslgSettingsCorrectGuessCheckbox, #cslgSettingsIncorrectGuessCheckbox"
  ).prop("disabled", true);
  updateSongListDisplay();
  updateModeDisplay();
  initializePopovers();
  setupRepeatMode();
  loadNewSongsSettings();
  miscSetup();
  $("#cslgSettingsMaxNewSongs").val(maxNewSongs24Hours);
  $("#cslgSettingsIncorrectSongs").val(incorrectSongsPerGame);
  $("#cslgSettingsCorrectSongs").val(correctSongsPerGame);
  if (lobby.inLobby) {
    if (autocomplete.length) {
      $("#cslgAutocompleteButton")
        .removeClass("btn-danger")
        .addClass("btn-success disabled");
    }

    // Initialize the mode and update display
    updateModeDisplay();

    $("#cslgSettingsModal").modal("show");
    initializePopovers();
  }
}

function updateModeDisplay() {
  // Update button text
  $("#cslgToggleModeButton").text(isSearchMode ? "Song " : "My Songs");

  // Toggle body class for CSS targeting
  $("body").toggleClass("song-search-mode", isSearchMode);

  // Show/hide AnisongDB search elements
  $(".anisongdb-search-row").toggle(isSearchMode);

  // Update other UI elements
  if (isSearchMode) {
    createSongListTable(songList);
    $("#cslgAnisongdbSearchRow").show();
    $("#cslgAddAllButton").attr("title", "Add all to My Songs");
    $("#cslgTransferSongListButton").attr(
      "title",
      "Transfer from merged to search results"
    );
  } else {
    createSongListTable(mySongList);
    $("#cslgAnisongdbSearchRow").hide();
    $("#cslgAddAllButton").attr("title", "Add all to merged");
    $("#cslgTransferSongListButton").attr(
      "title",
      "Transfer from merged to My Songs"
    );
  }

  // Update song count display
  $("#cslgSongListCount").text(
    "Songs: " + (isSearchMode ? songList.length : mySongList.length)
  );

  // Update popovers content
  if ($("#cslgAddAllButton").data("bs.popover")) {
    $("#cslgAddAllButton").data("bs.popover").options.content = isSearchMode
      ? "Add all to My Songs"
      : "Add all to merged";
  }
  if ($("#cslgTransferSongListButton").data("bs.popover")) {
    $("#cslgTransferSongListButton").data("bs.popover").options.content =
      isSearchMode
        ? "Transfer from merged to search results"
        : "Transfer from merged to My Songs";
  }
}

// when you click the go button
function anisongdbDataSearch() {
  let mode = String($("#cslgAnisongdbModeSelect").val()).toLowerCase();
  let query = String($("#cslgAnisongdbQueryInput").val());
  let ops = $("#cslgAnisongdbOPCheckbox").prop("checked");
  let eds = $("#cslgAnisongdbEDCheckbox").prop("checked");
  let ins = $("#cslgAnisongdbINCheckbox").prop("checked");
  let partial = $("#cslgAnisongdbPartialCheckbox").prop("checked");
  let ignoreDuplicates = $("#cslgAnisongdbIgnoreDuplicatesCheckbox").prop(
    "checked"
  );
  let arrangement = $("#cslgAnisongdbArrangementCheckbox").prop("checked");
  let maxOtherPeople = parseInt(
    String($("#cslgAnisongdbMaxOtherPeopleInput").val())
  );
  let minGroupMembers = parseInt(
    String($("#cslgAnisongdbMinGroupMembersInput").val())
  );
  if (query && !isNaN(maxOtherPeople) && !isNaN(minGroupMembers)) {
    getAnisongdbData(
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
    );
  }
}

/**
 * Fetch a list of songs from AnisongDB
 *
 * @param {string} mode Type of selector to use
 * @param {string} query
 * @param {boolean} ops
 * @param {boolean} eds
 * @param {boolean} ins
 * @param {boolean} partial
 * @param {boolean} ignoreDuplicates
 * @param {boolean} arrangement
 * @param {number} maxOtherPeople
 * @param {number} minGroupMembers
 */
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
  $("#cslgSongListCount").text("Loading...");
  $("#cslgSongListTable tbody").empty();

  /** @type {string} */
  let url = "https://anisongdb.com/api/search_request";

  /** @type {RequestInit} */
  const payload = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };

  /** @type {import('./types/anisong.js').AnisongSongQueryArguments} */
  let json = {
    and_logic: false,
    ignore_duplicate: ignoreDuplicates,
    opening_filter: ops,
    ending_filter: eds,
    insert_filter: ins,
  };

  if (mode === "anime") {
    json.anime_search_filter = {
      search: query,
      partial_match: partial,
    };
  } else if (mode === "artist") {
    console.log("query : ", query);
    console.log("minGroupMembers : ", minGroupMembers);
    console.log("maxOtherPeople : ", maxOtherPeople);
    json.artist_search_filter = {
      search: query,
      partial_match: partial,
      group_granularity: minGroupMembers,
      max_other_artist: maxOtherPeople,
    };
  } else if (mode === "song") {
    json.song_name_search_filter = {
      search: query,
      partial_match: partial,
    };
  } else if (mode === "composer") {
    json.composer_search_filter = {
      search: query,
      partial_match: partial,
      arrangement: arrangement,
    };
  } else if (mode === "season") {
    query = query.trim();
    query = query.charAt(0).toUpperCase() + query.slice(1).toLowerCase();
    payload.method = "GET"; // Use a GET request
    url = `https://anisongdb.com/api/filter_season?${new URLSearchParams({
      season: query,
    })}`;
  } else if (mode === "ann id") {
    url = "https://anisongdb.com/api/annId_request";
    json.annId = parseInt(query);
  } else if (mode === "mal id") {
    url = "https://anisongdb.com/api/malIDs_request";
    json.malIds = query
      .split(/[, ]+/)
      .map((n) => parseInt(n))
      .filter((n) => !isNaN(n));
  } else {
    console.error("Invalid mode");
    return;
  }

  if (mode !== "season") {
    payload["body"] = JSON.stringify(json);
  }

  console.log(url, payload);

  fetch(url, payload)
    .then((res) => res.json())
    .then((json) => {
      handleData(json);
      songList = finalSongList.filter((song) =>
        songTypeFilter(song, ops, eds, ins)
      );
      setSongListTableSort();
      console.log("song list ", songList);
      if (!Array.isArray(json)) {
        $("#cslgSongListCount").text("Songs: 0");
        $("#cslgSongListTable tbody").empty();
        $("#cslgSongListWarning").text(JSON.stringify(json));
      } else if (
        songList.length === 0 &&
        (ranked.currentState === ranked.RANKED_STATE_IDS.RUNNING ||
          ranked.currentState === ranked.RANKED_STATE_IDS.CHAMP_RUNNING)
      ) {
        $("#cslgSongListCount").text("Songs: 0");
        $("#cslgSongListTable tbody").empty();
        $("#cslgSongListWarning").text(
          "AnisongDB is not available during ranked"
        );
      } else {
        updateSongListDisplay();
      }
      createAnswerTable();
    })
    .catch((res) => {
      songList = [];
      setSongListTableSort();
      $("#cslgSongListCount").text("Songs: 0");
      $("#cslgSongListTable tbody").empty();
      $("#cslgSongListWarning").text(res.toString());
    });
}

/**
 * Check if data comes from AnisongDB
 *
 * @param {any} data
 * @returns {data is import('./types/anisong.js').AnisongEntry[]}
 */
const isAnisongDBData = (data) =>
  Array.isArray(data) && data.length && data[0].animeJPName;

/**
 * Check if data comes from the official AMQ song export
 *
 * @param {any} data
 * @returns {data is import("./types/amqexport.js").AMQExport}
 */
const isAMQData = (data) =>
  typeof data === "object" && data.roomName && data.startTime && data.songs;

/**
 * Check if data comes from the Joseph Song UI Export
 *
 * @param {any} data
 * @returns {data is import('./types/josephsongui.js').JosephSongUI[]}
 */
const isJosephSongUIData = (data) =>
  Array.isArray(data) && data.length && data[0].gameMode;

/**
 * Check if data comes from the Kempanator's Answer Stats script
 *
 * @param {any} data
 * @returns {data is import('./types/answerstats.js').KempanatorAnswerStats}
 */
const isKempanatorAnswerStatsData = (data) =>
  typeof data === "object" && data.songHistory && data.playerInfo;

/**
 * Check if data comes from a blissfulyoshi's ranked export
 *
 * @param {any} data
 * @returns {data is import('./types/blissfullyoshi.js').BlissfullYoshiRankedExport}
 */
const isBlissfullyoshiRankedData = (data) =>
  Array.isArray(data) && data.length && data[0].animeRomaji;

/**
 * Check if data comes from this script
 *
 * @param {any} data
 * @returns {data is import('./types.js').Song[]}
 */
const isMyData = (data) =>
  Array.isArray(data) && data.length && data[0].animeRomajiName;

/**
 * Parse a song type string (e.g. "Opening 2") to an object with type and number. (Insert songs have no number).
 *
 * @param {string} songType
 * @returns {{ songType: import('./types.js').SongTypes, typeNumber: number | null }}
 */
const parseSongType = (songType) => {
  if (songType.startsWith("Opening")) {
    return {
      songType: 1,
      typeNumber: parseInt(songType.replace(/\D/g, "")),
    };
  } else if (songType.startsWith("Ending")) {
    return {
      songType: 2,
      typeNumber: parseInt(songType.replace(/\D/g, "")),
    };
  } else if (songType === "Insert Song") {
    return {
      songType: 3,
      typeNumber: null,
    };
  }

  // Default to Insert Song
  return {
    songType: 3,
    typeNumber: null,
  };
};

/**
 * Load data from several sources, and save it to "finalSongList".
 *
 * @param {any} data
 * @returns {void}
 */
function handleData(data) {
  finalSongList = [];
  if (!data) return;
  loadIgnoredSongs(); // Load the latest ignored songs
  console.log("Got data", { data });
  // anisongdb structure
  if (isAnisongDBData(data)) {
    const songs = data.filter((song) => song.audio || song.MQ || song.HQ);
    for (let song of songs) {
      finalSongList.push({
        animeRomajiName: song.animeJPName,
        animeEnglishName: song.animeENName,
        altAnimeNames: [
          song.animeJPName,
          song.animeENName,
          ...(song.animeAltName || []),
        ].filter(Boolean),
        altAnimeNamesAnswers: [],
        songArtist: song.songArtist,
        songName: song.songName,
        ...parseSongType(song.songType),
        songDifficulty: song.songDifficulty ?? null,
        animeType: song.animeType ?? null,
        animeVintage: song.animeVintage ?? null,
        annId: song.annId,
        malId: song.linked_ids?.myanimelist,
        kitsuId: song.linked_ids?.kitsu,
        aniListId: song.linked_ids?.anilist,
        animeTags: [],
        animeGenre: [],
        rebroadcast: null,
        dub: null,
        startPoint: null,
        audio: song.audio ?? null,
        video480: song.MQ ?? null,
        video720: song.HQ ?? null,
        correctGuess: true,
        incorrectGuess: true,
        rating: null,
      });
    }
    for (let song of finalSongList) {
      let otherAnswers = new Set();
      for (let s of finalSongList) {
        if (s.songName === song.songName && s.songArtist === song.songArtist) {
          s.altAnimeNames.forEach((x) => otherAnswers.add(x));
        }
      }
      song.altAnimeNamesAnswers = Array.from(otherAnswers).filter(
        (x) => !song.altAnimeNames.includes(x)
      );
    }
  }
  // official amq song export structure
  else if (isAMQData(data)) {
    for (let song of data.songs) {
      finalSongList.push({
        animeRomajiName: song.songInfo.animeNames.romaji,
        animeEnglishName: song.songInfo.animeNames.english,
        altAnimeNames: song.songInfo.altAnimeNames || [
          song.songInfo.animeNames.romaji,
          song.songInfo.animeNames.english,
        ],
        altAnimeNamesAnswers: song.songInfo.altAnimeNamesAnswers || [],
        songArtist: song.songInfo.artist,
        songName: song.songInfo.songName,
        songType: song.songInfo.type,
        typeNumber: song.songInfo.typeNumber,
        songDifficulty: song.songInfo.animeDifficulty,
        animeType: song.songInfo.animeType,
        animeVintage: song.songInfo.vintage,
        annId: song.songInfo.siteIds.annId,
        malId: song.songInfo.siteIds.malId,
        kitsuId: song.songInfo.siteIds.kitsuId,
        aniListId: song.songInfo.siteIds.aniListId,
        animeTags: song.songInfo.animeTags ?? [],
        animeGenre: song.songInfo.animeGenre ?? [],
        rebroadcast: null,
        dub: null,
        startPoint: song.startPoint,
        audio: null,
        video480: null,
        video720: song.videoUrl ?? null,
        correctGuess: !song.wrongGuess,
        incorrectGuess: song.wrongGuess,
        rating: null,
      });
    }
  }
  // joseph song export script structure
  else if (isJosephSongUIData(data)) {
    for (let song of data) {
      finalSongList.push({
        animeRomajiName: song.anime.romaji,
        animeEnglishName: song.anime.english,
        altAnimeNames: song.altAnswers || [
          song.anime.romaji,
          song.anime.english,
        ],
        altAnimeNamesAnswers: [],
        songArtist: song.artist,
        songName: song.name,
        songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
        typeNumber:
          song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
        songDifficulty: song.difficulty === "Unrated" ? 0 : song.difficulty,
        animeType: song.animeType,
        animeVintage: song.vintage,
        annId: song.siteIds.annId,
        malId: song.siteIds.malId,
        kitsuId: song.siteIds.kitsuId,
        aniListId: song.siteIds.aniListId,
        animeTags: song.tags ?? [],
        animeGenre: song.genre ?? [],
        rebroadcast: null,
        dub: null,
        startPoint: song.startSample,
        audio: song.urls?.[0] ?? null,
        video480: song.urls?.[480] ?? null,
        video720: song.urls?.[720] ?? null,
        correctGuess: song.correct ?? false,
        incorrectGuess: !song.correct,
        rating: null,
      });
    }
  }
  // blissfulyoshi ranked data export structure
  else if (isBlissfullyoshiRankedData(data)) {
    for (let song of data) {
      finalSongList.push({
        animeRomajiName: song.animeRomaji,
        animeEnglishName: song.animeEng,
        altAnimeNames: [song.animeRomaji, song.animeEng],
        altAnimeNamesAnswers: [],
        songArtist: song.artist,
        songName: song.songName,
        songType: Object({ O: 1, E: 2, I: 3 })[song.type[0]],
        typeNumber:
          song.type[0] === "I" ? null : parseInt(song.type.split(" ")[1]),
        songDifficulty: song.songDifficulty,
        animeType: null,
        animeVintage: song.vintage,
        annId: song.annId,
        malId: song.malId ?? undefined,
        kitsuId: song.kitsuId ?? undefined,
        aniListId: song.aniListId ?? undefined,
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
        rating: null,
      });
    }
  }
  // kempanator answer stats script export structure
  else if (isKempanatorAnswerStatsData(data)) {
    for (let song of Object.values(data.songHistory)) {
      finalSongList.push({
        animeRomajiName: song.animeRomajiName,
        animeEnglishName: song.animeEnglishName,
        altAnimeNames: song.altAnimeNames || [],
        altAnimeNamesAnswers: song.altAnimeNamesAnswers || [],
        songArtist: song.songArtist,
        songName: song.songName,
        songType: song.songType,
        typeNumber: song.songTypeNumber,
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
        rating: null,
      });
    }
  }
  // this script structure
  else if (isMyData(data)) {
    finalSongList = data;
  }
  // Filter out ignored songs
  finalSongList = finalSongList.filter(
    (song) =>
      !ignoredSongs.some(
        (ignoredSong) =>
          ignoredSong.songName === song.songName &&
          ignoredSong.songArtist === song.songArtist &&
          ignoredSong.animeRomajiName === song.animeRomajiName
      )
  );

  finalSongList = finalSongList.filter(
    (song) => song.audio || song.video480 || song.video720
  );
}

/**
 * Create song list table
 *
 * @param {import("./types.js").Song[]} displayList
 */
function createSongListTable(displayList = []) {
  const showIgnored = $("#cslgShowIgnoredButton").hasClass("active");

  if (showIgnored) {
    displayList = ignoredSongs;
  } else if (isSearchMode) {
    displayList = filterSongList(songList);
  } else {
    displayList = filterSongList(mySongList);
  }

  $("#cslgSongListCount").text("Songs: " + displayList.length);
  $("#cslgMergeCurrentCount").text(
    `Current song list: ${displayList.length} song${
      displayList.length === 1 ? "" : "s"
    }`
  );
  $("#cslgSongListWarning").text("");
  let $thead = $("#cslgSongListTable thead");
  let $tbody = $("#cslgSongListTable tbody");
  $thead.empty();
  $tbody.empty();

  // Apply sorting
  if (songListTableSort[0] === 1) {
    displayList.sort((a, b) =>
      (a.songName || "").localeCompare(b.songName || "")
    );
  } else if (songListTableSort[0] === 2) {
    displayList.sort((a, b) =>
      (b.songName || "").localeCompare(a.songName || "")
    );
  } else if (songListTableSort[1] === 1) {
    displayList.sort((a, b) =>
      (a.songArtist || "").localeCompare(b.songArtist || "")
    );
  } else if (songListTableSort[1] === 2) {
    displayList.sort((a, b) =>
      (b.songArtist || "").localeCompare(a.songArtist || "")
    );
  } else if (songListTableSort[2] === 1) {
    displayList.sort(
      (a, b) => (a.songDifficulty ?? 0) - (b.songDifficulty ?? 0)
    );
  } else if (songListTableSort[2] === 2) {
    displayList.sort(
      (a, b) => (b.songDifficulty ?? 0) - (a.songDifficulty ?? 0)
    );
  } else if (songListTableSort[3] === 1) {
    displayList.sort((a, b) =>
      (options.useRomajiNames
        ? a.animeRomajiName
        : a.animeEnglishName
      ).localeCompare(
        options.useRomajiNames ? b.animeRomajiName : b.animeEnglishName
      )
    );
  } else if (songListTableSort[3] === 2) {
    displayList.sort((a, b) =>
      (options.useRomajiNames
        ? b.animeRomajiName
        : b.animeEnglishName
      ).localeCompare(
        options.useRomajiNames ? a.animeRomajiName : a.animeEnglishName
      )
    );
  } else if (songListTableSort[4] === 1) {
    displayList.sort(
      (a, b) =>
        songTypeSortValue(a.songType, a.typeNumber) -
        songTypeSortValue(b.songType, b.typeNumber)
    );
  } else if (songListTableSort[4] === 2) {
    displayList.sort(
      (a, b) =>
        songTypeSortValue(b.songType, b.typeNumber) -
        songTypeSortValue(a.songType, a.typeNumber)
    );
  } else if (songListTableSort[5] === 1) {
    displayList.sort(
      (a, b) =>
        vintageSortValue(a.animeVintage) - vintageSortValue(b.animeVintage)
    );
  } else if (songListTableSort[5] === 2) {
    displayList.sort(
      (a, b) =>
        vintageSortValue(b.animeVintage) - vintageSortValue(a.animeVintage)
    );
  }

  if (songListTableMode === 0) {
    let $row = $("<tr></tr>");
    $row.append($(`<th class="number">#</th>`));
    $row.append(
      $(/*html*/ `<th class="song clickAble">Song</th>`).on("click", () => {
        setSongListTableSort(0);
        createSongListTable(displayList);
      })
    );
    $row.append(
      $(/*html*/ `<th class="artist clickAble">Artist</th>`).on("click", () => {
        setSongListTableSort(1);
        createSongListTable(displayList);
      })
    );
    $row.append(
      $(/*html*/ `<th class="difficulty clickAble">Dif</th>`).on(
        "click",
        () => {
          setSongListTableSort(2);
          createSongListTable(displayList);
        }
      )
    );
    $row.append($(/*html*/ `<th class="action"></th>`));
    $thead.append($row);
    displayList.forEach((song, i) => {
      let $row = $(/*html*/ `<tr></tr>`);
      $row.append(
        $(/*html*/ `<td></td>`)
          .addClass("number")
          .text(i + 1)
      );
      $row.append($(/*html*/ `<td></td>`).addClass("song").text(song.songName));
      $row.append(
        $(/*html*/ `<td></td>`).addClass("artist").text(song.songArtist)
      );
      $row.append(
        $(/*html*/ `<td></td>`)
          .addClass("difficulty")
          .text(
            Number.isFinite(song.songDifficulty)
              ? Math.floor(song.songDifficulty ?? 0)
              : ""
          )
      );
      $row.append(
        $("<td></td>").addClass("action").append(`
                    ${
                      showIgnored
                        ? '<i class="fa fa-check clickAble" aria-hidden="true"></i>'
                        : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'
                    }
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${
                      showIgnored
                        ? ""
                        : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'
                    }
                `)
      );
      $tbody.append($row);
    });
  } else if (songListTableMode === 1) {
    let $row = $("<tr></tr>");
    $row.append($(`<th class="number">#</th>`));
    $row.append(
      $(`<th class="anime clickAble">Anime</th>`).click(() => {
        setSongListTableSort(3);
        createSongListTable(displayList);
      })
    );
    $row.append(
      $(`<th class="songType clickAble">Type</th>`).click(() => {
        setSongListTableSort(4);
        createSongListTable(displayList);
      })
    );
    $row.append(
      $(`<th class="vintage clickAble">Vintage</th>`).click(() => {
        setSongListTableSort(5);
        createSongListTable(displayList);
      })
    );
    $row.append($(`<th class="action"></th>`));
    $thead.append($row);
    displayList.forEach((song, i) => {
      let $row = $("<tr></tr>");
      $row.append(
        $("<td></td>")
          .addClass("number")
          .text(i + 1)
      );
      $row.append(
        $("<td></td>")
          .addClass("anime")
          .text(
            options.useRomajiNames
              ? song.animeRomajiName
              : song.animeEnglishName
          )
      );
      $row.append(
        $("<td></td>")
          .addClass("songType")
          .text(songTypeText(song.songType, song.typeNumber))
      );
      $row.append(
        $("<td></td>")
          .addClass("vintage")
          .text(song.animeVintage ?? "")
      );
      $row.append(
        $("<td></td>").addClass("action").append(`
                    ${
                      showIgnored
                        ? '<i class="fa fa-check clickAble" aria-hidden="true"></i>'
                        : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'
                    }
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${
                      showIgnored
                        ? ""
                        : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'
                    }
                `)
      );
      $tbody.append($row);
    });
  } else if (songListTableMode === 2) {
    let $row = $("<tr></tr>");
    $row.append($(`<th class="number">#</th>`));
    $row.append($(`<th class="link clickAble">MP3</th>`));
    $row.append($(`<th class="link clickAble">480</th>`));
    $row.append($(`<th class="link clickAble">720</th>`));
    $row.append($(`<th class="action"></th>`));
    $thead.append($row);
    displayList.forEach((song, i) => {
      let $row = $("<tr></tr>");
      $row.append(
        $("<td></td>")
          .addClass("number")
          .text(i + 1)
      );
      $row.append(
        $("<td></td>").addClass("link").append(createLinkElement(song.audio))
      );
      $row.append(
        $("<td></td>").addClass("link").append(createLinkElement(song.video480))
      );
      $row.append(
        $("<td></td>").addClass("link").append(createLinkElement(song.video720))
      );
      $row.append(
        $("<td></td>").addClass("action").append(`
                    ${
                      showIgnored
                        ? ""
                        : '<i class="fa fa-plus clickAble" aria-hidden="true"></i>'
                    }
                    <i class="fa fa-trash clickAble" aria-hidden="true"></i>
                    ${
                      showIgnored
                        ? ""
                        : '<i class="fa fa-ban clickAble" aria-hidden="true"></i>'
                    }
                `)
      );
      $tbody.append($row);
    });
  }
}

/**
 * @param {import("./types.js").Song[]} list
 */
function filterSongList(list) {
  if (currentSearchFilter) {
    const searchCriteria = $("#cslgSearchCriteria").val();
    return list.filter((song) => {
      const lowerCaseFilter = currentSearchFilter.toLowerCase();
      switch (searchCriteria) {
        case "songName":
          return song.songName.toLowerCase().includes(lowerCaseFilter);
        case "songArtist":
          return song.songArtist.toLowerCase().includes(lowerCaseFilter);
        case "animeName":
          return (
            song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) ||
            song.animeRomajiName.toLowerCase().includes(lowerCaseFilter)
          );
        case "songType":
          return songTypeText(song.songType, song.typeNumber)
            .toLowerCase()
            .includes(lowerCaseFilter);
        case "animeVintage":
          return song.animeVintage?.toLowerCase().includes(lowerCaseFilter);
        case "all":
        default:
          return (
            song.songName.toLowerCase().includes(lowerCaseFilter) ||
            song.songArtist.toLowerCase().includes(lowerCaseFilter) ||
            song.animeRomajiName.toLowerCase().includes(lowerCaseFilter) ||
            song.animeEnglishName.toLowerCase().includes(lowerCaseFilter) ||
            songTypeText(song.songType, song.typeNumber)
              .toLowerCase()
              .includes(lowerCaseFilter) ||
            song.animeVintage?.toLowerCase().includes(lowerCaseFilter)
          );
      }
    });
  }
  return list;
}

// create merged song list table
function createMergedSongListTable() {
  $("#cslgMergedSongListCount").text("Merged: " + mergedSongList.length);
  $("#cslgMergeTotalCount").text(
    `Merged song list: ${mergedSongList.length} song${
      mergedSongList.length === 1 ? "" : "s"
    }`
  );
  let $tbody = $("#cslgMergedSongListTable tbody");
  $tbody.empty();
  mergedSongList.forEach((song, i) => {
    let $row = $("<tr></tr>");
    $row.append(
      $("<td></td>")
        .addClass("number")
        .text(i + 1)
    );
    $row.append(
      $("<td></td>")
        .addClass("anime")
        .text(
          options.useRomajiNames ? song.animeRomajiName : song.animeEnglishName
        )
    );
    $row.append(
      $("<td></td>")
        .addClass("songType")
        .text(songTypeText(song.songType, song.typeNumber))
    );
    $row.append(
      $("<td></td>")
        .addClass("action")
        .append(
          /*html*/ `<i class="fa fa-chevron-up clickAble" aria-hidden="true"></i><i class="fa fa-chevron-down clickAble" aria-hidden="true"></i> <i class="fa fa-trash clickAble" aria-hidden="true"></i>`
        )
    );
    $tbody.append($row);
  });
}

// create answer table
function createAnswerTable() {
  let $tbody = $("#cslgAnswerTable tbody");
  $tbody.empty();
  if (finalSongList.length === 0) {
    $("#cslgAnswerText").text("No list loaded");
  } else if (autocomplete.length === 0) {
    $("#cslgAnswerText").text("Fetch autocomplete first");
  } else {
    let animeList = new Set();
    let missingAnimeList = [];
    for (let song of finalSongList) {
      let answers = [song.animeEnglishName, song.animeRomajiName].concat(
        song.altAnimeNames,
        song.altAnimeNamesAnswers
      );
      answers.forEach((x) => animeList.add(x));
    }
    for (let anime of animeList) {
      if (!autocomplete.includes(anime.toLowerCase())) {
        missingAnimeList.push(anime);
      }
    }
    missingAnimeList.sort((a, b) => a.localeCompare(b));
    $("#cslgAnswerText").text(
      `Found ${missingAnimeList.length} anime missing from AMQ's autocomplete`
    );
    for (let anime of missingAnimeList) {
      let $row = $("<tr></tr>");
      $row.append($("<td></td>").addClass("oldName").text(anime));
      $row.append(
        $("<td></td>")
          .addClass("newName")
          .text(replacedAnswers[anime] || "")
      );
      $row.append(
        $("<td></td>")
          .addClass("edit")
          .append(`<i class="fa fa-pencil clickAble" aria-hidden="true"></i>`)
      );
      $tbody.append($row);
    }
  }
}

/**
 * Create link element for song list table
 * @param {string | null} link
 */
function createLinkElement(link) {
  if (!link) return "";
  let $a = $("<a></a>");
  if (link.startsWith("http")) {
    $a.text(link.includes("catbox") ? link.split("/").slice(-1)[0] : link);
    $a.attr("href", link);
  } else if (/^\w+\.\w{3,4}$/.test(link)) {
    $a.text(link);
    if (fileHostOverride) {
      $a.attr(
        "href",
        "https://" + catboxHostDict[fileHostOverride] + "/" + link
      );
    } else {
      $a.attr("href", "https://ladist1.catbox.video/" + link);
    }
  }
  $a.attr("target", "_blank");
  return $a;
}

/**
 * Reset all values in table sort options and toggle specified index
 * @param {number} [index]
 */
function setSongListTableSort(index = NaN) {
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

/**
 * Get sorting value for anime vintage
 * @param {string | null} vintage
 */
function vintageSortValue(vintage) {
  if (!vintage) return 0;
  let split = vintage.split(" ");
  let year = parseInt(split[1]);
  if (isNaN(year)) return 0;
  let season = Object({ Winter: 0.1, Spring: 0.2, Summer: 0.3, Fall: 0.4 })[
    split[0]
  ];
  if (!season) return 0;
  return year + season;
}

/**
 * Get sorting value for song type
 * @param {number | null} type
 * @param {number | null} typeNumber
 */
function songTypeSortValue(type, typeNumber) {
  return (type || 0) * 1000 + (typeNumber || 0);
}

// reset all tabs
function tabReset() {
  $("#cslgSongListTab").removeClass("selected");
  $("#cslgQuizSettingsTab").removeClass("selected");
  $("#cslgAnswerTab").removeClass("selected");
  $("#cslgMergeTab").removeClass("selected");
  $("#cslgHotkeyTab").removeClass("selected");
  $("#cslgListImportTab").removeClass("selected");
  $("#cslgInfoTab").removeClass("selected");
  $("#cslgSongListContainer").hide();
  $("#cslgQuizSettingsContainer").hide();
  $("#cslgAnswerContainer").hide();
  $("#cslgMergeContainer").hide();
  $("#cslgHotkeyContainer").hide();
  $("#cslgListImportContainer").hide();
  $("#cslgInfoContainer").hide();
}

/**
 * Convert full url to target data
 * @param {string | null} url
 */
function formatTargetUrl(url) {
  if (url && url.startsWith("http")) {
    return url.split("/").slice(-1)[0];
  }
  return url;
}

/**
 * Translate type and typeNumber ids to shortened type text
 * @param {number} type
 * @param {number | null} typeNumber
 */
function songTypeText(type, typeNumber) {
  if (type === 1) return "OP" + (typeNumber ?? 1);
  if (type === 2) return "ED" + (typeNumber ?? 1);
  if (type === 3) return "IN";
  return "";
}

/**
 * Input 3 links, return formatted catbox link object
 *
 * @param {string | null} audio
 * @param {string | null} video480
 * @param {string | null} video720
 */
function createCatboxLinkObject(audio, video480, video720) {
  let links = {};
  if (fileHostOverride) {
    if (audio)
      links["0"] =
        "https://" +
        catboxHostDict[fileHostOverride] +
        "/" +
        audio.split("/").slice(-1)[0];
    if (video480)
      links["480"] =
        "https://" +
        catboxHostDict[fileHostOverride] +
        "/" +
        video480.split("/").slice(-1)[0];
    if (video720)
      links["720"] =
        "https://" +
        catboxHostDict[fileHostOverride] +
        "/" +
        video720.split("/").slice(-1)[0];
  } else {
    if (audio) links["0"] = audio;
    if (video480) links["480"] = video480;
    if (video720) links["720"] = video720;
  }
  return links;
}

/**
 * Create hotkey element
 * @param {string} title
 * @param {keyof import("./types.js").HotKeySettings} key
 * @param {string} selectID
 * @param {string} inputID
 */
function createHotkeyElement(title, key, selectID, inputID) {
  let $select = $(`<select id="${selectID}" style="padding: 3px 0;"></select>`)
    .append(`<option>ALT</option>`)
    .append(`<option>CTRL</option>`)
    .append(`<option>CTRL ALT</option>`)
    .append(`<option>-</option>`);
  let $input = $(
    `<input id="${inputID}" type="text" maxlength="1" style="width: 40px;">`
  ).val(hotKeys[key]?.key ?? "");
  $select.on("change", () => {
    hotKeys[key] = {
      altKey: String($select.val()).includes("ALT"),
      ctrlKey: String($select.val()).includes("CTRL"),
      key: String($input.val()).toLowerCase(),
    };
    saveSettings();
  });
  $input.on("change", () => {
    hotKeys[key] = {
      altKey: String($select.val()).includes("ALT"),
      ctrlKey: String($select.val()).includes("CTRL"),
      key: String($input.val()).toLowerCase(),
    };
    saveSettings();
  });
  if (hotKeys[key]?.altKey && hotKeys[key].ctrlKey) $select.val("CTRL ALT");
  else if (hotKeys[key]?.altKey) $select.val("ALT");
  else if (hotKeys[key]?.ctrlKey) $select.val("CTRL");
  else $select.val("-");
  $("#cslgHotkeyTable tbody").append(
    $(`<tr></tr>`)
      .append($(`<td></td>`).text(title))
      .append($(`<td></td>`).append($select))
      .append($(`<td></td>`).append($input))
  );
}

/**
 * Test hotkey
 *
 * @param {keyof import("./types.js").HotKeySettings} action
 * @param {string} key
 * @param {boolean} altKey
 * @param {boolean} ctrlKey
 */
function testHotkey(action, key, altKey, ctrlKey) {
  let hotkey = hotKeys[action];
  if (!hotkey) return false;
  return (
    key === hotkey.key && altKey === hotkey.altKey && ctrlKey === hotkey.ctrlKey
  );
}

// return true if you are in a ranked lobby or quiz
function isRankedMode() {
  return (
    (lobby.inLobby && lobby.settings.gameMode === "Ranked") ||
    (quiz.inQuiz && quiz.gameMode === "Ranked")
  );
}

/**
 * Safeguard against people putting valid javascript in the song json
 * @param {string} text
 */
function preventCodeInjection(text) {
  if (/<script/i.test(text)) {
    cslMessage("⚠️ code injection attempt detected, ending quiz");
    quizOver();
    console.warn("CSL CODE INJECTION ATTEMPT:\n" + text);
    return "";
  }
  return text;
}

/**
 * Split a string into chunks
 *
 * @param {string} str
 * @param {number} chunkSize
 */
function splitIntoChunks(str, chunkSize) {
  let chunks = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Convert base 10 number to base 36
 *
 * @param {number} number
 * @returns {string}
 */
function base10to36(number) {
  if (number === 0) return "0";
  let digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (number > 0) {
    let remainder = number % 36;
    result = digits[remainder] + result;
    number = Math.floor(number / 36);
  }
  return result;
}

/**
 * Convert base 36 number to base 10
 *
 * @param {string} number
 * @returns {number | null}
 */
function base36to10(number) {
  number = String(number);
  let digits = "0123456789abcdefghijklmnopqrstuvwxyz";
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
    /** @type {Record<number, string>} */
    this.chunkMap = {};
    this.isComplete = false;
  }

  /**
   * @param {string} text
   */
  append(text) {
    let regex = /^§CSL\w(\w)/.exec(text);
    if (regex) {
      let index = base36to10(regex[1]);
      if (index === null) {
        console.log("CSL ERROR: bad chunk index\n" + text);
        return;
      }
      if (text.endsWith("$")) {
        this.chunkMap[index] = text.slice(6, -1);
        this.isComplete = true;
      } else {
        this.chunkMap[index] = text.slice(6);
      }
    } else {
      console.log("CSL ERROR: bad chunk\n" + text);
    }
  }
  decode() {
    if (this.isComplete) {
      let result = Object.values(this.chunkMap).reduce((a, b) => a + b);
      try {
        return decodeURIComponent(atob(result));
      } catch {
        sendSystemMessage("CSL chunk decode error");
        console.log("CSL ERROR: could not decode\n" + result);
      }
    } else {
      sendSystemMessage("CSL incomplete chunk");
      console.log("CSL ERROR: incomplete chunk\n", this.chunkMap);
    }
    return "";
  }
}

/**
 * Input myanimelist username, return list of mal ids
 *
 * @param {string} username Myanimelist username
 */
async function getMalIdsFromMyanimelist(username) {
  let malIds = [];
  let statuses = [];
  if ($("#cslgListImportWatchingCheckbox").prop("checked")) {
    statuses.push("watching");
  }
  if ($("#cslgListImportCompletedCheckbox").prop("checked")) {
    statuses.push("completed");
  }
  if ($("#cslgListImportHoldCheckbox").prop("checked")) {
    statuses.push("on_hold");
  }
  if ($("#cslgListImportDroppedCheckbox").prop("checked")) {
    statuses.push("dropped");
  }
  if ($("#cslgListImportPlanningCheckbox").prop("checked")) {
    statuses.push("plan_to_watch");
  }
  for (let status of statuses) {
    $("#cslgListImportText").text(`Retrieving Myanimelist: ${status}`);

    /** @type {string} */
    let nextPage = `https://api.myanimelist.net/v2/users/${username}/animelist?offset=0&limit=1000&nsfw=true&status=${status}`;

    while (nextPage) {
      let result = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: nextPage,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-MAL-CLIENT-ID": malClientId,
          },
          onload: (res) => resolve(JSON.parse(res.response)),
          onerror: (res) => reject(res),
        });
      });
      if (result.error) {
        $("#cslgListImportText").text(`MAL API Error: ${result.error}`);
        break;
      } else {
        for (let anime of result.data) {
          const malIdEntry = {
            malId: /** @type {number} */ (anime.node.id),
          };
          malIds.push(malIdEntry);
        }
        nextPage = result.paging.next;
      }
    }
  }
  return malIds;
}

/**
 * Input anilist username, return list of mal ids
 *
 * @param {string} username Anilist username
 */
async function getMalIdsFromAnilist(username) {
  let pageNumber = 1;

  /** @type {import('./types.js').MalIdEntry[]} */
  let malIds = [];

  /** @type {import('./types/anilist.js').AnilistStatus[]} */
  let statuses = [];

  if ($("#cslgListImportWatchingCheckbox").prop("checked")) {
    statuses.push("CURRENT");
  }
  if ($("#cslgListImportCompletedCheckbox").prop("checked")) {
    statuses.push("COMPLETED");
  }
  if ($("#cslgListImportHoldCheckbox").prop("checked")) {
    statuses.push("PAUSED");
  }
  if ($("#cslgListImportDroppedCheckbox").prop("checked")) {
    statuses.push("DROPPED");
  }
  if ($("#cslgListImportPlanningCheckbox").prop("checked")) {
    statuses.push("PLANNING");
  }
  $("#cslgListImportText").text(`Retrieving Anilist: ${statuses}`);
  let hasNextPage = true;
  while (hasNextPage) {
    let data = await getAnilistData(username, statuses, pageNumber);
    if (data) {
      for (let item of data.mediaList) {
        if (item.media.idMal) {
          /** @type {import('./types.js').MalIdEntry} */
          const malIdEntry = {
            malId: item.media.idMal,
            genres: item.media.genres,
            tags: item.media.tags.map((tag) => tag.name), // Extracting tag names
            rating: (item.media.averageScore / 10).toFixed(1),
          };
          malIds.push(malIdEntry);
        }
      }
      if (data.pageInfo.hasNextPage) {
        pageNumber += 1;
      } else {
        hasNextPage = false;
      }
    } else {
      $("#cslgListImportText").text("Anilist API Error");
      hasNextPage = false;
    }
  }

  return malIds;
}

/**
 * Fetch data from Anilist API
 *
 * @param {string} username Anilist username
 * @param {import('./types/anilist.js').AnilistStatus[]} statuses
 * @param {number} pageNumber
 * @returns {Promise<import('./types/anilist.js').AnilistQueryResults["Page"] | void>}
 */
function getAnilistData(username, statuses, pageNumber) {
  let query = /* GraphQL */ `
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
                        genres
                        tags {
                          name
                        }
                        averageScore
                    }
                }
            }
        }
    `;
  let data = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: query }),
  };

  fetch("https://graphql.anilist.co", data).then((res) =>
    console.log(res.json())
  );

  return fetch("https://graphql.anilist.co", data)
    .then((res) => res.json())
    .then(
      (
        /** @type {{ data: import('./types/anilist.js').AnilistQueryResults} }*/ json
      ) => json?.data?.Page
    )
    .catch((error) => console.log(error));
}

/**
 * @param {import('./types.js').MalIdEntry[]} malIds
 */
async function getSongListFromMalIds(malIds) {
  if (!malIds) malIds = [];
  importedSongList = [];
  $("#cslgListImportText").text(
    `Anime: 0 / ${malIds.length} | Songs: ${importedSongList.length}`
  );
  if (malIds.length === 0) return;
  let url = "https://anisongdb.com/api/malIDs_request";
  let idsProcessed = 0;
  console.log("malIds: ", malIds);
  for (let i = 0; i < malIds.length; i += 500) {
    let segment = malIds.slice(i, i + 500);
    idsProcessed += segment.length;
    // Extract only the malId from each entry in the segment
    let malIdSegment = segment.map((item) => item.malId);
    let data = {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ malIds: malIdSegment }),
    };
    await fetch(url, data)
      .then((res) => res.json())
      .then(
        (/** @type {import('./types/anisong.js').AnisongEntry[]} */ json) => {
          if (Array.isArray(json)) {
            for (const data of json) {
              // Assuming anime is structured correctly to find the right item
              const animeIndex = segment.findIndex(
                (item) => item.malId === data.linked_ids.myanimelist
              );
              if (animeIndex !== -1) {
                /** @type {import('./types.js').Song} */
                const song = {
                  songName: data.songName,
                  songArtist: data.songArtist,
                  animeRomajiName: data.animeJPName,
                  animeEnglishName: data.animeENName,
                  ...parseSongType(data.songType),
                  animeVintage: data.animeVintage ?? null,
                  video480: data.MQ ?? null,
                  video720: data.HQ ?? null,
                  altAnimeNames: [
                    data.animeJPName,
                    data.animeENName,
                    ...(data.animeAltName ?? []),
                  ],
                  altAnimeNamesAnswers: [],
                  annId: data.annId,
                  malId: data.linked_ids.myanimelist,
                  kitsuId: data.linked_ids.kitsu,
                  aniListId: data.linked_ids.anilist,
                  animeGenre: segment[animeIndex].genres ?? [], // Use the genres from malIds
                  animeTags: segment[animeIndex].tags ?? [], // Use the tags from malIds
                  rating: Number(segment[animeIndex].rating) ?? null,
                  correctGuess: true,
                  incorrectGuess: true,
                  audio: data.audio ?? null,
                  startPoint: null,
                  rebroadcast: data.isRebroadcast ?? null,
                  dub: data.isDub ?? null,
                  songDifficulty: data.songDifficulty ?? null,
                  animeType: data.animeType ?? null,
                };

                // Search if the song is in other animes in the list
                for (let otherAnime of json) {
                  if (otherAnime !== data) {
                    // Skip comparing the anime with itself
                    // Check if the names and artist match
                    if (
                      otherAnime.songName === data.songName &&
                      otherAnime.songArtist === data.songArtist
                    ) {
                      if (
                        !(
                          otherAnime.animeJPName === data.animeJPName &&
                          otherAnime.animeENName === data.animeENName
                        )
                      ) {
                        song.altAnimeNamesAnswers.push(otherAnime.animeENName);
                        song.altAnimeNamesAnswers.push(otherAnime.animeJPName);
                      }
                    }
                  }
                }
                // Enrich the anime data with genres and tags
                importedSongList.push(song);
              }
            }
            $("#cslgListImportText").text(
              `Anime: ${idsProcessed} / ${malIds.length} | Songs: ${importedSongList.length}`
            );
          } else {
            $("#cslgListImportText").text("anisongdb error");
            console.log(json);
            throw new Error("did not receive an array from anisongdb");
          }
        }
      )
      .catch((res) => {
        importedSongList = [];
        $("#cslgListImportText").text("anisongdb error");
        console.log(res);
      });
  }
}

// start list import process
async function startImport() {
  if (importRunning) return;
  importRunning = true;
  $("#cslgListImportStartButton").addClass("disabled");
  $("#cslgListImportActionContainer").hide();
  if ($("#cslgListImportSelect").val() === "myanimelist") {
    if (malClientId) {
      let username = String($("#cslgListImportUsernameInput").val()).trim();
      if (username) {
        let malIds = await getMalIdsFromMyanimelist(username);
        await getSongListFromMalIds(malIds);
      } else {
        $("#cslgListImportText").text("Input Myanimelist Username");
      }
    } else {
      $("#cslgListImportText").text("Missing MAL Client ID");
    }
  } else if ($("#cslgListImportSelect").val() === "anilist") {
    let username = String($("#cslgListImportUsernameInput").val()).trim();
    if (username) {
      let malIds = await getMalIdsFromAnilist(username);
      await getSongListFromMalIds(malIds);
    } else {
      $("#cslgListImportText").text("Input Anilist Username");
    }
  }
  if (importedSongList.length) {
    $("#cslgListImportActionContainer").show();
    $("#cslgListImportMoveButton")
      .off("click")
      .on("click", function () {
        mySongList = importedSongList;
        isSearchMode = false;
        $("#cslgToggleModeButton").text("My Songs");
        updateSongListDisplay();
        createAnswerTable();
        $("#cslgListImportActionContainer").hide();
        gameChat.systemMessage(
          `Imported ${mySongList.length} songs to My Songs list.`
        );
      });
    $("#cslgListImportDownloadButton")
      .off("click")
      .on("click", function () {
        if (!importedSongList.length) return;
        let listType = $("#cslgListImportSelect").val();
        let username = String($("#cslgListImportUsernameInput").val()).trim();
        let date = new Date();
        let dateFormatted = `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        let data =
          "data:text/json;charset=utf-8," +
          encodeURIComponent(JSON.stringify(importedSongList));
        let element = document.createElement("a");
        element.setAttribute("href", data);
        element.setAttribute(
          "download",
          `${username} ${listType} ${dateFormatted} song list.json`
        );
        document.body.appendChild(element);
        element.click();
        element.remove();
      });
  }
  $("#cslgListImportStartButton").removeClass("disabled");
  importRunning = false;
}

/**
 * Validate json data in local storage
 *
 * @param {string} item The item to validate
 * @returns {import('./types.js').CSLSettings}
 */
function validateLocalStorage(item) {
  try {
    return JSON.parse(localStorage.getItem(item) ?? "{}");
  } catch {
    return {};
  }
}

function applyStyles() {
  $("#customSongListStyle").remove();
  let tableHighlightColor =
    getComputedStyle(document.documentElement).getPropertyValue(
      "--accentColorContrast"
    ) || "#4497ea";
  let style = document.createElement("style");
  style.type = "text/css";
  style.id = "customSongListStyle";
  let text = /*css*/ `

    input.number-to-text::-webkit-outer-spin-button,
    input.number-to-text::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    input[type=number].number-to-text {
        -moz-appearance: textfield;
    }

	.close {
    position: absolute;
    right: 15px;
    top: 10px;
	}

	.modal-header {
    position: relative;
	}

	.modal-header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: 10px;
	}

	.modal-title {
		flex-grow: 1;
		text-align: center;
		margin: 0;
	}

	.training-info-link {
		font-size: 0.9em;
		cursor: pointer;
		color: #4a90e2; /* Warmer blue color */
		position: absolute;
		left: 15px;
		top: 10px;
	}

	.training-info-link:hover {
		text-decoration: underline;
		color: #3a7bd5; /* Slightly darker on hover */
	}

	.cslg-search,
	.cslg-anisongdb-search {
		display: flex;
		align-items: center;
		width: 100%;
	}

	#cslgSearchCriteria,
	#cslgAnisongdbModeSelect {
		width: 120px;
		flex-shrink: 0;
	}

	#cslgSearchInput,
	#cslgAnisongdbQueryInput {
		flex-grow: 1;
		margin: 0 10px;
	}

	#cslgAnisongdbSearchButtonGo {
		flex-shrink: 0;
	}

    .btn-group-sm>.btn, .btn-sm {
        padding: 3px 8px;
        font-size: 13px;
        line-height: 1.5;
        border-radius: 3px;
    }

    #cslgToggleModeButton, #cslgFileUpload {
        padding: 2px 10px;
        font-size: 14px;
    }

    #lnCustomSongListButton, #lnStatsButton {
        left: calc(25%);
        width: 80px;
    }

    #lnStatsButton {
        left: calc(25% + 90px);
    }

    #cslgSongListContainer input[type="radio"],
    #cslgSongListContainer input[type="checkbox"],
    #cslgQuizSettingsContainer input[type="checkbox"],
    #cslgQuizSettingsContainer input[type="radio"],
    #cslgListImportContainer input[type="checkbox"] {
        width: 20px;
        height: 20px;
        margin-left: 3px;
        vertical-align: -5px;
        cursor: pointer;
    }

    #cslgSongListTable, #cslgMergedSongListTable {
        width: 100%;
        table-layout: fixed;
    }

    #cslgSongListTable thead tr, #cslgMergedSongListTable thead tr {
        font-weight: bold;
    }

    #cslgSongListTable .number, #cslgMergedSongListTable .number {
        width: 30px;
    }

    #cslgSongListTable .difficulty {
        width: 30px;
    }

    #cslgSongListTable .songType, #cslgMergedSongListTable .songType {
        width: 45px;
    }

    #cslgSongListTable .vintage {
        width: 100px;
    }

    #cslgSongListTable .action {
        width: 50px;
    }

    #cslgMergedSongListTable .action {
        width: 55px;
    }

    .btn.focus, .btn:focus, .btn:hover {
    color: white;
    }

    #cslgSongListTable .action i.fa-plus:hover,
    #cslgSongListTable .action i.fa-check:hover {
        color: #5cb85c;
    }

    #cslgSongListTable .action i.fa-trash:hover,
    #cslgMergedSongListTable .action i.fa-trash:hover {
        color: #d9534f;
    }

    #cslgSongListTable .action i.fa-ban:hover {
        color: #f0ad4e;
    }

    #cslgMergedSongListTable .action i.fa-chevron-up:hover,
    #cslgMergedSongListTable .action i.fa-chevron-down:hover {
        color: #f0ad4e;
    }

    #cslgSongListTable th, #cslgSongListTable td,
    #cslgMergedSongListTable th, #cslgMergedSongListTable td {
        padding: 0 4px;
    }

    #cslgSongListTable tr.selected td:not(.action),
    #cslgMergedSongListTable tr.selected td:not(.action) {
        color: ${tableHighlightColor};
    }

/* Adjust the header row layout */
.cslg-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

/* Ensure consistent spacing */
.cslg-header-row > div {
    margin-right: 15px;
}

.cslg-header-row > div:last-child {
    margin-right: 0;
}

    .cslg-mode-selector,
    .cslg-file-upload,
    .cslg-actions,
    .cslg-search,
    .cslg-counts,
    .cslg-anisongdb-search,
    .cslg-options,
    .cslg-advanced-options,
    .cslg-show-ignored {
        display: flex;
        align-items: center;
    }

	.cslg-counts {
		white-space: nowrap;
		margin-left: 10px;
	}

    .cslg-search select,
    .cslg-search input,
    .cslg-anisongdb-search select,
    .cslg-anisongdb-search input {
        margin-right: 5px;
    }

    #songOptionsButton {
    background-color: rgba(73, 80, 87, 1)
    }

    #cslgShowIgnoredButton {
    background-color: rgba(73, 80, 87, 1)
    }

    .form-control-sm {
        height: 25px;
        padding: 2px 5px;
        font-size: 12px;
        line-height: 1.5;
    }

    .dark-theme .form-control {
        color: #f8f9fa;
        background-color: rgba(73, 80, 87, 0.7);
        border-color: #6c757d;
    }

    .cslg-advanced-options .input-group {
        width: auto;
        margin-right: 10px;
    }

    .cslg-advanced-options .input-group-text {
        padding: 2px 5px;
        font-size: 12px;
    }

    .cslg-advanced-options input[type="number"] {
        width: 50px;
    }

    #cslgShowIgnoredButton {
        font-size: 12px;
        padding: 2px 8px;
    }

    .cslg-options {
    	margin-left: 10px;
    }

    .cslg-settings-section {
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 5px;
        padding: 15px;
        margin-bottom: 20px;
    }

    .cslg-settings-section h3 {
        margin-top: 0;
        margin-bottom: 15px;
        font-size: 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 5px;
    }

    .cslg-setting-row {
        display: flex;
        align-items: center;
        margin-bottom: 10px;
    }

    .cslg-setting-row input[type="number"],
    .cslg-setting-row input[type="text"],
    .cslg-setting-row select {
        flex: 0 0 100px;
        margin-right: 10px;
        color: black;
    }

    .cslg-checkbox-group {
        display: flex;
        flex-wrap: wrap;
    }

    .cslg-checkbox-group label {
        margin-right: 15px;
        display: flex;
        align-items: center;
    }

    .cslg-checkbox-group input[type="checkbox"] {
        margin-right: 5px;
    }

    .fa-info-circle {
        cursor: pointer;
        margin-left: 5px;
    }

    .song-options-popup {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 300px;
        background-color: #1a1a1a;
        border: 1px solid #495057;
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 10000;
        padding: 20px;
        color: #f8f9fa;
    }

    .song-options-popup.show {
        display: block;
    }

    .song-options-backdrop {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        z-index: 9999;
    }

    .song-options-backdrop.show {
        display: block;
    }

    .song-options-popup h6 {
        font-size: 1.1em;
        margin-top: 15px;
        margin-bottom: 10px;
        color: #adb5bd;
        border-bottom: 1px solid #495057;
        padding-bottom: 5px;
    }

    .song-options-popup .checkbox-group {
        display: flex;
        flex-direction: column;
        margin-bottom: 15px;
    }

    .song-options-popup .checkbox-group label {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        color: #f8f9fa;
    }

    .song-options-popup .checkbox-group input[type="checkbox"] {
        margin-right: 10px;
    }

    .song-options-close {
        position: absolute;
        top: 10px;
        right: 10px;
        font-size: 1.5em;
        color: #adb5bd;
        cursor: pointer;
    }

    .song-options-close:hover {
        color: #fff;
    }

	.cslg-mode-selector {
    display: flex;
    align-items: center;
}

.cslg-mode-selector .btn {
    margin-right: 10px;
}

.cslg-actions {
    display: flex;
    align-items: center;
}

.btn-icon {
    background: none;
    border: none;
    color: white;
    font-size: 1.5em;
    padding: 5px;
    margin: 0 5px;
    cursor: pointer;
}

.btn-icon:hover {
    opacity: 0.8;
}

.anisongdb-search-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Add this to your existing styles */
.cslg-header-row.anisongdb-search-row {
    display: flex;
}

body:not(.song-search-mode) .cslg-header-row.anisongdb-search-row {
    display: none;
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
  $("#customSongListStyle").append(`
        #cslgSearchCriteria {
            color: white;
            padding: 3px;
            margin-right: 10px;
        }
    `);
}
