type AMQSong = {
  songNumber: number;
  songInfo: {
    animeNames: {
      english: string;
      romaji: string;
    };
    altAnimeNames: string[];
    altAnimeNamesAnswers: string[];
    artist: string;
    songName: string;
    type: number;
    typeNumber: number;
    annId: number;
    animeScore: number;
    animeType: string; // e.g. "OVA"
    vintage: string; // e.g. "Fall 2016"
    animeDifficulty: number;
    siteIds: {
      annId: number;
      malId: number;
      kitsuId: number;
      aniListId: number;
    };
    animeTags: string[];
    animeGenre: string[];
    answer: string;
    correctGuess: number;
    wrongGuess: boolean;
    correctCount: number;
    wrongCount: number;
    startPoint: number;
    videoLength: number;
  };
};

export type AMQExport = {
  roomName: string; // e.g. "Solo"
  startTime: string; // e.g. Sun Sep 29 2024 13:31:59 GMT+0200
  songs: AMQSong[];
};
