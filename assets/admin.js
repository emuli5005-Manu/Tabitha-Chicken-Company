/* ==========================================================================
   Tabitha Chicken Company - admin dashboard
   ========================================================================== */
(() => {
  'use strict';

  const LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    ready_for_collection: 'Ready for Collection',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  const STATUSES = Object.keys(LABELS);
  const VIEW_TITLES = {
    overview: 'Overview',
    orders: 'Orders',
    products: 'Products',
    customers: 'Customers',
    reports: 'Reports',
  };

  const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
  });
  const statusPill = (s) => `<span class="pill pill-${esc(s)}">${esc(LABELS[s] || s)}</span>`;
  const payPill = (s) => `<span class="pill pill-${esc(s)}">${esc(s)}</span>`;

  const $ = (id) => document.getElementById(id);
  const viewEl = $('view');
  const loginView = $('loginView');
  const appView = $('appView');
  const modalRoot = $('modalRoot');
  const toastEl = $('toast');

  let admin = null;
  let currentView = 'overview';
  let ordersState = { search: '', status: 'all', from: '', to: '', page: 1 };
  let toastTimer = null;

  /* ----------------------------------------------------------------- utils */
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  async function api(path, options = {}) {
    const isForm = options.body instanceof FormData;
    const res = await fetch(`/api/admin${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: isForm ? { ...(options.headers || {}) } : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && path !== '/login') {
      showLogin('Your session expired. Please sign in again.');
      throw new Error('Please sign in again.');
    }
    if (!res.ok) {
      const error = new Error(data.error || 'Something went wrong. Please try again.');
      error.status = res.status;
      error.fields = data.fields;
      throw error;
    }
    return data;
  }

  const intlPhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('254')) return digits;
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    return digits;
  };
  const waChat = (phone, text) => `https://wa.me/${intlPhone(phone)}?text=${encodeURIComponent(text || '')}`;

  /* ---------------------------------------------------------------- modals */
  function openModal({ title, subtitle = '', body, foot = '', wide = false }) {
    modalRoot.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-card" style="${wide ? 'max-width:900px' : ''}">
          <div class="modal-head">
            <div>
              <h2 id="modalTitle">${esc(title)}</h2>
              ${subtitle ? `<p class="note">${esc(subtitle)}</p>` : ''}
            </div>
            <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
        </div>
      </div>`;
    const modal = modalRoot.querySelector('.modal');
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    modalRoot.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  }

  function closeModal() {
    modalRoot.innerHTML = '';
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  /* ------------------------------------------------------------- auth flow */
  function showLogin(message) {
    admin = null;
    appView.hidden = true;
    loginView.hidden = false;
    const box = $('loginError');
    box.className = message ? 'tcc-feedback show bad' : 'tcc-feedback';
    box.textContent = message || '';
    $('password').value = '';
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    $('adminName').textContent = admin.name || admin.email;
    $('adminRole').textContent = admin.role === 'admin' ? 'Administrator' : 'Staff';
    $('todayLabel').textContent = new Date().toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
    });
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    const email = $('email').value.trim();
    const password = $('password').value;
    $('loginError').className = 'tcc-feedback';
    $('loginError').textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const data = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      admin = data.admin;
      showApp();
      loadView('overview');
    } catch (err) {
      $('loginError').className = 'tcc-feedback show bad';
      $('loginError').textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
    showLogin('You have signed out.');
  });

  /* ------------------------------------------------------------ navigation */
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      loadView(button.dataset.view);
      closeSidebar();
    });
  });

  const sidebar = $('sidebar');
  const scrim = $('scrim');
  function openSidebar() {
    sidebar.classList.add('open');
    scrim.hidden = false;
    $('menuToggle').setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    scrim.hidden = true;
    $('menuToggle').setAttribute('aria-expanded', 'false');
  }
  $('menuToggle').addEventListener('click', () => (sidebar.classList.contains('open') ? closeSidebar() : openSidebar()));
  scrim.addEventListener('click', closeSidebar);

  async function loadView(name) {
    currentView = name;
    $('viewTitle').textContent = VIEW_TITLES[name] || 'Dashboard';
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    viewEl.innerHTML = '<p class="note">Loading…</p>';
    const renderers = {
      overview: renderOverview,
      orders: renderOrders,
      products: renderProducts,
      customers: renderCustomers,
      reports: renderReports,
    };
    try {
      await renderers[name]();
    } catch (err) {
      viewEl.innerHTML = `<div class="panel"><div class="panel-body"><p class="note">${esc(err.message)}</p></div></div>`;
    }
    window.scrollTo({ top: 0 });
  }

  /* -------------------------------------------------------------- overview */
  async function renderOverview() {
    const { stats, recentOrders } = await api('/overview');
    viewEl.innerHTML = `
      <div class="cards">
        <div class="stat"><span>Total orders</span><strong>${stats.total_orders}</strong></div>
        <div class="stat accent"><span>Pending</span><strong>${stats.pending}</strong><p class="note">Awaiting confirmation</p></div>
        <div class="stat"><span>Confirmed</span><strong>${stats.confirmed}</strong></div>
        <div class="stat"><span>Completed</span><strong>${stats.completed}</strong></div>
        <div class="stat"><span>Cancelled</span><strong>${stats.cancelled}</strong></div>
        <div class="stat"><span>Total sales</span><strong>${money(stats.completed_sales)}</strong><p class="note">From completed orders</p></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h2>Recent orders</h2>
          <button class="btn btn-line btn-sm" type="button" data-goto="orders">View all orders</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${recentOrders.length ? recentOrders.map((o) => `
                <tr class="clickable" data-order="${o.id}">
                  <td><strong>${esc(o.order_no)}</strong></td>
                  <td>${esc(o.customer_name)}<br><span class="note">${esc(o.customer_phone)}</span></td>
                  <td>${esc(fmtDateTime(o.created_at))}</td>
                  <td>${statusPill(o.status)}</td>
                  <td class="num">${money(o.total)}</td>
                </tr>`).join('')
                : '<tr class="empty-row"><td colspan="5">No orders yet. Orders placed on the website will appear here.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="cards">
        <div class="stat"><span>Open order value</span><strong>${money(stats.open_value)}</strong><p class="note">Not yet completed</p></div>
        <div class="stat"><span>Customers</span><strong>${stats.customers}</strong></div>
        <div class="stat"><span>Products</span><strong>${stats.products}</strong></div>
      </div>`;

    viewEl.querySelectorAll('[data-order]').forEach((row) => {
      row.addEventListener('click', () => openOrder(Number(row.dataset.order)));
    });
    viewEl.querySelector('[data-goto]')?.addEventListener('click', (e) => loadView(e.target.dataset.goto));
  }

  /* ---------------------------------------------------------------- orders */
  async function renderOrders() {
    const params = new URLSearchParams();
    if (ordersState.search) params.set('search', ordersState.search);
    if (ordersState.status && ordersState.status !== 'all') params.set('status', ordersState.status);
    if (ordersState.from) params.set('from', ordersState.from);
    if (ordersState.to) params.set('to', ordersState.to);
    params.set('page', ordersState.page);

    const data = await api(`/orders?${params.toString()}`);
    const statusOptions = ['all', ...STATUSES].map((s) => `
      <option value="${s}" ${ordersState.status === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : LABELS[s]}</option>`).join('');

    viewEl.innerHTML = `
      <div class="panel">
        <form class="filters" id="orderFilters">
          <div class="field" style="flex:2 1 200px">
            <label for="fSearch">Search</label>
            <input id="fSearch" type="search" placeholder="Order number, name or phone" value="${esc(ordersState.search)}">
          </div>
          <div class="field">
            <label for="fStatus">Status</label>
            <select id="fStatus">${statusOptions}</select>
          </div>
          <div class="field">
            <label for="fFrom">From</label>
            <input id="fFrom" type="date" value="${esc(ordersState.from)}">
          </div>
          <div class="field">
            <label for="fTo">To</label>
            <input id="fTo" type="date" value="${esc(ordersState.to)}">
          </div>
          <button class="btn btn-green btn-sm" type="submit">Apply</button>
          <button class="btn btn-line btn-sm" type="button" id="fReset">Clear</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Placed</th><th>Status</th><th>Payment</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${data.orders.length ? data.orders.map((o) => `
                <tr class="clickable" data-order="${o.id}">
                  <td><strong>${esc(o.order_no)}</strong><br><span class="note">${o.fulfilment === 'delivery' ? 'Delivery' : 'Collection'}</span></td>
                  <td>${esc(o.customer_name)}<br><span class="note">${esc(o.customer_phone)}</span></td>
                  <td>${o.item_count}</td>
                  <td>${esc(fmtDateTime(o.created_at))}</td>
                  <td>${statusPill(o.status)}</td>
                  <td>${payPill(o.payment_status)}</td>
                  <td class="num">${money(o.total)}</td>
                </tr>`).join('')
                : '<tr class="empty-row"><td colspan="7">No orders match these filters.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span>${data.total} order${data.total === 1 ? '' : 's'} · page ${data.page} of ${data.pages}</span>
          <div style="display:flex;gap:.4rem">
            <button class="btn btn-line btn-sm" type="button" id="prevPage" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
            <button class="btn btn-line btn-sm" type="button" id="nextPage" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      </div>`;

    $('orderFilters').addEventListener('submit', (event) => {
      event.preventDefault();
      ordersState = {
        search: $('fSearch').value.trim(),
        status: $('fStatus').value,
        from: $('fFrom').value,
        to: $('fTo').value,
        page: 1,
      };
      renderOrders().catch((err) => toast(err.message));
    });
    $('fStatus').addEventListener('change', () => $('orderFilters').requestSubmit());
    $('fReset').addEventListener('click', () => {
      ordersState = { search: '', status: 'all', from: '', to: '', page: 1 };
      renderOrders().catch((err) => toast(err.message));
    });
    $('prevPage').addEventListener('click', () => {
      ordersState.page = Math.max(1, ordersState.page - 1);
      renderOrders().catch((err) => toast(err.message));
    });
    $('nextPage').addEventListener('click', () => {
      ordersState.page += 1;
      renderOrders().catch((err) => toast(err.message));
    });
    viewEl.querySelectorAll('[data-order]').forEach((row) => {
      row.addEventListener('click', () => openOrder(Number(row.dataset.order)));
    });
  }

  async function openOrder(id) {
    try {
      const { order } = await api(`/orders/${id}`);
      const canEdit = Boolean(admin);
      const body = `
        <div class="grid-2">
          <div>
            <p class="section-title">Customer</p>
            <div class="kv">
              <div><span>Name</span><span>${esc(order.customerName)}</span></div>
              <div><span>Phone</span><span>${esc(order.customerPhone)}</span></div>
              ${order.customerEmail ? `<div><span>Email</span><span>${esc(order.customerEmail)}</span></div>` : ''}
              <div><span>Placed</span><span>${esc(fmtDateTime(order.createdAt))}</span></div>
            </div>
            <div style="display:flex;gap:.4rem;margin-top:.7rem;flex-wrap:wrap">
              <a class="btn btn-wa btn-sm" href="${waChat(order.customerPhone, `Hello ${order.customerName}, this is Tabitha Chicken Company about your order ${order.orderNo}.`)}" target="_blank" rel="noopener">Message on WhatsApp</a>
              <a class="btn btn-line btn-sm" href="tel:${esc(intlPhone(order.customerPhone))}">Call</a>
            </div>
          </div>
          <div>
            <p class="section-title">Fulfilment</p>
            <div class="kv">
              <div><span>Method</span><span>${order.fulfilment === 'delivery' ? 'Delivery' : 'Collection'}</span></div>
              <div><span>Location</span><span>${esc(order.deliveryLocation || '—')}</span></div>
              <div><span>Payment</span><span>${esc(order.paymentMethod.replace(/_/g, ' '))}</span></div>
              <div><span>Payment status</span><span>${payPill(order.paymentStatus)}</span></div>
            </div>
            ${order.notes ? `<p class="section-title" style="margin-top:.8rem">Instructions</p><p class="note">${esc(order.notes)}</p>` : ''}
          </div>
        </div>

        <div>
          <p class="section-title">Items</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Line total</th></tr></thead>
              <tbody>
                ${order.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unitPrice)}</td><td class="num">${money(i.lineTotal)}</td></tr>`).join('')}
                <tr><td colspan="3" class="num">Subtotal</td><td class="num">${money(order.subtotal)}</td></tr>
                <tr><td colspan="3" class="num">Delivery fee</td><td class="num">${money(order.deliveryFee)}</td></tr>
                <tr><td colspan="3" class="num"><strong>Total</strong></td><td class="num"><strong>${money(order.total)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p class="section-title">Order status</p>
          <div class="status-actions" id="statusActions">
            ${STATUSES.map((s) => `<button type="button" data-status="${s}" ${s === order.status ? 'class="current" disabled' : ''}>${LABELS[s]}</button>`).join('')}
          </div>
        </div>

        <div>
          <p class="section-title">Payment status</p>
          <div class="status-actions" id="payActions">
            ${['unpaid', 'paid', 'refunded'].map((p) => `<button type="button" data-pay="${p}" ${p === order.paymentStatus ? 'class="current" disabled' : ''}>${p}</button>`).join('')}
          </div>
        </div>

        <div>
          <p class="section-title">History</p>
          <div class="kv">
            ${order.history.slice().reverse().map((h) => `
              <div><span>${esc(fmtDateTime(h.at))}</span><span>${esc(LABELS[h.status] || h.status)}${h.note ? ` — ${esc(h.note)}` : ''}</span></div>`).join('')}
          </div>
        </div>`;

    openModal({
      title: order.orderNo,
      subtitle: `${LABELS[order.status]} · ${money(order.total)}`,
      body,
      wide: true,
      foot: '<button class="btn btn-line btn-sm" type="button" data-close>Close</button>',
    });

    if (!canEdit) return;
    modalRoot.querySelectorAll('#statusActions button[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) });
          toast(`Order ${order.orderNo} marked ${LABELS[button.dataset.status].toLowerCase()}.`);
          closeModal();
          openOrder(order.id);
          if (currentView === 'overview' || currentView === 'orders') loadView(currentView);
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    });
    modalRoot.querySelectorAll('#payActions button[data-pay]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ payment_status: button.dataset.pay }) });
          toast(`Payment marked ${button.dataset.pay}.`);
          closeModal();
          openOrder(order.id);
          if (currentView === 'overview' || currentView === 'orders') loadView(currentView);
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    });
  }

  /* -------------------------------------------------------------- products */
  async function renderProducts() {
    const { products } = await api('/products');
    const canManage = admin?.role === 'admin';
    viewEl.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <h2>Chicken products</h2>
          ${canManage ? '<button class="btn btn-green btn-sm" type="button" id="addProduct">Add product</button>' : ''}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${products.length ? products.map((p) => `
                <tr>
                  <td>
                    <div class="cell-product">
                      ${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="">` : '<div class="thumb"></div>'}
                      <div><strong>${esc(p.name)}</strong><br><span class="note">${esc(p.unit || '')}</span></div>
                    </div>
                  </td>
                  <td>${esc(p.category)}</td>
                  <td class="num">${money(p.price)}</td>
                  <td class="num">${p.stock}</td>
                  <td>${p.available && p.stock > 0 ? '<span class="pill pill-completed">Available</span>' : p.available ? '<span class="pill pill-pending">Out of stock</span>' : '<span class="pill pill-cancelled">Unavailable</span>'}</td>
                  <td class="num">
                    ${canManage ? `<button class="btn btn-line btn-sm" type="button" data-edit="${p.id}">Edit</button>
                    <button class="btn btn-danger btn-sm" type="button" data-delete="${p.id}">Delete</button>` : ''}
                  </td>
                </tr>`).join('')
                : '<tr class="empty-row"><td colspan="6">No products yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('addProduct')?.addEventListener('click', () => productModal(null));
    viewEl.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => productModal(products.find((p) => p.id === Number(button.dataset.edit))));
    });
    viewEl.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const product = products.find((p) => p.id === Number(button.dataset.delete));
        if (!product) return;
        if (!window.confirm(`Delete "${product.name}"? It will be removed from the website catalogue. Past orders keep their record.`)) return;
        try {
          await api(`/products/${product.id}`, { method: 'DELETE' });
          toast(`${product.name} deleted.`);
          renderProducts();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  function productModal(product) {
    const isNew = !product;
    const p = product || { name: '', category: 'Chicken', unit: '', price: '', stock: 0, available: true, description: '', image: '' };
    const body = `
      <form id="productForm" novalidate>
        <div class="grid-2">
          <div>
            <label for="pName">Product name</label>
            <input id="pName" value="${esc(p.name)}" required>
            <div class="err" id="pErrName"></div>
          </div>
          <div>
            <label for="pCategory">Category</label>
            <input id="pCategory" value="${esc(p.category)}" placeholder="Chicken, Chicks, Eggs">
          </div>
          <div>
            <label for="pPrice">Price (KES)</label>
            <input id="pPrice" type="number" min="0" step="1" value="${esc(p.price)}" required>
            <div class="err" id="pErrPrice"></div>
          </div>
          <div>
            <label for="pUnit">Unit</label>
            <input id="pUnit" value="${esc(p.unit)}" placeholder="per bird, per tray of 30">
          </div>
          <div>
            <label for="pStock">Stock quantity</label>
            <input id="pStock" type="number" min="0" step="1" value="${esc(p.stock)}">
            <div class="err" id="pErrStock"></div>
          </div>
          <div>
            <label for="pAvailable">Availability</label>
            <select id="pAvailable">
              <option value="true" ${p.available ? 'selected' : ''}>Available for ordering</option>
              <option value="false" ${!p.available ? 'selected' : ''}>Hidden / unavailable</option>
            </select>
          </div>
        </div>
        <div style="margin-top:.9rem">
          <label for="pDescription">Description</label>
          <textarea id="pDescription" rows="3">${esc(p.description)}</textarea>
        </div>
        <div style="margin-top:.9rem">
          <label for="pImage">Product image</label>
          <div style="display:flex;gap:.9rem;align-items:center;flex-wrap:wrap">
            ${p.image ? `<img class="image-preview" id="pPreview" src="${esc(p.image)}" alt="">` : '<img class="image-preview" id="pPreview" alt="" hidden>'}
            <div style="flex:1;min-width:180px">
              <input id="pImage" type="file" accept="image/jpeg,image/png,image/webp">
              <p class="note" style="margin-top:.3rem">JPG, PNG or WebP, up to 4 MB. Uploaded after saving.</p>
            </div>
          </div>
        </div>
      </form>`;

    openModal({
      title: isNew ? 'Add product' : `Edit ${p.name}`,
      body,
      foot: `
        <button class="btn btn-line btn-sm" type="button" data-close>Cancel</button>
        <button class="btn btn-green btn-sm" type="button" id="saveProduct">${isNew ? 'Create product' : 'Save changes'}</button>`,
    });

    $('saveProduct').addEventListener('click', async () => {
      const payload = {
        name: $('pName').value.trim(),
        category: $('pCategory').value.trim(),
        unit: $('pUnit').value.trim(),
        price: Number($('pPrice').value),
        stock: Number($('pStock').value || 0),
        available: $('pAvailable').value === 'true',
        description: $('pDescription').value.trim(),
      };
      let ok = true;
      ['pErrName', 'pErrPrice', 'pErrStock'].forEach((id) => { $(id).textContent = ''; });
      if (payload.name.length < 2) { $('pErrName').textContent = 'Enter a product name.'; ok = false; }
      if (!Number.isFinite(payload.price) || payload.price < 0) { $('pErrPrice').textContent = 'Enter a valid price.'; ok = false; }
      if (!Number.isInteger(payload.stock) || payload.stock < 0) { $('pErrStock').textContent = 'Enter a whole number.'; ok = false; }
      if (!ok) return;

      const button = $('saveProduct');
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const saved = isNew
          ? await api('/products', { method: 'POST', body: JSON.stringify(payload) })
          : await api(`/products/${p.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const productId = isNew ? saved.product.id : p.id;
        const file = $('pImage').files?.[0];
        if (file) {
          const form = new FormData();
          form.append('image', file);
          await api(`/products/${productId}/image`, { method: 'POST', body: form });
        }
        closeModal();
        toast(isNew ? 'Product created.' : 'Product updated.');
        renderProducts();
      } catch (err) {
        if (err.fields?.name) $('pErrName').textContent = err.fields.name;
        if (err.fields?.price) $('pErrPrice').textContent = err.fields.price;
        if (err.fields?.stock) $('pErrStock').textContent = err.fields.stock;
        toast(err.message);
        button.disabled = false;
        button.textContent = isNew ? 'Create product' : 'Save changes';
      }
    });
  }

  /* ------------------------------------------------------------- customers */
  async function renderCustomers(search = '') {
    const { customers } = await api(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    viewEl.innerHTML = `
      <div class="panel">
        <form class="filters" id="customerFilters">
          <div class="field" style="flex:2 1 220px">
            <label for="cSearch">Search customers</label>
            <input id="cSearch" type="search" value="${esc(search)}" placeholder="Name, phone or email">
          </div>
          <button class="btn btn-green btn-sm" type="submit">Search</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Phone</th><th class="num">Orders</th><th class="num">Total spent</th><th>Last order</th><th></th></tr></thead>
            <tbody>
              ${customers.length ? customers.map((c) => `
                <tr>
                  <td><strong>${esc(c.full_name)}</strong>${c.email ? `<br><span class="note">${esc(c.email)}</span>` : ''}</td>
                  <td>${esc(c.phone)}</td>
                  <td class="num">${c.orders_count}</td>
                  <td class="num">${money(c.total_spent)}</td>
                  <td>${c.last_order_at ? esc(fmtDateTime(c.last_order_at)) : '—'}</td>
                  <td class="num"><button class="btn btn-line btn-sm" type="button" data-customer="${c.id}">View</button></td>
                </tr>`).join('')
                : '<tr class="empty-row"><td colspan="6">No customers yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('customerFilters').addEventListener('submit', (event) => {
      event.preventDefault();
      renderCustomers($('cSearch').value.trim());
    });
    viewEl.querySelectorAll('[data-customer]').forEach((button) => {
      button.addEventListener('click', () => openCustomer(Number(button.dataset.customer)));
    });
  }

  async function openCustomer(id) {
    const { customer, orders } = await api(`/customers/${id}`);
    openModal({
      title: customer.fullName,
      subtitle: `${customer.phone}${customer.email ? ` · ${customer.email}` : ''}`,
      body: `
        <div class="kv">
          <div><span>Registered</span><span>${esc(fmtDateTime(customer.createdAt))}</span></div>
          <div><span>Orders</span><span>${orders.length}</span></div>
          <div><span>Total value</span><span>${money(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0))}</span></div>
        </div>
        <div>
          <p class="section-title">Previous orders</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Placed</th><th>Status</th><th class="num">Total</th></tr></thead>
              <tbody>
                ${orders.length ? orders.map((o) => `<tr><td>${esc(o.order_no)}</td><td>${esc(fmtDateTime(o.created_at))}</td><td>${statusPill(o.status)}</td><td class="num">${money(o.total)}</td></tr>`).join('')
                  : '<tr class="empty-row"><td colspan="4">No orders yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>`,
      foot: `<a class="btn btn-wa btn-sm" href="${waChat(customer.phone, `Hello ${customer.fullName}, this is Tabitha Chicken Company.`)}" target="_blank" rel="noopener">Message on WhatsApp</a>
             <button class="btn btn-line btn-sm" type="button" data-close>Close</button>`,
    });
  }

  /* --------------------------------------------------------------- reports */
  const shortLabel = (bucket, range) => {
    if (range === 'monthly') {
      const [y, m] = bucket.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    }
    const date = new Date(`${bucket}T00:00:00`);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  async function renderReports(range = 'daily') {
    const data = await api(`/reports?range=${range}`);
    const maxSales = Math.max(...data.series.map((s) => s.sales), 1);
    const total = data.series.reduce((sum, s) => sum + s.sales, 0);
    const maxQty = Math.max(...data.topProducts.map((p) => p.quantity), 1);

    viewEl.innerHTML = `
      <div class="cards">
        <div class="stat accent"><span>Sales today</span><strong>${money(data.totals.sales_today)}</strong><p class="note">Completed orders</p></div>
        <div class="stat"><span>Last 7 days</span><strong>${money(data.totals.sales_week)}</strong></div>
        <div class="stat"><span>This month</span><strong>${money(data.totals.sales_month)}</strong></div>
        <div class="stat"><span>Completed orders</span><strong>${data.totals.completed_orders}</strong></div>
        <div class="stat"><span>Pending orders</span><strong>${data.totals.pending_orders}</strong></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Sales trend</h2>
            <p class="note">${money(total)} captured in this period · excluding cancelled orders</p>
          </div>
          <div class="status-actions" id="rangeBtns">
            ${[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([value, label]) =>
              `<button type="button" data-range="${value}" class="${range === value ? 'current' : ''}" ${range === value ? 'disabled' : ''}>${label}</button>`).join('')}
          </div>
        </div>
        <div class="bars">
          ${data.series.map((s) => `
            <div class="bar" title="${esc(shortLabel(s.bucket, range))}: ${money(s.sales)} from ${s.orders} order(s)">
              <div class="bar-track"><div class="bar-fill" style="height:${Math.max(Math.round((s.sales / maxSales) * 100), 2)}%"></div></div>
              <span class="bar-label">${esc(shortLabel(s.bucket, range))}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Most ordered products</h2><span class="note">All time, excluding cancelled orders</span></div>
        <div class="top-list">
          ${data.topProducts.length ? data.topProducts.map((p) => `
            <div class="top-item">
              <div class="top-row">
                <span>${esc(p.name)}</span>
                <small>${p.quantity} sold · ${money(p.revenue)}</small>
              </div>
              <div class="top-bar"><i style="width:${Math.max(Math.round((p.quantity / maxQty) * 100), 4)}%"></i></div>
            </div>`).join('')
            : '<p class="note">No sales data yet.</p>'}
        </div>
      </div>`;

    viewEl.querySelectorAll('#rangeBtns [data-range]').forEach((button) => {
      button.addEventListener('click', () => renderReports(button.dataset.range));
    });
  }

  /* ------------------------------------------------------------ bootstrap */
  (async function init() {
    try {
      const data = await api('/me');
      admin = data.admin;
      showApp();
      loadView('overview');
    } catch {
      showLogin();
    }
  })();
})();
