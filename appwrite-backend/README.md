# Appwrite Backend

This directory contains the Appwrite implementation of the login and file-access screening task. It is deliberately different from `../custom-backend`: the custom backend implements auth, revocation, SQL isolation, and local file streaming by hand; this implementation configures Appwrite Auth, Databases, Storage, and permissions so Appwrite enforces those guarantees.

## Setup

Self-hosted Appwrite should already be running at `http://localhost/v1`. The Docker Compose stack uses its own environment file:

```powershell
cd appwrite
Copy-Item .env.example .env
docker compose up -d
```

The generated `.env` file under `appwrite/` is for Appwrite's server containers only. Keep it separate from `../.env`, which is used by this directory's Node seed script.

In the Appwrite Console, this implementation expects these resources to exist:

- A project and Web platform for `localhost`.
- A database whose ID is stored in `APPWRITE_DATABASE_ID`.
- A `profiles` collection whose ID is stored in `APPWRITE_PROFILES_COLLECTION_ID`.
- Profile attributes: `userId`, `fullName`, `displayName`, `bio`, `role`, all text.
- Document security enabled on `profiles`, with empty collection-level permissions.
- A `user-files` storage bucket whose ID is stored in `APPWRITE_BUCKET_ID`.
- File security enabled on the bucket, with empty bucket-level permissions.

Create a server API key with permissions for Users, Databases, and Storage. Then:

```powershell
cd appwrite-backend
Copy-Item .env.example .env
npm install
npm run seed
```

The seed script reads `../client/seed-data.json` directly. It does not hash passwords because Appwrite Auth receives plaintext passwords and hashes them internally. It creates reproducible local placeholder files under `seed-files/`, verifies their exact byte sizes, then uploads them to Appwrite Storage.

The script is intentionally non-destructive. If a seeded email already exists, it skips that user and logs it. A full re-seed should be done by clearing users, profile documents, and storage files in the Console first.

## Client Adapter

The test client contains the Appwrite Web SDK and adapter tags directly:

```html
<script src="https://cdn.jsdelivr.net/npm/appwrite@14.0.0"></script>
<script src="appwrite-adapter.js"></script>
```

The adapter implementation lives at `../client/appwrite-adapter.js`. To manually test Appwrite mode, serve `../client` directly:

```powershell
npx serve ../client --listen 5000
```

Then open `http://localhost:5000`, select **Appwrite**, and fill in the Appwrite endpoint, project ID, database ID, profiles collection ID, and storage bucket ID fields.

If the two Appwrite script tags in `../client/index.html` are still commented, enable those existing tags before testing Appwrite mode. The adapter itself remains the single implementation file at `../client/appwrite-adapter.js`.

In Appwrite mode, the existing client field labeled "Files collection ID" is used as the profiles collection ID. Set it to the value from `APPWRITE_PROFILES_COLLECTION_ID`.

## Registration Behavior

Registration is implemented in `../client/appwrite-adapter.js` because the fixed client posts to `/register`, while Appwrite exposes account creation through its Web SDK. In Appwrite mode the adapter handles `POST /register` by:

1. Deleting any current Appwrite session.
2. Calling `account.create(ID.unique(), email, password)`.
3. Creating an email/password session for the new account.
4. Returning the simplified `{ id, email }` shape expected by `client/index.html`.

This creates a real Appwrite Auth user and verifies that registration works. The seeded profile documents and storage files are still created by `seed.js`, so the complete profile/file isolation review should use the seeded Alice, Bob, and Carol accounts. A newly registered account can authenticate immediately, but it will not have seeded files unless the application provisions profile and file records for that new user.

## JWT vs Session Auth

The custom backend uses JWT access tokens in HttpOnly cookies plus a `revoked_tokens` table. That was a good manual design because JWTs are otherwise hard to invalidate before expiry.

Appwrite is different. The browser uses Appwrite's Account API, which creates secure server-side sessions managed by Appwrite. The client does not handle raw JWTs and the seed script does not create tokens. This is closer to a classic session-based design: the browser keeps Appwrite's session cookie, and Appwrite checks that session on Account, Database, and Storage requests.

That contrast is the interview story. In the custom backend, I built the token lifecycle and revocation logic. In Appwrite, I chose the platform's managed session model because it gives server-side invalidation without a custom revocation table.

## Logout

Logout is implemented with:

```javascript
account.deleteSession('current')
```

Appwrite invalidates the current session server-side. After that, the old browser session no longer authorizes Account, Database, or Storage operations. This is the managed equivalent of inserting a JWT `jti` into the custom backend's revocation table, except Appwrite owns the session store and the invalidation path.

## User Isolation

Profile isolation uses Appwrite Document Security. The `profiles` collection has empty collection-level permissions, so no profile is readable just because a user is authenticated. Each seeded profile document receives only:

```javascript
Permission.read(Role.user(appwriteUserId))
Permission.update(Role.user(appwriteUserId))
Permission.delete(Role.user(appwriteUserId))
```

File isolation uses Appwrite File Security. The `user-files` bucket has empty bucket-level permissions. Each uploaded file receives:

```javascript
Permission.read(Role.user(appwriteUserId))
```

That means `Storage.listFiles` naturally returns only files the current Appwrite session may read. The adapter does not manually filter by owner, because Appwrite's authorization engine is the isolation layer. This is also why using `Role.users()` would be a serious bug: it would grant every authenticated user access instead of just the owner.

### Storage 404 vs 403

The custom backend intentionally distinguishes two file errors: `404` when a file does not exist, and `403` when the file exists but belongs to another user.

Appwrite Storage behaves differently. With file security enabled, Appwrite returns `404 storage_file_not_found` both when a file is genuinely missing and when the file exists but the current user lacks permission to read it. This avoids revealing whether another user's private file exists.

The adapter preserves that Appwrite behavior instead of working around it with extra server-side lookups. In this implementation, Alice requesting Bob's real file ID returns `404`, not `403`, because Appwrite's permission model deliberately hides inaccessible storage objects.

## Appwrite vs My Configuration

Appwrite handled password hashing, secure session creation, session cookie management, server-side session invalidation, file storage, and the actual authorization enforcement engine. Appwrite's docs describe abuse protection through rate limits on routes, and self-hosted deployments can enable rate limiting with `_APP_OPTIONS_ABUSE=enabled`.

This repository's self-hosted Appwrite `.env.example` sets `_APP_OPTIONS_ABUSE=enabled`. I configured the project resources: the `profiles` schema, the storage bucket, document security, file security, and the exact per-user permission grants on every profile and file. That last part is still application logic. Appwrite denies access by default when permissions are empty, but the app must grant the correct user access to the correct resources.

## Improvements With More Time

- Add Appwrite Functions for server-side validation around registration and profile creation.
- Add a dedicated profile-creation flow for newly registered users from the test client.
- Verify and document the exact self-hosted abuse/rate-limit settings used in `.env`.
- Add Appwrite Teams if the product needed multi-user workspaces or organization-level access.
