#!/usr/bin/env bash
# 加工1：N03を市区町村単位（政令市は市単位）にまとめ、2m未満の凹凸だけ除いた中間ファイルを作る
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw/build
NODE_OPTIONS=--max-old-space-size=2800 npx mapshaper raw/N03/N03-20260101.shp encoding=utf8 \
  -filter 'N03_004 != "所属未定地"' \
  -each 'key = N03_005 ? "W|" + N03_001 + "|" + N03_004 : N03_007' \
  -dissolve2 key copy-fields=N03_001,N03_004,N03_005,N03_007 \
  -simplify interval=2 keep-shapes \
  -o raw/build/dissolved.geojson precision=0.00001
