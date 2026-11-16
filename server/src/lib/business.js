/** Single source of truth for business details and order vocabulary. */

export const BUSINESS = {
  name: 'Tabitha Chicken Company',
  whatsapp: process.env.BUSINESS_WHATSAPP || '254726777924',
  phoneDisplay: '+254 726 777 924',
  email: process.env.BUSINESS_EMAIL || 'Tabitha3003@gmail.com',
  location: 'Makueni County, Kenya',
  hours: 'Every day, 5:00 AM – 6:00 PM',
  deliveryFee: Number(process.env.DELIVERY_FEE || 150),
};

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'ready_for_collection',
  'out_for_delivery',
  'completed',
  'cancelled',
];

export const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  ready_for_collection: 'Ready for Collection',
  out_for_delivery: 'Out for Delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PAYMENT_METHODS = {
  cash_on_delivery: 'Cash on Delivery',
  pay_on_collection: 'Pay on Collection',
  mpesa: 'M-Pesa',
};

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];

export const money = (value) =>
  Number(value).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const waUrl = (text) =>
  `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(text)}`;

/** Prefilled WhatsApp message that the shop receives for a new order. */
export function buildOrderMessage(order, items) {
  const lines = [
    BUSINESS.name.toUpperCase(),
    'NEW CUSTOMER ORDER',
    '',
    `Order Reference: ${order.order_no}`,
    '',
    `Customer Name: ${order.customer_name}`,
    `Phone Number: ${order.customer_phone}`,
  ];
  if (order.customer_email) lines.push(`Email: ${order.customer_email}`);
  lines.push('', 'ORDER DETAILS:');
  for (const item of items) {
    lines.push(`${item.name} × ${item.quantity} = KES ${money(item.line_total)}`);
  }
  lines.push(
    '',
    `Subtotal: KES ${money(order.subtotal)}`,
    `Delivery Fee: KES ${money(order.delivery_fee)}`,
    `TOTAL: KES ${money(order.total)}`,
    '',
    `Fulfilment: ${order.fulfilment === 'delivery' ? 'Delivery' : 'Collection'}`,
    `Delivery Location: ${order.delivery_location || 'N/A'}`,
    `Customer Instructions: ${order.notes || 'None'}`,
    `Payment Method: ${PAYMENT_METHODS[order.payment_method] || order.payment_method}`,
    '',
    'Thank you for choosing Tabitha Chicken Company!',
  );
  return lines.join('\n');
}
