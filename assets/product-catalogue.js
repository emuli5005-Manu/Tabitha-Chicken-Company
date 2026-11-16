/* ==========================================================================
   Storefront catalogue: renders the products served by the order API into the
   existing product cards. Loaded inline from index.html.
   ========================================================================== */
/* ===================== */

const wa = t => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(t)}`;
const GENERAL = "Hello Tabitha Chicken Company, I would like to place an order. Please share the available products, prices and availability.";
document.querySelectorAll('.wa-link').forEach(a => { a.href = wa(a.dataset.msg && a.dataset.msg !== 'general' ? a.dataset.msg : GENERAL); });
document.getElementById('yr').textContent = new Date().getFullYear();

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = n => 'KSh ' + Number(n).toLocaleString('en-KE');

const henIcon = '<svg viewBox="0 0 100 80" aria-hidden="true"><use href="#hen"/></svg>';
const eggIcon = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M24 6c8 0 14 14 14 22a14 14 0 0 1-28 0C10 20 16 6 24 6z"/></svg>';
const catalogue = document.getElementById('catalogue'), flinks = document.getElementById('flinks');

function productCard(p) {
  const card = document.createElement('article');
  card.className = 'card';
  card.id = 'p-' + esc(p.slug);
  const stock = Number(p.stock) || 0;
  const soldOut = !p.available || stock < 1;
  const media = p.image
    ? `<div class="pimg"><img src="${esc(p.image)}" alt="${esc(p.name)}" width="800" height="800" loading="lazy" decoding="async"></div>`
    : `<div class="pimg"><div class="ph">${(p.category || '').toLowerCase() === 'eggs' ? eggIcon : henIcon}Photo coming soon</div></div>`;
  const price = p.price != null
    ? `<div class="price">${kes(p.price)} <small>${esc(p.unit || '')}</small></div>`
    : '<div class="price ask">Contact us for price</div>';
  const low = !soldOut && stock <= 5 ? `<p class="note">Only ${stock} left</p>` : '';
  card.innerHTML = `${media}<div class="pbody"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>${price}${low}
    <div class="buy"><div class="qty"><button type="button" aria-label="Decrease quantity of ${esc(p.name)}">−</button><output aria-live="polite">1</output><button type="button" aria-label="Increase quantity of ${esc(p.name)}">+</button></div>
    <button class="btn btn-green" type="button" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Out of stock' : 'Add to cart'}</button></div></div>`;

  const out = card.querySelector('output');
  const [minus, plus] = card.querySelectorAll('.qty button');
  const addBtn = card.querySelector('.buy .btn');
  const max = Math.max(Math.min(stock, 99), 1);
  let q = 1;
  minus.onclick = () => { q = Math.max(1, q - 1); out.textContent = q; };
  plus.onclick = () => { q = Math.min(max, q + 1); out.textContent = q; };
  addBtn.onclick = () => { if (window.TCC) window.TCC.addToCart(p, q); };
  return card;
}

function renderCatalogue(products) {
  catalogue.innerHTML = '';
  flinks.innerHTML = '';
  if (!products.length) {
    catalogue.innerHTML = '<p class="note">Our catalogue is being updated. Please contact us on WhatsApp for today&#39;s availability.</p>';
    return;
  }
  products.forEach(p => {
    catalogue.appendChild(productCard(p));
    flinks.insertAdjacentHTML('beforeend', `<li><a href="#p-${esc(p.slug)}">${esc(p.name)}</a></li>`);
  });
}

(async () => {
  try {
    const res = await fetch('/api/products', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('catalogue unavailable');
    const data = await res.json();
    renderCatalogue(Array.isArray(data.products) ? data.products : []);
  } catch {
    catalogue.innerHTML = '<p class="note">We could not load the catalogue just now. Please refresh the page or order on WhatsApp.</p>';
  }
})();

