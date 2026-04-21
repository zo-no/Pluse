import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(__dirname, '../dist/pluse')
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

echo "Pluse CLI requires Bun. Install Bun or set BUN=/absolute/path/to/bun." >&2
exit 1
`

writeFileSync(outputPath, contents)
chmodSync(outputPath, 0o755)
