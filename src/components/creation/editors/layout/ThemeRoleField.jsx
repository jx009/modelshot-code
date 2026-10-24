// Small inspector control; no theme-wide work occurs until the user changes it.
export default function ThemeRoleField({ label, value, onChange, disabled, font = false, zh }) {
  const text = (cn, en) => zh ? cn : en;
  return <label>{label}<select value={value || ""} disabled={disabled} onChange={event => onChange(event.target.value)}>
    {!value && <option value="" disabled>{text("自动匹配（原有作品）", "Legacy matching")}</option>}
    <option value="custom">{text("自定义，不跟随主题", "Custom, keep unchanged")}</option>
    {font ? <option value="theme">{text("跟随主题字体", "Follow theme font")}</option> : <>
      <option value="primary">{text("主题主色", "Theme primary")}</option>
      <option value="accent">{text("主题强调色", "Theme accent")}</option>
      <option value="background">{text("主题背景色", "Theme background")}</option>
    </>}
  </select></label>;
}
