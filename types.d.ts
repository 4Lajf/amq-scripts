export {};

import type { GMXmlHttpRequestOptions } from "./types/userscript";

/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/game/quiz/quiz.js
 */
declare class Quiz {
  isHost: boolean;
  inQuiz: boolean;
  isSpectator?: boolean;
  soloMode: boolean;
  ownGamePlayerId?: number;
  videoReady: (songId: number) => void;
  leave: () => void;
  startReturnLobbyVote: () => void;

  /**
   * The input object for the quiz answer
   */
  answerInput: QuizAnswerInput;

  gameMode: Gamemode;

  /** @see https://socket.animemusicquiz.com/scripts/pages/gamePage/game/quiz/quizSkipController.js */
  skipController: {
    voteSkip: () => void;
    sendSkipVote: () => void;
    autoVoteTimeout: number | undefined;
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

  /** @see https://socket.animemusicquiz.com/scripts/pages/gamePage/game/quiz/pauseButton.js */
  pauseButton: {
    $button: JQuery<HTMLButtonElement>;
    pauseOn: boolean;
  };
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
    gameMode: Gamemode;
  };
  hostName: string;
  players: Record<number, Player>;
  gameId: number;
  soloMode: boolean;
  numberOfTeams: number;
  numberOfPlayers: number;
  numberOfPlayersReady: number;
  isHost: boolean;
  changeToSpectator: (playerName: string) => void;
  leave: (args: any) => void;
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

export type NewPlayerPayload = {
  level: number;
  ready: boolean;
  name: string;
  teamNumber?: number;
  gamePlayerId: number;
  avatar: any;
  inGame: boolean;
};

export type NewSpectatorPayload = {
  name: string;
  gamePlayerId: number | null;
};

export type SpectatorChangedToPlayerPayload = {
  name: string;
  gamePlayerId: number;
  level: number;
  avatar: any;
  ready: boolean;
  inGame: boolean;
  teamNumber?: number;
};

type PlayerIdentifier = {
  name: string;
  gamePlayerId?: number;
};

export type PlayerChangedToSpectatorPayload = {
  spectatorDescription: PlayerIdentifier;
  playerDescription: PlayerIdentifier;
  isHost: boolean;
};

export type PlayerLeftPayload = {
  kicked: boolean;
  disconnect: boolean;
  newHost?: string;
  player: PlayerIdentifier;
};

export type SpectatorLeftPayload = {
  kicked: boolean;
  newHost?: string;
  spectator: string;
};

export type GameClosedPayload = {
  reason: string;
};

export type AnimeNames = {
  english: string;
  romaji: string;
};

export type VideoMap = {
  0: string;
  480?: string;
  720: string;
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

// @see https://github.com/Zolhungaj/AMQ-API/tree/main/src/main/java/tech/zolhungaj/amqapi for the payload types reference
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
  constructor(command: "get all song names", callback: () => void);
  constructor(command: "update all song names", callback: () => void);
  constructor(command: "Host Game", callback: (payload: any) => void);
  constructor(command: "Join Game", callback: (payload: any) => void);
  constructor(
    command: "New Player",
    callback: (payload: NewPlayerPayload) => void
  );
  constructor(
    command: "New Spectator",
    callback: (payload: NewSpectatorPayload) => void
  );
  constructor(
    command: "Spectator Change To Player",
    callback: (payload: SpectatorChangedToPlayerPayload) => void
  );
  constructor(
    command: "Player Change To Spectator",
    callback: (payload: PlayerChangedToSpectatorPayload) => void
  );
  constructor(command: "Host Promotion", callback: (payload: any) => void);
  constructor(
    command: "Player Left",
    callback: (payload: PlayerLeftPayload) => void
  );
  constructor(
    command: "Spectator Left",
    callback: (payload: SpectatorLeftPayload) => void
  );
  constructor(
    command: "game closed",
    callback: (payload: GameClosedPayload) => void
  );

  fire: (payload: any) => void;
  bindListener: () => void;
  unbindListener: () => void;
}

export type AMQSocket = {
  sendCommand: (params: { type: string; command: string; data?: any }) => void;
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
  typeNumber: number | null;
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
  rating: number | null;
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

// https://www.npmjs.com/package/bootstrap-slider#events
export type SliderRangeChangeEvent = {
  value: {
    oldValue: [number, number];
    newValue: [number, number];
  };
};

export type SliderChangeEvent = {
  value: {
    oldValue: number;
    newValue: number;
  };
};

export type AMQOptions = {
  autoVoteSkipGuess: number;
  useRomajiNames: number;
};

export type HotKey = {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
};

export type HotKeySettings = {
  start?: HotKey;
  stop?: HotKey;
  startTraining?: HotKey;
  stopTraining?: HotKey;
  cslgWindow?: HotKey;
};

export type CSLSettings = {
  CSLButtonCSS?: string;
  debug?: boolean;
  hotkeys?: HotKeySettings;
  showCSLMessages?: boolean;
  replacedAnswers?: any;
  malClientId?: string;
  hotKeys: HotKeySettings;
};

export type ReviewDataItem = {
  date: number;
  efactor: number;
  successCount: number;
  successStreak: number;
  failureCount: number;
  failureStreak: number;
  isLastTryCorrect: boolean;
  weight: number;
  lastFiveTries: boolean[];
  manualWeightAdjustment: number;
  lastReviewDate?: number;
};

// Key is song
export type ReviewData = Record<string, ReviewDataItem>;
/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/game/quiz/amqAwesomeplete.js
 */
export class AmqAwesomepleteClass {
  constructor(
    input: HTMLInputElement,
    o: { list: string[] },
    scrollable: boolean
  );
}

/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/shared/viewChanger.js
 */
export class ViewChanger {
  changeView: (view: string) => void;
}

/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/gameSettings/hostModal.js
 */
export class HostModal {
  displayHostSolo: () => void;
}

/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/roomBrowser/roomBrowser.js
 */
export class RoomBrowser {
  host: () => void;
}

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
  var options: AMQOptions;
  var GM_xmlhttpRequest: (details: GMXmlHttpRequestOptions) => void;
  var AmqAwesomeplete: typeof AmqAwesomepleteClass;
  var viewChanger: ViewChanger;
  var roomBrowser: RoomBrowser;
  var hostModal: HostModal;
  var AMQ_addScriptData: (data: {
    name?: string;
    author?: string;
    version?: string;
    link?: string;
    description?: string;
  }) => void;
}

/**
 * @see https://socket.animemusicquiz.com/scripts/pages/gamePage/game/chat/gameChat.js
 */
declare class GameChat {
  systemMessage: (message: string) => void;
  $chatMessageContainer: JQuery<HTMLDivElement>;
}
