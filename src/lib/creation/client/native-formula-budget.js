export const NATIVE_FORMULA_BUDGET_EVENT = "modelshot-univer-formula-budget-1";
const prefix = "formula.mutation.";
const start = new Map([[`${prefix}set-formula-calculation-start`, "workbook"], [`${prefix}set-formula-string-batch-calculation`, "batch"]]);

// Emit before the engine can enter synchronous calculation. The enforcing timer
// belongs to the main thread, so a blocked formula worker cannot stop its timer.
// Progress/repeated requests never renew an already-active calculation budget.
export function observeNativeFormulaBudget(api, post) {
  const active = new Set();
  const publish = () => post({ type: NATIVE_FORMULA_BUDGET_EVENT, active: active.size > 0 });
  const before = api.addEvent(api.Event.BeforeCommandExecute, event => {
    const lane = start.get(event.id);
    if (lane && !active.has(lane)) { active.add(lane); publish(); }
  });
  const after = api.addEvent(api.Event.CommandExecuted, event => {
    let lane;
    if (event.id === `${prefix}set-formula-string-batch-calculation-result`) lane = "batch";
    else if (event.id === `${prefix}set-formula-calculation-notification` && [1, 2, 3].includes(event.params?.functionsExecutedState)) lane = "workbook";
    if (lane && active.delete(lane)) publish();
  });
  return { dispose() { before.dispose(); after.dispose(); active.clear(); } };
}
