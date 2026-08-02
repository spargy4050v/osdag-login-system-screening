const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const pool = require('../src/config/db');
const { hashPassword } = require('../src/utils/hash');

const seedDataPath = path.resolve(__dirname, '../../client/seed-data.json');
const storageDirectory = path.resolve(__dirname, '../storage/seeded');

async function createPlaceholderFile(fileDefinition, destinationPath) {
  const requestedSize = Number(fileDefinition.sizeBytes);

  if (!Number.isSafeInteger(requestedSize) || requestedSize < 0) {
    throw new Error(`Invalid sizeBytes for ${fileDefinition.id}`);
  }

  const description = Buffer.from(
    `Seeded placeholder for ${fileDefinition.fileName}\n`
      + `MIME type: ${fileDefinition.mimeType}\n`,
    'utf8',
  );

  // Padding the buffer makes the on-disk byte count genuinely match the JSON
  // metadata instead of merely copying the declared number into PostgreSQL.
  const content = Buffer.alloc(requestedSize, 0x20);
  description.copy(content, 0, 0, Math.min(description.length, content.length));
  await fs.writeFile(destinationPath, content);

  const stats = await fs.stat(destinationPath);
  if (stats.size !== requestedSize) {
    throw new Error(`Could not create ${fileDefinition.id} at its declared size`);
  }
}

async function loadSeedData() {
  // This is the single source of seed data; no user or file fixture is copied
  // into the backend repository.
  const json = await fs.readFile(seedDataPath, 'utf8');
  const seedData = JSON.parse(json);

  if (!Array.isArray(seedData.users)) {
    throw new Error('client/seed-data.json must contain a users array');
  }

  return seedData;
}

async function seedDatabase() {
  const seedData = await loadSeedData();
  const client = await pool.connect();

  // Only this dedicated generated subdirectory is replaced during reseeding.
  await fs.rm(storageDirectory, { recursive: true, force: true });
  await fs.mkdir(storageDirectory, { recursive: true });

  try {
    await client.query('BEGIN');

    // Clearing task-owned tables makes the script deterministic and idempotent.
    await client.query(
      'TRUNCATE TABLE revoked_tokens, login_attempts, files, users CASCADE',
    );

    const userIdMap = new Map();

    for (const seedUser of seedData.users) {
      const databaseUserId = randomUUID();
      const passwordHash = await hashPassword(seedUser.password);
      const profile = seedUser.profile || {};

      userIdMap.set(seedUser.id, databaseUserId);

      await client.query(
        `INSERT INTO users (
           id, email, password_hash, full_name, display_name, bio, role, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          databaseUserId,
          seedUser.email.toLowerCase(),
          passwordHash,
          profile.fullName ?? null,
          profile.displayName ?? null,
          profile.bio ?? null,
          profile.role ?? 'user',
          profile.createdAt ?? new Date(),
        ],
      );
    }

    let insertedFileCount = 0;

    for (const seedUser of seedData.users) {
      for (const seedFile of seedUser.files || []) {
        const databaseOwnerId = userIdMap.get(seedFile.ownerId);

        if (!databaseOwnerId) {
          throw new Error(
            `File ${seedFile.id} references unknown ownerId ${seedFile.ownerId}`,
          );
        }

        const databaseFileId = randomUUID();
        const safeFileName = path.basename(seedFile.fileName);
        const storagePath = path.join(
          storageDirectory,
          `${databaseFileId}-${safeFileName}`,
        );

        await createPlaceholderFile(seedFile, storagePath);

        await client.query(
          `INSERT INTO files (
             id, owner_id, file_name, mime_type, size_bytes, storage_path, uploaded_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            databaseFileId,
            databaseOwnerId,
            seedFile.fileName,
            seedFile.mimeType,
            seedFile.sizeBytes,
            storagePath,
            seedFile.uploadedAt,
          ],
        );

        insertedFileCount += 1;
      }
    }

    await client.query('COMMIT');
    console.log(
      `Seeded ${seedData.users.length} users and ${insertedFileCount} files from client/seed-data.json.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedDatabase().catch((error) => {
    console.error('Database seeding failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { createPlaceholderFile, loadSeedData, seedDatabase };
