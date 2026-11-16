import { Router } from 'express';
import { query } from '../db.js';
import { BUSINESS, ORDER_STATUSES, PAYMENT_METHODS, STATUS_LABELS } from '../lib/business.js';
import { buildOrderMessage } from '../lib/business.js';
import { buildWhatsappLink, buildWhatsappMessage, createOrder, loadOrder } from '../lib/orders.js';
import { HttpError, normPhone, text } from '../lib/validate.js';

const router = Router();

/* Simple in-memory rate limiting: enough for a single small business API. */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > windowMs) {
    hits.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (now - entry.start > 3600_000) hits.delete(key);
}, 600_000).unref();

router.get('/config', (req, res) => {
  res.json({
    business: {
      name: BUSINESS.name,
      whatsapp: BUSINESS.whatsapp,
      phoneDisplay: BUSINESS.phoneDisplay,
      email: BUSINESS.email,
      location: BUSINESS.location,
      hours: BUSINESS.hours,
    },
    deliveryFee: BUSINESS.deliveryFee,
    statuses: ORDER_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    paymentMethods: Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })),
  });
});

router.get('/products', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, slug, name, description, category, unit, stock, available,
              price::float8 AS price, image
         FROM products
        WHERE deleted_at IS NULL AND available = TRUE
        ORDER BY sort_order, id`,
    );
    res.set('Cache-Control', 'no-store');
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`order:${ip}`, 30, 10 * 60_000)) {
      throw new HttpError(429, 'Too many orders from this device. Please wait a few minutes.');
    }
    const { order, reused } = await createOrder(req.body);
    res.status(reused ? 200 : 201).json({
      order,
      reused,
      message: buildWhatsappMessage(order),
      whatsappUrl: buildWhatsappLink(order),
      businessWhatsapp: BUSINESS.whatsapp,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/track', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (!rateLimit(`track:${ip}`, 40, 10 * 60_000)) {
      throw new HttpError(429, 'Too many tracking attempts. Please wait a few minutes.');
    }
    const orderNo = text(req.body?.orderNo ?? req.body?.order_no, 40).toUpperCase();
    const phone = normPhone(req.body?.phone);
    if (!orderNo || !phone) {
      throw new HttpError(400, 'Enter your order reference and the phone number you ordered with.', {
        orderNo: orderNo ? '' : 'Order reference is required.',
        phone: phone ? '' : 'Enter the phone number used for the order.',
      });
    }
    const { rows } = await query(
      'SELECT id FROM orders WHERE upper(order_no) = $1 OR upper(replace(order_no, \' \', \'\')) = $1',
      [orderNo],
    );
    const order = rows[0] ? await loadOrder(rows[0].id) : null;
    const supplied = normPhone(phone);
    if (!order || normPhone(order.customerPhone) !== supplied) {
      throw new HttpError(404, 'We could not find an order with that reference and phone number.');
    }
    res.json({
      order: {
        orderNo: order.orderNo,
        status: order.status,
        statusLabel: STATUS_LABELS[order.status],
        customerName: order.customerName,
        fulfilment: order.fulfilment,
        deliveryLocation: order.deliveryLocation,
        notes: order.notes,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        items: order.items,
        history: order.history,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
