// Fetch one extra row so pagination remains accurate after hiding zero entries.
// Raw ledger reasons can contain internal IDs and are never sent to this UI.
export async function accountRecords(userId, { page = 1, tab = "all" } = {}, db) {
  const orderSize = 20, usageSize = 30;
  const [orderRows, transactionRows] = await Promise.all([
    tab === "usage" ? [] : db.order.findMany({
      where: { userId, type: "credits" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: orderSize + 1, skip: (page - 1) * orderSize,
      select: { id: true, amountMinor: true, refundedMinor: true, currency: true, status: true, createdAt: true },
    }),
    tab === "orders" ? [] : db.creditTransaction.findMany({
      where: { userId, amount: { not: 0 } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: usageSize + 1, skip: (page - 1) * usageSize,
      select: { id: true, type: true, channel: true, amount: true, tryOnId: true, createdAt: true },
    }),
  ]);
  const orders = orderRows.slice(0, orderSize), transactions = transactionRows.slice(0, usageSize);
  const taskIds = [...new Set(transactions.map(row => row.tryOnId).filter(Boolean))];
  const [credits, tasks] = await Promise.all([
    orders.length ? db.creditTransaction.groupBy({
      by: ["reason"], where: { userId, channel: "credits", type: { in: ["purchase", "payment_refund"] }, reason: { in: orders.map(row => row.id) } },
      _sum: { amount: true },
    }) : [],
    taskIds.length ? db.tryOn.findMany({ where: { userId, id: { in: taskIds } }, select: { id: true, snapshot: true } }) : [],
  ]);
  const creditsByOrder = new Map(credits.map(row => [row.reason, row._sum.amount || 0]));
  const tasksById = new Map(tasks.map(row => [row.id, row]));
  return {
    orders: orders.map(row => ({ ...row, creditedCredits: ["paid", "refunded"].includes(row.status) ? Math.max(0, creditsByOrder.get(row.id) || 0) : 0 })),
    transactions: transactions.map(({ tryOnId, ...row }) => {
      const task = tasksById.get(tryOnId), snapshot = task?.snapshot || {};
      const operation = task ? snapshot.tool || (snapshot.kind === "language" ? snapshot.purpose : !snapshot.kind ? "generate" : null) : null;
      const resolution = ["1K", "2K", "4K"].includes(snapshot.pricing?.resolution) ? snapshot.pricing.resolution : null;
      return { ...row, operation, resolution };
    }),
    pagination: { orders: { hasMore: orderRows.length > orderSize }, usage: { hasMore: transactionRows.length > usageSize } },
    page,
  };
}
