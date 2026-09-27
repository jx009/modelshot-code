# Third-Party Notices

ModelShot's production workflow vocabulary and e-commerce deliverable planning were informed by the following MIT-licensed projects. ModelShot uses its own implementation and does not include their command-line or agent runtime code.

## Ecommerce Image Generation Workflow

Source: https://github.com/QIYU-JACKMAN/codexQIYU-image-workflow

MIT License

Copyright (c) 2026 启宇跨境

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## gpt-image2-ecommerce

Source: https://github.com/buluslan/gpt-image2-ecommerce

MIT License

Copyright (c) 2026 Buluu@新西楼

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ecommerce-detail-page-generator

Source: https://github.com/Gayaya999/ecommerce-detail-page-generator

MIT License

Copyright (c) 2026 Better call Even

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Canvas additions: third-party notices

- `src/lib/studio/canvas-utils.js`: `scaleToFit` and video extension detection adapted from [Loomic](https://github.com/fancyboi999/Loomic), commit `bdb47a5adf900b48615af0bd914336e3770021b5`, `apps/web/src/lib/canvas-elements.ts`. Copyright (c) 2026 Xinmin Zeng, MIT. Full notice is retained in [docs/Loomic-LICENSE.txt](docs/Loomic-LICENSE.txt).
- Konva 10.7.0 and react-konva 19.2.3: MIT. Original notices ship with the npm packages. Pinned React 19.2-compatible binding instead of forcing an incompatible React 19.3 peer requirement.
- Sharp (existing dependency): Apache-2.0. Used for deterministic raster processing, not copied source.
- Optional external image-tool engines: rembg MIT, Real-ESRGAN BSD-3-Clause, PaddleOCR Apache-2.0. Engines and checkpoints are not bundled; see service README for provenance and setup.

`ai-picture-editor` was reviewed as an architectural reference only. No source code or assets were copied because the reviewed revision had no explicit license. The tool registry, task handling and Python service here are independently implemented.

Existing dependency licenses remain applicable. Model checkpoint terms and hosted API usage terms are separate from these software licenses.

## Commerce redesign additions (2026-09-26)

`src/lib/commerce/planner.js` adapts product-lock and per-module prompt recipes from Gayaya999/ecommerce-detail-page-generator (MIT, Copyright 2026 Better call Even). The original recipes and complete license are retained in `docs/upstream/detail-page-prompt-recipes.md` and `docs/upstream/detail-page-LICENSE.txt`.

`src/lib/commerce/editorial-template.json` is copied from buluslan/gpt-image2-ecommerce, `references/templates/20-magazine-editorial.json` (MIT, Copyright 2026 Buluu@新西楼). Full license: `docs/upstream/ecommerce-templates-LICENSE.txt`. The planner uses its editorial photography guidance; its shell scripts and agent runtime are not embedded.

Photography references in `public/inspiration/` are from Unsplash under the Unsplash License. Exact source URLs and usage are recorded in `public/inspiration/sources.json`. Photographs demonstrate layouts and art direction; they are not generated product results. Depicted trademarks do not imply affiliation.
