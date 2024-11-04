/**
 * @see https://github.com/kempanator/amq-scripts/blob/main/amqAnswerStats.user.js
 */
import type { Song, SongInfo } from "../types";

export type KempanatorAnswerStats = {
  songHistory: {
    animeRomajiName: SongInfo["animeNames"]["romaji"];
    animeEnglishName: SongInfo["animeNames"]["english"];
    altAnimeNames: SongInfo["altAnimeNames"];
    altAnimeNamesAnswers: SongInfo["altAnimeNamesAnswers"];
    animeType: SongInfo["animeType"];
    animeVintage: SongInfo["vintage"];
    animeTags: SongInfo["animeTags"];
    animeGenre: SongInfo["animeGenre"];
    songNumber: number;
    songArtist: SongInfo["artist"];
    songName: SongInfo["songName"];
    songType: SongInfo["type"];
    songTypeNumber: number;
    songTypeText: string;
    songDifficulty: SongInfo["animeDifficulty"];
    rebroadcast: boolean;
    dub: boolean;
    annId: SongInfo["siteIds"]["annId"];
    malId: SongInfo["siteIds"]["malId"];
    kitsuId: SongInfo["siteIds"]["kitsuId"];
    aniListId: SongInfo["siteIds"]["aniListId"];
    startPoint: number | null;
    audio: string | null;
    video480: string | null;
    video720: string | null;
  }[];
  playerInfo: any;
};
