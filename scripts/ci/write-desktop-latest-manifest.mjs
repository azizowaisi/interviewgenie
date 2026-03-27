/**
 * Writes desktop-latest.json for the website and/or installer volume.
 * Keeps version in sync with clients/electron-app/package.json.
 *
 * Usage:
 *   node scripts/ci/write-desktop-latest-manifest.mjs <output-path>
 * Env:
 *   DESKTOP_DOWNLOAD_PAGE — optional (default: production #desktop-app)
 *   DESKTOP_MIN_VERSION — optional; oldest client you still support (default: same as `version`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const pkgPath = path.join(root, "clients", "electron-app", "package.json");
const outPath = process.argv[2] || path.join(root, "web", "public", "desktop-latest.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = String(pkg.version || "0.0.0").trim();
const downloadPage =
  process.env.DESKTOP_DOWNLOAD_PAGE?.trim() ||
  "https://interviewgenie.teckiz.com/#desktop-app";
const minVersion =
  process.env.DESKTOP_MIN_VERSION?.trim() || version;

const manifest = {
  version,
  minVersion,
  message:
    "A newer version of the desktop app is available. Update for the latest fixes and features.",
  downloadPage,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath} (version ${version})`);
