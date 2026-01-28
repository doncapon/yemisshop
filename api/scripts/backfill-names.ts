// scripts/backfill-names.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe(`
    UPDATE "User"
    SET
      "firstName" = COALESCE(NULLIF(split_part(COALESCE(name, ''), ' ', 1), ''), 'Unknown'),
      "lastName"  = COALESCE(NULLIF(split_part(COALESCE(name, ''), ' ', array_length(string_to_array(name, ' '), 1)), ''), 'Unknown'),
      "middleName" = NULLIF(
        NULLIF(regexp_replace(COALESCE(name,''), '^\\s*\\S+\\s*|\\s*\\S+\\s*$', '', 'g'), ''),
        ''
      )
  `);
  console.log('Backfilled names');
}
main().finally(() => prisma.$disconnect());
