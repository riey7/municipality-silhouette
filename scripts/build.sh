#!/usr/bin/env bash
# データ加工の全段階（raw/ の取得済みデータから data/ を作り直す）
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/dissolve.sh
node --max-old-space-size=2800 scripts/build-data.mjs
bash scripts/build-japan.sh
