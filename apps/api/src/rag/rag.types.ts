export type RetrievedChunk = {
  id: string;
  documentId: string;
  title: string | null;
  source: string | null;
  content: string;
  chunkIndex: number;
  metadata: unknown;
  score: number;
};
