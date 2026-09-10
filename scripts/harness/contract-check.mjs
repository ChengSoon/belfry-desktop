import fs from "node:fs";
for (const file of process.argv.slice(2)) { try { const value = JSON.parse(fs.readFileSync(file, "utf8")); if (value.schemaVersion !== 1) throw new Error("schemaVersion must be 1"); console.log(`${file}: OK`); } catch (error) { console.error(`${file}: ${error.message}`); process.exitCode = 1; } }
