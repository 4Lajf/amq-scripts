/**
 * @file Types for Anisong API Data
 * @see https://github.com/xSardine/AMQ-Artists-DB/blob/4d7f1c41574da061fd83e7668a5c6f70cafa7381/backEnd/app/main.py#L172 as reference
 */

export type AnisongAnimeListLink = {
  myanimelist?: number;
  anidb?: number;
  anilist?: number;
  kitsu?: number;
};

export type AnisongArtist = {
  id: number;
  names: string[];
  line_up_id?: number;
  groups?: Artist[];
  members?: Artist[];
};

export type AnisongEntry = {
  annId: number;
  annSongId: number;
  animeENName: string;
  animeJPName: string;
  animeAltName?: string[];
  animeVintage?: string;
  linked_ids: AnisongAnimeListLink;
  animeType?: string;
  animeCategory?: string;
  songType: string;
  songName: string;
  songArtist: string;
  songDifficulty?: number;
  songCategory?: string;
  songLength?: number;
  isDub?: boolean;
  isRebroadcast?: boolean;
  HQ?: string;
  MQ?: string;
  audio?: string;
  artists: Artist[];
  composers: Artist[];
  arrangers: Artist[];
};

export type AnisongSearchFilter = {
  search: string;
  partial_match: boolean;
};

export type AnisongSongQueryArguments = {
  anime_search_filter?: AnisongSearchFilter;
  artist_search_filter?: AnisongSearchFilter & {
    group_granularity: number;
    max_other_artist: number;
  };
  song_name_search_filter?: AnisongSearchFilter;
  composer_search_filter?: AnisongSearchFilter & { arrangement: boolean };
  and_logic: boolean;
  ignore_duplicate: boolean;
  opening_filter: boolean;
  ending_filter: boolean;
  insert_filter: boolean;
  annId?: number;
  malIds?: number[];
};
