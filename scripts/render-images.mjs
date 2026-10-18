// 加工4：出題用の画像（SVG）を作る。サーバーはこの画像を表示するだけ
//   raw/build/shapes/<code>.json（build-data.mjs の出力）＋ data/index.json の表示枠
//   → data/images/<code>.svg
// 投影と間引きはここで済ませる。間引きは画面上の大きさ（px）で決めるので、どの市区町村も同じ細かさになる
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { geoMercator } from "d3-geo";
import simplify from "simplify-js";

// ── 基準値 ──
const SIZE = 1000;          // viewBox の一辺
const PAD = 25;             // 表示枠の外側の余白
const TOL_PX = 0.3;         // これより小さい凹凸を消す（viewBox 上のpx。全画面表示でも1px未満）
const MAX_FILE_KB = 300;
const COLORS = { light: "#2f5d4a", dark: "#7fb89d" }; // check.html の --shape と同じ

const fail = (msg) => { console.error(`NG: ${msg}`); process.exit(1); };
const r1 = (v) => Math.round(v * 10) / 10;
const outside = (pts) =>
  pts.every((p) => p.x < 0) || pts.every((p) => p.x > SIZE) ||
  pts.every((p) => p.y < 0) || pts.every((p) => p.y > SIZE);

const index = JSON.parse(readFileSync("data/index.json", "utf8"));
mkdirSync("data/images", { recursive: true });
for (const name of readdirSync("data/images")) rmSync(`data/images/${name}`); // 前回の出力を消す

const stats = [];
for (const m of index) {
  const shape = JSON.parse(readFileSync(`raw/build/shapes/${m.code}.json`, "utf8"));
  const [w, s, e, n] = m.view;
  const frame = { type: "MultiPoint", coordinates: [[w, s], [e, n], [w, n], [e, s]] };
  const projection = geoMercator().fitExtent([[PAD, PAD], [SIZE - PAD, SIZE - PAD]], frame);

  let d = "", points = 0;
  for (const poly of shape.geometry.coordinates) {
    for (const ring of poly) {
      const pts = ring.map((lonLat) => { const [x, y] = projection(lonLat); return { x, y }; });
      if (outside(pts)) continue; // 表示枠の外の島は描かない
      const out = simplify(pts, TOL_PX, true).map((p) => [r1(p.x), r1(p.y)]);
      const [a, b] = [out[0], out.at(-1)];
      if (a[0] === b[0] && a[1] === b[1]) out.pop(); // 閉じる点は Z で表す
      if (out.length < 3) continue;
      d += `M${out.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
      points += out.length;
    }
  }
  if (!d) fail(`描く形がない: ${m.code} ${m.pref}${m.name}`);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<style>path{fill:${COLORS.light}}@media (prefers-color-scheme:dark){path{fill:${COLORS.dark}}}</style>` +
    `<path fill-rule="evenodd" d="${d}"/></svg>`;
  const file = `data/images/${m.code}.svg`;
  writeFileSync(file, svg);
  stats.push({ label: `${m.pref}${m.name}`, points, kb: statSync(file).size / 1024 });
}

// 検証
if (readdirSync("data/images").length !== index.length) fail("画像の数が一覧と一致しない");
const heavy = stats.filter((x) => x.kb > MAX_FILE_KB);
if (heavy.length) fail(`画像が重すぎる: ${heavy.map((x) => `${x.label}(${x.kb.toFixed(0)}KB)`).join(" ")}`);

const total = stats.reduce((a, x) => a + x.kb, 0);
const p = stats.map((x) => x.points).sort((a, b) => a - b);
console.log(`OK: 画像 ${stats.length}件 / 合計 ${(total / 1024).toFixed(1)}MB（最大 ${Math.max(...stats.map((x) => x.kb)).toFixed(0)}KB）`);
console.log(`画像の頂点数: 最小 ${p[0]} / 中央値 ${p[p.length >> 1]} / 最大 ${p.at(-1)}`);
