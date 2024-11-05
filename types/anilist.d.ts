export type AnilistStatus =
  | "CURRENT"
  | "COMPLETED"
  | "PAUSED"
  | "DROPPED"
  | "PLANNING";

export type AnilistQueryResults = {
  Page: {
    pageInfo: {
      currentPage: number;
      hasNextPage: boolean;
    };
    mediaList: {
      status: AnilistStatus;
      media: {
        id: number;
        idMal: number;
        tags: { name: string }[];
        genres: string[];
        averageScore: number;
      };
    }[];
  };
};
