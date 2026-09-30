#!/usr/bin/env bash
#
# Format this repository with Prettier.
# Rules live in .prettierrc.json and .prettierignore.
# Cross-platform equivalents: `npm run format` / `npm run format:check`.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'EOF'
Format this repository with Prettier.

Usage: scripts/format.sh [options] [paths...]

Options:
  -c, --check    Report unformatted files instead of rewriting them.
                 Exits non-zero when something is unformatted (CI gate).
  -s, --staged   Only process files staged for commit (pre-commit hook).
  -h, --help     Show this help.

With no paths every file outside .prettierignore is processed.
Options and paths may be combined, e.g. `scripts/format.sh -c src tests`.
EOF
}

mode="--write"
staged=0
paths=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    -c | --check) mode="--check" ;;
    -s | --staged) staged=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do
        paths+=("$1")
        shift
      done
      break
      ;;
    -*)
      echo "format.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *) paths+=("$1") ;;
  esac
  shift
done

if [ ! -x node_modules/.bin/prettier ]; then
  echo "format.sh: Prettier is not installed. Run: npm ci" >&2
  exit 1
fi

if [ "$staged" -eq 1 ]; then
  if [ "${#paths[@]}" -gt 0 ]; then
    echo "format.sh: --staged cannot be combined with explicit paths" >&2
    exit 2
  fi
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "format.sh: --staged requires a git repository" >&2
    exit 1
  fi
  while IFS= read -r file; do
    [ -n "$file" ] && paths+=("$file")
  done < <(git diff --cached --name-only --diff-filter=ACMR)
  if [ "${#paths[@]}" -eq 0 ]; then
    echo "format.sh: nothing staged, nothing to do"
    exit 0
  fi
fi

# Prettier reads stdin when given no pattern, so default to the whole tree.
if [ "${#paths[@]}" -eq 0 ]; then
  paths=(.)
fi

exec node_modules/.bin/prettier "$mode" --ignore-unknown "${paths[@]}"
