#!/usr/bin/env bash
# Builds, validates and zips the n8n workflows for a given SAFQA URL.
#   ./n8n/package.sh https://safqa-indol.vercel.app
set -euo pipefail
URL="${1:?usage: package.sh https://your-safqa-domain}"
cd "$(dirname "$0")/.."
SAFQA_PUBLIC_URL="$URL" npx tsx n8n/build-workflows.ts
STAGE=$(mktemp -d)/safqa-n8n-workflows
mkdir -p "$STAGE/workflows"
EXPECTED_BASE_URL="$URL" npx tsx n8n/validate-workflows.ts > "$STAGE/VALIDATION_REPORT.txt"
cp n8n/workflows/*.json "$STAGE/workflows/"
cp n8n/SETUP_GUIDE.md "$STAGE/SETUP_GUIDE.md"
(cd "$STAGE" && sha256sum workflows/*.json SETUP_GUIDE.md > CHECKSUMS.sha256)
mkdir -p n8n/dist
rm -f n8n/dist/safqa-n8n-workflows.zip
python3 -c "
import os, sys, zipfile
root = sys.argv[1]; out = sys.argv[2]; base = os.path.dirname(root)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(root):
        for f in sorted(files):
            p = os.path.join(d, f); z.write(p, os.path.relpath(p, base))
" "$STAGE" n8n/dist/safqa-n8n-workflows.zip
echo "Packaged: n8n/dist/safqa-n8n-workflows.zip"
