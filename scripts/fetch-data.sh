#!/usr/bin/env bash
# 段階2：元データ（smartnews-smri/japan-topography）を raw/ に取得する
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=https://github.com/smartnews-smri/japan-topography
SHA=$(git ls-remote "$REPO" refs/heads/main | cut -f1)
[ -n "$SHA" ] || { echo "コミットを取得できない" >&2; exit 1; }
FILE=N03-21_210101_designated_city.json   # 政令市の区を結合済みの全国版（簡素化1%）
URL="https://raw.githubusercontent.com/smartnews-smri/japan-topography/$SHA/data/municipality/topojson/s0010/$FILE"
mkdir -p raw
curl -fsSL "$URL" -o "raw/$FILE"
echo "$SHA  $FILE" > raw/SOURCE.txt
echo "取得: $FILE @ $SHA ($(wc -c < raw/$FILE) bytes)"
