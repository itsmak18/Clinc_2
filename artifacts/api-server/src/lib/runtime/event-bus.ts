export interface EventBus {
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, handler: (payload: string) => void): () => void;
  dispose(): Promise<void>;
}
