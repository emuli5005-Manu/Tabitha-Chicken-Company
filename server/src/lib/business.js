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

/**
 * Manual M-Pesa payments are confirmed by the owner against the M-Pesa
 * statement, so a customer submitting a code only moves an order as far as
 * "Payment Submitted". "Paid" is set by an administrator only.
 */
export const PAYMENT_STATUSES = [
  'awaiting_payment',
  'payment_submitted',
  'verification_required',
  'paid',
  'failed',
  'refunded',
];

export const PAYMENT_STATUS_LABELS = {
  awaiting_payment: 'Awaiting Payment',
  payment_submitted: 'Payment Submitted',
  verification_required: 'Verification Required',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

/** Statuses that still need the administrator to look at the money. */
export const OPEN_PAYMENT_STATUSES = ['awaiting_payment', 'payment_submitted', 'verification_required'];

export const money = (value) =>
  Number(value).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const waUrl = (text) =>
  `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(text)}`;

/** Prefilled WhatsApp message that the shop receives for a new order. */
export function buildOrderMessage(order, items) {
  const isMpesa = order.payment_method === 'mpesa';
  const lines = [
    BUSINESS.name.toUpperCase(),
    '',
    'NEW ORDER',
    '',
    `Order Reference: ${order.order_no}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.customer_phone}`,
    '',
    'Products:',
    ...items.map((item) => `${item.name} × ${item.quantity} = KES ${money(item.line_total)}`),
    '',
    `Total: KES ${money(order.total)}`,
    '',
    `Payment Method: ${PAYMENT_METHODS[order.payment_method] || order.payment_method}`,
  ];
  if (isMpesa) {
    lines.push(`Transaction Code: ${order.mpesa_code || 'Not provided'}`);
    lines.push('Payment Status: Awaiting Verification');
  } else {
    lines.push(`Payment Status: ${PAYMENT_STATUS_LABELS[order.payment_status] || 'Awaiting Payment'}`);
  }
  lines.push('', `Delivery Location: ${order.delivery_location || 'N/A'}`);
  if (order.notes) lines.push(`Customer Instructions: ${order.notes}`);
  return lines.join('\n');
}
