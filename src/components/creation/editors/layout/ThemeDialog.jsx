import { useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { ColorField } from "./InspectorFields";
import { layoutFonts } from "@/lib/creation/layout-rendering";

const presets = [
  { names: ["简洁蓝", "Clear blue"], primary: "#172554", accent: "#2563eb", background: "#ffffff", fontFamily: "sans" },
  { names: ["暖调咖啡", "Warm coffee"], primary: "#35251b", accent: "#b87940", background: "#fff8ed", fontFamily: "serif" },
  { names: ["森林", "Forest"], primary: "#163d32", accent: "#368667", background: "#f3f8f2", fontFamily: "sans" },
  { names: ["暗夜紫", "Night violet"], primary: "#f2efff", accent: "#a78bfa", background: "#1c1633", fontFamily: "sans" },
];

export default function ThemeDialog({ theme, pageCount, onApply, onClose, readOnly, zh }) {
  const [draft, setDraft] = useState(() => ({ ...theme }));
  const text = (cn, en) => zh ? cn : en;
  const update = patch => setDraft(current => ({ ...current, ...patch }));
  return <Modal className="cw-theme-dialog" label={text("作品主题", "Artwork theme")} onClose={onClose}>
    <header><strong>{text("作品主题", "Artwork theme")}</strong><button aria-label={text("关闭主题设置", "Close theme settings")} onClick={onClose}><X size={18} /></button></header>
    <div className="cw-theme-content">
      <div className="cw-theme-presets" role="group" aria-label={text("预设配色", "Color presets")}>
        {presets.map(({ names, ...value }) => <button key={names[1]} disabled={readOnly} onClick={() => setDraft({ ...value, name: names[zh ? 0 : 1] })}>
          <span className="cw-theme-swatches" aria-hidden="true">{[value.primary, value.accent, value.background].map(color => <i key={color} style={{ background: color }} />)}</span>{names[zh ? 0 : 1]}
        </button>)}
      </div>
      <div className="cw-theme-preview" style={{ background: draft.background, color: draft.primary, fontFamily: layoutFonts[draft.fontFamily] }} aria-hidden="true"><strong>{text("让创意清晰呈现", "Bring ideas to life")}</strong><span style={{ background: draft.accent }} /></div>
      <div className="cw-theme-fields">
        <label>{text("主题名称", "Theme name")}<input maxLength={100} value={draft.name} disabled={readOnly} onChange={event => update({ name: event.target.value })} /></label>
        <ColorField label={text("主色", "Primary")} value={draft.primary} disabled={readOnly} zh={zh} onChange={primary => update({ primary })} />
        <ColorField label={text("强调色", "Accent")} value={draft.accent} disabled={readOnly} zh={zh} onChange={accent => update({ accent })} />
        <ColorField label={text("背景色", "Background")} value={draft.background} disabled={readOnly} zh={zh} onChange={background => update({ background })} />
        <label>{text("主题字体", "Theme font")}<select value={draft.fontFamily} disabled={readOnly} onChange={event => update({ fontFamily: event.target.value })}><option value="sans">{text("无衬线", "Sans serif")}</option><option value="serif">{text("衬线", "Serif")}</option><option value="mono">{text("等宽", "Monospace")}</option></select></label>
      </div>
      <p>{text(`应用于全部 ${pageCount} 页。跟随已指定的主题色与字体，保留自定义样式、图片和锁定对象。原有作品未指定来源时仍按颜色匹配；无法区分用途的相同颜色保持原样。`, `Applies to all ${pageCount} pages. Follows assigned theme colors and fonts; preserves custom styles, images and locked objects. Legacy objects use color matching; ambiguous shared colors stay unchanged.`)}</p>
    </div>
    <footer><button onClick={onClose}>{text("取消", "Cancel")}</button><button disabled={readOnly} onClick={() => onApply(draft)}>{text("应用到整个作品", "Apply to artwork")}</button></footer>
  </Modal>;
}
