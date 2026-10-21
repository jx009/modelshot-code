export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items);
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Math.min(values.length, Math.max(1, Math.floor(concurrency) || 1));

  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(values[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));

  return results;
}
