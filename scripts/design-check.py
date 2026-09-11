#!/usr/bin/env python3
"""设计规范验收扫描 — 可执行化验收标准
规则来源：《ModelShot前端全面重构方案》双主题铁律 + 阶段三设计规范
"""
import re, sys, os

# 排版规范检查：仅用户侧核心页面
FILES = [
    "src/app/[locale]/studio/page.js",
    "src/app/[locale]/gallery/page.js",
    "src/app/[locale]/pricing/page.js",
    "src/app/[locale]/login/page.js",
    "src/components/Navbar.js",
]

RULES = {
    "字号超出 5 档": r"text-\[(?:7|8|9|10|11)px\]|text-3xl|text-4xl|text-5xl|text-6xl|text-7xl",
    "违规字重": r"font-(?:semibold|bold|extrabold|black)",
    "紫粉渐变残留": r"bg-gradient-to-\w+ from-(?:violet|purple|fuchsia)",
    "装饰性动画": r"animate-(?:pulse|ping|bounce)",
    "超大圆角": r"rounded-(?:2xl|3xl)",
    "衬线字体用于小字（<20px 禁用）": r"font-display[^\"]*text-(?:xs|sm)",
}

# ═══ 双主题铁律（全 src 生效，CI 级拦截）═══
# 1) 禁止硬编码 Tailwind 调色板色类（颜色只能走语义 token）
COLOR_CLASS = re.compile(
    r"\b(?:bg|text|border|from|to|via|ring|shadow|divide|placeholder|decoration|outline|accent|caret|fill|stroke)-"
    r"(?:zinc|slate|gray|grey|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|"
    r"violet|purple|fuchsia|pink|rose)-\d{2,3}(?:/\d+)?\b"
)
# 2) 禁止任意值写死颜色（shadow-[...rgba(...)]、bg-[#...] 等）
# 3) 布局铁律：max-w-* 与 overflow-y-auto 不得同元素（滚动容器不得带宽度约束）
# 4) 语义容器：内容页只允许 prose/content/wide 三档（admin 除外）
SCROLL_WITH_WIDTH = re.compile(r'class="[^"]*max-w-[^"]*overflow-y-auto[^"]*"|class="[^"]*overflow-y-auto[^"]*max-w-[^"]*"')
NON_SEMANTIC_CONTAINER = re.compile(r"max-w-(?:lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|screen-md|screen-lg)\b")
COLOR_ARBITRARY = re.compile(
    r"\b(?:bg|text|border|shadow|ring|from|to)-\[[^\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\()[^\]]*\]"
)

total = 0

# ── 排版规范（核心页面）──
for f in FILES:
    try:
        s = open(f, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"!! 文件不存在: {f}")
        continue
    for rule, pattern in RULES.items():
        hits = re.findall(pattern, s)
        if hits:
            total += len(hits)
            print(f"FAIL {f}: {rule} x{len(hits)} -> {sorted(set(hits))[:4]}")

# ── 双主题铁律（全部 src）──
js_files = []
for root, dirs, fnames in os.walk("src"):
    for fn in fnames:
        if fn.endswith((".js", ".jsx")):
            js_files.append(os.path.join(root, fn))

for f in sorted(js_files):
    s = open(f, encoding="utf-8").read()
    rules = [
        ("硬编码调色板色类（必须用语义 token）", COLOR_CLASS),
        ("任意值写死颜色", COLOR_ARBITRARY),
        ("滚动容器带宽度约束（max-w 与 overflow-y-auto 同元素）", SCROLL_WITH_WIDTH),
    ]
    # 语义容器规则仅对用户侧页面生效（admin 内部工具豁免）
    if "/admin/" not in f.replace("\\", "/"):
        rules.append(("非语义容器宽度（页面级只允许 max-w-prose/content/wide）", NON_SEMANTIC_CONTAINER))
    for rule, pat in rules:
        hits = pat.findall(s)
        if hits:
            total += len(hits)
            print(f"FAIL {f}: {rule} x{len(hits)} -> {sorted(set(hits))[:4]}")

print("PASS 设计规范扫描通过（含双主题零硬编码铁律）" if total == 0 else f"TOTAL {total} violations")
sys.exit(1 if total else 0)
