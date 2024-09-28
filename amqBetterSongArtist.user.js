// ==UserScript==
// @name         AMQ Song Artist Mode
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  Makes you able to play song/artist with other people who have this script installed. Includes dropdown (with auto-update) and scoretable.
// @author       4Lajf (forked from Zolhungaj)
// @match        https://*.animemusicquiz.com/*
// @grant        none
// @downloadURL  https://github.com/4Lajf/amq-scripts/raw/main/amqBetterSongArtist.user.js
// @updateURL    https://github.com/4Lajf/amq-scripts/raw/main/amqBetterSongArtist.user.js
// @require      https://github.com/amq-script-project/AMQ-Scripts/raw/master/gameplay/simpleLogger.js
// @require      https://raw.githubusercontent.com/TheJoseph98/AMQ-Scripts/master/common/amqScriptInfo.js
// @copyright    MIT license
// ==/UserScript==
// It only shows score on scoreboard during guess phase and IDK how to bypass it buy anyways, it works.
// I'm sure you can guess which parts of code were written by me. I don't know js very much so it's dirty garbage but hey, again, it works! (I hope)

/* Limits how many songs can be rendered when you type a keyword. Larger number means more lag and requires more computing power. */
let dropdownListLimit = 50;
/* 0 - Strict Mode: Need to submit all artists that sings in the song OR the group that they all appear in (only groups that exist in universe of that anime)
1 - Lax Mode: Need to submit only one artist that sings in the song OR they appear in (only groups that exist in universe of that anime) */
let defaultMode = 1;
/* The rest of the script */
//TODO: Escape ","
let enableScript = true,
    scoreboardReady = false,
    playerDataReady = false,
    returningToLobby = false,
    playerData = {},
    playerAmount = 0,
    songList,
    titles,
    artists,
    songsInit = false,
    artistsInit = false,
    titleValue,
    artistValue;

// listeners
let quizReadyRigTracker, answerResultsRigTracker, joinLobbyListener, spectateLobbyListener, quizEndTracker;

if (document.getElementById("startPage")) return;

// Wait until the LOADING... screen is hidden and load script
let loadInterval = setInterval(() => {
    if (document.getElementById("loadingScreen").classList.contains("hidden")) {
        setup();
        clearInterval(loadInterval);
    }
}, 500);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Writes the current rig to scoreboard
function writeRigToScoreboard() {
    if (enableScript === false) {
        return;
    }
    if (playerDataReady) {
        for (let entryId in quiz.scoreboard.playerEntries) {
            let entry = quiz.scoreboard.playerEntries[entryId];
            let guessedCounter = entry.$entry.find(".qps-sa-score");
            guessedCounter.text(playerData[entryId].score);
            quiz.scoreboard.playerEntries[entryId].$score[0].textContent = playerData[entryId].rig;
        }
    }
}

// Clears the rig counters from scoreboard
function clearScoreboard() {
    if (enableScript === false) {
        return;
    }
    $(".qps-sa-score").remove();
    scoreboardReady = false;
}

// Clears player data
function clearPlayerData() {
    if (enableScript === false) {
        return;
    }
    playerData = {};
    playerDataReady = false;
    missedFromOwnList = 0;
}

// Creates the player data for counting rig (and score)
function initialisePlayerData() {
    if (enableScript === false) {
        return;
    }
    clearPlayerData();
    for (let entryId in quiz.players) {
        playerData[entryId] = {
            rig: 0,
            score: 0,
            missedList: 0,
            name: quiz.players[entryId]._name,
        };
    }
    playerDataReady = true;
}

// Creates the rig counters on the scoreboard and sets them to 0
function initialiseScoreboard() {
    if (enableScript === false) {
        return;
    }
    clearScoreboard();
    for (let entryId in quiz.scoreboard.playerEntries) {
        let tmp = quiz.scoreboard.playerEntries[entryId];
        let rig = $(`<span class="qps-sa-score">0</span>`);
        tmp.$entry.find(".qpsPlayerName").before(rig);
    }
    scoreboardReady = true;
}

async function toggleScript(e) {
    if (e.altKey && e.key == "h") {
        enableScript = !enableScript;

        gameChat.systemMessage(enableScript ? "Song/Artist script has been ENABLED" : "Song/Artist script has been DISABLED");
        if (enableScript === false) {
            let songArtistDOMElement = document.querySelector("#songartist");
            songArtistDOMElement.style.display = "none";
            let playerScore = document.querySelector(".qps-sa-score");
            playerScore.style.display = "none";
        }
        if (enableScript === true) {
            let songArtistDOMElement = document.querySelector("#songartist");
            songArtistDOMElement.style.display = "block";
            let playerScore = document.querySelector(".qps-sa-score");
            playerScore.style.display = "block";
        }
    }
}

async function fetchAnisongDBArtistAutocomplete() {
    let artists;
    try {
        const response = await fetch("https://anisongdb.com/api/artist_autocomplete", {
            method: "GET",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        artists = data;
    } catch (error) {
        console.error("Fetch error:", error);
    }
    return artists;
}

async function fetchAnisongDBTitleAutocomplete() {
    let titles;
    try {
        const response = await fetch("https://anisongdb.com/api/song_name_autocomplete", {
            method: "GET",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        titles = data;
    } catch (error) {
        console.error("Fetch error:", error);
    }
    return titles;
}

function parseMessage(content) {
    if (content.startsWith("/sa")) {
        //toggle sa
        enableScript = !enableScript;

        gameChat.systemMessage(enableScript ? "Song/Artist script has been ENABLED" : "Song/Artist script has been DISABLED");
        if (enableScript === false) {
            let songArtistDOMElement = document.querySelector("#songartist");
            songArtistDOMElement.style.display = "none";
            let playerScore = document.querySelector(".qps-sa-score");
            playerScore.style.display = "none";
        }
        if (enableScript === true) {
            let songArtistDOMElement = document.querySelector("#songartist");
            songArtistDOMElement.style.display = "block";
            let playerScore = document.querySelector(".qps-sa-score");
            playerScore.style.display = "block";
        }
    }
}

new Listener("game chat update", (payload) => {
    for (let message of payload.messages) {
        if (message.message.startsWith("/")) {
            parseMessage(message.message, message.sender);
        }
    }
}).bindListener();

// Initial setup on quiz start
quizReadyRigTracker = new Listener("quiz ready", async (data) => {
    gameChat.systemMessage('Press [Alt+H] or type "/sa" to toggle Song/Artist');
    document.addEventListener("keydown", toggleScript);

    const cacheDate = localStorage.getItem("SACacheDate");
    if (!cacheDate || cacheDate < Date.now() - 86_400_000) {
        localStorage.setItem("SACacheDate", Date.now());

        titles = await fetchAnisongDBTitleAutocomplete();
        artists = await fetchAnisongDBArtistAutocomplete();

        localStorage.setItem("titleData", JSON.stringify(titles));
        localStorage.setItem("artistData", JSON.stringify(artists));
    } else {
        titles = JSON.parse(localStorage.getItem("titleData"));
        artists = JSON.parse(localStorage.getItem("artistData"));
    }

    playerAmount = Object.entries(quiz.players).length;
    returningToLobby = false;
    clearPlayerData();
    clearScoreboard();
    answerResultsRigTracker.bindListener();
    initialiseScoreboard();
    initialisePlayerData();

    await sleep(2000);
});

// Reset data when joining a lobby
joinLobbyListener = new Listener("Join Game", async (payload) => {
    if (enableScript === false) {
        return;
    }
    songsInit = false;
    const cacheDate = localStorage.getItem("SACacheDate");
    if (!cacheDate || cacheDate < Date.now() - 86_400_000) {
        localStorage.setItem("SACacheDate", Date.now());

        titles = await fetchAnisongDBTitleAutocomplete();
        artists = await fetchAnisongDBArtistAutocomplete();

        localStorage.setItem("titleData", JSON.stringify(titles));
        localStorage.setItem("artistData", JSON.stringify(artists));
    } else {
        titles = JSON.parse(localStorage.getItem("titleData"));
        artists = JSON.parse(localStorage.getItem("artistData"));
    }

    if (payload.error) {
        return;
    }
    if (payload.inLobby) {
        answerResultsRigTracker.unbindListener();
        clearPlayerData();
        clearScoreboard();
    }
});

// stuff to do on answer reveal
answerResultsRigTracker = new Listener("answer results", async (result) => {
    if (enableScript === false) {
        return;
    }
    for (let player of result.players) {
        if (player.correct === true) {
            playerData[player.gamePlayerId].score++;
        }
    }
    await sleep(100);
    writeRigToScoreboard();
});

// Reset data when spectating a lobby
spectateLobbyListener = new Listener("Spectate Game", (payload) => {
    if (enableScript === false) {
        return;
    }
    if (payload.error) {
        return;
    }
    answerResultsRigTracker.bindListener();
    clearPlayerData();
    clearScoreboard();
});

//Remove Alt+H listener on the end of the game
quizEndTracker = new Listener("quiz end result", (result) => {
    if (enableScript === false) {
        return;
    }
    document.removeEventListener("keydown", toggleScript);
    writeRigToScoreboard();
});

quizReadyRigTracker.bindListener();
answerResultsRigTracker.bindListener();
joinLobbyListener.bindListener();
spectateLobbyListener.bindListener();
quizEndTracker.bindListener();
let currentArtist = [];
class SongArtistMode {
    #signature = "sa-";
    #songHeader = "s";
    #artistHeader = "a";
    #revealHeader = "r";
    #teamHeader = "t";
    #hashHeader = "h";
    #playerHashesSong = new Map();
    #playerHashesArtist = new Map();
    #playerHashesSongLocked = new Map();
    #playerHashesArtistLocked = new Map();
    #playerAnswersSong = new Map();
    #playerAnswersArtist = new Map();
    #playerSongScore = new Map();
    #playerArtistScore = new Map();
    #playerContainers = new Map();
    #currentSong = "";
    debug = false;

    #logger = new SimpleLogger("Song-Artist Mode");

    #songField;
    #artistField;
    constructor() {
        if (enableScript === false) {
            return;
        }

        if (window.socket === undefined) {
            return;
        }
        new window.Listener("game chat update", ({ messages }) => this.#handleMessages(messages)).bindListener();
        new window.Listener("Game Chat Message", (message) => this.#handleMessages([message])).bindListener();
        //team messages are sent instantly and alone instead of grouped up
        new window.Listener("answer results", ({ songInfo }) => this.#answerResults(songInfo)).bindListener();
        new window.Listener("guess phase over", this.#autoSubmit).bindListener();
        new window.Listener("player answers", this.#answerReveal).bindListener();
        new window.Listener("quiz ready", this.#reset).bindListener();
        new window.Listener("Game Starting", this.#reset).bindListener();
        new window.Listener("Join Game", this.#reset).bindListener();
        new window.Listener("play next song", this.#reset).bindListener();
        //new Listener("play next song", this.#clearAnswerFields)
        new window.Listener("Game Starting", this.#setupPlayers).bindListener();
        new window.Listener("Join Game", ({ quizState }) => this.#setupPlayers(quizState)).bindListener();

        const oldChatUpdate = window.gameChat._chatUpdateListener;
        window.gameChat._chatUpdateListener = new window.Listener("game chat update", (payload) => {
            if (!this.debug) {
                payload.messages = payload.messages.filter(({ message }) => !message.startsWith(this.#signature));
            }
            oldChatUpdate.callback.apply(window.gameChat, [payload]);
        });
        const oldGameChatMessage = window.gameChat._newMessageListner;
        window.gameChat._newMessageListner = new window.Listener("Game Chat Message", (payload) => {
            if (this.debug || !payload.message.startsWith(this.#signature)) {
                oldGameChatMessage.callback.apply(window.gameChat, [payload]);
            }
        });
    }

    /**
     * @param {number} value
     * @return {number} current value of logLevel
     */
    logLevel = (value) => {
        return (this.#logger.logLevel = value);
    };

    /**
     * @param {Object} object
     * @param {[{gamePlayerId: number, name: string}]} object.players
     */
    #setupPlayers = async ({ players }) => {
        while (window.quiz.players === undefined || window.quiz.players === null) {
            await this.#wait(250); //wait for quiz.players to finish setup
        }
        this.#playerContainers.clear();
        players.forEach(({ gamePlayerId, name }) => {
            this.#playerContainers.set(name, window.quiz.players[gamePlayerId].avatarSlot);
        });
        this.#playerContainers.forEach((avatarSlot) => {
            const animeAnswerContainer = avatarSlot.$answerContainer;

            const songAnswerElement = animeAnswerContainer[0].cloneNode(true);
            songAnswerElement.style = "top:20px";
            avatarSlot.$innerContainer[0].appendChild(songAnswerElement);

            avatarSlot.$songAnswerContainer = $(songAnswerElement);
            avatarSlot.$songAnswerContainerText = avatarSlot.$songAnswerContainer.find(".qpAvatarAnswerText");

            const artistAnswerElement = animeAnswerContainer[0].cloneNode(true);
            artistAnswerElement.style = "top:60px";
            avatarSlot.$innerContainer[0].appendChild(artistAnswerElement);
            avatarSlot.$artistAnswerContainer = $(artistAnswerElement);
            avatarSlot.$artistAnswerContainerText = avatarSlot.$artistAnswerContainer.find(".qpAvatarAnswerText");
        });
    };

    #autoSubmit = () => {
        this.#logger.debug("autoSubmit triggered");
        if (this.#songField.value !== "" && this.#currentSong === "") {
            this.#submitSong(this.#songField.value);
        }
        if (this.#artistField.value !== "") {
            this.#submitArtist(this.#artistField.value, 0);
        }
    };

    #showSong = (playerName, song, correct) => {
        const avatarSlot = this.#playerContainers.get(playerName);
        if (avatarSlot === undefined) {
            return;
        }
        this.#showAnswer(playerName, song, correct, avatarSlot.$songAnswerContainer, avatarSlot.$songAnswerContainerText);
    };

    #showArtist = (playerName, artist, correct) => {
        const avatarSlot = this.#playerContainers.get(playerName);
        if (avatarSlot === undefined) {
            return;
        }
        this.#showAnswer(playerName, artist, correct, avatarSlot.$artistAnswerContainer, avatarSlot.$artistAnswerContainerText);
    };

    #showAnswer(playerName, value, correct, $container, $text) {
        if (value === undefined || value === "") {
            $container[0].classList.add("hide");
        } else {
            $container[0].classList.remove("hide");
        }
        $text.text(value);
        if (correct !== undefined) {
            const classList = $text[0].classList;
            if (correct) {
                classList.add("rightAnswer");
            } else {
                classList.add("wrongAnswer");
            }
        }
        window.fitTextToContainer($text, $container, 23, 9);
    }

    #wait = (time) => {
        return new Promise((resolve, _) => {
            setTimeout(resolve, time);
        });
    };

    #reset = () => {
        this.#playerHashesSong.clear();
        this.#playerHashesArtist.clear();
        this.#playerHashesSongLocked.clear();
        this.#playerHashesArtistLocked.clear();
        this.#playerSongScore.clear();
        this.#playerArtistScore.clear();
        this.#playerAnswersSong.clear();
        this.#playerAnswersArtist.clear();

        this.#currentSong = "";
        currentArtist = [];

        this.#setupAnswerArea();
        this.#songField.disabled = false;
        this.#artistField.disabled = false;
        this.#songField.value = "";
        this.#artistField.value = "";

        this.#playerContainers?.forEach((avatarSlot) => {
            avatarSlot.$songAnswerContainer[0].classList.add("hide");
            avatarSlot.$songAnswerContainerText.text("");
            avatarSlot.$songAnswerContainerText[0].classList.remove("wrongAnswer", "rightAnswer");
            avatarSlot.$artistAnswerContainer[0].classList.add("hide");
            avatarSlot.$artistAnswerContainerText.text("");
            avatarSlot.$artistAnswerContainerText[0].classList.remove("wrongAnswer", "rightAnswer");
        });
    };

    #setupAnswerArea = () => {
        if (document.getElementById("songartist")) {
            return;
        }
        const answerInput = document.getElementById("qpAnswerInputContainer");
        const container = document.createElement("div");
        container.id = "songartist";
        const songContainer = document.createElement("div");
        songContainer.id = "song";
        const songTitlesInput = answerInput.cloneNode(true);
        const songTitlesAnswerField = songTitlesInput.childNodes[3];

        // Creating "title" input field
        songTitlesAnswerField.placeholder = "Song Title";
        songTitlesAnswerField.maxLength = "" + 150 - this.#signature.length - 2;
        songTitlesInput.removeChild(songTitlesInput.childNodes[1]); //remove skip button
        songContainer.appendChild(songTitlesInput);
        container.appendChild(songContainer);

        // Create autocomplete dropdown (ul) for titles field
        let dropdownFocus = -1;
        let artistArrayPos = -1;
        const titlesList = document.createElement("ul");
        titlesList.id = "songs-list";
        titlesList.style =
            "max-height: 190px; overflow: hidden; position: absolute; z-index: 9999 !important; width:100%; background: #424242; border: none; box-shadow: 0 0 10px 2px rgb(0 0 0); border-radius: 0.3em; margin: 0.2em 0 0; text-shadow: none; box-sizing: border-box; list-style: none; padding: 0;";
        songTitlesInput.appendChild(titlesList);

        let songDropdownItems = [];

        const songsListElement = songTitlesInput.querySelector("#songs-list");
        const songsInputElement = songTitlesInput.querySelector("#qpAnswerInput");

        function closeDropdown(element) {
            element.innerHTML = "";
            dropdownFocus = -1;
        }

        songsInputElement.addEventListener("input", function () {
            if (!songsInputElement.value) {
                closeDropdown(songsListElement);
            }

            if (songsInputElement.value) {
                titleValue = songsInputElement.value;
                //TODO: Add proper special characters escpae
                titleValue = titleValue.replace(/[^a-zA-Z0-9 ]/g, " ");
                const filteredData = filterData(titles, titleValue);
                loadTitleData(filteredData, songsListElement);
                songDropdownItems = songsListElement.querySelectorAll("li");
            }
        });

        function filterData(data, query) {
            // Normalize query once for comparison
            const normalizedQuery = query.toLowerCase();

            // Helper function to calculate the score
            function calculateScore(item) {
                const normalizedItem = item.replace(/[^a-zA-Z0-9 ]/g, " ").toLowerCase();

                if (normalizedItem === normalizedQuery) {
                    // Perfect match
                    return 2;
                } else if (normalizedItem.startsWith(normalizedQuery) || normalizedItem.endsWith(normalizedQuery)) {
                    // Start or end match
                    return 1;
                } else if (normalizedItem.includes(normalizedQuery)) {
                    // Partial match
                    return 0.5;
                } else {
                    // No match
                    return 0;
                }
            }

            // Filter and then sort
            return data
                .filter((x) =>
                    x
                        .replace(/[^a-zA-Z0-9 ]/g, " ")
                        .toLowerCase()
                        .includes(normalizedQuery)
                )
                .sort((a, b) => calculateScore(b) - calculateScore(a));
        }

        function loadTitleData(data, element) {
            let dataLength = data.length;
            if (dataLength >= dropdownListLimit) {
                dataLength = dropdownListLimit;
                data.splice(dropdownListLimit, data.length);
            }

            // Create autocomplete dropdown elements for titles (li)
            if (data) {
                data, element;
                element.innerHTML = "";
                for (let i = 0; i < dataLength; i++) {
                    let el = document.createElement("li");
                    let songElIndex = data[i]
                        .toLowerCase()
                        .replace(/[^a-zA-Z0-9 ]/g, " ")
                        .indexOf(titleValue.toLowerCase());
                    data[i] = `${data[i].substr(0, songElIndex)}<b style="color:#4497ea;">${data[i].substr(songElIndex, titleValue.length)}</b>${data[i].substr(titleValue.length + songElIndex, data[i].length)}`;
                    el.innerHTML = data[i];
                    el.style = "position: relative; padding: 0.2em 0.5em; cursor: pointer;";
                    el.type = "button";
                    el.setAttribute("onmouseover", `this.style.backgroundColor='#3d6d8f'`);
                    el.setAttribute("onmouseout", `this.style.backgroundColor='#424242'`);
                    el.setAttribute("onfocusin", `this.style.backgroundColor='#3d6d8f'`);
                    el.setAttribute("onfocusout", `this.style.backgroundColor='#424242'`);
                    //Required for ".focus()" to work
                    el.setAttribute("tabindex", "-1");
                    el.addEventListener("click", function () {
                        songsInputElement.value = el.innerText;
                        closeDropdown(songsListElement);
                    });
                    element.appendChild(el);
                }
            }
        }

        // A hacky way to tell the dropdown to close once it's out of focus
        document.addEventListener("click", function () {
            closeDropdown(songsListElement);
        });

        songContainer.addEventListener("keydown", function (e) {
            if (e.key == "ArrowDown") {
                dropdownFocus++;
                if (dropdownFocus >= songDropdownItems.length) {
                    dropdownFocus = 0;
                }
                songDropdownItems[dropdownFocus].focus();
            }
            if (e.key == "ArrowUp") {
                dropdownFocus--;
                if (dropdownFocus < 0) {
                    dropdownFocus = songDropdownItems.length - 1;
                }
                songDropdownItems[dropdownFocus].focus();
            }
            if (e.key == "Enter" && songDropdownItems[dropdownFocus]) {
                songDropdownItems[dropdownFocus].focus();
                songsInputElement.value = document.activeElement.innerText;
                closeDropdown(songsListElement);
                artistsInputElement.focus();
            }
            if (e.key == "Escape") {
                closeDropdown(songsListElement);
            }
            if (e.key == "Tab") {
                songsInputElement.value = document.activeElement.innerText;
                closeDropdown(songsListElement);
                artistsInputElement.focus();
            }
        });

        // Creating "artist" input field
        const artistContainer = document.createElement("div");
        artistContainer.id = "artist";
        const songArtistsInput = answerInput.cloneNode(true);
        const songArtistsAnswerField = songArtistsInput.childNodes[3];
        songArtistsAnswerField.placeholder = "Artist";
        songArtistsAnswerField.maxLength = "" + 150 - this.#signature.length - 2;
        songArtistsInput.removeChild(songArtistsInput.childNodes[1]); //remove skip button
        artistContainer.appendChild(songArtistsInput);
        container.appendChild(artistContainer);

        // Creating autocomplete dropdown for artists (ul)
        const artistsList = document.createElement("ul");
        artistsList.id = "artists-list";
        artistsList.style =
            "max-height: 190px; overflow: hidden; position: absolute; z-index: 9999 !important; width:100%;background: #424242; border: none; box-shadow: 0 0 10px 2px rgb(0 0 0); border-radius: 0.3em; margin: 0.2em 0 0; text-shadow: none; box-sizing: border-box; list-style: none; padding: 0;";
        songArtistsInput.appendChild(artistsList);

        let artistDropdownItems = [];

        const artistsListElement = songArtistsInput.querySelector("#artists-list");
        const artistsInputElement = songArtistsInput.querySelector("#qpAnswerInput");

        artistsInputElement.addEventListener("input", function () {
            if (!artistsInputElement.value) {
                closeDropdown(artistsListElement);
            }

            if (artistsInputElement.value) {
                artistValue = artistsInputElement.value;
                //TODO: Add proper special characters escpae
                artistValue = artistValue.replace(/[^a-zA-Z0-9 ]/g, " ");
                const filteredData = filterData(artists, artistValue);
                loadArtistData(filteredData, artistsListElement);
                artistDropdownItems = artistsListElement.querySelectorAll("li");
            }
        });

        function loadArtistData(data, element) {
            let dataLength = data.length;
            if (dataLength >= dropdownListLimit) {
                dataLength = dropdownListLimit;
                data.splice(dropdownListLimit, data.length);
            }

            if (data) {
                element.innerHTML = "";
                // Creating autocomplete dropdown elements for artists (li)
                for (let i = 0; i < dataLength; i++) {
                    let el = document.createElement("li");
                    let songElIndex = data[i]
                        .toLowerCase()
                        .replace(/[^a-zA-Z0-9 ]/g, " ")
                        .indexOf(artistValue.toLowerCase());
                    data[i] = `${data[i].substr(0, songElIndex)}<b style="color:#4497ea;">${data[i].substr(songElIndex, artistValue.length)}</b>${data[i].substr(artistValue.length + songElIndex, data[i].length)}`;
                    el.innerHTML = data[i];
                    el.style = "position: relative; padding: 0.2em 0.5em; cursor: pointer;";
                    el.type = "button";
                    el.setAttribute("onmouseover", `this.style.backgroundColor='#3d6d8f'`);
                    el.setAttribute("onmouseout", `this.style.backgroundColor='#424242'`);
                    el.setAttribute("onfocusin", `this.style.backgroundColor='#3d6d8f'`);
                    el.setAttribute("onfocusout", `this.style.backgroundColor='#424242'`);
                    //Required for ".focus()" to work
                    el.setAttribute("tabindex", "-1");
                    el.addEventListener("click", function () {
                        artistsInputElement.value = el.innerText;
                        closeDropdown(artistsListElement);
                    });
                    element.appendChild(el);
                }
            }
        }

        // A hacky way to tell the dropdown to close once it's out of focus
        document.addEventListener("click", function () {
            closeDropdown(artistsListElement);
        });

        artistContainer.addEventListener("keydown", function (e) {
            if (e.key == "ArrowDown") {
                dropdownFocus++;
                if (dropdownFocus >= artistDropdownItems.length) {
                    dropdownFocus = 0;
                }
                artistDropdownItems[dropdownFocus].focus();
            }
            if (e.key == "ArrowUp") {
                dropdownFocus--;
                if (dropdownFocus < 0) {
                    dropdownFocus = artistDropdownItems.length - 1;
                }
                artistDropdownItems[dropdownFocus].focus();
            }
            if (e.key == "Enter" && artistDropdownItems[dropdownFocus]) {
                artistDropdownItems[dropdownFocus].focus();
                artistsInputElement.value = document.activeElement.innerText;
                closeDropdown(artistsListElement);
                artistsInputElement.focus();
            }
            if (e.key == "Escape") {
                closeDropdown(artistsListElement);
            }
            if (e.key == "Tab") {
                artistDropdownItems[dropdownFocus].focus();
                artistsInputElement.value = document.activeElement.innerText;
                closeDropdown(artistsListElement);
                artistsInputElement.focus();
            }
            if (e.key == "ArrowRight") {
                artistArrayPos++;
                if (artistArrayPos < 0) artistArrayPos = 0;
                if (artistArrayPos > currentArtist.length) artistArrayPos = 0;
                if (artistArrayPos > currentArtist.length - 1) {
                    artistsInputElement.value = "";
                    return;
                }
                artistsInputElement.value = currentArtist[artistArrayPos];
            }
            if (e.key == "ArrowLeft") {
                artistArrayPos--;
                if (artistArrayPos < 0) {
                    artistArrayPos = currentArtist.length;
                    artistsInputElement.value = "";
                    return;
                }
                if (artistArrayPos < 0) artistArrayPos = currentArtist.length - 1;
                artistsInputElement.value = currentArtist[artistArrayPos];
            }
        });

        const parent = document.getElementById("qpAnimeCenterContainer");
        parent.appendChild(container);

        this.#songField = songTitlesAnswerField;
        this.#artistField = songArtistsAnswerField;

        this.#songField.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.#submitSong(this.#songField.value);
            }
        });

        this.#artistField.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                if (artistArrayPos > currentArtist.length) artistArrayPos = -1;
                this.#submitArtist(this.#artistField.value, artistArrayPos);
                this.#artistField.value = "";
            }
        });
    };

    /**
     * @param {[{sender: string, message: string}]} messages
     */
    #handleMessages = (messages) => {
        messages
            .filter(({ message }) => message.startsWith(this.#signature))
            .map(this.#stripMessage)
            .forEach(this.#updatePlayer);
    };

    /**
     * @param {Object} messageObject
     * @param {string} messageObject.sender
     * @param {string} messageObject.message
     * @return {{sender: string, message: string}} message stripped of signature, same sender
     */
    #stripMessage = ({ message, sender }) => {
        return {
            message: message.substring(this.#signature.length),
            sender,
        };
    };

    /**
     * @param {Object} messageObject
     * @param {string} messageObject.sender
     * @param {string} messageObject.message
     */
    #updatePlayer = ({ message, sender }) => {
        const content = message.substring(2);
        switch (message.substring(0, 2)) {
            case this.#hashHeader + this.#songHeader:
                this.#playerHashesSong.set(sender, content);
                break;
            case this.#hashHeader + this.#artistHeader:
                this.#playerHashesArtist.set(sender, content);
                break;
            case this.#revealHeader + this.#songHeader:
                this.#handleRevealSong(sender, content);
                break;
            case this.#revealHeader + this.#artistHeader:
                this.#handleRevealArtist(sender, content);
                break;
            case this.#teamHeader + this.#songHeader:
                this.#handleTeamRevealSong(sender, content);
                break;
            case this.#teamHeader + this.#artistHeader:
                this.#handleTeamRevealArtist(sender, content);
                break;
        }
    };

    /**
     * @param {string} sender
     * @param {string} content
     * @param {boolean | undefined} correct
     */
    #handleRevealSong = (sender, content, correct) => {
        this.#handleReveal(sender, content, this.#playerHashesSongLocked, this.#playerAnswersSong);
        this.#showSong(sender, this.#playerAnswersSong.get(sender), correct);
    };

    /**
     * @param {string} sender
     * @param {string} content
     * @param {boolean | undefined} correct
     */
    #handleRevealArtist = (sender, content, correct) => {
        this.#handleReveal(sender, content, this.#playerHashesArtistLocked, this.#playerAnswersArtist);
        this.#showArtist(sender, this.#playerAnswersArtist.get(sender), correct);
    };

    /**
     * @param {string} sender
     * @param {string} content
     */
    #handleTeamRevealSong = (sender, content) => {
        this.#handleReveal(sender, content, this.#playerHashesSong, this.#playerAnswersSong);
        this.#showSong(sender, this.#playerAnswersSong.get(sender));
    };

    /**
     * @param {string} sender
     * @param {string} content
     */
    #handleTeamRevealArtist = (sender, content) => {
        this.#handleReveal(sender, content, this.#playerHashesArtist, this.#playerAnswersArtist);
        this.#showArtist(sender, this.#playerAnswersArtist.get(sender));
    };

    /**
     * @param {string} sender
     * @param {string} content
     * @param {Map<String, String>} hashMap
     * @param {Map<String, String>} answerMap
     */
    #handleReveal = (sender, content, hashMap, answerMap) => {
        const hash = hashMap.get(sender) ?? "";
        if (this.#isCorrect(content, sender, hash)) {
            answerMap.set(sender, content);
            this.#logger.info("reveal handling", `${sender} did send the answer ${content}`);
        } else {
            this.#logger.error("Mismatch between hash and answer", `${sender} : ${content}`);
        }
    };

    /**
     * @param {Object} songInfo
     * @param {string} songInfo.artist
     * @param {string} songInfo.songName
     */
    #answerResults = async ({ artist, songName }) => {
        async function fetchMetadata(artist, songName) {
            let rightArtists, altRightArtists, rightTitle;
            let json = {
                song_name_search_filter: {
                    search: songName,
                    partial_match: false,
                },
                artist_search_filter: {
                    search: artist,
                    partial_match: false,
                    group_granularity: 0,
                    max_other_artist: 99,
                },
                and_logic: true,
                ignore_duplicate: true,
                opening_filter: true,
                ending_filter: true,
                insert_filter: true,
            };
            try {
                const response = await fetch("https://anisongdb.com/api/search_request", {
                    method: "POST",
                    headers: { Accept: "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify(json),
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                rightArtists = data[0].artists
                    .map((artists) => {
                        return artists.names;
                    })
                    .filter((artist) => artist)
                    .flat(Infinity);
                altRightArtists = data[0].songArtist;
                rightTitle = data[0].songName;
            } catch (error) {
                console.error("Fetch error:", error);
            }
            return {
                artists: [rightArtists, altRightArtists],
                title: rightTitle,
            };
        }

        const metadata = await fetchMetadata(artist, songName);

        this.#answerResultsHelper(metadata.title, this.#playerHashesSongLocked, this.#playerSongScore, this.#playerAnswersSong, this.#handleRevealSong);
        this.#answerResultsHelper(metadata.artists, this.#playerHashesArtistLocked, this.#playerArtistScore, this.#playerAnswersArtist, this.#handleRevealArtist);
    };

    /**
     * @param {String|Array} answerData
     * @param {Map<String, String>} hashesMap
     * @param {Map<String, String>} scoreMap
     * @param {Map<String, String>} answerMap
     * @param {Function<string, string, undefined|boolean>} revealFunction
     */
    #answerResultsHelper = (answerData, hashesMap, scoreMap, answerMap, revealFunction) => {
        function arraysEqual(arr1, arr2) {
            // Check if both arrays have the same length
            if (arr1.length !== arr2.length) {
                return false;
            }

            // Sort the arrays
            const sortedArr1 = arr1.slice().sort();
            const sortedArr2 = arr2.slice().sort();

            // Compare the sorted arrays element by element
            for (let i = 0; i < sortedArr1.length; i++) {
                if (sortedArr1[i] !== sortedArr2[i]) {
                    return false;
                }
            }

            // If all elements are equal, the arrays are considered equal
            return true;
        }

        let rightAnswers, altRightAnswers;
        hashesMap.forEach((answer, sender) => {
            if (!answerMap.get(sender)) {
                answerMap.set(sender, "");
            }

            // If we are checking artists (they have 2 possible rightAnswer conditions)
            if (Array.isArray(answerData[0]) === true) {
                rightAnswers = answerData[0].map((e) => e.trim().toLowerCase());
            }
            if (Array.isArray(answerData[1]) === false) {
                altRightAnswers = answerData[1].trim().toLowerCase();
            }
            if (Array.isArray(answerData[0]) === false) {
                rightAnswers = [answerData.trim().toLowerCase()];
            }

            if (rightAnswers) {
                let answers = answerMap.get(sender).split(",").filter(Boolean);
                console.log(rightAnswers, answers);
                answers = answers.map((e) => e.toLowerCase());
                if (defaultMode === 0) {
                    if (arraysEqual(rightAnswers, answers)) {
                        for (let i = 0; i < playerAmount; i++) {
                            if (quiz.players[i]._name === sender) {
                                playerData[i].rig++;
                            }
                        }
                        writeRigToScoreboard();
                        const displayAnswer = answerMap.get(sender) ?? rightAnswers;
                        revealFunction(sender, displayAnswer, true);
                        return;
                    }
                }
                if (defaultMode === 1) {
                    if (rightAnswers.some((answer) => answers.includes(answer))) {
                        for (let i = 0; i < playerAmount; i++) {
                            if (quiz.players[i]._name === sender) {
                                playerData[i].rig++;
                            }
                        }
                        writeRigToScoreboard();
                        const displayAnswer = answerMap.get(sender) ?? rightAnswers;
                        revealFunction(sender, displayAnswer, true);
                        return;
                    }
                }
            }

            if (altRightAnswers.includes(answerMap.get(sender).toLowerCase())) {
                for (let i = 0; i < playerAmount; i++) {
                    if (quiz.players[i]._name === sender) {
                        playerData[i].rig++;
                    }
                }
                writeRigToScoreboard();
                const displayAnswer = answerMap.get(sender) ?? rightAnswers;
                revealFunction(sender, displayAnswer, true);
            } else {
                const displayAnswer = answerMap.get(sender) ?? "WRONG";
                revealFunction(sender, displayAnswer, false);
            }
        });
    };

    /**
     * @param {String} value
     * @param {String} sender
     * @param {String} answer
     * @return {boolean}
     */
    #isCorrect = (value, sender, answer) => {
        value = value.split(",");
        if (value.length > 1) {
            /* I couldn't figure out how to make hashing work with arrays of artists */
            return true;
        } else {
            value = value.toString();
            const hash = answer.substring(0, 16);
            const timestamp = answer.substring(16);
            return hash === this.#hash(value, sender, timestamp);
        }
    };

    #submitSong = (song) => {
        song = song.trim();
        this.#submit(this.#hashHeader + this.#songHeader, song).then(() => {
            this.#teamSubmit(this.#teamHeader + this.#songHeader, song);
        });
        this.#logger.debug("Submitted song", song);
        this.#currentSong = song;
    };

    #submitArtist = (artist, pos) => {
        artist = artist.trim();
        this.#submit(this.#hashHeader + this.#artistHeader, artist).then(() => {
            this.#teamSubmit(this.#teamHeader + this.#artistHeader, artist);
        });
        this.#logger.debug("Submitted artist", artist);
        if (pos < 0) {
            currentArtist.push(artist);
        } else {
            currentArtist[pos] = artist;
        }
    };

    #teamSubmit = (header, value) => {
        if (window.quiz.teamMode) {
            let teamMessage = false;
            for (let index in window.quiz.players) {
                //for some dumb reason players is an object
                const player = window.quiz.players[index];
                if (player.teamNumber !== 1) {
                    teamMessage = true;
                    break;
                }
            }
            this.#sendMessage(this.#signature + header + value, teamMessage);
        }
    };

    /**
     * @param {String} header
     * @param {String} value
     */
    #submit = (header, value) => {
        const timestamp = Date.now().toString(16).toUpperCase();
        const hash = this.#hash(value, window.selfName, timestamp);
        const message = this.#signature + header + hash + timestamp;
        return this.#sendMessage(message);
    };

    /**
     * @param {String} inputString
     * @param {String} sender
     * @param timestamp string unix timestamp in hexadecimal
     * @return {String} 64-bit hash in hexadecimal
     */
    #hash = (inputString, sender, timestamp) => {
        const first = this.#calculateHash(inputString, sender, timestamp);
        const reverseInput = inputString.split("").reverse().join("");
        const second = this.#calculateHash(reverseInput, sender, timestamp);

        const radix = 16;
        const hash = first.toString(radix).padEnd(8, "0") + second.toString(radix).padEnd(8, "0");
        return hash.toUpperCase();
    };

    /**
     * @param {string} inputString
     * @param {string} sender
     * @param {string} timestamp string unix timestamp in hexadecimal
     * @return Number
     */
    #calculateHash = (inputString, sender, timestamp) => {
        return this.#hashCode(sender + inputString + timestamp);
    };

    /**
     * Returns a hash code from a string
     * @param  {String} str The string to hash.
     * @return {Number}    A 32bit integer
     * @see https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
     */
    #hashCode = (str) => {
        const spice = "alphanumeric";
        //during testing, I found the last letter to heavily impact the first byte pair of the hash
        //the spice should shift that away
        str += spice;
        str = str.toLowerCase();
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    };

    #lockAnswers = () => {
        this.#playerHashesSongLocked = new Map(this.#playerHashesSong);
        this.#playerHashesArtistLocked = new Map(this.#playerHashesArtist);
        this.#songField.disabled = true;
        this.#artistField.disabled = true;
        this.#songField.value = this.#currentSong;
        this.#artistField.value = currentArtist.toString();
    };

    #answerReveal = () => {
        this.#lockAnswers();
        const template = (header, value) => `${this.#answerRevealHeader(header)}${value}`;
        if (this.#currentSong !== "") {
            const msg = template(this.#songHeader, this.#currentSong);
            this.#sendMessage(msg);
        }
        if (currentArtist.length !== 0) {
            const msg = template(this.#artistHeader, currentArtist.toString());
            this.#sendMessage(msg);
        }
    };

    #answerRevealHeader = (header) => {
        return `${this.#signature}${this.#revealHeader}${header}`;
    };

    /**
     * @param {String} msg
     * @param {boolean} teamMessage
     * @return {Promise<boolean>} true on success, false on timeout
     */
    #sendMessage = (msg, teamMessage = false) => {
        const promise = new Promise((resolve, _) => {
            let timeout;
            let listener;
            if (teamMessage) {
                listener = new window.Listener("Game Chat Message", ({ message, sender }) => {
                    if (sender === window.selfName && message === msg) {
                        resolve(true);
                        listener.unbindListener();
                        clearTimeout(timeout);
                    }
                });
                listener.bindListener();
            } else {
                listener = new window.Listener("game chat update", ({ messages }) => {
                    const found = messages.some(({ sender, message }) => sender === window.selfName && message === msg);
                    if (found) {
                        resolve(true);
                        listener.unbindListener();
                        clearTimeout(timeout);
                    }
                });
                listener.bindListener();
            }
            timeout = setTimeout(() => {
                resolve(false);
                listener.unbindListener();
                this.#logger.warn("Message not sent (timeout)", msg);
            }, 2000);
        });
        window.socket.sendCommand({
            type: "lobby",
            command: "game chat message",
            data: {
                msg,
                teamMessage,
            },
        });
        this.#logger.info("Sent Message", msg);
        return promise;
    };
}

if (enableScript === true) {
    window.songArtist = new SongArtistMode();
}

AMQ_addScriptData({
    name: " AMQ Better Song Artist Mode",
    author: "4Lajf (forked from Zolhungaj)",
    description: `Makes you able to play song/artist with other people who have this script installed. Includes dropdown (with auto-update) and scoretable.`,
});

function setup() {
    // CSS stuff
    AMQ_addStyle(`
            .qps-sa-score {
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
