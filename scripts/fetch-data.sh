#!/usr/bin/env bash
# 元データを raw/ に取得する（raw/ は commit しない）
#   1. 国土数値情報 行政区域データ N03（2026年1月1日時点、全国、CC BY 4.0）
#   2. 総務省 全国地方公共団体コード一覧（令和6年1月1日更新、公共データ利用規約）… 過不足の突き合わせとカタカナの読み
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw
URL=https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip
ZIP=raw/N03-20260101_GML.zip
[ -f "$ZIP" ] || curl -fsSL "$URL" -o "$ZIP"
rm -rf raw/N03 && mkdir -p raw/N03 && unzip -q -o "$ZIP" -d raw/N03
{
  echo "url: $URL"
  echo "sha256: $(sha256sum "$ZIP" | cut -d' ' -f1)"
  echo "fetched: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > raw/SOURCE-N03.txt
CODES_URL=https://www.soumu.go.jp/main_content/000925835.xlsx
curl -fsSL "$CODES_URL" -o raw/soumu-codes.xlsx
{
  echo "url: $CODES_URL"
  echo "sha256: $(sha256sum raw/soumu-codes.xlsx | cut -d' ' -f1)"
} > raw/SOURCE-codes.txt
cat raw/SOURCE-N03.txt raw/SOURCE-codes.txt
