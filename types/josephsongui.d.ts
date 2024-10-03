/**
 * @see https://github.com/joske2865/AMQ-Scripts/blob/master/amqSongListUI.user.js
 */

import type { Song, SongInfo } from "../types";

export type JosephSongUI = {
  gameMode: string;
  name: SongInfo["songName"];
  artist: SongInfo["artist"];
  anime: SongInfo["animeNames"];
  annId: SongInfo["annId"];
  songNumber: number;
  activePlayers: number;
  totalPlayers: number;
  type: string; // e.g. "Opening 3"
  urls: SongInfo["videoTargetMap"];
  siteIds: SongInfo["siteIds"];
  difficulty: "Unrated" | number;
  animeType: SongInfo["animeType"];
  animeScore: SongInfo["animeScore"];
  vintage: SongInfo["vintage"];
  tags: SongInfo["animeTags"];
  genre: SongInfo["animeGenre"];
  altAnswers: string[];
  startSample: number;
  videoLength: number;
  players: {
    name: string;
    score: number;
    correctGuesses: number;
    correct: boolean;
    answer: string;
    guessTime: number;
    active: boolean;
    position: number;
    positionSlot: number;
  }[];
  fromList: {
    name: string;
    listStatus: string;
    score: number | null;
  }[];
  correct?: boolean;
  selfAnswer?: string;
};
