import { writeFileSync } from "fs";
writeFileSync("../api-zod/src/index.ts", "export * from './generated/api';\n");
