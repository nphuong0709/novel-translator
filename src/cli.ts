#!/usr/bin/env node
/** CLI (Slice 1): ingest | import | status. Chưa hiện thực, xem docs/blueprint-v4.md mục 4. */
const [command] = process.argv.slice(2);
console.error(`novel: lệnh '${command ?? ""}' chưa được hiện thực (Slice 1 đang dựng).`);
process.exit(1);
