import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const destDir = path.join(__dirname, "..", "..", "..", "web", "public", "desktop");

const artifacts = [
  "InterviewGenie-macos.dmg",
  "InterviewGenie-windows.exe",
  "InterviewGenie-linux.AppImage",
];

fs.mkdirSync(destDir, { recursive: true });

for (const ent of fs.readdirSync(destDir, { withFileTypes: true })) {
  if (!ent.isFile()) continue;
  const n = ent.name;
  if (/\.(dmg|exe|AppImage|appimage|blockmap)$/i.test(n)) {
    fs.unlinkSync(path.join(destDir, n));
  }
}

let copied = 0;
for (const name of artifacts) {
  const src = path.join(distDir, name);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(destDir, name));
  copied += 1;
  console.log(`Copied ${name} → web/public/desktop/`);
}

if (copied === 0) {
  console.warn(
    "No installers found in dist/. Run this on each platform after npm run dist, or build the targets you need.",
  );
  process.exitCode = 1;
} else {
  console.log(`Done. ${copied} file(s) ready at /desktop/*. Open the site and use Download.`);
}
