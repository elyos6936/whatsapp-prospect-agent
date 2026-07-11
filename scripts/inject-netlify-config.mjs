import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiUrl = (process.env.KLANVIO_API_URL || "").replace(/\/$/, "");

const content = `window.KLANVIO_CONFIG = {
  apiUrl: ${JSON.stringify(apiUrl)},
  appName: "Klanvio",
};
`;

fs.writeFileSync(path.join(__dirname, "..", "public", "config.js"), content, "utf8");
console.log(`Klanvio config: apiUrl=${apiUrl || "(same origin via redirects)"}`);
