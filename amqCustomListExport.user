// ==UserScript==
// @name         AMQ Custom List Export
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Export Song Library custom lists as AMQ-compatible JSON
// @author       4Lajf
// @match        https://animemusicquiz.com/*
// @match        https://*.animemusicquiz.com/*
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqScriptInfo.js
// @grant        none
// ==/UserScript==

"use strict";

(function () {
  if (typeof Listener === "undefined") return;

  const SCRIPT_PREFIX = "[AMQ Custom List Export]";
  const BUTTON_ID = "amqCustomListExportButton";
  const MAX_SETUP_ATTEMPTS = 240;
  const SETUP_INTERVAL_MS = 500;

  let setupAttempts = 0;
  let setupInterval = null;
  let containerObserver = null;

  bootstrap();

  function bootstrap() {
    console.log(`${SCRIPT_PREFIX} Booting...`);

    setupInterval = setInterval(() => {
      if ($("#loadingScreen").hasClass("hidden")) {
        clearInterval(setupInterval);
        waitForGameObjects();
      }
    }, SETUP_INTERVAL_MS);
  }

  function waitForGameObjects() {
    const waitInterval = setInterval(() => {
      setupAttempts += 1;

      if (isReady()) {
        clearInterval(waitInterval);
        initialize();
        return;
      }

      if (setupAttempts >= MAX_SETUP_ATTEMPTS) {
        clearInterval(waitInterval);
        console.warn(`${SCRIPT_PREFIX} Timed out while waiting for AMQ objects.`);
      }
    }, SETUP_INTERVAL_MS);
  }

  function isReady() {
    return !!(window.customListHandler && window.libraryCacheHandler);
  }

  function initialize() {
    console.log(`${SCRIPT_PREFIX} Initializing...`);
    mountExportButton();
    startUiWatcher();
  }

  function startUiWatcher() {
    const refreshButton = () => {
      mountExportButton();
      updateButtonVisibility();
    };

    const shortWarmup = setInterval(refreshButton, 500);
    setTimeout(() => clearInterval(shortWarmup), 60_000);

    if (containerObserver) {
      containerObserver.disconnect();
    }
    containerObserver = new MutationObserver(() => {
      refreshButton();
    });
    containerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function mountExportButton() {
    const backButton = $("#elCustomListBackButton");
    if (!backButton.length) return;

    let exportButton = $(`#${BUTTON_ID}`);
    if (!exportButton.length) {
      exportButton = backButton.clone();
      exportButton.attr("id", BUTTON_ID);
      exportButton.removeClass("hide disabled");
      exportButton.off("click");

      const icon = exportButton.find("i");
      if (icon.length) {
        icon.attr("class", "fa fa-download");
      }

      const textContainer = exportButton.find("div, span").first();
      if (textContainer.length) {
        textContainer.text("Export");
      } else {
        exportButton.text("Export");
      }

      exportButton.on("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleExportClick();
      });

      backButton.after(exportButton);
      console.log(`${SCRIPT_PREFIX} Export button mounted.`);
    }
  }

  function updateButtonVisibility() {
    const exportButton = $(`#${BUTTON_ID}`);
    if (!exportButton.length) return;

    const activeList = getActiveList();
    exportButton.toggle(!!activeList);
  }

  function getActiveList() {
    if (!window.customListHandler) return null;
    return customListHandler.activeCustomList || null;
  }

  function handleExportClick() {
    const activeList = getActiveList();
    if (!activeList) {
      showMessage("Export Failed", "Open a custom list first, then click Export.");
      return;
    }

    const payload = buildAmqCompatibleExport(activeList);
    if (!payload.songs.length) {
      showMessage(
        "Nothing To Export",
        "No songs found in this custom list. Add songs or anime entries first."
      );
      return;
    }

    const filename = getOfficialLikeFilename();
    downloadJson(payload, filename);

    showMessage(
      "Export Complete",
      `Exported ${payload.songs.length} songs from "${escapeHtmlSafe(activeList.name || "Custom List")}" as AMQ-compatible JSON.`
    );
  }

  function buildAmqCompatibleExport(customList) {
    const seenAnnSongIds = new Set();
    const songs = [];
    const unresolved = [];

    const addAnnSongId = (annSongId) => {
      if (!annSongId || seenAnnSongIds.has(annSongId)) return;
      seenAnnSongIds.add(annSongId);

      const annSongEntry = libraryCacheHandler.getCachedAnnSongEntry(annSongId);
      if (!annSongEntry) {
        unresolved.push(annSongId);
        return;
      }

      const animeEntry = libraryCacheHandler.getCachedAnime(annSongEntry.annId);
      songs.push(createFullSongHistoryLikeEntry(songs.length + 1, annSongEntry, animeEntry));
    };

    if (customList.songMap && typeof customList.songMap.forEach === "function") {
      customList.songMap.forEach((_, annSongId) => addAnnSongId(annSongId));
    }

    if (customList.animeMap && typeof customList.animeMap.forEach === "function") {
      customList.animeMap.forEach((_, annId) => {
        const anime = libraryCacheHandler.getCachedAnime(annId);
        if (!anime || !anime.songs) return;

        ["OP", "ED", "INS"].forEach((type) => {
          const entries = anime.songs[type] || [];
          entries.forEach((songEntry) => addAnnSongId(songEntry.annSongId));
        });
      });
    }

    unresolved.forEach((annSongId) => {
      songs.push(createSimplifiedSongEntry(songs.length + 1, annSongId));
    });

    return {
      roomName: customList.name || "AMQ Custom List",
      startTime: new Date().toString(),
      songs
    };
  }

  function createFullSongHistoryLikeEntry(songNumber, annSongEntry, animeEntry) {
    const song = annSongEntry?.songEntry || {};
    const siteIds = extractSiteIds(animeEntry, annSongEntry);
    const names = extractAnimeNames(animeEntry);
    const altAnimeNames = extractAltAnimeNames(animeEntry, names);

    const typeNumber = Number.isFinite(annSongEntry?.number) ? annSongEntry.number : 0;

    return {
      songNumber,
      songInfo: {
        animeNames: {
          english: names.english,
          romaji: names.romaji
        },
        altAnimeNames,
        altAnimeNamesAnswers: [],
        artist: extractDisplayName(song.artist),
        composerInfo: toPersonInfo(song.composer),
        arrangerInfo: toPersonInfo(song.arranger),
        songName: song.name || "",
        type: annSongEntry?.type || 0,
        typeNumber,
        annId: annSongEntry?.annId || animeEntry?.annId || null,
        annSongId: annSongEntry?.annSongId || null,
        animeScore: null,
        animeType: "",
        vintage: "",
        animeDifficulty: 0,
        siteIds,
        seasonInfo: null,
        animeTags: [],
        animeGenre: []
      },
      answer: "",
      correctGuess: 0,
      wrongGuess: false,
      correctCount: 0,
      wrongCount: 0,
      startPoint: 0,
      videoLength: 90,
      annSongId: annSongEntry?.annSongId || null
    };
  }

  function createSimplifiedSongEntry(songNumber, annSongId) {
    return {
      songNumber,
      annSongId,
      startPoint: 0,
      guessTime: null,
      extraGuessTime: null
    };
  }

  function extractAnimeNames(animeEntry) {
    const mainNames = animeEntry?.mainNames || {};
    const english = mainNames.EN || mainNames.JA || animeEntry?.mainName || "";
    const romaji = mainNames.JA || mainNames.EN || animeEntry?.mainName || "";
    return { english, romaji };
  }

  function extractAltAnimeNames(animeEntry, names) {
    const altNames = [];
    if (Array.isArray(animeEntry?.names)) {
      animeEntry.names.forEach((entry) => {
        if (entry && typeof entry.name === "string" && entry.name.trim()) {
          altNames.push(entry.name.trim());
        }
      });
    }

    if (!altNames.length) {
      if (names.english) altNames.push(names.english);
      if (names.romaji && names.romaji !== names.english) altNames.push(names.romaji);
    }

    return Array.from(new Set(altNames));
  }

  function extractSiteIds(animeEntry, annSongEntry) {
    const annId = annSongEntry?.annId || animeEntry?.annId || null;
    return {
      annId,
      malId: null,
      kitsuId: null,
      aniListId: null,
      annSongId: annSongEntry?.annSongId || null
    };
  }

  function toPersonInfo(personLike) {
    if (!personLike) {
      return { artistId: null, groupId: null, name: "" };
    }
    return {
      artistId: Number.isFinite(personLike.songArtistId) ? personLike.songArtistId : null,
      groupId: Number.isFinite(personLike.songGroupId) ? personLike.songGroupId : null,
      name: extractDisplayName(personLike)
    };
  }

  function extractDisplayName(entity) {
    if (!entity) return "";
    if (typeof entity.name === "string") return entity.name;
    if (Array.isArray(entity.names) && entity.names.length) {
      const first = entity.names.find((name) => typeof name === "string" && name.trim());
      if (first) return first;
    }
    return "";
  }

  function getOfficialLikeFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `amq_song_expoert-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  function showMessage(title, content) {
    if (window.messageDisplayer && typeof messageDisplayer.displayMessage === "function") {
      messageDisplayer.displayMessage(title, content);
    } else {
      alert(`${title}\n${content.replace(/<[^>]*>/g, "")}`);
    }
  }

  function escapeHtmlSafe(input) {
    const text = String(input ?? "");
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
