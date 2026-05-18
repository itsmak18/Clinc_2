export interface RevocationStore {
  revoke(userId: number, atSec: number): Promise<void>;
  getRevokedAt(userId: number): Promise<number | null>;
  /** Returns true if the given jti has already been observed (used). */
  isJtiUsed(jti: string): Promise<boolean>;
  /** Records the given jti as used. Best-effort; callers should not block on this. */
  markJtiUsed(jti: string): Promise<void>;
  dispose(): Promise<void>;
}
