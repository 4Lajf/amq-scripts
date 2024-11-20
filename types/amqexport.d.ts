type AMQSong = {
  songNumber: number;
  songInfo: {
    animeNames: {
      english: string;
      romaji: string;
    };
    artist: string;
    songName: string;
    type: number;
    typeNumber: number;
    annId: number;
    animeScore: number;
    animeType: string; // e.g. "OVA"
    vintage: string; // e.g. "Fall 2016"
    animeDifficulty: number;
    animeTags: string[];
    animeGenre: string[];
    altAnimeNames: string[];
    altAnimeNamesAnswers: string[];
    siteIds: {
      annId: number;
      malId: number;
      kitsuId: number;
      aniListId: number;
    };
    rebroadcast?: number;
    dub?: number;
  };
  correctGuess: boolean;
  wrongGuess: boolean;
  answer: string;
  correctCount: number;
  wrongCount: number;
  startPoint: number;
  videoLength: number;
  videoUrl?: string;
  correctGuessPlayers?: string[];
  listStates?: {
    name: string;
    status: number;
    score: number;
  }[];
};

export type AMQExport = {
  roomName: string; // e.g. "Solo"
  startTime: string; // e.g. Sun Sep 29 2024 13:31:59 GMT+0200
  songs: AMQSong[];
};
