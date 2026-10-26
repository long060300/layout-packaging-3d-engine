# Dieline parser (stub)

`parse_dieline.py` nhận một PDF và ghi `panels.json` nháp. Việc tách nét cắt / nét gấp thành panel và crease **chưa làm** — file ghi rõ `TODO`.

`pdfinfo` (poppler) chỉ dùng để lấy khổ trang. Không có poppler thì skeleton vẫn được ghi, với khổ 100×100 mm.

## English

```bash
python3 parser/parse_dieline.py path/to/dieline.pdf jobs/<code>/panels.json --product-code DRAFT-EXAMPLE
```

Then, in that job folder only:

1. Replace the single blank panel with real faces, glue, flaps, and windows.
2. Add one crease per hinge (`panelB` is the only hinge; `axis.direction` is in that child's local space).
3. Put print files in `textures/` and point `textureRef` at them. Do not embed base64.
4. Set `pack.anchor`. `center` pairs with `restingYRule` `floor+H/2`. `pivot` pairs with `floor`.

The viewer does not change per product. Open `/viewer/?job=../jobs/<code>/panels.json`.
