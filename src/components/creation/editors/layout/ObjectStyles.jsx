import { ImagePlus } from "lucide-react";
import { ColorField, NumberField } from "./InspectorFields";
import ThemeRoleField from "./ThemeRoleField";

// Only the selected object's inspector is mounted. Edits use the same bounded
// operation journal as canvas gestures, with no additional save requests.
export default function ObjectStyles({ node, pageId, apply, disabled, onReplaceImage, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const style = value => apply([{ op: "setTextStyle", pageId, nodeId: node.id, style: value }]);
  const shape = changes => apply([{ op: "setShapeStyle", pageId, nodeId: node.id, changes }]);
  if (node.type === "text") return <>
    <label>{text("内容", "Text")}<textarea value={node.text} maxLength={16000} disabled={disabled} onChange={event => apply([{ op: "setText", pageId, nodeId: node.id, text: event.target.value }])} /></label>
    <NumberField label={text("字号", "Font size")} value={node.style.fontSize} min={6} max={512} disabled={disabled} onChange={fontSize => style({ fontSize })} />
    <label>{text("字体", "Font")}<select value={node.style.fontFamily} disabled={disabled} onChange={event => style({ fontFamily: event.target.value })}><option value="sans">{text("无衬线", "Sans serif")}</option><option value="serif">{text("衬线", "Serif")}</option><option value="mono">{text("等宽", "Monospace")}</option></select></label>
    <ColorField label={text("文字颜色", "Text color")} value={node.style.fill} disabled={disabled} zh={zh} onChange={fill => style({ fill })} />
    <ThemeRoleField label={text("文字配色来源", "Text color source")} value={node.style.fillRole} disabled={disabled} zh={zh} onChange={fillRole => style({ fillRole })} />
    <ThemeRoleField label={text("字体来源", "Font source")} value={node.style.fontRole} font disabled={disabled} zh={zh} onChange={fontRole => style({ fontRole })} />
    <div className="cw-field-grid">
      <label>{text("水平对齐", "Horizontal align")}<select value={node.style.align} disabled={disabled} onChange={event => style({ align: event.target.value })}><option value="left">{text("左对齐", "Left")}</option><option value="center">{text("居中", "Center")}</option><option value="right">{text("右对齐", "Right")}</option></select></label>
      <label>{text("垂直对齐", "Vertical align")}<select value={node.style.verticalAlign} disabled={disabled} onChange={event => style({ verticalAlign: event.target.value })}><option value="top">{text("顶部", "Top")}</option><option value="middle">{text("居中", "Middle")}</option><option value="bottom">{text("底部", "Bottom")}</option></select></label>
      <NumberField label={text("行距倍数", "Line height")} value={node.style.lineHeight} min={.8} max={3} step={.1} disabled={disabled} onChange={lineHeight => style({ lineHeight })} />
      <NumberField label={text("字距", "Letter spacing")} value={node.style.letterSpacing} min={-20} max={100} disabled={disabled} onChange={letterSpacing => style({ letterSpacing })} />
    </div>
    <div className="cw-object-actions">
      <button disabled={disabled} aria-pressed={node.style.fontWeight === "bold"} onClick={() => style({ fontWeight: node.style.fontWeight === "bold" ? "normal" : "bold" })}>{text("加粗", "Bold")}</button>
      <button disabled={disabled} aria-pressed={node.style.fontStyle === "italic"} onClick={() => style({ fontStyle: node.style.fontStyle === "italic" ? "normal" : "italic" })}>{text("斜体", "Italic")}</button>
    </div>
  </>;
  if (node.type === "shape") return <>
    <ColorField label={text("填充颜色", "Fill")} value={node.fill} disabled={disabled} zh={zh} onChange={fill => shape({ fill })} />
    <ThemeRoleField label={text("填充配色来源", "Fill color source")} value={node.fillRole} disabled={disabled} zh={zh} onChange={fillRole => shape({ fillRole })} />
    <ColorField label={text("描边颜色", "Stroke")} value={node.stroke} disabled={disabled} zh={zh} onChange={stroke => shape({ stroke })} />
    <ThemeRoleField label={text("描边配色来源", "Stroke color source")} value={node.strokeRole} disabled={disabled} zh={zh} onChange={strokeRole => shape({ strokeRole })} />
    <NumberField label={text("描边宽度", "Stroke width")} value={node.strokeWidth} min={0} max={64} disabled={disabled} onChange={strokeWidth => shape({ strokeWidth })} />
    {node.shape === "rectangle" && <NumberField label={text("圆角", "Corner radius")} value={node.radius} min={0} max={512} disabled={disabled} onChange={radius => shape({ radius })} />}
  </>;
  if (node.type === "image") return <>
    <label>{text("图片适配", "Image fit")}<select value={node.fit} disabled={disabled} onChange={event => apply([{ op: "setImageStyle", pageId, nodeId: node.id, changes: { fit: event.target.value } }])}>
      <option value="contain">{text("完整显示", "Contain")}</option><option value="cover">{text("填满并裁切", "Cover")}</option><option value="stretch">{text("拉伸填满", "Stretch")}</option>
    </select></label>
    <button disabled={disabled} onClick={onReplaceImage}><ImagePlus size={15} />{text("替换图片", "Replace image")}</button>
  </>;
  return null;
}
