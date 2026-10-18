// 段階3：raw/ の元データから、ゲーム用の data/ を作る
//   data/municipalities.topojson … 形（市区町村コードを id に持つ）
//   data/index.json              … コード・名前・都道府県・重心
// 元データは政令市の区が結合済みなので、ここでは区の統合はしない。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import * as topojson from "topojson-client";
import { geoCentroid } from "d3-geo";

const SRC = "raw/N03-21_210101_designated_city.json";
const OUT_TOPO = "data/municipalities.topojson";
const OUT_INDEX = "data/index.json";
const EXPECTED_COUNT = 1747; // 1,718市町村 + 東京23区 + 北方領土6村（2021年1月1日時点）
const NORTHERN_VILLAGES = ["01695", "01696", "01697", "01698", "01699", "01700"];

const fail = (msg) => { console.error(`NG: ${msg}`); process.exit(1); };

// 1. 形：所属未定地（コードなし）を除き、属性をコードだけにして書き出す
execFileSync("npx", [
  "mapshaper", SRC,
  "-filter", "N03_007 != null",
  "-each", "code = N03_007",
  "-filter-fields", "code",
  "-rename-layers", "municipalities",
  "-o", OUT_TOPO, "format=topojson", "id-field=code", "quantization=100000",
], { stdio: "inherit" });

// 2. 一覧：名前・都道府県・重心
const raw = JSON.parse(readFileSync(SRC, "utf8"));
const rawObj = Object.values(raw.objects)[0];
const features = topojson.feature(raw, rawObj).features
  .filter((f) => f.properties.N03_007);

const index = features.map((f) => {
  const p = f.properties;
  const [lon, lat] = geoCentroid(f);
  return {
    code: p.N03_007,
    name: p.N03_004 ?? p.N03_003, // 政令市は N03_004 が空で、N03_003 に市名が入る
    pref: p.N03_001,
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
  };
}).sort((a, b) => a.code.localeCompare(b.code));

// 3. 検証（どれかが崩れたら書き出さずに失敗させる）
const codes = new Set(index.map((m) => m.code));
if (index.length !== EXPECTED_COUNT) fail(`件数 ${index.length}（期待 ${EXPECTED_COUNT}）`);
if (codes.size !== index.length) fail("コードが重複している");
for (const m of index) {
  if (!/^\d{5}$/.test(m.code)) fail(`コード形式が不正: ${m.code}`);
  if (!m.name || !m.pref) fail(`名前か都道府県が空: ${m.code}`);
  if (!(m.lat > 20 && m.lat < 46 && m.lon > 122 && m.lon < 154)) fail(`重心が日本の範囲外: ${m.code} ${m.name}`);
}
for (const c of NORTHERN_VILLAGES) if (!codes.has(c)) fail(`北方領土の村がない: ${c}`);

const topo = JSON.parse(readFileSync(OUT_TOPO, "utf8"));
const topoIds = new Set(topo.objects.municipalities.geometries.map((g) => g.id));
for (const c of codes) if (!topoIds.has(c)) fail(`形が欠けている: ${c}`);
if (topoIds.size !== codes.size) fail("形と一覧の件数が一致しない");

writeFileSync(OUT_INDEX, JSON.stringify(index));
const kb = (p) => (statSync(p).size / 1024).toFixed(0);
console.log(`OK: ${index.length}件 / ${OUT_TOPO} ${kb(OUT_TOPO)}KB / ${OUT_INDEX} ${kb(OUT_INDEX)}KB`);
