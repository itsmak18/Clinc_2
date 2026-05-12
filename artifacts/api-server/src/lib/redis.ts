// This file is intentionally empty.
//
// Redis client construction is now handled exclusively by the runtime factory
// at lib/runtime/index.ts, which picks the right adapter (memory vs redis)
// based on SESSION_STORE env var.
//
// DO NOT import ioredis directly elsewhere. Import from lib/runtime instead.
