// AM Restaurant RMIS — Stock Adjustment page (Sprint 2).
// Manager/Admin record damage, spoilage, returns, or manual corrections.
//   - each adjustment: ingredient, type, effect (+/-), quantity, reason, date
//   - stock can never be driven below zero (server enforces; UI surfaces error)
//   - the selected ingredient's adjustment history is shown below the form
// Page + API are gated to Admin/Manager (server-side); Staff/Cashier get 403.

(async () => {
  const { esc, fmt, shortDate, api, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;

  const sel = document.getElementById('adj-ingredient');
  const onhand = document.getElementById('adj-onhand');
  const form = document.getElementById('adj-form');
  const historyBody = document.getElementById('adj-history');
  const historyEmpty = document.getElementById('history-empty');
  const historyHead = document.getElementById('history-head');

  // Today's date, display-only (adjustments are stamped server-side).
  document.getElementById('adj-date').value = new Date().toLocaleDateString('en-US',
    { year: 'numeric', month: 'short', day: 'numeric' });

  let ingredients = [];

  async function loadIngredients() {
    const { data } = await api('GET', '/api/ingredients');
    ingredients = data.ingredients || [];
    sel.innerHTML = '<option value="">&mdash; select ingredient &mdash;</option>' +
      ingredients.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  }

  function selectedIngredient() {
    return ingredients.find((i) => i.id === Number(sel.value));
  }

  function showOnHand() {
    const it = selectedIngredient();
    onhand.textContent = it ? `On hand: ${fmt(it.quantity)} ${it.unit}` : '';
  }

  async function loadHistory() {
    const it = selectedIngredient();
    if (!it) {
      historyBody.innerHTML = '';
      historyEmpty.hidden = false;
      historyHead.textContent = 'Adjustment history';
      return;
    }
    historyHead.textContent = `Adjustment history — ${it.name}`;
    const { data } = await api('GET', `/api/ingredients/${it.id}`);
    const adj = (data.transactions || []).filter((t) => t.type === 'adjustment');
    if (!adj.length) {
      historyBody.innerHTML = '';
      historyEmpty.textContent = 'No adjustments recorded for this ingredient yet.';
      historyEmpty.hidden = false;
      return;
    }
    historyEmpty.hidden = true;
    historyBody.innerHTML = adj.map((t) => {
      const sign = t.quantity > 0 ? '+' : '';
      return `<tr>
        <td>${shortDate(t.createdAt)}</td>
        <td>${esc(t.adjustmentType)}</td>
        <td class="num">${sign}${fmt(t.quantity)}</td>
        <td>${esc(t.reason || '')}</td>
        <td>${esc(t.user)}</td>
      </tr>`;
    }).join('');
  }

  // Sensible default direction per type (spoilage/damage/return reduce stock).
  document.getElementById('adj-type').addEventListener('change', (e) => {
    const dir = document.getElementById('adj-direction');
    if (['damage', 'spoilage', 'return'].includes(e.target.value)) dir.value = 'decrease';
  });

  sel.addEventListener('change', () => { showOnHand(); loadHistory(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const it = selectedIngredient();
    const errEl = document.getElementById('adj-err');
    errEl.textContent = '';
    if (!it) { errEl.textContent = 'Select an ingredient.'; return; }
    const payload = {
      adjustmentType: form.adjustmentType.value,
      direction: form.direction.value,
      quantity: Number(form.quantity.value),
      reason: form.reason.value,
    };
    document.getElementById('adj-submit').disabled = true;
    const { ok, data } = await api('POST', `/api/ingredients/${it.id}/adjustments`, payload);
    document.getElementById('adj-submit').disabled = false;
    if (!ok) { errEl.textContent = data.message || 'Adjustment failed.'; return; }

    const u = data.ingredient;
    notice('page-notice', 'ok',
      `Recorded ${esc(payload.adjustmentType)} adjustment for <strong>${esc(u.name)}</strong>. New on-hand: ${fmt(u.quantity)} ${esc(u.unit)}.`);
    form.reset();
    document.getElementById('adj-date').value = new Date().toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric' });
    // Refresh cached quantities + history.
    await loadIngredients();
    sel.value = String(u.id);
    showOnHand();
    await loadHistory();
  });

  await loadIngredients();
  historyEmpty.hidden = false;
})();
