import type { Store } from "express-rate-limit";

export interface RateStore {
  createExpressStore(): Store | undefined;
  dispose(): Promise<void>;
}
