import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { endSession, issueSession, requireAdmin, requireRole } from '../auth.js';
import { query, withTransaction } from '../db.js';
import {
  OPEN_PAYMENT_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  STATUS_LABELS,
} from '../lib/business.js';
import { loadOrder } from '../lib/orders.js';
import { loadPaymentSettings, serializeSettings } from '../lib/payments.js';
import {
  HttpError,
  badRequest,
  email,
  multiline,
  normPhone,
  oneOf,
  positiveInt,
  slugify,
  text,
} from '../lib/validate.js';

const router = Router();
const ORDER_STATUSES = Object.keys(STATUS_LABELS);

/* ---------- login throttling ---------- */
const attempts = new Map();
function throttled(key, max, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.start > windowMs) {
    attempts.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

router.post('/login', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (throttled(`login:${ip}`, 10, 10 * 60_000)) {
      throw new HttpError(429, 'Too many sign-in attempts. Please wait 10 minutes.');
    }
    const mail = text(req.body?.email, 120).toLowerCase();
    const password = String(req.body?.password || '');
    if (!mail || !password) throw new HttpError(400, 'Enter your email and password.');

    const { rows } = await query('SELECT * FROM admins WHERE email = $1', [mail]);
    const admin = rows[0];
    const ok = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!ok) throw new HttpError(401, 'Incorrect email or password.');

    await query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);
    issueSession(res, admin);
    res.json({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  endSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

/* ---------- dashboard overview ---------- */
router.get('/overview', requireAdmin, async (req, res, next) => {
  try {
    const { rows: statsRows } = await query(`
      SELECT count(*)::int AS total_orders,
             count(*) FILTER (WHERE status = 'pending')::int AS pending,
             count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
             count(*) FILTER (WHERE status = 'processing')::int AS processing,
             count(*) FILTER (WHERE status = 'ready_for_collection')::int AS ready,
             count(*) FILTER (WHERE status = 'out_for_delivery')::int AS out_for_delivery,
             count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             coalesce(sum(total) FILTER (WHERE status = 'completed'), 0)::float8 AS completed_sales,
             coalesce(sum(total) FILTER (WHERE status NOT IN ('completed','cancelled')), 0)::float8 AS open_value,
             count(*) FILTER (WHERE payment_status IN ('payment_submitted','verification_required'))::int AS payments_to_verify
        FROM orders`);
    const { rows: recent } = await query(`
      SELECT id, order_no, customer_name, customer_phone, total::float8 AS total,
             status, payment_status, fulfilment, created_at
        FROM orders ORDER BY created_at DESC LIMIT 8`);
    const { rows: customers } = await query('SELECT count(*)::int AS n FROM customers');
    const { rows: products } = await query(
      'SELECT count(*)::int AS n FROM products WHERE deleted_at IS NULL',
    );
    res.json({
      stats: { ...statsRows[0], customers: customers[0].n, products: products[0].n },
      recentOrders: recent,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------- orders ---------- */
router.get('/orders', requireAdmin, async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const search = text(req.query.search, 80);
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where.push(`(customer_name ILIKE $${i} OR order_no ILIKE $${i} OR customer_phone ILIKE $${i})`);
    }
    const status = text(req.query.status, 40);
    if (status && status !== 'all') {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const from = text(req.query.from, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from);
      where.push(`created_at >= $${params.length}::date`);
    }
    const to = text(req.query.to, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to);
      where.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    const totals = await query(`SELECT count(*)::int AS n FROM orders ${clause}`, params);
    const { rows } = await query(
      `SELECT id, order_no, customer_name, customer_phone, total::float8 AS total,
              status, payment_status, fulfilment, delivery_location, created_at,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = orders.id) AS item_count
         FROM orders ${clause}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({
      orders: rows,
      total: totals.rows[0].n,
      page,
      pages: Math.max(Math.ceil(totals.rows[0].n / limit), 1),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const order = await loadOrder(positiveInt(req.params.id, { field: 'order' }));
    if (!order) throw new HttpError(404, 'Order not found.');
    const { rows } = await query('SELECT id, full_name, phone, email, created_at FROM customers WHERE phone = $1', [order.customerPhone]);
    res.json({ order, customer: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.patch('/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'order' });
    const hasStatus = req.body?.status !== undefined;
    const hasPayment = req.body?.payment_status !== undefined || req.body?.paymentStatus !== undefined;
    if (!hasStatus && !hasPayment) throw badRequest('Nothing to update.');

    if (hasStatus) {
      const status = oneOf(req.body.status, ORDER_STATUSES, 'status');
      const note = multiline(req.body?.note, 300) || null;
      await withTransaction(async (client) => {
        const { rows } = await client.query('SELECT id, status, stock_restored FROM orders WHERE id = $1 FOR UPDATE', [id]);
        if (!rows[0]) throw new HttpError(404, 'Order not found.');
        const current = rows[0];
        if (current.status === status) return;
        await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
        if (status === 'cancelled' && !current.stock_restored) {
          await client.query(
            `UPDATE products p SET stock = p.stock + oi.quantity, updated_at = now()
               FROM order_items oi WHERE oi.order_id = $1 AND p.id = oi.product_id`,
            [id],
          );
          await client.query('UPDATE orders SET stock_restored = TRUE WHERE id = $1', [id]);
        }
        await client.query(
          `INSERT INTO order_status_history (order_id, status, note, changed_by)
           VALUES ($1, $2, $3, $4)`,
          [id, status, note || `Status changed from ${STATUS_LABELS[current.status]} to ${STATUS_LABELS[status]}`, req.admin.email],
        );
      });
    }

    if (hasPayment) {
      const paymentStatus = oneOf(
        req.body.payment_status ?? req.body.paymentStatus,
        PAYMENT_STATUSES,
        'payment_status',
      );
      if (paymentStatus === 'paid' && req.admin.role !== 'admin') {
        throw new HttpError(403, 'Only an administrator can mark an order as paid.');
      }
      await withTransaction(async (client) => {
        const { rows } = await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [id]);
        if (!rows[0]) throw new HttpError(404, 'Order not found.');
        await client.query('UPDATE orders SET payment_status = $1, updated_at = now() WHERE id = $2', [paymentStatus, id]);
        await client.query(
          `INSERT INTO order_status_history (order_id, status, note, changed_by)
           SELECT $1, status, $2, $3 FROM orders WHERE id = $1`,
          [id, `Payment marked as ${paymentStatus}`, req.admin.email],
        );
      });
    }

    res.json({ order: await loadOrder(id) });
  } catch (err) {
    next(err);
  }
});

/* ---------- manual M-Pesa payment verification ---------- */
const PAYMENT_QUEUE_COLUMNS = `id, order_no, customer_name, customer_phone, total::float8 AS total,
  fulfilment, delivery_location, payment_method, payment_status, mpesa_code,
  payment_receiving_number, payment_note, payment_verified_at, payment_verified_by, created_at`;

router.get('/payments', requireAdmin, async (req, res, next) => {
  try {
    const scope = text(req.query.scope, 20) || 'open';
    const search = text(req.query.search, 80);
    const where = ["payment_method = 'mpesa'"];
    const params = [];
    if (scope !== 'all') {
      params.push(OPEN_PAYMENT_STATUSES);
      where.push(`payment_status = ANY($${params.length}::text[])`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(order_no ILIKE $${params.length} OR customer_name ILIKE $${params.length}
                   OR customer_phone ILIKE $${params.length} OR coalesce(mpesa_code, '') ILIKE $${params.length})`);
    }
    const { rows } = await query(
      `SELECT ${PAYMENT_QUEUE_COLUMNS} FROM orders
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    const { rows: counts } = await query(`
      SELECT count(*) FILTER (WHERE payment_status = 'awaiting_payment')::int AS awaiting_payment,
             count(*) FILTER (WHERE payment_status = 'payment_submitted')::int AS payment_submitted,
             count(*) FILTER (WHERE payment_status = 'verification_required')::int AS verification_required,
             count(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
             count(*) FILTER (WHERE payment_status = 'failed')::int AS failed,
             coalesce(sum(total) FILTER (WHERE payment_status IN ('payment_submitted','verification_required')), 0)::float8 AS submitted_value
        FROM orders WHERE payment_method = 'mpesa'`);
    res.json({
      scope,
      payments: rows,
      counts: counts[0],
      labels: PAYMENT_STATUS_LABELS,
    });
  } catch (err) {
    next(err);
  }
});

/** Verify, reject or annotate a customer-submitted M-Pesa payment. */
router.post('/orders/:id/payment', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'order' });
    const action = oneOf(req.body?.action, ['verify', 'reject', 'flag', 'note'], 'action');
    const note = multiline(req.body?.note, 500);

    if (action === 'reject' && note.length < 3) {
      throw badRequest('Say why the payment was rejected - the note is kept with the order.', {
        note: 'Add a short reason, for example "Code not found in the M-Pesa statement".',
      });
    }

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, order_no, status, payment_method, payment_status, mpesa_code, payment_note
           FROM orders WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const order = rows[0];
      if (!order) throw new HttpError(404, 'Order not found.');
      if (order.payment_method !== 'mpesa' && action !== 'note') {
        throw badRequest('This order is not paid by M-Pesa.');
      }
      if (action === 'verify' && order.payment_method === 'mpesa' && !order.mpesa_code) {
        throw badRequest('There is no M-Pesa transaction code on this order yet.');
      }

      const notes = notesFor(action, order, note);
      if (action === 'verify') {
        await client.query(
          `UPDATE orders SET payment_status = 'paid', payment_verified_at = now(),
                  payment_verified_by = $2, payment_note = $3, updated_at = now()
            WHERE id = $1`,
          [id, req.admin.email, nextPaymentNote(order.payment_note, notes.history)],
        );
      } else if (action === 'reject') {
        await client.query(
          `UPDATE orders SET payment_status = 'failed', payment_verified_at = now(),
                  payment_verified_by = $2, payment_note = $3, updated_at = now()
            WHERE id = $1`,
          [id, req.admin.email, nextPaymentNote(order.payment_note, notes.history)],
        );
      } else if (action === 'flag') {
        await client.query(
          `UPDATE orders SET payment_status = 'verification_required', payment_note = $2, updated_at = now()
            WHERE id = $1`,
          [id, nextPaymentNote(order.payment_note, notes.history)],
        );
      } else {
        await client.query('UPDATE orders SET payment_note = $2, updated_at = now() WHERE id = $1', [
          id,
          nextPaymentNote(order.payment_note, notes.history),
        ]);
      }

      await client.query(
        `INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1, $2, $3, $4)`,
        [id, order.status, notes.history, req.admin.email],
      );
      return id;
    });

    res.json({ order: await loadOrder(updated) });
  } catch (err) {
    next(err);
  }
});

function notesFor(action, order, note) {
  const code = order.mpesa_code ? ` (code ${order.mpesa_code})` : '';
  const history = {
    verify: note || `Payment verified against the M-Pesa statement${code}`,
    reject: `Payment rejected${code}: ${note}`,
    flag: note || `Payment needs a closer look${code}`,
    note: note,
  }[action];
  if (action === 'note' && !note) throw badRequest('Write a note first.');
  return { history };
}

/** Internal notes are appended with a timestamp so nothing is overwritten. */
function nextPaymentNote(existing, addition) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `[${stamp}] ${addition}`;
  return existing ? `${existing}\n${line}`.slice(-4000) : line;
}

/* ---------- payment settings ---------- */
router.get('/payment-settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = await loadPaymentSettings();
    res.json({ settings: serializeSettings(settings) });
  } catch (err) {
    next(err);
  }
});

router.put('/payment-settings', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const current = await loadPaymentSettings();
    const rawNumber = text(req.body?.mpesaNumber ?? req.body?.mpesa_number, 20);
    if (!rawNumber) throw badRequest('Enter the M-Pesa number that receives payments.', {
      mpesaNumber: 'Enter the number customers send money to.',
    });
    const local = normPhone(rawNumber);
    if (!local) {
      throw badRequest('Enter a valid Safaricom number, for example 0726 777 924.', {
        mpesaNumber: 'Enter a valid Kenyan mobile number.',
      });
    }
    const accountName = text(req.body?.accountName ?? req.body?.account_name, 80);
    if (accountName.length < 2) throw badRequest('Enter the M-Pesa account holder name.', {
      accountName: 'Enter the name registered on the M-Pesa line.',
    });
    const instructions = multiline(req.body?.instructions, 600);
    const enabled = req.body?.enabled === undefined ? current.enabled : Boolean(req.body.enabled);

    const numberChanged = local !== current.mpesa_number;
    const { rows } = await query(
      `UPDATE payment_settings
          SET mpesa_number = $1, account_name = $2, instructions = $3, enabled = $4,
              verified_at = CASE WHEN $5 THEN NULL ELSE verified_at END,
              verified_by = CASE WHEN $5 THEN NULL ELSE verified_by END,
              updated_by = $6, updated_at = now()
        WHERE id = 1
        RETURNING *`,
      [local, accountName, instructions, enabled, numberChanged, req.admin.email],
    );
    res.json({ settings: serializeSettings(rows[0]), numberChanged });
  } catch (err) {
    next(err);
  }
});

router.post('/payment-settings/verify', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE payment_settings
          SET verified_at = now(), verified_by = $1, updated_at = now()
        WHERE id = 1 RETURNING *`,
      [req.admin.email],
    );
    res.json({ settings: serializeSettings(rows[0]) });
  } catch (err) {
    next(err);
  }
});

/* ---------- customers ---------- */
router.get('/customers', requireAdmin, async (req, res, next) => {
  try {
    const search = text(req.query.search, 80);
    const params = [];
    let clause = '';
    if (search) {
      params.push(`%${search}%`);
      clause = 'WHERE (c.full_name ILIKE $1 OR c.phone ILIKE $1 OR coalesce(c.email, \'\') ILIKE $1)';
    }
    const { rows } = await query(
      `SELECT c.id, c.full_name, c.phone, c.email, c.created_at,
              count(o.id)::int AS orders_count,
              coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::float8 AS total_spent,
              max(o.created_at) AS last_order_at
         FROM customers c
         LEFT JOIN orders o ON o.customer_id = c.id
         ${clause}
        GROUP BY c.id
        ORDER BY max(o.created_at) DESC NULLS LAST, c.created_at DESC
        LIMIT 200`,
      params,
    );
    res.json({ customers: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/customers/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'customer' });
    const { rows } = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Customer not found.');
    const orders = await query(
      `SELECT id, order_no, total::float8 AS total, status, payment_status, created_at
         FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    res.json({
      customer: {
        id: rows[0].id,
        fullName: rows[0].full_name,
        phone: rows[0].phone,
        email: rows[0].email,
        createdAt: rows[0].created_at,
      },
      orders: orders.rows,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------- reports ---------- */
router.get('/reports', requireAdmin, async (req, res, next) => {
  try {
    const range = text(req.query.range, 10) || 'daily';
    const span = { daily: 14, weekly: 12, monthly: 12 }[range] ? range : 'daily';

    const seriesSql = {
      daily: `
        SELECT to_char(d, 'YYYY-MM-DD') AS bucket,
               coalesce(sum(o.total), 0)::float8 AS sales,
               count(o.id)::int AS orders
          FROM generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day') d
          LEFT JOIN orders o ON o.created_at::date = d::date AND o.status <> 'cancelled'
         GROUP BY d ORDER BY d`,
      weekly: `
        SELECT to_char(date_trunc('week', d), 'YYYY-MM-DD') AS bucket,
               coalesce(sum(o.total), 0)::float8 AS sales,
               count(o.id)::int AS orders
          FROM generate_series(date_trunc('week', current_date) - INTERVAL '11 weeks',
                               date_trunc('week', current_date), INTERVAL '1 week') d
          LEFT JOIN orders o ON o.created_at >= d AND o.created_at < d + INTERVAL '1 week'
                            AND o.status <> 'cancelled'
         GROUP BY date_trunc('week', d) ORDER BY date_trunc('week', d)`,
      monthly: `
        SELECT to_char(date_trunc('month', d), 'YYYY-MM') AS bucket,
               coalesce(sum(o.total), 0)::float8 AS sales,
               count(o.id)::int AS orders
          FROM generate_series(date_trunc('month', current_date) - INTERVAL '11 months',
                               date_trunc('month', current_date), INTERVAL '1 month') d
          LEFT JOIN orders o ON o.created_at >= d AND o.created_at < d + INTERVAL '1 month'
                            AND o.status <> 'cancelled'
         GROUP BY date_trunc('month', d) ORDER BY date_trunc('month', d)`,
    }[span];

    const { rows: series } = await query(seriesSql);
    const { rows: topProducts } = await query(`
      SELECT coalesce(p.name, oi.name) AS name,
             sum(oi.quantity)::int AS quantity,
             sum(oi.line_total)::float8 AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.status <> 'cancelled'
       GROUP BY 1 ORDER BY quantity DESC LIMIT 8`);
    const { rows: totals } = await query(`
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed_orders,
             count(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
             coalesce(sum(total) FILTER (WHERE status = 'completed'), 0)::float8 AS completed_sales,
             coalesce(sum(total) FILTER (WHERE status = 'completed' AND created_at >= current_date), 0)::float8 AS sales_today,
             coalesce(sum(total) FILTER (WHERE status = 'completed' AND created_at >= current_date - INTERVAL '6 days'), 0)::float8 AS sales_week,
             coalesce(sum(total) FILTER (WHERE status = 'completed' AND created_at >= date_trunc('month', current_date)), 0)::float8 AS sales_month
        FROM orders`);
    res.json({ range: span, series, topProducts, totals: totals[0] });
  } catch (err) {
    next(err);
  }
});

/* ---------- products ---------- */
router.get('/products', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, slug, name, description, category, unit, stock, available,
              price::float8 AS price, image, sort_order, created_at, updated_at
         FROM products WHERE deleted_at IS NULL
        ORDER BY sort_order, id`,
    );
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
});

function productPayload(body, { partial = false } = {}) {
  const out = {};
  const has = (key) => body[key] !== undefined;
  if (!partial || has('name')) {
    const name = text(body.name, 80);
    if (name.length < 2) throw badRequest('Enter a product name.', { name: 'Enter a product name.' });
    out.name = name;
  }
  if (!partial || has('description')) out.description = multiline(body.description, 800);
  if (!partial || has('category')) out.category = text(body.category, 60) || 'Chicken';
  if (!partial || has('unit')) out.unit = text(body.unit, 40);
  if (!partial || has('price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
      throw badRequest('Enter a valid price in KES.', { price: 'Enter a price between 0 and 1,000,000.' });
    }
    out.price = Math.round(price * 100) / 100;
  }
  if (!partial || has('stock')) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
      throw badRequest('Enter a valid stock quantity.', { stock: 'Use a whole number, 0 or more.' });
    }
    out.stock = stock;
  }
  if (!partial || has('available')) out.available = Boolean(body.available);
  if (!partial || has('image')) out.image = text(body.image, 500) || null;
  if (has('sort_order')) {
    const order = Number(body.sort_order);
    out.sort_order = Number.isInteger(order) ? order : 0;
  }
  return out;
}

async function uniqueSlug(base, excludeId = null) {
  const root = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { rows } = await query(
      'SELECT id FROM products WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)',
      [candidate, excludeId],
    );
    if (!rows[0]) return candidate;
  }
  return `${root}-${Date.now()}`;
}

router.post('/products', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const p = productPayload(req.body);
    const slug = await uniqueSlug(p.name);
    const { rows } = await query(
      `INSERT INTO products (slug, name, description, category, unit, price, stock, available, image, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, slug, name, description, category, unit, stock, available, price::float8 AS price, image, sort_order`,
      [slug, p.name, p.description, p.category, p.unit, p.price, p.stock, p.available ?? true, p.image, p.sort_order || 0],
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/products/:id', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'product' });
    const p = productPayload(req.body, { partial: true });
    const fields = Object.keys(p);
    if (!fields.length) throw badRequest('Nothing to update.');
    if (p.name) p.slug = await uniqueSlug(p.name, id);
    const keys = Object.keys(p);
    const values = keys.map((k) => p[k]);
    const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    values.push(id);
    const { rows } = await query(
      `UPDATE products SET ${setSql}, updated_at = now()
        WHERE id = $${values.length} AND deleted_at IS NULL
        RETURNING id, slug, name, description, category, unit, stock, available, price::float8 AS price, image, sort_order`,
      values,
    );
    if (!rows[0]) throw new HttpError(404, 'Product not found.');
    res.json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/products/:id', requireAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'product' });
    const { rows } = await query(
      `UPDATE products SET deleted_at = now(), available = FALSE, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, 'Product not found.');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
      cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : badRequest('Upload a JPG, PNG or WebP image.'), ok);
  },
});

router.post('/products/:id/image', requireAdmin, requireRole('admin'), upload.single('image'), async (req, res, next) => {
  try {
    const id = positiveInt(req.params.id, { field: 'product' });
    if (!req.file) throw badRequest('Choose an image to upload.');
    const url = `/uploads/${req.file.filename}`;
    const { rows } = await query(
      'UPDATE products SET image = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING id, slug, name, image',
      [url, id],
    );
    if (!rows[0]) throw new HttpError(404, 'Product not found.');
    res.json({ product: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
