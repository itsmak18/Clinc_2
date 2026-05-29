import { randomBytes } from "crypto";

/**
 * Generates a UUID v7 (RFC 9562) — time-ordered, random node.
 *
 * Layout (128 bits):
 *   bits  0-47  unix_ts_ms  (48-bit millisecond timestamp, big-endian)
 *   bits 48-51  ver = 0b0111 (7)
 *   bits 52-63  rand_a      (12 random bits)
 *   bits 64-65  var = 0b10  (RFC 4122 variant)
 *   bits 66-127 rand_b      (62 random bits)
 *
 * Time-sortable: lexicographic sort on the UUID string equals chronological
 * order within the same millisecond window. Safe for use as a Postgres PK.
 */
export function uuidV7(): string {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10);

  const b = Buffer.allocUnsafe(16);

  // bytes 0-3: ts[47:16] — top 32 bits of the 48-bit timestamp
  b.writeUInt32BE(Number(ms >> 16n), 0);
  // bytes 4-5: ts[15:0]  — bottom 16 bits of the 48-bit timestamp
  b.writeUInt16BE(Number(ms & 0xffffn), 4);
  // byte 6: version nibble (7) + rand_a[11:8]
  b[6] = 0x70 | (rand[0] & 0x0f);
  // byte 7: rand_a[7:0]
  b[7] = rand[1];
  // byte 8: variant (0b10) + rand_b[61:56]
  b[8] = 0x80 | (rand[2] & 0x3f);
  // bytes 9-15: rand_b[55:0]
  rand.copy(b, 9, 3, 10);

  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
