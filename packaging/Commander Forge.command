#!/bin/bash
# Commander Forge for macOS: double-click to start. Close this window or press Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1
# The bundle came from a zip download; clear the quarantine flag so macOS lets the bundled
# Node load the database module. Opening this file already showed the macOS warning once.
xattr -dr com.apple.quarantine . 2>/dev/null
./node/bin/node launcher.mjs "$@"
status=$?
if [ $status -ne 0 ]; then
  echo
  read -r -p "Commander Forge stopped with an error. Press Return to close this window."
fi
exit $status
