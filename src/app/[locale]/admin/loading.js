export default function AdminLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="正在加载后台页面">
      <div className="h-5 w-28 rounded bg-bg-card animate-pulse" />
      <div className="h-3 w-96 max-w-full rounded bg-bg-card animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(index => <div key={index} className="h-36 rounded-[14px] border border-divider bg-bg-card animate-pulse" />)}
      </div>
    </div>
  );
}
