/**
 * Seeds the catalogue from the website content and ensures the administrator
 * account exists. Safe to run on every start:
 *  - existing products keep their price/stock edits,
 *  - the admin password follows the ADMIN_PASSWORD environment variable.
 *
 * The catalogue itself is the plain data file data/products.json at the
 * repository root, so every product (name, price, unit, stock, photo) is
 * visible and editable in the code. This script only publishes that file into
 * the database; products edited in the dashboard are never overwritten.
 */
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { pool, waitForDatabase } from '../src/db.js';
import { DEFAULT_INSTRUCTIONS } from '../src/lib/payments.js';

const PRODUCTS = JSON.parse(
  readFileSync(new URL('../../data/products.json', import.meta.url), 'utf8'),
);

async function main() {
  await waitForDatabase();

  for (const p of PRODUCTS) {
    await pool.query(
      `INSERT INTO products (slug, name, description, category, unit, price, stock, image, sort_order, available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       ON CONFLICT (slug) DO NOTHING`,
      [p.slug, p.name, p.description, p.category, p.unit, p.price, p.stock, p.image, p.sort_order],
    );
  }
  console.log(`[seed] catalogue ready (${PRODUCTS.length} products ensured)`);

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set - admin dashboard login is unavailable until both are provided');
  } else {
    const hash = await bcrypt.hash(password, 11);
    await pool.query(
      `INSERT INTO admins (email, password_hash, name, role)
       VALUES ($1,$2,$3,'admin')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name = EXCLUDED.name`,
      [email, hash, name],
    );
    console.log(`[seed] administrator ${email} is ready`);
  }

  // M-Pesa receiving details start from the business contact number; the owner
  // edits and verifies them in the dashboard. Never overwritten once it exists.
  const rawNumber = String(process.env.BUSINESS_WHATSAPP || '254726777924').replace(/\D/g, '');
  const localNumber = rawNumber.startsWith('254') ? `0${rawNumber.slice(3)}` : rawNumber;
  await pool.query(
    `INSERT INTO payment_settings (id, mpesa_number, account_name, instructions, enabled)
     VALUES (1, $1, $2, $3, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [localNumber, process.env.BUSINESS_NAME || 'Tabitha Chicken Company', DEFAULT_INSTRUCTIONS],
  );
  console.log('[seed] M-Pesa payment settings ready');

  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});
