"""Optional native export QA; requires the bundled pypdf/Pillow runtime."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader

root = Path(sys.argv[1])
reader = PdfReader(root / "slides.pdf")
assert len(reader.pages) == 2
for page, dimensions in zip(reader.pages, [(480, 270), (241, 361)]):
    assert abs(float(page.mediabox.width) - dimensions[0]) < 0.001
    assert abs(float(page.mediabox.height) - dimensions[1]) < 0.001
texts = [page.extract_text() for page in reader.pages]
assert "咖啡开业" in texts[0] and "PAGE ONE" in texts[0], texts
assert "PAGE TWO" in texts[1] and len(texts[1].splitlines()[0]) == 3, texts
# Local Windows variable CJK fonts reproduce Skia's ambiguous reverse glyph
# mapping (e.g. 二 -> U+2F06, 页 -> U+2EDA). Keep this finding visible; do not
# pretend that all selectable text has byte-exact search/copy semantics.
exact_cjk_roundtrip = "第二页" in texts[1]
assert "HIDDEN" not in "".join(texts) and "PRIVATE NOTE" not in "".join(texts)
assert len(reader.pages[0].images) == 1  # The photo, not a screenshot of the page.
assert len(reader.pages[1].images) == 0  # Shape and text stay vector.
assert reader.pages[0]["/Resources"].get("/Font")
poster = PdfReader(root / "poster.pdf")
assert len(poster.pages) == 1 and "咖啡开业" in poster.pages[0].extract_text()

# Poppler renders at 96 dpi to match CSS pixel dimensions. Compare geometry,
# opacity and clipping against the existing PNG renderer; font antialiasing is
# expected to differ between independent rasterizers.
comparison = []
for index in (1, 2):
    actual = Image.open(root / f"pdf-page-{index}.png").convert("RGBA")
    expected = Image.open(root / f"expected-{index}.png").convert("RGBA")
    assert all(0 <= a - e <= 1 for a, e in zip(actual.size, expected.size))
    white = Image.new("RGBA", actual.size, "white")
    white.alpha_composite(expected)
    expected = white.convert("RGB")
    white = Image.new("RGBA", actual.size, "white")
    actual = Image.alpha_composite(white, actual).convert("RGB")
    mean = sum(ImageStat.Stat(ImageChops.difference(actual, expected)).mean) / 3
    assert mean < 6, mean
    # Outside the clipped cover photo must remain the page background.
    if index == 1:
        assert actual.getpixel((535, 245)) == (255, 255, 255)
        assert actual.getpixel((480, 245))[0] > 200
    comparison.append({"page": index, "size": actual.size, "mean_rgb_error": round(mean, 4)})
if (root / "child.pdf").exists():
    child = PdfReader(root / "child.pdf")
    assert [list(page.mediabox) for page in child.pages] == [list(page.mediabox) for page in reader.pages]
    assert [page.extract_text() for page in child.pages] == texts
print(json.dumps({"pages": len(reader.pages), "searchable_chinese": True, "exact_cjk_roundtrip": exact_cjk_roundtrip, "comparison": comparison}))
