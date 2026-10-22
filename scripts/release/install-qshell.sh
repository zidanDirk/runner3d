#!/usr/bin/env bash
set -euo pipefail
# Only the Linux GitHub runner calls this script. No binary enters the repository.
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
test -n "${RUNNER_TEMP:-}"
mkdir -p "$RUNNER_TEMP/runner3d-qshell"
curl --fail --location --silent --show-error --retry 3 \
  --output "$RUNNER_TEMP/runner3d-qshell/qshell.tar.gz" \
  https://github.com/qiniu/qshell/releases/download/v2.19.12/qshell-v2.19.12-linux-amd64.tar.gz
cd "$RUNNER_TEMP/runner3d-qshell"
echo '19edaf7337f08609d2570b6e1337ca5a912bfe45155133a6b7fc66efa53bf965  qshell.tar.gz' | sha256sum --check
tar -xzf qshell.tar.gz qshell
echo "$RUNNER_TEMP/runner3d-qshell" >> "$GITHUB_PATH"
