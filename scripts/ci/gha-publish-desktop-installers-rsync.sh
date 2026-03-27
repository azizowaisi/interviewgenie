#!/usr/bin/env bash
# Publish merged desktop installers to a host path (VM volume, static file server dir, etc.).
# Replaces the remote directory contents: rsync --delete removes installers no longer in the build.
#
# Env:
#   STAGING_DIR   — directory containing InterviewGenie-*.dmg|.exe|.AppImage
#   RSYNC_DEST    — scp-style dest, e.g. deploy@files.example.com:/var/www/desktop-installers/
#   SSH_PRIVATE_KEY — PEM for SSH (e.g. GitHub secret DESKTOP_INSTALLERS_SSH_PRIVATE_KEY)
#   SSH_PORT      — optional, default 22
set -euo pipefail

STAGING_DIR="${STAGING_DIR:?STAGING_DIR is required}"
RSYNC_DEST="${RSYNC_DEST:?RSYNC_DEST is required}"
SSH_PRIVATE_KEY="${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY is required}"
SSH_PORT="${SSH_PORT:-22}"

if [ ! -d "$STAGING_DIR" ]; then
  echo "::error::STAGING_DIR is not a directory: $STAGING_DIR"
  exit 1
fi

# Require at least one installer so we do not accidentally wipe the volume.
shopt -s nullglob
files=( "$STAGING_DIR"/InterviewGenie-* )
shopt -u nullglob
if [ "${#files[@]}" -lt 1 ]; then
  echo "::error::No InterviewGenie-* files in $STAGING_DIR"
  exit 1
fi

rest="${RSYNC_DEST#*@}"
host="${rest%%:*}"
if [ -z "$host" ] || [ "$host" = "$RSYNC_DEST" ]; then
  echo "::error::RSYNC_DEST must look like user@host:/path"
  exit 1
fi

mkdir -p "$HOME/.ssh"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$HOME/.ssh/id_desktop_installers"
chmod 600 "$HOME/.ssh/id_desktop_installers"
ssh-keyscan -p "$SSH_PORT" -H "$host" >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

RSYNC_RSH="ssh -i ${HOME}/.ssh/id_desktop_installers -o IdentitiesOnly=yes -p ${SSH_PORT}"

echo "Rsync (with --delete) to $RSYNC_DEST"
rsync -avz --delete -e "$RSYNC_RSH" "$STAGING_DIR/" "$RSYNC_DEST"
