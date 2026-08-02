const fs = require('fs/promises');
const path = require('path');
const {
  Client,
  Databases,
  ID,
  Permission,
  Query,
  Role,
  Storage,
  Users,
} = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');

require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

const requiredEnv = [
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'APPWRITE_API_KEY',
  'APPWRITE_DATABASE_ID',
  'APPWRITE_PROFILES_COLLECTION_ID',
  'APPWRITE_BUCKET_ID',
];

function getConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    endpoint: process.env.APPWRITE_ENDPOINT,
    projectId: process.env.APPWRITE_PROJECT_ID,
    apiKey: process.env.APPWRITE_API_KEY,
    databaseId: process.env.APPWRITE_DATABASE_ID,
    profilesCollectionId: process.env.APPWRITE_PROFILES_COLLECTION_ID,
    bucketId: process.env.APPWRITE_BUCKET_ID,
  };
}

function createServices(config) {
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setKey(config.apiKey);

  return {
    users: new Users(client),
    databases: new Databases(client),
    storage: new Storage(client),
  };
}

async function loadSeedData() {
  const seedPath = path.resolve(__dirname, '../client/seed-data.json');
  const json = await fs.readFile(seedPath, 'utf8');
  const seedData = JSON.parse(json);

  if (!Array.isArray(seedData.users)) {
    throw new Error('../client/seed-data.json must contain a users array');
  }

  return seedData;
}

async function createPlaceholderFile(fileDefinition, destinationPath) {
  const sizeBytes = Number(fileDefinition.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Invalid sizeBytes for ${fileDefinition.id}`);
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });

  const header = Buffer.from(
    `Appwrite seeded placeholder for ${fileDefinition.fileName}\n`
      + `MIME type: ${fileDefinition.mimeType}\n`,
    'utf8',
  );
  const content = Buffer.alloc(sizeBytes, 0x20);
  header.copy(content, 0, 0, Math.min(header.length, content.length));
  await fs.writeFile(destinationPath, content);

  const stats = await fs.stat(destinationPath);
  if (stats.size !== sizeBytes) {
    throw new Error(`Could not create ${fileDefinition.id} at its declared size`);
  }
}

async function findUserByEmail(users, email) {
  const result = await users.list({
    queries: [Query.equal('email', email)],
  });

  return result.users[0] || null;
}

async function findProfileByUserId(databases, config, userId) {
  const result = await databases.listDocuments({
    databaseId: config.databaseId,
    collectionId: config.profilesCollectionId,
    queries: [Query.equal('userId', userId), Query.limit(1)],
  });

  return result.documents[0] || null;
}

async function findFileForUserByName(storage, config, userId, fileName) {
  const result = await storage.listFiles({
    bucketId: config.bucketId,
    queries: [Query.limit(100)],
  });
  const ownerReadPermission = Permission.read(Role.user(userId));

  return result.files.find((file) => (
    file.name === fileName
    && Array.isArray(file.$permissions)
    && file.$permissions.includes(ownerReadPermission)
  )) || null;
}

async function seed() {
  const config = getConfig();
  const services = createServices(config);
  const seedData = await loadSeedData();
  const seedFilesDirectory = path.resolve(__dirname, 'seed-files');

  const summary = {
    usersCreated: [],
    usersReused: [],
    profilesReused: [],
    profilesCreated: [],
    filesReused: [],
    filesUploaded: [],
  };

  // This script is intentionally non-destructive. A complete re-seed should be
  // done by clearing users, profile documents, and storage files in the Console.
  for (const seedUser of seedData.users) {
    let appwriteUser = await findUserByEmail(services.users, seedUser.email);
    const profile = seedUser.profile || {};

    if (appwriteUser) {
      summary.usersReused.push({ email: seedUser.email, userId: appwriteUser.$id });
    } else {
      appwriteUser = await services.users.create({
        userId: ID.unique(),
        email: seedUser.email,
        password: seedUser.password,
        name: profile.fullName || profile.displayName || seedUser.email,
      });
      summary.usersCreated.push({ email: seedUser.email, userId: appwriteUser.$id });
    }

    const userPermissions = [
      Permission.read(Role.user(appwriteUser.$id)),
      Permission.update(Role.user(appwriteUser.$id)),
      Permission.delete(Role.user(appwriteUser.$id)),
    ];

    const existingProfile = await findProfileByUserId(
      services.databases,
      config,
      appwriteUser.$id,
    );

    if (existingProfile) {
      summary.profilesReused.push({
        email: seedUser.email,
        documentId: existingProfile.$id,
      });
    } else {
      const profileDocument = await services.databases.createDocument({
        databaseId: config.databaseId,
        collectionId: config.profilesCollectionId,
        documentId: ID.unique(),
        data: {
          userId: appwriteUser.$id,
          fullName: profile.fullName || '',
          displayName: profile.displayName || '',
          bio: profile.bio || '',
          role: profile.role || 'user',
        },
        permissions: userPermissions,
      });
      summary.profilesCreated.push({
        email: seedUser.email,
        documentId: profileDocument.$id,
      });
    }

    for (const seedFile of seedUser.files || []) {
      const existingFile = await findFileForUserByName(
        services.storage,
        config,
        appwriteUser.$id,
        seedFile.fileName,
      );

      if (existingFile) {
        summary.filesReused.push({
          email: seedUser.email,
          fileName: seedFile.fileName,
          fileId: existingFile.$id,
        });
        continue;
      }

      const safeName = path.basename(seedFile.fileName);
      const localPath = path.join(seedFilesDirectory, seedUser.id, safeName);

      await createPlaceholderFile(seedFile, localPath);

      const uploadedFile = await services.storage.createFile({
        bucketId: config.bucketId,
        fileId: ID.unique(),
        file: InputFile.fromPath(localPath, seedFile.fileName),
        permissions: [Permission.read(Role.user(appwriteUser.$id))],
      });

      summary.filesUploaded.push({
        email: seedUser.email,
        fileName: seedFile.fileName,
        fileId: uploadedFile.$id,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  seed().catch((error) => {
    console.error('Appwrite seed failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createPlaceholderFile,
  createServices,
  findFileForUserByName,
  findProfileByUserId,
  getConfig,
  loadSeedData,
  seed,
};
