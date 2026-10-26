# QuickPack layout 3D engine

Một viewer tĩnh cho mọi job xếp hộp. Sản phẩm mới = thư mục `jobs/<mã>/` (file `panels.json` + ảnh trong `textures/`). Không viết engine thứ hai, không nhúng base64 vào HTML.

## Thêm một job

1. Copy `jobs/sample-zosia` thành `jobs/<mã>/`.
2. Sửa `panels.json`: panel (mm), crease (bản lề duy nhất), và `pack`. Nguồn ghi trong `meta.sources`: `dieline`, `ProductMaster`, hoặc `estimate`.
3. Đặt ảnh in vào `jobs/<mã>/textures/` và trỏ `textureRef` bằng đường dẫn tương đối (`textures/hero.png`). Không `data:` URL.
4. Mở viewer: `/viewer/?job=../jobs/<mã>/panels.json`.

Mẫu `EXAMPLE-ZOSIA-LAYOUT` dùng hằng số tròn (thùng 200×100×160, inner 46×46×120, sóng 2.0 mm). Đây không phải số Product Master và không phải số đo dieline.

## Quy tắc Y nghỉ

`floor = carton.thicknessMm × pack.floorBoardLayers`. `H = pack.itemHeightMm`.

| `pack.anchor` | `restingYRule` | Tâm / gốc của món hàng |
| --- | --- | --- |
| `center` | `floor+H/2` | tâm hình học tại `floor + H/2` |
| `pivot` | `floor` | gốc lắp ráp tại `floor` |

Mẫu dùng `center`, hai lớp đáy, `t = 2` → `floor = 4`, `H = 120` → **Y = 64 mm**. `pivot` với cùng floor sẽ nằm tại Y = 4 mm. Chi tiết nằm trong `schema/panels.schema.json` và `viewer/js/pack-rule.js` (một chỗ duy nhất trong code).

Panel local: +X ngang mặt, +Y lên, +Z về phía mặt in. Panel không phải gốc chỉ bản lề bằng một crease mà nó là `panelB`. `axis.direction` nằm trong hệ của panel con.

## Chạy

```bash
python3 -m http.server 4173
# http://127.0.0.1:4173/viewer/
```

Trang gốc (`/`) chuyển tới `/viewer/` (trên Vercel bằng `vercel.json`; khi tự host, `index.html` refresh). Phải mở qua HTTP vì viewer `fetch` JSON. Three.js **r147** lấy từ CDN.

```bash
node scripts/verify_pack.mjs
```

Kiểm tra job mẫu, quy tắc Y, không có base64, và parser nháp. Nếu máy có `three@0.147.0` thì script đo thêm bản lề. Nếu có puppeteer: `node scripts/verify_pack.mjs --browser`.

Parser dieline (mới đọc khổ trang qua poppler `pdfinfo`, **chưa** tách vector): xem `parser/README.md`.

```bash
python3 parser/parse_dieline.py path/to/dieline.pdf jobs/<mã>/panels.json --product-code DRAFT-EXAMPLE
```

---

# English

One static viewer for every packing job. A new product is a new `jobs/<code>/` folder (`panels.json` plus files in `textures/`). Do not fork the engine. Do not embed base64 in HTML or JS.

## Add a job

1. Copy `jobs/sample-zosia` to `jobs/<code>/`.
2. Edit `panels.json`: panels (mm), creases (the only hinge), and `pack`. Record `meta.sources` as `dieline`, `ProductMaster`, and/or `estimate`.
3. Put print art in `jobs/<code>/textures/` and set `textureRef` to a relative path such as `textures/hero.png`.
4. Open `/viewer/?job=../jobs/<code>/panels.json`.

`EXAMPLE-ZOSIA-LAYOUT` uses round EXAMPLE constants (carton 200×100×160, inner 46×46×120, board 2.0 mm). Those are not Product Master numbers and not dieline measurements. The fold slider, legend, and resting Y follow the earlier one-file sim; the blank here is simplified rectangles so the first load does not wait on a full dieline port.

## Resting Y

`floor = carton.thicknessMm × pack.floorBoardLayers`. `H = pack.itemHeightMm`.

| `pack.anchor` | `restingYRule` | Where the packed item sits |
| --- | --- | --- |
| `center` | `floor+H/2` | geometric center at `floor + H/2` |
| `pivot` | `floor` | assembly origin at `floor` |

The sample uses `center` with two bottom layers and `t = 2`, so `floor = 4`, `H = 120`, and **Y = 64 mm**. The same floor with `pivot` would rest at Y = 4 mm. The schema comments and `viewer/js/pack-rule.js` are the single definition of that rule.

Panel local space is +X across the face, +Y up, +Z toward the print. A non-root panel hinges only by being `panelB` of one crease. `axis.direction` is in that child panel's local space. `pack.heroTowardDisplay` yaws a packed item so the `hero` print faces +Z (the display side). Row 0 of the grid is the row toward +Z.

FIT compares the grid to the carton cavity `L−2t`, `W−2t`, and `Hcarton − floor`. The sample hood is a rim outside the walls, so the height check uses the carton wall, not a lid ceiling.

## Run

Serve the repo over HTTP (the viewer fetches JSON; `file://` will not):

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/viewer/`. `/` redirects to `/viewer/` on Vercel (`vercel.json`); a local static server follows the root `index.html` refresh. Three.js **r147** is loaded from the CDN.

```bash
node scripts/verify_pack.mjs
```

That checks the sample job, the resting-Y numbers, that text files contain no `data:image` payload, and that the dieline parser writes a valid draft. When `three@0.147.0` resolves, it also measures the hinged blanks. With puppeteer installed, `node scripts/verify_pack.mjs --browser` drives the fold slider.

The dieline parser records page size via poppler `pdfinfo` and leaves vector extraction as TODO. See `parser/README.md`.
