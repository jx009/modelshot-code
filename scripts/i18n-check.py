#!/usr/bin/env python3
"""i18n 验收 — 英文页面渲染输出不得含中文（DB 双字段 + 代码文案回归检测）"""
import os, re, sys, urllib.request

PAGES = ["/en", "/en/studio", "/en/gallery", "/en/pricing", "/en/login"]
BASE = os.environ.get("I18N_BASE_URL", "http://127.0.0.1:3000").rstrip("/")

fail = 0
for p in PAGES:
    try:
        html = urllib.request.urlopen(BASE + p, timeout=10).read().decode()
    except Exception as e:
        fail += 1
        print(f"FAIL {p}: {e}")
        continue
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S)
    hits = sorted(set(re.findall(r"[\u4e00-\u9fa5]{2,}", html)))
    if hits:
        fail += 1
        print(f"FAIL {p}: {hits}")
    else:
        print(f"PASS {p}")

sys.exit(1 if fail else 0)
