import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const outputPath = resolve(import.meta.dirname, '../dist/pulse')
mkdirSync(dirname(outputPath), { recursive: true })

const contents = `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [ -n "\${BUN:-}" ] && [ -x "\${BUN}" ]; then
  exec "\${BUN}" "\${ROOT_DIR}/cli.js" "$@"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun "\${ROOT_DIR}/cli.js" "$@"
fi

if [ -x "\${HOME}/.bun/bin/bun" ]; then
  exec "\${HOME}/.bun/bin/bun" "\${ROOT_DIR}/cli.js" "$@"
fi

echo "Pulse CLI requires Bun. Install Bun or set BUN=/absolute/path/to/bun." >&2
exit 1
`

writeFileSync(outputPath, contents)
chmodSync(outputPath, 0o755)
