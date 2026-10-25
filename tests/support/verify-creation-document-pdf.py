"""Real-file checks plus a contact sheet for human review, not a layout oracle."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw

root = Path(sys.argv[1])
results = {}
for name in ("semantic", "native"):
    reader = PdfReader(root / f"{name}.pdf")
    texts = [p.extract_text() for p in reader.pages]
    joined = "\n".join(texts)
    assert "END OF DOCUMENT" in texts[-1]
    assert "Private inline image" in joined
    assert any("\u4e00" <= c <= "\u9fff" for c in joined)
    for i in range(1, 73):
        assert f"ROW_{i:03d}" in joined, (name, i)
    for i, text in enumerate(texts):
        assert "CREATION REPORT" in text and "INTERNAL REVIEW" in text
        # Every page containing table data must also contain its repeated header.
        if re.search(r"ROW_\d{3}", text):
            assert "ITEM HEADER" in text
        assert str(i + 1) in text
        box = reader.pages[i].mediabox
        assert 590 < float(box.width) < 600 and 835 < float(box.height) < 850
        assert not reader.pages[i].get("/Annots")
    previews = sorted(root.glob(f"{name}-page-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    assert len(previews) == len(texts)
    sheet = Image.new("RGB", (360 * min(3, len(previews)), 540 * ((len(previews) + 2) // 3)), "#e5e7eb")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(previews):
        with Image.open(path) as page:
            assert ImageOps.grayscale(page).getextrema()[0] < 80
            thumb = ImageOps.contain(page.convert("RGB"), (342, 508))
            x, y = (i % 3) * 360 + 9, (i // 3) * 540 + 24
            sheet.paste(thumb, (x, y))
            draw.text((x, y - 18), f"{name} - page {i + 1}", fill="black")
    sheet.save(root / f"{name}-contact.png")
    results[name] = {"pages": len(texts), "rows": 72, "searchable_cjk": True, "bytes": (root / f"{name}.pdf").stat().st_size}
print(json.dumps(results))
