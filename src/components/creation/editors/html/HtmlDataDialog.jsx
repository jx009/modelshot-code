"use client";
import { useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { htmlChartSchema, chartSvg } from "@/lib/creation/html/chart";

const defaultChart = { type: "bar", title: "销售额", labels: ["一月", "二月", "三月"], series: [{ name: "销售额", values: [120, 180, 240], color: "#6859d5" }] };
export default function HtmlDataDialog({ kind, html, onApply, onClose, zh = true }) {
  const t = (cn, en) => zh ? cn : en;
  const original = useMemo(() => html ? new DOMParser().parseFromString(html, "text/html").body.firstElementChild : null, [html]);
  const [chart, setChart] = useState(() => original?.hasAttribute("data-chart") ? htmlChartSchema.parse(JSON.parse(original.getAttribute("data-chart"))) : defaultChart);
  const [rows, setRows] = useState(() => original?.tagName === "TABLE" ? [...original.rows].map(row => [...row.cells].map(cell => ({ text: cell.textContent, colSpan: cell.colSpan, rowSpan: cell.rowSpan }))) : Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => ({ text: r === 0 ? `${t("列", "Column")} ${c + 1}` : "", colSpan: 1, rowSpan: 1 }))));
  const [error, setError] = useState("");
  function submit() {
    try {
      if (kind === "chart") {
        const value = htmlChartSchema.parse(chart), node = original?.cloneNode(true) || document.createElement("div");
        if (!original) node.style.cssText = "position:absolute;left:80px;top:120px;width:640px;height:360px";
        node.setAttribute("data-chart", JSON.stringify(value)); node.innerHTML = chartSvg(value); onApply(node.outerHTML);
      } else {
        const node = original?.cloneNode(true) || document.createElement("table");
        if (original) rows.forEach((row, r) => row.forEach((cell, c) => { node.rows[r].cells[c].textContent = cell.text; }));
        else {
          node.style.cssText = "position:absolute;left:80px;top:120px;width:560px;border-collapse:collapse;font-size:24px";
          rows.forEach(row => { const tr = node.insertRow(); row.forEach(cell => { const td = tr.insertCell(); td.textContent = cell.text; td.style.cssText = "border:1px solid #aaa;padding:12px;min-width:60px"; }); });
        }
        onApply(node.outerHTML);
      }
    } catch (e) { setError(e.message); }
  }
  return <Modal label={t(kind === "table" ? "表格数据" : "图表数据", kind === "table" ? "Table data" : "Chart data")} className="cw-html-data" onClose={onClose}>
    <header><strong>{t(kind === "table" ? "表格数据" : "图表数据", kind === "table" ? "Table data" : "Chart data")}</strong><button onClick={onClose}>{t("关闭", "Close")}</button></header>
    {kind === "chart" ? <>
      <label>{t("标题", "Title")}<input value={chart.title} maxLength={160} onChange={e => setChart({ ...chart, title: e.target.value })} /></label>
      <label>{t("类型", "Type")}<select value={chart.type} onChange={e => setChart({ ...chart, type: e.target.value, series: e.target.value === "pie" ? chart.series.slice(0, 1) : chart.series })}><option value="bar">{t("柱状图", "Bar")}</option><option value="line">{t("折线图", "Line")}</option><option value="pie">{t("饼图", "Pie")}</option></select></label>
      <div className="cw-html-data-grid"><table><thead><tr><th>{t("分类", "Category")}</th>{chart.series.map((series, s) => <th key={s}><input aria-label={`${t("系列", "Series")} ${s + 1}`} value={series.name} maxLength={120} onChange={e => setChart({ ...chart, series: chart.series.map((v, i) => i === s ? { ...v, name: e.target.value } : v) })} /><input type="color" aria-label={`${t("颜色", "Color")} ${s + 1}`} value={series.color} onChange={e => setChart({ ...chart, series: chart.series.map((v, i) => i === s ? { ...v, color: e.target.value } : v) })} /></th>)}</tr></thead><tbody>{chart.labels.map((label, r) => <tr key={r}><td><input aria-label={`Category ${r + 1}`} value={label} maxLength={120} onChange={e => setChart({ ...chart, labels: chart.labels.map((v, i) => i === r ? e.target.value : v) })} /></td>{chart.series.map((series, s) => <td key={s}><input aria-label={`Value ${r + 1},${s + 1}`} type="number" value={series.values[r]} onChange={e => setChart({ ...chart, series: chart.series.map((v, i) => i === s ? { ...v, values: v.values.map((n, j) => j === r ? Number(e.target.value) : n) } : v) })} /></td>)}</tr>)}</tbody></table></div>
      <button disabled={chart.labels.length >= 100} onClick={() => setChart({ ...chart, labels: [...chart.labels, ""], series: chart.series.map(s => ({ ...s, values: [...s.values, 0] })) })}>{t("添加分类", "Add category")}</button>
      <button disabled={chart.labels.length < 2} onClick={() => setChart({ ...chart, labels: chart.labels.slice(0, -1), series: chart.series.map(s => ({ ...s, values: s.values.slice(0, -1) })) })}>{t("删除末行", "Remove last row")}</button>
      <button disabled={chart.type === "pie" || chart.series.length >= 10} onClick={() => setChart({ ...chart, series: [...chart.series, { name: t("新系列", "New series"), color: "#cb853e", values: chart.labels.map(() => 0) }] })}>{t("添加系列", "Add series")}</button>
      <button disabled={chart.series.length < 2} onClick={() => setChart({ ...chart, series: chart.series.slice(0, -1) })}>{t("删除末系列", "Remove last series")}</button>
    </> : <><div className="cw-html-data-grid"><table><tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} colSpan={cell.colSpan} rowSpan={cell.rowSpan}><textarea aria-label={`Cell ${r + 1},${c + 1}`} value={cell.text} maxLength={4000} onChange={e => setRows(rows.map((v, i) => i === r ? v.map((n, j) => j === c ? { ...n, text: e.target.value } : n) : v))} /></td>)}</tr>)}</tbody></table></div>{!original && <><button disabled={rows.length >= 30} onClick={() => setRows([...rows, rows[0].map(() => ({ text: "", colSpan: 1, rowSpan: 1 }))])}>{t("添加行", "Add row")}</button><button disabled={rows[0].length >= 16} onClick={() => setRows(rows.map(row => [...row, { text: "", colSpan: 1, rowSpan: 1 }]))}>{t("添加列", "Add column")}</button></>}</>}
    {error && <p role="alert">{t("数据无效，请检查数值、分类和系列。", "Check values, categories and series.")}</p>}<footer><button onClick={submit}>{t("应用", "Apply")}</button></footer>
  </Modal>;
}
