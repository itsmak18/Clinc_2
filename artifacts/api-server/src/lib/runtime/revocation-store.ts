export interface RevocationStore {
  revoke(userId: number, atSec: number): Promise<void>;
  getRevokedAt(userId: number): Promise<number | null>;
  dispose(): Promise<void>;
}
