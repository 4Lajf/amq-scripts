export {};

declare class Quiz {
  inQuiz: boolean;
  isSpectator?: boolean;

  /**
   * The input object for the quiz answer
   */
  answerInput: QuizAnswerInput;

  gameMode: Gamemode;

  skipController: {
    voteSkip: () => void;
  };

  /**
   * Dictionary of player number to player object
   */
  players: Record<number, Player>;

  setupQuiz: (...args: any[]) => void;

  /**
   * Flag set by CSL
   */
  cslActive?: boolean;
}

declare class QuizAnswerInput {
  submitAnswer: (showState: boolean) => void;
  typingInput: {
    autoCompleteController: {
      updateList: () => void;
      list: string[];
      awesomepleteInstance: {
        selected: boolean;
        isOpened: boolean;
        $ul: JQuery<HTMLUListElement>;
      };
    };
  };
  activeInputController: {
    autoCompleteController: {
      awesomepleteInstance: {
        close: () => void;
      };
    };
  };
}

export type Player = {
  name: string;
  answer: string;
  gamePlayerId: number;
  isSelf: boolean;
  teamNumber: null | number;
  avatarSlot: {
    _answer: string | null;
    $body: JQuery<HTMLDivElement>;
  };
};

declare class Lobby {
  inLobby: boolean;
  settings: {
    gamemode: Gamemode;
  };
  hostName: string;
  players: Record<number, Player>;
  gameId: number;
  soloMode: boolean;
  numberOfTeams: number;
  numberOfPlayers: number;
  numberOfPlayersReady: number;
  isHost: boolean;
}

export type Gamemode = "Ranked" | "Multiplayer" | "Solo";

export type GameChatUpdatePayload = {
  messages: MessagePayload[];
};

export type MessagePayload = {
  sender: string;
  modMessage: boolean;
  message: string;
  teamMessage: boolean;
  messageId: number;
  // And other properties for emojis, badges, etc.
};

export type GameStartingPayload = {
  showSelection: number;
  players: any[];
  groupSlotMap: Record<string, number[]>;
  multipleChoiceEnabled: boolean;
  quizIdentifier: any;
  gameMode: Gamemode;
};

export type QuizOverPayload = {
  gameId: number;
  settings: any;
  hostName: string;
  playersInQueue: string[];
  players: any[];
  inLobby: boolean;
  mapOfFullTeams: Record<number, boolean>;
  spectators: any[];
  numberOfTeams: number;
};

export type TeamMemberAnswerPayload = {
  answer: string;
  gamePlayerId: number;
};

export type AnswerResultsPayload = {
  songInfo: SongInfo;
};

export type SpectateGamePayload = {
  hostName: string;
  inLobby: boolean;
};

export type SongInfo = {
  songName: string;
  artist: string;
  animeNames: AnimeNames;
  videoTargetMap: VideoMap;
  altAnimeNames: string[];
  type: number;
  annId: number;
  highRisk: number;
  animeScore: number;
  animeType: string;
  vintage: string;
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
  artistInfo: Artist | Group;
};

export class ListenerClass {
  constructor(
    command: "game chat update",
    callback: (data: GameChatUpdatePayload) => void
  );
  constructor(command: "play next song", callback: (data: any) => void);
  constructor(
    command: "Game Starting",
    callback: (data: GameStartingPayload) => void
  );
  constructor(command: "quiz over", callback: (data: QuizOverPayload) => void);
  constructor(command: "guess phase over", callback: () => void);
  constructor(
    command: "team member answer",
    callback: (data: TeamMemberAnswerPayload) => void
  );
  constructor(
    command: "answer results",
    callback: (data: AnswerResultsPayload) => void
  );
  constructor(
    command: "Spectate Game",
    callback: (data: SpectateGamePayload) => void
  );
  fire: (payload: any) => void;
  bindListener: () => void;
  unbindListener: () => void;
}

export type AMQSocket = {
  sendCommand: (params: { type: string; command: string; data: any }) => void;
};

export type HotKey = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
};

export enum SongTypes {
  Opening = 1,
  Ending = 2,
  Insert = 3,
}

export type Song = {
  animeRomajiName: string;
  animeEnglishName: string;
  altAnimeNames: string[];
  altAnimeNamesAnswers: string[];
  songArtist: string;
  songName: string;
  songType: SongTypes;
  songTypeNumber: number | null;
  songDifficulty: number | null;
  animeType: string | null;
  animeVintage: string | null;
  annId: number;
  malId?: number;
  kitsuId?: number;
  aniListId?: number;
  animeTags: string[];
  animeGenre: string[];
  rebroadcast: boolean | null;
  dub: boolean | null;
  startPoint: number | null;
  audio: string | null;
  video480: string | null;
  video720: string | null;
  correctGuess: boolean;
  incorrectGuess: boolean;
};

export type MessageDisplayer = {
  active: boolean;
  loadFinished: boolean;
  messageQueue: Promise[];
  displayMessage: (
    title: string,
    msg?: string,
    callback?: () => void,
    outsideDismiss?: boolean,
    disableSWAL?: boolean,
    confirmButtonText?: string
  ) => any;
};

export enum RankedStateID {
  OFFLINE = 0,
  IN_LOBBY = 1,
  RUNNING = 2,
  FINISHED = 3,
  CHAMP_OFFLINE = 4,
  CHAMP_LOBBY = 5,
  CHAMP_RUNNING = 6,
  CHAMP_FINISHED = 7,
  BREAK_DAY = 8,
}

export type RankedState = {
  currentState: RankedStateID;
  RANKED_STATE_IDS: typeof RankedStateID;
};

export type HostModal = {};

declare global {
  var gameChat: GameChat;
  var quiz: Quiz;
  var lobby: Lobby;
  var Listener: typeof ListenerClass;
  var socket: AMQSocket;
  var messageDisplayer: MessageDisplayer;
  var selfName: string;
  var ranked: RankedState;
  var hostModal: HostModal;
}

declare class GameChat {
  systemMessage: (message: string) => void;
}
