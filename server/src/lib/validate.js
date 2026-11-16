/** Small, dependency-free input validation helpers. */

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (message, fields) => new HttpError(400, message, fields);

export function text(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Keep multi-line notes readable but bounded. */
export function multiline(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** Returns a normalised Kenyan mobile number in local form (07XXXXXXXX), or null. */
export function normPhone(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('254')) local = `0${local.slice(3)}`;
  else if (local.startsWith('7') && local.length === 9) local = `0${local}`;
  else if (local.startsWith('1') && local.length === 9) local = `0${local}`;
  if (!/^0[17]\d{8}$/.test(local)) return null;
  return local;
}

export const phoneIntl = (local) => `254${String(local).slice(1)}`;

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export function email(value) {
  const cleaned = text(value, 120).toLowerCase();
  if (!cleaned) return '';
  if (!isEmail(cleaned)) throw badRequest('Enter a valid email address or leave it blank.', { email: 'Enter a valid email address.' });
  return cleaned;
}

export function positiveInt(value, { min = 1, max = 100000, field = 'value' } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`Enter a valid ${field}.`, { [field]: `Must be a whole number between ${min} and ${max}.` });
  }
  return n;
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw badRequest(`Choose a valid ${field}.`, { [field]: `Allowed: ${allowed.join(', ')}` });
  }
  return value;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'product';
}
