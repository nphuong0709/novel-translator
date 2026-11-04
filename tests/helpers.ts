import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (rel: string): string => readFileSync(join(here, "fixtures", rel), "utf8");
export const golden = <T = unknown>(rel: string): T =>
  JSON.parse(readFileSync(join(here, "golden", rel), "utf8")) as T;
