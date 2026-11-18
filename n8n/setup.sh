#!/usr/bin/env bash
# Imports the LendLoop workflows into the running compose n8n, points them at the error
# workflow, and activates them. Safe to re-run: existing workflows are overwritten by id.
set -euo pipefail
cd "$(dirname "$0")"
x() { docker compose exec -T n8n "$@"; }

# import <file> [errorWorkflowId] -> prints the workflow id
import() {
  local f=$1 err=${2:-} name existing
  name=$(x node -e "console.log(require('/workflows/$f.json').name)")
  existing=$(x n8n list:workflow | grep "|$name\$" | head -1 | cut -d'|' -f1 || true)
  x node -e "
    const w = require('/workflows/$f.json');
    if ('$existing') w.id = '$existing';
    if ('$err') w.settings.errorWorkflow = '$err';
    require('fs').writeFileSync('/tmp/$f.json', JSON.stringify(w));"
  x n8n import:workflow --input=/tmp/$f.json >/dev/null
  x n8n list:workflow | grep "|$name\$" | head -1 | cut -d'|' -f1
}

ERR_ID=$(import error-handler)
for f in request-notification overdue-reminders; do
  id=$(import "$f" "$ERR_ID")
  x n8n update:workflow --id="$id" --active=true >/dev/null
  echo "✓ $f ($id) → error workflow $ERR_ID"
done
docker compose restart n8n >/dev/null
echo "Done. Webhook: ${WEBHOOK_URL:-http://localhost:5678/}webhook/lendloop-request"
