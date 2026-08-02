# Secure Login System With File Access

This repository contains two separate implementations of the same secure login and file-access task:

1. `custom-backend/` - a custom Node.js, Express, and PostgreSQL backend.
2. `appwrite-backend/` - a managed-backend implementation using self-hosted Appwrite Auth, Databases, and Storage.

The provided test UI is kept under `client/`. I did not create a replacement GUI; the same `client/index.html` is used to exercise both implementations. `mock-api.js` and `seed-data.json` are fixtures/reference files only and are not the real backend implementation:

- `client/index.html`
- `client/mock-api.js`
- `client/seed-data.json`

Both backend seed scripts read from `client/seed-data.json` as the source of truth for the three sample users and their seeded files.

## Verified Task Coverage

The JavaScript sources were syntax-checked with `node --check` across `custom-backend/`, `appwrite-backend/`, and `client/`. The Appwrite registration path was also manually verified through the provided client: in Appwrite mode, `POST /register` returned `201` after Appwrite created the account and the adapter mapped Appwrite's response to the fixed client shape.

| Requirement | Custom backend | Appwrite backend |
| --- | --- | --- |
| Registration | `POST /register` hashes the password with bcrypt and inserts a PostgreSQL user. | `POST /register` calls Appwrite Account `create`, then creates an Appwrite email/password session. |
| Login | `POST /login` returns a server-set HttpOnly JWT cookie. Errors are generic. | `POST /login` creates an Appwrite managed session. Errors are normalized by the adapter for the test client. |
| Logout | `POST /logout` inserts the JWT `jti` into `revoked_tokens` and clears the cookie. | `POST /logout` calls `account.deleteSession('current')`, invalidating the Appwrite session server-side. |
| `GET /me` | Reads the profile for `req.user.id` only. Supplied identifiers are ignored. | Reads the current Appwrite account and the readable profile document for that account. |
| `GET /files` | SQL query filters by authenticated `owner_id`. | Appwrite Storage file security returns only files readable by the current session. |
| `GET /files/:id` | Returns `404` for missing files and `403` for files owned by another user. | Appwrite returns `404` for missing or inaccessible private files; this is Appwrite's intentional non-disclosure behavior. |
| 3+ users | Seed script loads Alice, Bob, and Carol from `client/seed-data.json`. | Seed script creates/reuses Alice, Bob, and Carol in Appwrite and uploads their files. |
| Rate limiting/lockout | Failed logins are tracked in PostgreSQL and locked for 60 seconds after 5 failures. | Appwrite abuse protection is enabled in `appwrite-backend/appwrite/.env.example` with `_APP_OPTIONS_ABUSE=enabled`. |

Important Appwrite note: registration creates a real Appwrite Auth account and logs it in. Seeded profiles and files are created by `appwrite-backend/seed.js`, so the full profile/file review should use the seeded Alice/Bob/Carol accounts. A newly self-registered Appwrite user can authenticate immediately, but will not have seeded files unless files/profile data are provisioned for that account.

## Repository Layout

```text
.
+-- client/              # Provided test client, kept unchanged
+-- custom-backend/      # Express + PostgreSQL implementation
+-- appwrite-backend/    # Appwrite implementation and seed/adapter files
```

## Custom Backend

See `custom-backend/README.md` for the full setup and security explanation.

Summary:

- Uses Node.js, Express, PostgreSQL, and raw SQL through `pg`.
- Passwords are hashed with bcrypt.
- Login uses JWT access tokens in HttpOnly cookies.
- Logout invalidates tokens server-side by storing each logged-out token's `jti` in a `revoked_tokens` table.
- Protected routes check the JWT signature, expiry, and revocation list.
- Failed login attempts return a generic error and trigger lockout after repeated failures.
- File isolation is enforced in SQL using the authenticated user's ID.
- `GET /files/:id` returns `404` when the file does not exist and `403` when the file exists but belongs to another user.

Typical local setup:

```bash
cd custom-backend
npm install
copy .env.example .env
npm run seed
npm start
```

The API runs on `http://localhost:3000` by default.

## Appwrite Backend

See `appwrite-backend/README.md` for the full setup and security explanation.

Summary:

- Uses self-hosted Appwrite for Auth, Database, Storage, sessions, password hashing, and permission enforcement.
- The seed script creates three Appwrite users from `client/seed-data.json`.
- Profile data is stored in the Appwrite `profiles` collection.
- Files are uploaded to an Appwrite Storage bucket with per-user read permissions.
- Registration is implemented in `client/appwrite-adapter.js` through Appwrite Account creation.
- Logout uses `account.deleteSession('current')`, which invalidates the Appwrite session server-side.
- Appwrite's document security and file security enforce user isolation.

The Appwrite adapter exists because the fixed `client/index.html` expects REST-like actions such as `/login`, `/me`, and `/files`, while Appwrite exposes those operations through its Web SDK. `client/appwrite-adapter.js` maps the fixed client's actions to Appwrite SDK calls without creating a new GUI.

## Serve the Test Client

Do not open `client/index.html` through `file://`; browsers may block its request for `seed-data.json`.

From the repository root, serve the client over HTTP:

```bash
npx serve client --listen 5000
```

or:

```bash
python -m http.server 5000 --directory client
```

Then open:

```text
http://localhost:5000
```

For the custom backend:

- Select **Custom REST backend**.
- Use base URL `http://localhost:3000`.
- Enable **Backend uses cookie sessions**.

For the Appwrite backend:

- Select **Appwrite**.
- The Appwrite SDK and adapter script tags are already included in `client/index.html`, but commented out by default - uncomment them before testing Appwrite mode.
- Fill in the Appwrite endpoint, project ID, database ID, profiles collection ID, and storage bucket ID from your local Appwrite project.
- The field labeled **Files collection ID** is used as the Appwrite profiles collection ID in Appwrite mode. Set it to `APPWRITE_PROFILES_COLLECTION_ID`.

## Seeded Test Users

The development credentials come from `client/seed-data.json`:

- `alice@example.com` / `Password123!`
- `bob@example.com` / `Password123!`
- `carol@example.com` / `Password123!`

These plaintext passwords are only fixture data. The custom backend hashes them with bcrypt before insertion into PostgreSQL. Appwrite receives them through its user-creation API and handles password hashing internally.

## Review Checklist

Use this order when manually reviewing the task:

1. Start the custom backend, serve `client/`, select **Custom REST backend**, enable cookie sessions, and log in as Alice/Bob/Carol.
2. Confirm `GET /me` changes with the logged-in user and never accepts another user's identifier.
3. Confirm `GET /files` only lists the current user's files.
4. Copy a file ID from one user, log in as a different user, and confirm `GET /files/:id` returns `403` on the custom backend.
5. Start Appwrite, run `appwrite-backend` seeding, serve `client/`, select **Appwrite**, and enter the Appwrite IDs.
6. Register a new Appwrite user to confirm account creation works.
7. Log in as seeded Alice/Bob/Carol to confirm Appwrite profile and file isolation through document/file permissions.

## What To Review

The most relevant files for review are:

- `custom-backend/src/controllers/`
- `custom-backend/src/middleware/`
- `custom-backend/src/models/`
- `custom-backend/db/schema.sql`
- `custom-backend/db/seed.js`
- `appwrite-backend/seed.js`
- `client/appwrite-adapter.js`
- `custom-backend/README.md`
- `appwrite-backend/README.md`
