// Seed a couple of demo accounts so you can log in immediately and test with
// two browser windows. Safe to run multiple times (upsert).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from './src/lib/prisma.js';

const DEMO_USERS = [
  { username: 'alice', email: 'alice@example.com', displayName: 'Alice', password: 'password123' },
  { username: 'bob', email: 'bob@example.com', displayName: 'Bob', password: 'password123' },
];

async function main() {
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: { email: u.email, displayName: u.displayName, passwordHash },
      create: {
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        passwordHash,
      },
    });
    console.log(`  seeded user: ${u.username} / ${u.password}`);
  }
}

main()
  .then(() => console.log('\nSeed complete.\n'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
