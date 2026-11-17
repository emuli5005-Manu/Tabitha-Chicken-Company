/**
 * Manual M-Pesa payments.
 *
 * The business receives money on a personal Safaricom number, so there is no
 * STK Push and no automatic confirmation: the customer pays, types the
 * transaction code on the website, and an administrator checks that code
 * against the M-Pesa statement before marking the order as paid.
 *
 * `PAYMENT_PROVIDER` exists so a Daraja merchant account can be added later
 * without changing the order records: the manual flow stays the default.
 */
import { query } from '../db.js';
import { BUSINESS, PAYMENT_STATUS_LABELS } from './business.js';

export const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER === 'daraja' ? 'daraja' : 'manual';

export const DEFAULT_INSTRUCTIONS = [
  'Open M-Pesa on your phone and choose Send Money.',
  `Send the full order amount to the number below.`,
  'Use your order reference as the reason (for example TCC-0001).',
  'Enter the M-Pesa confirmation code you receive by SMS in the box here, then place your order.',
  'We check every payment against our M-Pesa statement and confirm your order on WhatsApp.',
].join(' ');

/** "0726 777 924" style display for an 07XXXXXXXX or 2547XXXXXXXX number. */
export function displayPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('254') ? `0${digits.slice(3)}` : digits;
  if (!/^0[17]\d{8}$/.test(local)) return String(value || '');
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** Safaricom confirmation codes are 8-12 letters/digits, e.g. RJ41K5M2QZ. */
export function normaliseMpesaCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function isValidMpesaCode(value) {
  const code = normaliseMpesaCode(value);
  if (code.length < 8 || code.length > 12) return false;
  if (!/^[A-Z0-9]+$/.test(code)) return false;
  // A real code always mixes letters and digits; reject obvious placeholders.
  if (!/[A-Z]/.test(code) || !/\d/.test(code)) return false;
  return !/^0+$/.test(code);
}

export function serializeSettings(row) {
  return {
    mpesaNumber: row.mpesa_number,
    mpesaNumberDisplay: displayPhone(row.mpesa_number),
    accountName: row.account_name,
    instructions: row.instructions,
    enabled: row.enabled,
    verified: Boolean(row.verified_at),
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    updatedAt: row.updated_at,
  };
}

/** The single settings row. Created by the migration/seed; created lazily too. */
export async function loadPaymentSettings() {
  const { rows } = await query('SELECT * FROM payment_settings WHERE id = 1');
  if (rows[0]) return rows[0];
  const { rows: created } = await query(
    `INSERT INTO payment_settings (id, mpesa_number, account_name, instructions, enabled)
     VALUES (1, $1, $2, $3, TRUE)
     ON CONFLICT (id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [BUSINESS.whatsapp, BUSINESS.name, DEFAULT_INSTRUCTIONS],
  );
  return created[0];
}

/** Kenyan mobile number in local form (07XXXXXXXX) or as given. */
export function localPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return `0${digits.slice(3)}`;
  if (digits.startsWith('7') && digits.length === 9) return `0${digits}`;
  return digits;
}

/** What the storefront is allowed to see. */
export function publicPayment(settings) {
  if (!settings?.enabled || !settings.mpesa_number) {
    return { enabled: false, method: 'mpesa', provider: PAYMENT_PROVIDER };
  }
  return {
    enabled: true,
    method: 'mpesa',
    provider: PAYMENT_PROVIDER,
    accountName: settings.account_name,
    mpesaNumber: localPhone(settings.mpesa_number),
    mpesaNumberDisplay: displayPhone(settings.mpesa_number),
    instructions: settings.instructions,
  };
}

export function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status;
}
