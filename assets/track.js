/* Order tracking page: reference + phone verification. */
(() => {
  'use strict';

  const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    ready_for_collection: 'Ready for Collection',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  const form = document.getElementById('trackForm');
  const result = document.getElementById('trackResult');
  const feedback = document.getElementById('trackFeedback');
  const orderInput = document.getElementById('orderNo');
  const phoneInput = document.getElementById('phone');

  const params = new URLSearchParams(location.search);
  const preset = params.get('order');
  if (preset) orderInput.value = preset.toUpperCase();

  const fmt = (iso) => new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Nairobi',
  });

  function setError(id, field, message) {
    const box = document.getElementById(id);
    if (box) box.textContent = message || '';
    if (field) field.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function render(order) {
    const flow = order.fulfilment === 'collection'
      ? ['pending', 'confirmed', 'processing', 'ready_for_collection', 'completed']
      : ['pending', 'confirmed', 'processing', 'out_for_delivery', 'completed'];
    const current = flow.indexOf(order.status);
    const cancelled = order.status === 'cancelled';

    const steps = cancelled
      ? ''
      : `<ul class="track-steps">${flow.map((s, i) => {
        const cls = i < current ? 'done' : i === current ? 'now' : '';
        return `<li class="${cls}">${LABELS[s]}</li>`;
      }).join('')}</ul>`;

    const history = (order.history || []).slice().reverse().map((h) => `
      <li class="done">
        <span class="dot" aria-hidden="true"></span>
        <div><b>${esc(LABELS[h.status] || h.status)}</b><span>${esc(fmt(h.at))}${h.note ? ` — ${esc(h.note)}` : ''}</span></div>
      </li>`).join('');

    result.innerHTML = `
      <div class="track-head">
        <div>
          <p class="track-ref">${esc(order.orderNo)}</p>
          <p class="track-meta">Placed ${esc(fmt(order.createdAt))} (Nairobi time)</p>
        </div>
        <span class="pill pill-${esc(order.status)}">${esc(LABELS[order.status] || order.status)}</span>
      </div>
      ${steps}
      <div class="track-items">
        ${order.items.map((i) => `<div><span>${esc(i.name)} × ${i.quantity}</span><span>${money(i.lineTotal)}</span></div>`).join('')}
        <div><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
        <div><span>Delivery fee</span><span>${money(order.deliveryFee)}</span></div>
        <div class="tcc-grand"><span>Total</span><span>${money(order.total)}</span></div>
      </div>
      <div class="track-items">
        <div><span>Fulfilment</span><span>${order.fulfilment === 'delivery' ? 'Delivery' : 'Collection'}</span></div>
        <div><span>Location</span><span>${esc(order.deliveryLocation || '—')}</span></div>
        <div><span>Payment</span><span>${esc(order.paymentMethod.replace(/_/g, ' '))} · ${esc(order.paymentStatus)}</span></div>
        ${order.notes ? `<div><span>Instructions</span><span>${esc(order.notes)}</span></div>` : ''}
      </div>
      <div>
        <h4 style="font-size:.95rem;margin-bottom:.4rem">Order history</h4>
        <ul class="track-timeline">${history || '<li><div><b>No updates yet</b></div></li>'}</ul>
      </div>
      <a class="btn btn-wa" href="https://wa.me/254726777924?text=${encodeURIComponent(`Hello Tabitha Chicken Company, I would like an update on order ${order.orderNo}.`)}" target="_blank" rel="noopener">Ask about this order on WhatsApp</a>`;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.className = 'tcc-feedback';
    feedback.textContent = '';
    setError('errOrderNo', orderInput, '');
    setError('errPhone', phoneInput, '');

    const orderNo = orderInput.value.trim().toUpperCase();
    const phone = phoneInput.value.trim();
    let ok = true;
    if (!orderNo) { setError('errOrderNo', orderInput, 'Enter your order reference.'); ok = false; }
    if (!/^(?:\+?254|0)?[17]\d{8}$/.test(phone.replace(/[\s-]/g, ''))) {
      setError('errPhone', phoneInput, 'Enter the phone number you ordered with.'); ok = false;
    }
    if (!ok) return;

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const res = await fetch('/api/orders/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'We could not find that order.');
      render(data.order);
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      feedback.className = 'tcc-feedback show bad';
      feedback.textContent = err.message || 'We could not check that order. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Check order status';
    }
  });
})();
