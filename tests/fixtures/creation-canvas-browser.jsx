import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import LayoutCanvas from "../../src/components/creation/editors/layout/LayoutCanvas";
import ObjectStyles from "../../src/components/creation/editors/layout/ObjectStyles";
import { layoutDocumentSchema, layoutOperationsSchema } from "../../src/lib/creation/contracts/layout.js";
import { applyWithInverse } from "../../src/lib/creation/layout-history.js";

// Real Canvas, inspector, contracts and history; this harness deliberately has
// no Next shell, database, model, network save or substitute canvas renderer.
const fixture = layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "Canvas regression", theme: { name: "Brand", primary: "#33443b", accent: "#cb985e", background: "#faf7ef", fontFamily: "sans" }, pages: [0, 1].map(index => ({
  id: `page-${index}`, title: `Page ${index + 1}`, width: 1920, height: 1080, background: "#faf7ef", nodes: [
    { id: "title", name: "标题", type: "text", x: 200, y: 180, width: 600, height: 180, text: index ? "第二页标题" : "测试文字", style: { fontSize: 64, fill: "#33443b" } },
    { id: "rect", name: "透明矩形", type: "shape", shape: "rectangle", x: 1000, y: 580, width: 320, height: 200, fill: "#00000000", stroke: "#cb985e", strokeWidth: 4, radius: 20 },
    { id: "ellipse", name: "圆形", type: "shape", shape: "ellipse", x: 200, y: 650, width: 200, height: 200, fill: "#cb985e" },
    { id: "line", name: "线条", type: "shape", shape: "line", x: 600, y: 680, width: 200, height: 160, fill: "#33443b" },
  ],
})) });

function Harness() {
  const [content, setContent] = useState(fixture), [pageIndex, setPageIndex] = useState(0), [selectedId, select] = useState(null);
  const [history, setHistory] = useState([]), [error, setError] = useState(""), [readOnly, setReadOnly] = useState(false);
  const control = useRef(null), page = content.pages[pageIndex], selected = page.nodes.find(node => node.id === selectedId);
  const report = error => setError(error.message);
  const apply = operations => {
    if (readOnly) return false;
    try {
      const next = applyWithInverse(content, layoutOperationsSchema.parse(operations));
      setContent(layoutDocumentSchema.parse(next.document)); setHistory(current => [...current, next.inverse]); setError(""); return true;
    } catch (error) { report(error); return false; }
  };
  const change = changes => apply([{ op: "setNode", pageId: page.id, nodeId: selected.id, changes }]);
  const choose = id => { try { control.current?.commitPending(); select(id); } catch (error) { report(error); } };
  return <main>
    <nav>
      <button onClick={() => { try { control.current?.commitPending(); setPageIndex(value => 1 - value); select(null); } catch (error) { report(error); } }}>切页</button>
      <button disabled={!history.length} onClick={() => { const next = applyWithInverse(content, history.at(-1)); setContent(next.document); setHistory(value => value.slice(0, -1)); }}>撤销</button>
      <button onClick={() => setReadOnly(value => !value)}>{readOnly ? "恢复编辑" : "只读"}</button>
      <span>{page.title}</span><span role="alert">{error}</span>
    </nav>
    <div className="harness-body">
      <LayoutCanvas page={page} selectedId={selectedId} onSelect={choose} onOperations={apply} onCommitText={apply} controllerRef={control} onError={report} readOnly={readOnly} />
      <aside aria-label="作品属性"><header>{selected?.name || "画板"}</header>
        {selected && <>
          {["x", "y", "width", "height", "rotation"].map(key => <label key={key}>{key}<input aria-label={key} type="number" value={Math.round(selected[key] * 100) / 100} disabled={readOnly || selected.locked} onChange={event => change({ [key]: Number(event.target.value) })} /></label>)}
          <button disabled={readOnly} onClick={() => change({ locked: !selected.locked })}>{selected.locked ? "解锁" : "锁定"}</button>
          <ObjectStyles node={selected} pageId={page.id} apply={apply} disabled={readOnly || selected.locked} zh />
        </>}
      </aside>
    </div>
    <details><summary>测试数据</summary><pre data-testid="content">{JSON.stringify(content)}</pre></details>
  </main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
