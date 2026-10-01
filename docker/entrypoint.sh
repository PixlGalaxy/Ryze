#!/bin/sh
set -e
# Make sure the data folder is writable by the unprivileged "node" user,
# even when it is a bind mount created by root on the host.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi
exec "$@"
