import { query, withTransaction } from '../db.js';
import { BUSINESS, buildOrderMessage, waUrl } from './business.js';
import { badRequest, email, multiline, normPhone, oneOf, phoneIntl, positiveInt, text } from './validate.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Nairobi-time order reference prefix, e.g. 261116 for 16 Nov 2026. */
function orderDatePrefix(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export function serializeOrder(row, items = [], history = []) {
  return {
    id: row.id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    fulfilment: row.fulfilment,
    deliveryLocation: row.delivery_location,
    notes: row.notes,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      unit: i.unit,
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
    history: history.map((h) => ({ status: h.status, note: h.note, at: h.created_at, by: h.changed_by })),
  };
}

const ORDER_COLUMNS = `id, order_no, customer_id, customer_name, customer_phone, customer_email,
  fulfilment, delivery_location, notes, subtotal, delivery_fee, total,
  payment_method, payment_status, status, created_at, updated_at`;

export async function loadOrder(id) {
  const { rows } = await query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  const history = await query(
    'SELECT status, note, changed_by, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id',
    [id],
  );
  return serializeOrder(rows[0], items.rows, history.rows);
}

export function buildWhatsappMessage(order) {
  return buildOrderMessage({
    order_no: order.orderNo,
    customer_name: order.customerName,
    customer_phone: order.customerPhone,
    customer_email: order.customerEmail,
    subtotal: order.subtotal,
    delivery_fee: order.deliveryFee,
    total: order.total,
    fulfilment: order.fulfilment,
    delivery_location: order.deliveryLocation,
    notes: order.notes,
    payment_method: order.paymentMethod,
  }, order.items.map((i) => ({ name: i.name, quantity: i.quantity, line_total: i.lineTotal })));
}

export function buildWhatsappLink(order) {
  return waUrl(buildWhatsappMessage(order));
}

/**
 * Validate a checkout payload, price it from the database and store the order.
 * Prices, delivery fee and totals are always calculated here - never trusted
 * from the browser.
 */
export async function createOrder(body) {
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length) throw badRequest('Your cart is empty.', { items: 'Add at least one product.' });
  if (rawItems.length > 20) throw badRequest('Too many different products in one order.');

  const wanted = rawItems.map((raw) => ({
    productId: positiveInt(raw?.productId ?? raw?.product_id ?? raw?.id, { min: 1, field: 'product' }),
    quantity: positiveInt(raw?.quantity, { min: 1, max: 99, field: 'quantity' }),
  }));

  const name = text(body?.customer?.name ?? body?.name, 80);
  if (name.length < 2) throw badRequest('Enter your full name.', { name: 'Enter your full name.' });

  const phone = normPhone(body?.customer?.phone ?? body?.phone);
  if (!phone) throw badRequest('Enter a valid Kenyan phone number.', { phone: 'Enter a valid phone number, for example 0712 345 678.' });

  const mail = email(body?.customer?.email ?? body?.email);

  const fulfilment = oneOf(body?.fulfilment || 'delivery', ['delivery', 'collection'], 'fulfilment');
  const notes = multiline(body?.notes, 500);

  let location = text(body?.deliveryLocation ?? body?.location, 200);
  if (fulfilment === 'delivery') {
    if (location.length < 3) throw badRequest('Enter your delivery location.', { location: 'Where should we deliver your order?' });
  } else {
    location = location || 'Collection at Tabitha Chicken Company';
  }

  let paymentMethod = body?.paymentMethod || (fulfilment === 'delivery' ? 'cash_on_delivery' : 'pay_on_collection');
  oneOf(paymentMethod, ['cash_on_delivery', 'pay_on_collection'], 'paymentMethod');
  if (fulfilment === 'collection') paymentMethod = 'pay_on_collection';

  const idempotencyKey = text(body?.idempotencyKey, 80) || null;
  if (idempotencyKey) {
    const { rows } = await query('SELECT id FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
    if (rows[0]) return { order: await loadOrder(rows[0].id), reused: true };
  }

  const orderId = await withTransaction(async (client) => {
    const ids = [...new Set(wanted.map((w) => w.productId))];
    const { rows: products } = await client.query(
      `SELECT id, name, unit, price::float8 AS price, stock, available
         FROM products WHERE id = ANY($1::int[]) AND deleted_at IS NULL FOR UPDATE`,
      [ids],
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = wanted.map((w) => {
      const product = byId.get(w.productId);
      if (!product) throw badRequest('One of the products in your cart is no longer available.', { items: 'Remove it and try again.' });
      if (!product.available) throw badRequest(`${product.name} is currently unavailable.`, { items: `${product.name} is unavailable.` });
      if (product.stock < w.quantity) {
        throw badRequest(
          `Only ${product.stock} ${product.unit || 'unit'}(s) of ${product.name} are available.`,
          { items: `Reduce the quantity of ${product.name}.` },
        );
      }
      const unitPrice = round2(product.price);
      return {
        productId: product.id,
        name: product.name,
        unit: product.unit,
        quantity: w.quantity,
        unitPrice,
        lineTotal: round2(unitPrice * w.quantity),
      };
    });

    const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
    const deliveryFee = fulfilment === 'delivery' ? round2(BUSINESS.deliveryFee) : 0;
    const total = round2(subtotal + deliveryFee);

    const { rows: customerRows } = await client.query(
      `INSERT INTO customers (full_name, phone, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             email = COALESCE(NULLIF(EXCLUDED.email, ''), customers.email),
             updated_at = now()
       RETURNING id`,
      [name, phone, mail || ''],
    );
    const customerId = customerRows[0].id;

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (customer_id, customer_name, customer_phone, customer_email, fulfilment,
                           delivery_location, notes, subtotal, delivery_fee, total,
                           payment_method, payment_status, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'unpaid','pending',$12)
       RETURNING id`,
      [customerId, name, phone, mail, fulfilment, location, notes, subtotal, deliveryFee, total, paymentMethod, idempotencyKey],
    );
    const id = orderRows[0].id;
    const orderNo = `TCC-${orderDatePrefix()}-${String(id).padStart(4, '0')}`;
    await client.query('UPDATE orders SET order_no = $1 WHERE id = $2', [orderNo, id]);

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, line.productId, line.name, line.unit, line.unitPrice, line.quantity, line.lineTotal],
      );
      await client.query(
        'UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2',
        [line.quantity, line.productId],
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'pending', 'Order placed by the customer', 'customer')`,
      [id],
    );

    return id;
  });

  const order = await loadOrder(orderId);
  return { order, reused: false };
}

export function customerPhoneIntl(phone) {
  const local = normPhone(phone);
  return local ? phoneIntl(local) : null;
}
