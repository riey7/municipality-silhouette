#!/usr/bin/env bash
# 加工3：答え合わせ用の全国地図（境界線を共有したまま間引く）
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_OPTIONS=--max-old-space-size=2800 npx mapshaper raw/build/dissolved.geojson \
  -join raw/build/codes.csv keys=key,key field-types=key:str,code:str \
  -simplify interval=800 keep-shapes \
  -each 'pref = N03_001' -filter-fields code,pref \
  -rename-layers municipalities \
  -dissolve pref + name=prefectures \
  -o data/japan.topojson target=* format=topojson id-field=code quantization=100000
