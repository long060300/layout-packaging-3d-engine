#!/usr/bin/env python3
"""Write a draft panels.json skeleton from a dieline PDF.

Poppler's `pdfinfo` is optional and only supplies the page size. Cutting
the page into hinged panels is not implemented.

Usage:
  python3 parser/parse_dieline.py dieline.pdf jobs/<code>/panels.json
  python3 parser/parse_dieline.py dieline.pdf jobs/<code>/panels.json --product-code DRAFT-EXAMPLE
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def page_size_mm(pdf_path: Path) -> tuple[float, float] | None:
    """Return the first page size in millimetres, or None when pdfinfo cannot say."""
    try:
        proc = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        print(
            "TODO: install poppler (pdfinfo) to read the page size. "
            "Writing a skeleton with a placeholder size.",
            file=sys.stderr,
        )
        return None
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        print(f"TODO: pdfinfo failed ({detail or proc.returncode}). Placeholder page size.", file=sys.stderr)
        return None
    text = proc.stdout
    pts = re.search(r"Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts", text)
    if pts:
        w, h = float(pts.group(1)), float(pts.group(2))
        return (round(w * 25.4 / 72.0, 1), round(h * 25.4 / 72.0, 1))
    mm = re.search(r"Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+mm", text)
    if mm:
        return (round(float(mm.group(1)), 1), round(float(mm.group(2)), 1))
    print("TODO: pdfinfo had no Page size line. Placeholder page size.", file=sys.stderr)
    return None


def skeleton(product_code: str, pdf_path: Path, page_mm: tuple[float, float] | None) -> dict:
    width, height = page_mm or (100.0, 100.0)
    todos = [
        "TODO: parse cut and crease vectors from the dieline PDF (pdfinfo/poppler records page size only).",
        "TODO: emit one Panel per face and one Crease per hinge. A panel hinges only as crease.panelB; axis.direction is in that child panel's local space.",
        "TODO: write textures under textures/ and set textureRef to a relative path. Never embed base64.",
        "TODO: replace the placeholder pack (anchor, grid, H) after the real blank is known. center → floor+H/2; pivot → floor.",
    ]
    if page_mm is None:
        todos.insert(0, "TODO: page size was not read; rectMm is a 100×100 mm placeholder.")
    return {
        "meta": {
            "productCode": product_code,
            "title": f"Draft from {pdf_path.name}",
            "sources": ["dieline", "estimate"],
            "notes": (
                "Skeleton only. pdfinfo may record the page size; panel outlines, creases, "
                "and textures are not parsed yet. Thickness and pack numbers are placeholders, not Product Master values."
            ),
            "todo": todos,
            "pageSizeMm": [width, height],
            "generatedBy": "parser/parse_dieline.py",
        },
        "carton": {
            "id": "carton",
            "thicknessMm": 1,
            "nominalOutsideMm": {"l": width, "w": height, "h": 10},
            "flatPositionMm": [0, 0, 0],
            "seatMm": [0, 0, 0],
            "uprightEulerDeg": [0, 0, 0],
            "orientWindow": [0, 1],
            "panels": [
                {
                    "id": "blank",
                    "role": "face",
                    "rectMm": {"x": 0, "y": 0, "w": width, "h": height},
                    "printFace": "none",
                }
            ],
            "creases": [],
        },
        "inners": [],
        "pack": {
            "eb": "vertical",
            "grid": {"cols": 1, "rows": 1, "colMm": 1, "rowMm": 1, "cells": []},
            "anchor": "center",
            "restingYRule": "floor+H/2",
            "heroTowardDisplay": False,
            "itemHeightMm": 1,
            "floorBoardLayers": 1,
            "dropWindow": [0, 1],
            "stagger": 0,
            "dropDuration": 1,
        },
        "steps": [
            {"t": 0, "label": "Draft sheet / Tấm nháp"},
            {"t": 100, "label": "TODO — replace with real fold steps"},
        ],
    }


def write_skeleton(pdf_path: Path, output_path: Path, product_code: str) -> dict:
    if not pdf_path.is_file():
        raise FileNotFoundError(pdf_path)
    page = page_size_mm(pdf_path)
    job = skeleton(product_code, pdf_path, page)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
    return job


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write a draft QuickPack panels.json from a dieline PDF.")
    parser.add_argument("pdf", type=Path, help="Path to the dieline PDF")
    parser.add_argument("output", type=Path, help="Where to write panels.json")
    parser.add_argument("--product-code", default="DRAFT", help="meta.productCode for the skeleton")
    args = parser.parse_args(argv)
    try:
        job = write_skeleton(args.pdf, args.output, args.product_code)
    except FileNotFoundError:
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 2
    page = job["meta"]["pageSizeMm"]
    print(f"Wrote {args.output} (page {page[0]} × {page[1]} mm, vector parse TODO)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
