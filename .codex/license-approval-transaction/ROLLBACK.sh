#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: ROLLBACK.sh <workspace-copy>" >&2
  exit 64
fi

target=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
diff_file="$script_dir/DIFF_FILE"

git -C "$target" apply --reverse --check "$diff_file"
git -C "$target" apply --reverse "$diff_file"
echo "Rollback restored the pre-approval project state."
