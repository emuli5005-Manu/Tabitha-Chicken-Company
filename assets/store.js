/* ==========================================================================
   Tabitha Chicken Company - shopping cart, checkout and order confirmation.
   Prices shown here are illustrative; the server recalculates every total.
   ========================================================================== */
(() => {
  'use strict';

  const CART_KEY = 'tcc.cart.v1';
  const LAST_ORDER_KEY = 'tcc.lastOrder.v1';
  const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  let products = [];
  let config = { deliveryFee: 150, business: {} };
  let cart = loadCart();
  let fulfilment = 'delivery';
  let submitting = false;
  let idempotencyKey = newId();
  let lastFocus = null;
  let toastTimer = null;

  function newId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(raw)
        ? raw.filter((i) => i && Number(i.productId) > 0 && Number(i.quantity) > 0)
          .map((i) => ({ productId: Number(i.productId), quantity: Math.min(Number(i.quantity), 99) }))
        : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* storage unavailable - cart still works for this page view */
    }
  }

  const findProduct = (id) => products.find((p) => p.id === Number(id));
  const lines = () => cart
    .map((item) => {
      const product = findProduct(item.productId);
      if (!product) return null;
      return { ...item, product, lineTotal: Number(product.price) * item.quantity };
    })
    .filter(Boolean);
  const subtotal = () => lines().reduce((sum, l) => sum + l.lineTotal, 0);
  const deliveryFee = () => (fulfilment === 'delivery' ? Number(config.deliveryFee || 0) : 0);
  const grandTotal = () => subtotal() + deliveryFee();
  const itemCount = () => cart.reduce((n, i) => n + i.quantity, 0);

  /* ------------------------------------------------------------------ DOM */
  const drawerHtml = `
    <div class="tcc-overlay" id="tccOverlay"></div>
    <aside class="tcc-drawer" id="tccDrawer" role="dialog" aria-modal="true" aria-labelledby="tccDrawerTitle" aria-hidden="true">
      <div class="tcc-drawer-head">
        <h2 id="tccDrawerTitle">Your cart</h2>
        <button class="tcc-close" id="tccClose" type="button" aria-label="Close cart">✕</button>
      </div>
      <div class="tcc-drawer-body">
        <div id="tccItems"></div>
        <form class="tcc-checkout" id="tccForm" novalidate>
          <h3 class="tcc-sec-title">Checkout details</h3>
          <div class="tcc-feedback" id="tccFeedback" role="alert"></div>
          <div class="tcc-field">
            <label for="tccName">Full name</label>
            <input id="tccName" name="name" autocomplete="name" required>
            <div class="err" id="tccErrName"></div>
          </div>
          <div class="tcc-field">
            <label for="tccPhone">Phone number</label>
            <input id="tccPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required>
            <div class="err" id="tccErrPhone"></div>
          </div>
          <div class="tcc-field">
            <label for="tccEmail">Email address <em>(optional)</em></label>
            <input id="tccEmail" name="email" type="email" autocomplete="email">
            <div class="err" id="tccErrEmail"></div>
          </div>
          <div class="tcc-field">
            <label>How would you like to receive your order?</label>
            <div class="tcc-seg" role="radiogroup" aria-label="Fulfilment">
              <label><input type="radio" name="fulfilment" value="delivery" checked>Delivery</label>
              <label><input type="radio" name="fulfilment" value="collection">Collection</label>
            </div>
          </div>
          <div class="tcc-field" id="tccLocationWrap">
            <label for="tccLocation">Delivery location</label>
            <input id="tccLocation" name="location" placeholder="Village, town or landmark">
            <div class="err" id="tccErrLocation"></div>
          </div>
          <div class="tcc-field">
            <label for="tccNotes">Additional instructions <em>(optional)</em></label>
            <textarea id="tccNotes" name="notes" rows="2" placeholder="E.g. cut into pieces, call before delivery"></textarea>
          </div>
          <div class="tcc-field">
            <label for="tccPay">Payment method</label>
            <select id="tccPay" name="payment"></select>
            <p class="tcc-hint" id="tccPayHint">M-Pesa payments are coming soon. No online payment is taken on this website.</p>
          </div>
        </form>
      </div>
      <div class="tcc-drawer-foot" id="tccFoot">
        <div class="tcc-foot-row"><span>Total</span><strong id="tccFootTotal">KES 0</strong></div>
        <button class="btn btn-green" id="tccPlace" type="button">Place order</button>
        <p class="note">Your order is saved as pending. It is confirmed once we reply on WhatsApp.</p>
      </div>
    </aside>
    <div class="tcc-confirm" id="tccConfirm" role="dialog" aria-modal="true" aria-labelledby="tccConfirmTitle"></div>
    <div class="tcc-toast" id="tccToast" role="status" aria-live="polite"></div>`;

  document.body.insertAdjacentHTML('beforeend', drawerHtml);

  const $ = (id) => document.getElementById(id);
  const itemsEl = $('tccItems');
  const form = $('tccForm');
  const feedback = $('tccFeedback');
  const placeBtn = $('tccPlace');
  const footEl = $('tccFoot');
  const overlay = $('tccOverlay');
  const drawer = $('tccDrawer');
  const confirmEl = $('tccConfirm');
  const toastEl = $('tccToast');
  const paySelect = $('tccPay');
  const locationWrap = $('tccLocationWrap');
  const locationInput = $('tccLocation');

  /* --------------------------------------------------------------- render */
  function renderCart() {
    const count = itemCount();
    document.querySelectorAll('.tcc-cart-count').forEach((el) => {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
    const cartBtn = $('cartBtn');
    if (cartBtn) cartBtn.setAttribute('aria-label', count ? `Open cart, ${count} item${count > 1 ? 's' : ''}` : 'Open cart');

    const rows = lines();
    if (!rows.length) {
      itemsEl.innerHTML = `
        <div class="tcc-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 7h12l-1.4 12H7.4L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
          <p><strong>Your cart is empty.</strong><br>Add a chicken product to start your order.</p>
          <button class="btn btn-green" type="button" data-action="browse">Browse products</button>
        </div>`;
      form.hidden = true;
      footEl.hidden = true;
      totalsEl.hidden = true;
      // Set display explicitly as well: these blocks declare their own display
      // in CSS, which would otherwise override the `hidden` attribute.
      form.style.display = 'none';
      footEl.style.display = 'none';
      totalsEl.style.display = 'none';
      return;
    }

    form.hidden = false;
    footEl.hidden = false;
    totalsEl.hidden = false;
    form.style.display = '';
    footEl.style.display = '';
    totalsEl.style.display = '';
    itemsEl.innerHTML = rows.map((line) => {
      const p = line.product;
      const max = Math.min(Number(p.stock) || 0, 99);
      return `
        <div class="tcc-line" data-product="${p.id}">
          <img class="tcc-line-img" src="${esc(p.image || '')}" alt="" width="62" height="62" loading="lazy">
          <div>
            <p class="tcc-line-name">${esc(p.name)}</p>
            <p class="tcc-line-meta">${money(p.price)}${p.unit ? ` <span>${esc(p.unit)}</span>` : ''}</p>
            <button class="tcc-remove" type="button" data-action="remove" data-product="${p.id}">Remove</button>
          </div>
          <div class="tcc-line-right">
            <div class="tcc-stepper">
              <button type="button" data-action="dec" data-product="${p.id}" aria-label="Decrease quantity of ${esc(p.name)}" ${line.quantity <= 1 ? 'disabled' : ''}>−</button>
              <span aria-live="polite">${line.quantity}</span>
              <button type="button" data-action="inc" data-product="${p.id}" aria-label="Increase quantity of ${esc(p.name)}" ${line.quantity >= max ? 'disabled' : ''}>+</button>
            </div>
            <div class="tcc-line-total">${money(line.lineTotal)}</div>
          </div>
        </div>`;
    }).join('');

    updateTotals();
  }

  function updateTotals() {
    const sub = subtotal();
    const fee = deliveryFee();
    const rows = `
      <div><span>Subtotal</span><span>${money(sub)}</span></div>
      <div${fee ? '' : ' hidden'}><span>Delivery fee</span><span>${money(fee)}</span></div>
      <div class="tcc-grand"><span>Total</span><span>${money(sub + fee)}</span></div>`;
    const totals = document.getElementById('tccTotals');
    if (totals) totals.innerHTML = rows;
    $('tccFootTotal').textContent = money(sub + fee);
    placeBtn.disabled = submitting || itemCount() === 0 || !sub;
  }

  function totalsBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'tcc-totals';
    wrap.id = 'tccTotals';
    return wrap;
  }
  // Totals sit just above the sticky footer inside the scrolling body.
  const totalsEl = totalsBlock();
  $('tccForm').before(totalsEl);

  /* ---------------------------------------------------------- cart actions */
  function addToCart(product, quantity = 1) {
    if (!product || !product.id) return;
    const stock = Math.min(Number(product.stock) || 0, 99);
    if (!product.available || stock < 1) {
      toast(`${product.name} is currently out of stock.`);
      return;
    }
    const existing = cart.find((i) => i.productId === Number(product.id));
    const wanted = (existing ? existing.quantity : 0) + Math.max(1, Number(quantity) || 1);
    if (wanted > stock) toast(`Only ${stock} available - we added the rest to your cart.`);
    const next = Math.min(wanted, stock);
    if (existing) existing.quantity = next;
    else cart.push({ productId: Number(product.id), quantity: next });
    saveCart();
    renderCart();
    openDrawer();
  }

  itemsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'browse') {
      closeDrawer();
      document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const id = Number(btn.dataset.product);
    const item = cart.find((i) => i.productId === id);
    if (!item) return;
    const product = findProduct(id);
    if (action === 'inc') {
      const max = Math.min(Number(product?.stock) || 99, 99);
      if (item.quantity >= max) {
        toast(`Only ${max} in stock.`);
        return;
      }
      item.quantity += 1;
    } else if (action === 'dec') {
      item.quantity -= 1;
      if (item.quantity < 1) cart = cart.filter((i) => i.productId !== id);
    } else if (action === 'remove') {
      cart = cart.filter((i) => i.productId !== id);
    }
    saveCart();
    renderCart();
  });

  /* -------------------------------------------------------- open / close */
  function openDrawer() {
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tcc-locked');
    $('tccClose').focus({ preventScroll: true });
  }

  function closeDrawer() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (!confirmEl.classList.contains('open')) document.body.classList.remove('tcc-locked');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }

  $('cartBtn')?.addEventListener('click', openDrawer);
  $('tccClose').addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (confirmEl.classList.contains('open')) closeConfirm();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  /* ------------------------------------------------------------ checkout */
  function setPaymentOptions() {
    const delivery = fulfilment === 'delivery';
    paySelect.innerHTML = delivery
      ? '<option value="cash_on_delivery">Cash on Delivery</option>'
      : '<option value="pay_on_collection">Pay on Collection</option>';
    paySelect.innerHTML += '<option value="mpesa" disabled>M-Pesa (coming soon)</option>';
    locationWrap.hidden = !delivery;
    locationWrap.style.display = delivery ? '' : 'none';
    locationInput.required = delivery;
    updateTotals();
  }

  form.addEventListener('change', (event) => {
    if (event.target.name === 'fulfilment') {
      fulfilment = event.target.value;
      setPaymentOptions();
    }
  });

  function fieldError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || '';
    const field = el.previousElementSibling;
    if (field && 'setAttribute' in field) field.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors() {
    ['tccErrName', 'tccErrPhone', 'tccErrEmail', 'tccErrLocation'].forEach((id) => fieldError(id, ''));
    feedback.className = 'tcc-feedback';
    feedback.textContent = '';
  }

  function showFeedback(message) {
    feedback.className = 'tcc-feedback show bad';
    feedback.textContent = message;
  }

  function setSubmitting(state, label) {
    submitting = state;
    placeBtn.disabled = state;
    placeBtn.textContent = state ? (label || 'Placing order…') : 'Place order';
  }

  const validPhone = (value) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(value).replace(/[\s-]/g, ''));
  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    clearErrors();

    const rows = lines();
    if (!rows.length) {
      toast('Your cart is empty.');
      return;
    }

    const name = $('tccName').value.trim();
    const phone = $('tccPhone').value.trim();
    const email = $('tccEmail').value.trim();
    const location = $('tccLocation').value.trim();
    const notes = $('tccNotes').value.trim();
    const paymentMethod = paySelect.value;

    let ok = true;
    if (name.length < 2) { fieldError('tccErrName', 'Enter your full name.'); ok = false; }
    if (!validPhone(phone)) { fieldError('tccErrPhone', 'Enter a valid phone number, for example 0712 345 678.'); ok = false; }
    if (email && !validEmail(email)) { fieldError('tccErrEmail', 'Enter a valid email address or leave it blank.'); ok = false; }
    if (fulfilment === 'delivery' && location.length < 3) { fieldError('tccErrLocation', 'Where should we deliver your order?'); ok = false; }
    if (!ok) {
      showFeedback('Please fix the highlighted fields and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: rows.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          customer: { name, phone, email },
          fulfilment,
          deliveryLocation: location,
          notes,
          paymentMethod,
          idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fields) {
          if (data.fields.name) fieldError('tccErrName', data.fields.name);
          if (data.fields.phone) fieldError('tccErrPhone', data.fields.phone);
          if (data.fields.email) fieldError('tccErrEmail', data.fields.email);
          if (data.fields.location) fieldError('tccErrLocation', data.fields.location);
        }
        throw new Error(data.error || 'We could not place your order. Please try again.');
      }

      showConfirmation(data);
      cart = [];
      idempotencyKey = newId();
      saveCart();
      form.reset();
      fulfilment = 'delivery';
      setPaymentOptions();
      await loadProducts();
      renderCart();
    } catch (err) {
      showFeedback(err.message || 'We could not place your order. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  });

  placeBtn.addEventListener('click', () => form.requestSubmit());

  /* -------------------------------------------------------- confirmation */
  function showConfirmation(data) {
    const order = data.order;
    const items = order.items || [];
    try {
      localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ orderNo: order.orderNo, at: new Date().toISOString() }));
    } catch { /* ignore */ }

    confirmEl.innerHTML = `
      <div class="tcc-confirm-card">
        <div class="tcc-tick" aria-hidden="true">✓</div>
        <div>
          <h2 id="tccConfirmTitle">Order received</h2>
          <p class="note" style="margin-top:.35rem">Thank you, ${esc(order.customerName)}. Your order is saved and waiting for confirmation.</p>
        </div>
        <div class="tcc-ref">
          <span>Order reference</span>
          <strong id="tccRef">${esc(order.orderNo)}</strong>
        </div>
        <div><span class="tcc-status-pill"><span aria-hidden="true">●</span> Pending confirmation</span></div>
        <div class="tcc-confirm-list">
          ${items.map((i) => `<div><span>${esc(i.name)} × ${i.quantity}</span><span>${money(i.lineTotal)}</span></div>`).join('')}
          <div><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
          <div><span>Delivery fee</span><span>${money(order.deliveryFee)}</span></div>
          <div class="tcc-grand"><span>Total</span><span>${money(order.total)}</span></div>
        </div>
        <p class="note">Send this order on WhatsApp so we can confirm it. It stays <strong>pending</strong> until we reply.</p>
        <div class="tcc-confirm-actions">
          <a class="btn btn-wa" id="tccWaLink" href="${esc(data.whatsappUrl)}" target="_blank" rel="noopener">Send order on WhatsApp</a>
          <button class="btn btn-line" type="button" id="tccCopy" style="border-color:var(--forest);color:var(--forest)">Copy order details</button>
          <a class="btn btn-line" id="tccTrackLink" href="/track?order=${encodeURIComponent(order.orderNo)}" style="border-color:var(--forest);color:var(--forest)">Track this order</a>
          <button class="btn" type="button" id="tccDone" style="background:var(--cream);color:var(--ink)">Continue browsing</button>
        </div>
      </div>`;

    confirmEl.classList.add('open');
    document.body.classList.add('tcc-locked');
    $('tccDone').focus({ preventScroll: true });

    const copyText = data.message || `${order.orderNo}\n${items.map((i) => `${i.name} × ${i.quantity}`).join('\n')}\nTotal: ${money(order.total)}`;
    $('tccCopy').addEventListener('click', async () => {
      const btn = $('tccCopy');
      try {
        await navigator.clipboard.writeText(copyText);
        btn.textContent = 'Copied to clipboard';
      } catch {
        const box = document.createElement('textarea');
        box.value = copyText;
        document.body.appendChild(box);
        box.select();
        try { document.execCommand('copy'); btn.textContent = 'Copied to clipboard'; }
        catch { btn.textContent = 'Copy failed - select the reference above'; }
        box.remove();
      }
      setTimeout(() => { btn.textContent = 'Copy order details'; }, 2600);
    });
    $('tccDone').addEventListener('click', closeConfirm);

    // Best-effort automatic WhatsApp hand-off. Browsers may block a popup that
    // happens after the network round-trip, so the button above is always shown.
    try { window.open(data.whatsappUrl, '_blank', 'noopener'); } catch { /* blocked */ }
    closeDrawer();
  }

  function closeConfirm() {
    confirmEl.classList.remove('open');
    document.body.classList.remove('tcc-locked');
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  /* -------------------------------------------------------------- loading */
  async function loadProducts() {
    try {
      const res = await fetch('/api/products', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('catalogue unavailable');
      const data = await res.json();
      products = Array.isArray(data.products) ? data.products : [];
      cart = cart.filter((item) => findProduct(item.productId));
      saveCart();
    } catch {
      products = products || [];
    }
    renderCart();
  }

  async function init() {
    setPaymentOptions();
    renderCart();
    try {
      const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (res.ok) config = await res.json();
    } catch { /* defaults are fine */ }
    await loadProducts();
    updateTotals();
  }

  window.TCC = { addToCart, openCart: openDrawer, reload: loadProducts };
  init();
})();
