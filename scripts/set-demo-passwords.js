// Set a known password on the four seeded demo accounts.
//
// WHY THIS EXISTS: "SQL/AMDB accounts.sql" seeds real scrypt hashes for
// manager@, cashier@ and staff@, but the plaintext behind them is not recorded
// anywhere in the repo, so after a fresh load nobody can sign in as those roles.
// Only admin@ works, because server/index.js re-seeds it on boot.
//
// This rehashes all four with the app's own scrypt helper, so the demo accounts
// are usable for testing role-based access.
//
//   npm run seed:demo-passwords              # sets every account to admin1234
//   npm run seed:demo-passwords -- s3cret    # or a password of your choosing
//
// Development convenience only. Never run it against a database holding real
// staff accounts — it overwrites their passwords.

const dbApi = require('../server/db');
const { hashPassword } = require('../server/password');

const EMAILS = [
  'admin@amrestaurant.local',
  'manager@amrestaurant.local',
  'cashier@amrestaurant.local',
  'staff@amrestaurant.local',
];

async function main() {
  const password = process.argv[2] || 'admin1234';
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  let changed = 0;
  for (const email of EMAILS) {
    const user = await dbApi.findUserByEmail(email);
    if (!user) {
      console.warn(`  skipped ${email} — not found (run SQL/AMDB accounts.sql first)`);
      continue;
    }
    await dbApi.updatePassword(user.id, hashPassword(password));
    console.log(`  ${email.padEnd(30)} ${user.role}`);
    changed += 1;
  }

  console.log(`\n${changed} account(s) set to "${password}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
