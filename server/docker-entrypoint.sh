#!/bin/sh
# Starts as root so the data folder can be handed to the user the server
# runs as, then drops privileges (the PUID/PGID pattern). A bind mount that
# Compose created on the fly is owned by root, and without this step the
# first start would fail with a permission error on the vault.
#
# Started with a non-root `user:` in the compose file, there is nothing to
# fix and nothing to drop; the command runs as that user directly.
set -eu

DATA_DIR="${SCRIBEDOG_VAULT_PATH:-/data}"

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID$PGID" in
  *[!0-9]*) echo "[scribedog] PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)." >&2; exit 1 ;;
esac

# Give the ids a name so os.userInfo() and $HOME resolve; the image's "node"
# account is reused when the ids match, otherwise a fresh one is created.
if ! getent group "$PGID" >/dev/null 2>&1; then
  addgroup -g "$PGID" scribedog
fi
GROUP_NAME="$(getent group "$PGID" | cut -d: -f1)"

if ! getent passwd "$PUID" >/dev/null 2>&1; then
  adduser -D -H -u "$PUID" -G "$GROUP_NAME" scribedog
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"
export HOME="/home/$USER_NAME"

mkdir -p "$DATA_DIR"

# Only touch ownership when something is not already owned by the target
# user: a vault of thousands of notes should not be chowned on every start.
if [ -n "$(find "$DATA_DIR" ! -user "$PUID" -print -quit 2>/dev/null)" ]; then
  echo "[scribedog] handing $DATA_DIR to uid $PUID / gid $PGID"
  chown -R "$PUID:$PGID" "$DATA_DIR"
fi

# Shared vaults (multi-instance setup): one folder that every person's
# container mounts and writes. It is never handed to one person; instead it
# belongs to a group all of them are in, every folder in it carries the setgid
# bit so new files inherit that group, and the server runs with umask 002 so
# those files are group-writable. Without this the second person could read
# the first one's notes but not save them.
SHARED_DIR="${SCRIBEDOG_SHARED_PATH:-}"

if [ -z "$SHARED_DIR" ]; then
  exec su-exec "$PUID:$PGID" "$@"
fi

SHARED_GID="${SCRIBEDOG_SHARED_GID:-}"

case "$SHARED_GID" in
  ''|*[!0-9]*) echo "[scribedog] SCRIBEDOG_SHARED_GID must be set to a numeric group id when SCRIBEDOG_SHARED_PATH is (got \"$SHARED_GID\")." >&2; exit 1 ;;
esac

if ! getent group "$SHARED_GID" >/dev/null 2>&1; then
  addgroup -g "$SHARED_GID" scribedog-shared
fi
SHARED_GROUP_NAME="$(getent group "$SHARED_GID" | cut -d: -f1)"

# su-exec keeps supplementary groups only when it is given a user alone, and
# then takes the primary group from /etc/passwd. A reused account (the image's
# "node") may name another primary group than PGID there, so the entry is
# pointed at PGID first; this is the container's own passwd, nothing on the host.
if [ "$(getent passwd "$PUID" | cut -d: -f4)" != "$PGID" ]; then
  sed -i "s/^\($USER_NAME:[^:]*:$PUID:\)[0-9]*:/\1$PGID:/" /etc/passwd
fi

if [ "$SHARED_GID" != "$PGID" ]; then
  addgroup "$USER_NAME" "$SHARED_GROUP_NAME" 2>/dev/null || true
fi

mkdir -p "$SHARED_DIR"

# Same idea as the data folder above: only walk the tree when something is
# off, so a start does not touch thousands of files every time. Several
# containers may do this at once; every step is idempotent.
if [ -n "$(find "$SHARED_DIR" \( ! -group "$SHARED_GID" -o \( -type d ! -perm -2070 \) -o \( -type f ! -perm -0060 \) \) -print -quit 2>/dev/null)" ]; then
  echo "[scribedog] giving $SHARED_DIR to the shared group (gid $SHARED_GID)"
  chgrp -R "$SHARED_GID" "$SHARED_DIR"
  find "$SHARED_DIR" -type d -exec chmod g+rwxs {} +
  find "$SHARED_DIR" -type f -exec chmod g+rw {} +
fi

umask 002
exec su-exec "$USER_NAME" "$@"
