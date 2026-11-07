export default function VideoModelFields({ offer, value = {}, onChange, disabled, zh }) {
  if (!offer?.fields?.length) return null;
  return <div className="space-y-2">{offer.fields.map(field => <label key={field.key} className="block text-xs text-secondary-text">{zh ? field.label : field.key}
    <input className="block w-full rounded border border-divider bg-bg-page p-2 text-primary-text" disabled={disabled} maxLength={1000} value={value[field.key] || ""} placeholder={offer.configuredFields?.includes(field.key) ? zh ? "留空使用已配置的值" : "Use configured value" : ""} onChange={event => onChange({ ...value, [field.key]: event.target.value })} />
  </label>)}</div>;
}
