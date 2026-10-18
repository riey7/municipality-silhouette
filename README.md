# municipality-silhouette

市区町村のシルエットを見て名前を当てるゲームの個人試作（非公開）。
静的ファイルだけで動くので、GitHub Pages にそのまま載せられる構成にしてある。

## データの作り方

```
npm install
npm run fetch        # raw/ に元データを取得（commitしない）
npm run build:data   # data/ を生成し、件数・コード・重心を検証する
npm run serve        # http://localhost:8000/check.html で形を確認
```

- 基準日：2021年1月1日（元データの時点）
- 政令指定都市は区を結合して1市として扱う
- 北方領土の6村を含む。所属未定地は除く
- 件数：1,747（1,718市町村 + 東京23区 + 北方領土6村）

## 出典

出典：国土数値情報（行政区域データ）（国土交通省）を加工して作成
加工元：smartnews-smri/japan-topography（取得したコミットは raw/SOURCE.txt に記録）
