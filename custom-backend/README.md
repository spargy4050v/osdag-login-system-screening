# Custom Backend

This directory contains the hand-written Node.js, Express, and PostgreSQL implementation of the authentication and per-user file-access task. SQL is issued directly through `pg`; there is no ORM.

## Setup

1. Copy `.env.example` to `.env` and replace `JWT_SECRET` and the database credentials.
2. Create the PostgreSQL database.
3. Apply `db/schema.sql` to that database.
4. Run `npm install`.
5. Run `npm run seed` to load the fixed `../client/seed-data.json` fixture.
6. Start the API with `npm start`.

The seeded login credentials are the plaintext development credentials listed in `../client/seed-data.json`. The seed script bcrypt-hashes them before inserting them into PostgreSQL.

The API listens on `http://localhost:3000` by default. The test client should be served at `http://localhost:5000`, switched to **Custom REST backend**, and configured to **use cookie sessions**.

## Why JWT cookies plus a revocation list?

An HttpOnly cookie prevents frontend JavaScript from reading and accidentally exposing the access token. `Secure` limits transmission to secure contexts, and `SameSite=Strict` reduces cross-site request forgery exposure. A bearer token placed in local storage would be directly readable by injected JavaScript.

Plain server sessions provide simple revocation, but require every authenticated request to load the complete session state. A signed JWT lets the server verify identity and expiry from the token itself. The trade-off is that an ordinary JWT cannot be invalidated before expiry. The `revoked_tokens` table deliberately adds one small stateful check so logout has immediate server-side meaning.

## How logout works

Every access token receives a cryptographically random UUID in its `jti` claim. On `POST /logout`, authentication first verifies the JWT signature and expiry and confirms that its `jti` is not already revoked. The controller then inserts that `jti` and the token expiry into `revoked_tokens` and clears the browser cookie.

If a copied version of the same token is presented later, `authenticate.js` verifies its signature but then finds the `jti` in `revoked_tokens` and returns `401`. The token remains listed only until its natural expiry; expired rows can safely be removed because the JWT library will already reject those tokens.

## How file isolation is enforced

`GET /files` never fetches a global list and filters it in application memory. Its model query includes the authenticated identity directly:

```sql
SELECT id, owner_id, file_name, mime_type, size_bytes, uploaded_at
FROM files
WHERE owner_id = $1;
```

`$1` is `req.user.id` from the verified JWT. This makes accidental disclosure of another user's rows less likely and lets PostgreSQL use the owner index.

`GET /files/:id` and its download route must distinguish missing files from forbidden files. They therefore first execute:

```sql
SELECT id, owner_id, file_name, mime_type, size_bytes, storage_path, uploaded_at
FROM files
WHERE id = $1;
```

No row produces `404`. An existing row whose `owner_id` differs from `req.user.id` produces `403`. Only a matching owner receives metadata or file bytes. All values use `pg` parameters rather than SQL string concatenation.

## Design Decisions

### Mapping fixture IDs to PostgreSQL UUIDs

The provided fixture uses readable identifiers such as `usr_001` and `file_001`, while the required schema uses UUID primary and foreign keys. Those fixture identifiers cannot be inserted into UUID columns.

During seeding, each fixture user receives a generated UUID and the script records an in-memory mapping such as `usr_001 -> 8e5...`. Each file's `ownerId` is resolved through that map before insertion into `files.owner_id`. Files also receive generated UUIDs. This preserves every ownership relationship without weakening the database schema or changing the read-only fixture.

### Keeping file metadata truthful

The seed script creates each placeholder under `storage/seeded/` at exactly the `sizeBytes` declared by the fixture. It writes a short description and pads the remaining bytes. It verifies the resulting file size before inserting the row, so `files.size_bytes` describes the actual on-disk file rather than an unrelated copied number.

## Improvements with more time

- Store short-lived revocations and login counters in Redis to reduce database traffic.
- Add refresh-token rotation and reuse detection while keeping access tokens short-lived.
- Schedule deletion of expired `revoked_tokens` rows.
- Add IP-aware throttling alongside email lockout to make targeted account lockout harder.
- Add CSRF tokens if deployment requirements make `SameSite=Strict` impractical.
- Store file bytes in object storage and use short-lived signed download URLs.
