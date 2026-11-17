/**
 * Seeds the catalogue from the original website content and ensures the
 * administrator account exists. Safe to run on every start:
 *  - existing products keep their price/stock edits,
 *  - the admin password follows the ADMIN_PASSWORD environment variable.
 */
import bcrypt from 'bcryptjs';
import { pool, waitForDatabase } from '../src/db.js';
import { DEFAULT_INSTRUCTIONS } from '../src/lib/payments.js';

const PRODUCTS = [
  {
    slug: 'live',
    name: 'Live Chicken',
    description: 'Live chickens available for customers seeking whole birds.',
    category: 'Chicken',
    unit: 'per bird',
    price: 800,
    stock: 20,
    image: '/assets/products/live.jpg',
    sort_order: 1,
  },
  {
    slug: 'broiler',
    name: 'Broiler Chicken',
    description: 'Broiler chickens available for purchase.',
    category: 'Chicken',
    unit: 'per bird',
    price: 1500,
    stock: 15,
    image: '/assets/products/broiler.jpg',
    sort_order: 2,
  },
  {
    slug: 'chicks',
    name: 'Chicks',
    description: 'Chicks available for customers who want to start or grow their flock.',
    category: 'Chicks',
    unit: 'per chick',
    price: 200,
    stock: 100,
    image: '/assets/products/chicks.jpg',
    sort_order: 3,
  },
  {
    slug: 'eggs',
    name: 'Eggs',
    description: 'Eggs available for customers, if offered by the business.',
    category: 'Eggs',
    unit: 'per tray of 30',
    price: 360,
    stock: 40,
    image: '/assets/products/eggs.jpg',
    sort_order: 4,
  },
];

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
