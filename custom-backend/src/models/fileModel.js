const pool = require('../config/db');

async function findFilesByOwnerId(ownerId) {
  const result = await pool.query(
    `SELECT id, owner_id, file_name, mime_type, size_bytes, uploaded_at
     FROM files
     WHERE owner_id = $1
     ORDER BY uploaded_at DESC, id`,
    [ownerId],
  );

  return result.rows;
}

async function findFileById(id) {
  // Ownership is intentionally checked after this lookup so the API can
  // distinguish a missing file (404) from another user's file (403).
  const result = await pool.query(
    `SELECT id, owner_id, file_name, mime_type, size_bytes, storage_path, uploaded_at
     FROM files
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

module.exports = { findFilesByOwnerId, findFileById };
