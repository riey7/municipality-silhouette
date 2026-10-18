// 加工2：中間ファイルから、出題用の形（1件1ファイル）と一覧を作る
//   data/shapes/<code>.json … 出題用の形（市区町村ごとに大きさに比例して間引く）
//   data/index.json         … コード・名前・都道府県・読み・代表点・表示枠
//   raw/build/codes.csv     … 全国地図（build-japan.sh）用のキー→コード対応
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { geoArea, geoBounds, geoCentroid, geoDistance } from "d3-geo";
import simplify from "simplify-js";
import XLSX from "xlsx";

// ── 仮の基準値（確認ページで見比べて調整する）──
const DETAIL_DIVISOR = 800;     // 間引きの許容誤差 = 表示枠の対角線 / これ
const MIN_ISLET_M2 = 10_000;    // これ未満の小島は除く（唯一の陸地なら残す）
const VIEW_MAX_KM = 50;         // 表示枠に入れる島：最大の陸地から何km以内か
const VIEW_MIN_RATIO = 0.01;    // 表示枠に入れる島：最大の陸地の何割以上の面積か
// ── 検証の基準 ──
const EXPECTED_COUNT = 1747;
// N03と総務省一覧で字体だけが違う名前（表示にはN03の名前を使う）
const NAME_VARIANTS = new Map([
  ["39405", "梼原町"], // N03は「檮原町」
]);
// 政令市（区を結合して1市にする）。N03の区がこの表に合わなければ失敗させる
const DESIGNATED_CITIES = new Map(Object.entries({
  "北海道|札幌市": "01100", "宮城県|仙台市": "04100", "埼玉県|さいたま市": "11100",
  "千葉県|千葉市": "12100", "神奈川県|横浜市": "14100", "神奈川県|川崎市": "14130",
  "神奈川県|相模原市": "14150", "新潟県|新潟市": "15100", "静岡県|静岡市": "22100",
  "静岡県|浜松市": "22130", "愛知県|名古屋市": "23100", "京都府|京都市": "26100",
  "大阪府|大阪市": "27100", "大阪府|堺市": "27140", "兵庫県|神戸市": "28100",
  "岡山県|岡山市": "33100", "広島県|広島市": "34100", "福岡県|北九州市": "40100",
  "福岡県|福岡市": "40130", "熊本県|熊本市": "43100",
}));
const MIN_VERTICES = 12;
const MAX_FILE_KB = 150;

const R_KM = 6371.0088;
const fail = (msg) => { console.error(`NG: ${msg}`); process.exit(1); };
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// 1. 総務省コード一覧（6桁の末尾は検査数字なので5桁にそろえる）
const book = XLSX.readFile("raw/soumu-codes.xlsx");
const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }).slice(1);
const soumu = new Map();       // code5 → { pref, name, kana }
for (const [code6, pref, name, , kanaHalf] of rows) {
  if (!code6 || !name) continue; // 都道府県の行は除く
  const code = String(code6).padStart(6, "0").slice(0, 5);
  const kana = String(kanaHalf ?? "").normalize("NFKC");
  soumu.set(code, { pref, name, kana });
}

// 2. 読みの手修正（data/kana-overrides.csv：code,kana,note）
const overrides = new Map();
for (const line of readFileSync("data/kana-overrides.csv", "utf8").split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [code, kana] = line.split(",");
  if (!/^\d{5}$/.test(code) || !kana) fail(`kana-overrides.csv の行が不正: ${line}`);
  overrides.set(code, kana.trim());
}

// 3. 形の処理に使う関数
// 中間ファイル（GeoJSON）は外周が反時計回り。d3 は時計回りを内側とみなすので、
// 「地球全体からその形を除いた領域」と解釈されないよう向きをそろえる。出力も d3 向きになる。
const toD3Winding = (poly) =>
  geoArea({ type: "Polygon", coordinates: poly }) > 2 * Math.PI ? poly.map((r) => [...r].reverse()) : poly;
const partsOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(toD3Winding);
const asGeom = (parts) => ({ type: "MultiPolygon", coordinates: parts });
const areaM2 = (poly) => geoArea({ type: "Polygon", coordinates: poly }) * (R_KM * 1000) ** 2;
const bboxDiagKm = ([[w, s], [e, n]]) =>
  geoDistance([w, s], [e, n]) * R_KM;

function simplifyRing(ring, tolM, lat0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 110_574;
  const pts = ring.map(([x, y]) => ({ x: x * kx, y: y * ky }));
  const out = simplify(pts, tolM, true).map((p) => [round(p.x / kx, 5), round(p.y / ky, 5)]);
  const [a, b] = [out[0], out.at(-1)];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([...a]);
  return out.length >= 4 ? out : null;
}

// 4. 本体
const dissolved = JSON.parse(readFileSync("raw/build/dissolved.geojson", "utf8"));
mkdirSync("data/shapes", { recursive: true });
for (const name of readdirSync("data/shapes")) rmSync(`data/shapes/${name}`); // 前回の出力を消す

const index = [], codesCsv = ["key,code"], report = [], nameMismatches = [], seenCities = new Set();
for (const f of dissolved.features) {
  const p = f.properties;
  const isWardCity = p.key.startsWith("W|");
  const code = isWardCity ? DESIGNATED_CITIES.get(`${p.N03_001}|${p.N03_004}`) : p.N03_007;
  if (!code) fail(`政令市の表にない区: ${p.key}`);
  if (isWardCity) seenCities.add(code);
  const ref = soumu.get(code);
  if (!ref) fail(`総務省一覧にないコード: ${code} ${p.N03_001}${p.N03_004}`);
  if (ref.pref !== p.N03_001 || (ref.name !== p.N03_004 && NAME_VARIANTS.get(code) !== ref.name)) {
    nameMismatches.push(`${code} N03=${p.N03_001}${p.N03_004} 総務省=${ref.pref}${ref.name}`);
    continue;
  }

  // 小島の除外（唯一の陸地なら残す）
  let parts = partsOf(f.geometry).map((poly) => ({ poly, area: areaM2(poly) }))
    .sort((a, b) => b.area - a.area);
  const kept = parts.filter((x) => x.area >= MIN_ISLET_M2);
  const droppedIslets = parts.length - (kept.length || 1);
  parts = kept.length ? kept : parts.slice(0, 1);

  // 表示枠：最大の陸地と、その近くのそれなりに大きい島
  const main = parts[0];
  const mainC = geoCentroid({ type: "Polygon", coordinates: main.poly });
  const mainB = geoBounds({ type: "Polygon", coordinates: main.poly });
  const mainR = bboxDiagKm(mainB) / 2;
  const viewParts = parts.filter((x) => x === main || (
    x.area >= main.area * VIEW_MIN_RATIO &&
    geoDistance(geoCentroid({ type: "Polygon", coordinates: x.poly }), mainC) * R_KM - mainR <= VIEW_MAX_KM
  ));
  const viewGeom = asGeom(viewParts.map((x) => x.poly));
  const [[w, s], [e, n]] = geoBounds(viewGeom);
  const [lon, lat] = geoCentroid(viewGeom);

  // 間引き：表示枠の大きさに比例
  const tolM = (bboxDiagKm([[w, s], [e, n]]) * 1000) / DETAIL_DIVISOR;
  let simplified = parts.map(({ poly }) => {
    const rings = poly.map((r) => simplifyRing(r, tolM, lat));
    return rings[0] ? rings.filter(Boolean) : null;
  }).filter(Boolean);
  if (!simplified.length) simplified = [main.poly.map((r) => simplifyRing(r, tolM / 10, lat)).filter(Boolean)];

  const vertices = simplified.flat().reduce((sum, r) => sum + r.length, 0);
  const file = `data/shapes/${code}.json`;
  writeFileSync(file, JSON.stringify({ type: "Feature", id: code, properties: {}, geometry: asGeom(simplified) }));

  index.push({
    code, name: p.N03_004, pref: p.N03_001,
    kana: overrides.get(code) ?? ref.kana,
    lat: round(lat, 4), lon: round(lon, 4),
    view: [round(w, 4), round(s, 4), round(e, 4), round(n, 4)],
  });
  codesCsv.push(`"${p.key}",${code}`);
  report.push({ code, label: p.N03_001 + p.N03_004, vertices, kb: statSync(file).size / 1024,
    areaKm2: parts.reduce((a, x) => a + x.area, 0) / 1e6, parts: parts.length,
    outOfView: parts.length - viewParts.length, droppedIslets });
}
index.sort((a, b) => a.code.localeCompare(b.code));

// 5. 検証
const absentCities = [...DESIGNATED_CITIES.values()].filter((c) => !seenCities.has(c));
if (absentCities.length) fail(`N03に区が見つからない政令市: ${absentCities}`);
if (nameMismatches.length) fail(`名前が一致しない（字体違いなら NAME_VARIANTS に追加）:\n  ${nameMismatches.join("\n  ")}`);
const codes = new Set(index.map((m) => m.code));
const soumuCodes = new Set(soumu.keys());
const missing = [...soumuCodes].filter((c) => !codes.has(c));
const extra = [...codes].filter((c) => !soumuCodes.has(c));
if (missing.length || extra.length) fail(`総務省一覧との過不足 不足=${missing} 余分=${extra}`);
if (index.length !== EXPECTED_COUNT) fail(`件数 ${index.length}（期待 ${EXPECTED_COUNT}）`);
if (codes.size !== index.length) fail("コードが重複している");
for (const c of overrides.keys()) if (!codes.has(c)) fail(`kana-overrides.csv に存在しないコード: ${c}`);
for (const m of index) if (!/^[ァ-ヴー・ヶ]+$/.test(m.kana)) fail(`読みがカタカナでない: ${m.code} ${m.name} "${m.kana}"`);
const thin = report.filter((r) => r.vertices < MIN_VERTICES);
if (thin.length) fail(`頂点が少なすぎる: ${thin.map((r) => `${r.label}(${r.vertices})`).join(" ")}`);
const heavy = report.filter((r) => r.kb > MAX_FILE_KB);
if (heavy.length) fail(`ファイルが重すぎる: ${heavy.map((r) => `${r.label}(${r.kb.toFixed(0)}KB)`).join(" ")}`);
if (readdirSync("data/shapes").length !== index.length) fail("形のファイル数が一覧と一致しない");

writeFileSync("data/index.json", JSON.stringify(index));
writeFileSync("raw/build/codes.csv", codesCsv.join("\n") + "\n");
writeFileSync("raw/build/report.json", JSON.stringify(report));

// 6. 要約
const total = report.reduce((a, r) => a + r.kb, 0);
const v = report.map((r) => r.vertices).sort((a, b) => a - b);
console.log(`OK: ${index.length}件 / shapes 合計 ${(total / 1024).toFixed(1)}MB（最大 ${Math.max(...report.map((r) => r.kb)).toFixed(0)}KB）`);
console.log(`頂点数: 最小 ${v[0]} / 中央値 ${v[v.length >> 1]} / 最大 ${v.at(-1)}`);
console.log(`表示枠の外に島がある: ${report.filter((r) => r.outOfView).length}件 / 小島を除いた: ${report.filter((r) => r.droppedIslets > 0).length}件`);
