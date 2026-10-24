import { z } from "zod";
export const htmlChartSchema = z.object({
  type: z.enum(["bar", "line", "pie"]), title: z.string().max(160).default(""),
  labels: z.array(z.string().max(120)).min(1).max(100),
  series: z.array(z.object({ name: z.string().max(120), values: z.array(z.number().finite()).min(1).max(100), color: z.string().regex(/^#[a-fA-F0-9]{6}$/) }).strict()).min(1).max(10),
}).strict().superRefine((chart, ctx) => {
  if (chart.series.some(series => series.values.length !== chart.labels.length) || chart.type === "pie" && (chart.series.length !== 1 || chart.series[0].values.some(value => value < 0) || chart.series[0].values.every(value => value === 0))) ctx.addIssue({ code: "custom", message: "HTML_CHART_DATA_INVALID" });
});
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
export function chartSvg(input) {
  const chart = htmlChartSchema.parse(input), W = 640, H = 360, left = 50, top = 50, width = 550, height = 250;
  const values = chart.series.flatMap(s => s.values), min = Math.min(0, ...values), max = Math.max(1, ...values), y = value => top + height * (max - value) / (max - min), zero = y(0);
  let shapes = "";
  if (chart.type === "pie") {
    const total = chart.series[0].values.reduce((a, b) => a + b, 0); let start = -Math.PI / 2;
    const colors = [chart.series[0].color, "#E9B872", "#8AB0AB", "#BC96E6", "#D66BA0", "#6B9AC4"];
    chart.series[0].values.forEach((value, index) => { const end = start + value / total * Math.PI * 2, x1 = 270 + 115 * Math.cos(start), y1 = 185 + 115 * Math.sin(start), x2 = 270 + 115 * Math.cos(end), y2 = 185 + 115 * Math.sin(end); shapes += value === total ? `<circle cx="270" cy="185" r="115" fill="${colors[index % colors.length]}"/>` : `<path d="M270 185 L${x1} ${y1} A115 115 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z" fill="${colors[index % colors.length]}"/>`; shapes += `<text x="420" y="${65 + index * 22}" font-size="14" fill="${colors[index % colors.length]}">${escape(chart.labels[index])}: ${value}</text>`; start = end; });
  } else {
    shapes += `<path d="M${left} ${top}V${top + height}H${left + width} M${left} ${zero}H${left + width}" fill="none" stroke="#b8b8b8"/>`;
    const stride = width / chart.labels.length;
    chart.series.forEach((series, seriesIndex) => {
      if (chart.type === "line") shapes += `<polyline points="${series.values.map((v, i) => `${left + stride * (i + .5)},${y(v)}`).join(" ")}" fill="none" stroke="${series.color}" stroke-width="3"/>`;
      else series.values.forEach((value, index) => { const barWidth = stride * .7 / chart.series.length; shapes += `<rect x="${left + stride * index + stride * .15 + seriesIndex * barWidth}" y="${Math.min(y(value), zero)}" width="${barWidth}" height="${Math.max(.5, Math.abs(zero - y(value)))}" fill="${series.color}"/>`; });
    });
    chart.labels.forEach((label, index) => { shapes += `<text x="${left + stride * (index + .5)}" y="328" text-anchor="middle" font-size="12">${escape(label)}</text>`; });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="${escape(chart.title)}"><text x="32" y="28" font-size="20" font-weight="bold">${escape(chart.title)}</text>${shapes}</svg>`;
}
