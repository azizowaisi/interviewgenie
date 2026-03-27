import fs from "node:fs";
import path from "node:path";

import { getPublicAppOriginFromEnv } from "@/lib/site-url";

export type DesktopDownloadLinks = {
  mac: string;
  win: string;
  linux: string;
  /** Optional “all releases” page when per-OS URLs are not set */
  releasesPage: string;
};

/** Filenames produced by electron-builder (see clients/electron-app/package.json) and copied to public/desktop. */
const PUBLIC_DESKTOP_FILES = {
  mac: "InterviewGenie-macos.dmg",
  win: "InterviewGenie-windows.exe",
  linux: "InterviewGenie-linux.AppImage",
} as const;

function publicDesktopAbsolute(name: string): string {
  return path.join(process.cwd(), "public", "desktop", name);
}

/**
 * Env URLs override everything. Otherwise, if a file exists under `web/public/desktop/`, the site serves `/desktop/<file>`.
 *
 * Configure either:
 * - NEXT_PUBLIC_DESKTOP_DOWNLOADS_JSON='{"mac":"https://...","win":"https://...","linux":"https://...","releasesPage":"https://..."}'
 * - or individual NEXT_PUBLIC_DESKTOP_DOWNLOAD_MAC|WIN|LINUX and NEXT_PUBLIC_DESKTOP_DOWNLOADS_PAGE
 *
 * Local/public builds: `cd clients/electron-app && npm run dist:publish-web` (per OS for that platform’s installer).
 *
 * Option C — one public base URL (same filenames on your CDN or site path `/desktop`):
 *   NEXT_PUBLIC_DESKTOP_INSTALLER_BASE=https://yoursite.com/desktop
 * Fills any OS still missing after env JSON and public/ file checks.
 */
export function getDesktopDownloadLinks(): DesktopDownloadLinks {
  const jsonRaw = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOADS_JSON;
  let links: DesktopDownloadLinks;
  if (jsonRaw) {
    try {
      const j = JSON.parse(jsonRaw) as Record<string, string | undefined>;
      links = {
        mac: (j.mac ?? "").trim(),
        win: (j.win ?? "").trim(),
        linux: (j.linux ?? "").trim(),
        releasesPage: (j.releasesPage ?? "").trim(),
      };
    } catch {
      links = emptyLinks();
    }
  } else {
    links = {
      mac: (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_MAC ?? "").trim(),
      win: (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_WIN ?? "").trim(),
      linux: (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_LINUX ?? "").trim(),
      releasesPage: (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOADS_PAGE ?? "").trim(),
    };
  }

  const out = { ...links };
  for (const key of ["mac", "win", "linux"] as const) {
    if (out[key]) continue;
    const file = PUBLIC_DESKTOP_FILES[key];
    try {
      if (fs.existsSync(publicDesktopAbsolute(file))) {
        out[key] = `/desktop/${file}`;
      }
    } catch {
      /* ignore fs errors (e.g. restrictive env) */
    }
  }

  let base = (process.env.NEXT_PUBLIC_DESKTOP_INSTALLER_BASE ?? "").trim().replace(/\/$/, "");
  if (!base) {
    const origin = getPublicAppOriginFromEnv();
    if (origin) base = `${origin}/desktop`;
  }
  if (base) {
    const fromBase = {
      mac: `${base}/InterviewGenie-macos.dmg`,
      win: `${base}/InterviewGenie-windows.exe`,
      linux: `${base}/InterviewGenie-linux.AppImage`,
    } as const;
    for (const key of ["mac", "win", "linux"] as const) {
      if (!out[key]) out[key] = fromBase[key];
    }
  }

  return out;
}

function emptyLinks(): DesktopDownloadLinks {
  return { mac: "", win: "", linux: "", releasesPage: "" };
}
