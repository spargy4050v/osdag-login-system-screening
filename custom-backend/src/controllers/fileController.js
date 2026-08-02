const fs = require('fs');
const fsPromises = require('fs/promises');
const { findFileById, findFilesByOwnerId } = require('../models/fileModel');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function presentFile(file) {
  return {
    id: file.id,
    ownerId: file.owner_id,
    fileName: file.file_name,
    mimeType: file.mime_type,
    sizeBytes: Number(file.size_bytes),
    uploadedAt: file.uploaded_at,
  };
}

async function getAuthorizedFile(fileId, userId) {
  // Invalid UUIDs cannot exist in a UUID primary-key column, so they are 404s.
  if (!UUID_PATTERN.test(fileId)) {
    return { status: 404, error: 'File not found' };
  }

  const file = await findFileById(fileId);

  if (!file) {
    return { status: 404, error: 'File not found' };
  }

  if (file.owner_id !== userId) {
    return { status: 403, error: 'You do not have access to this file' };
  }

  return { file };
}

async function getFiles(req, res, next) {
  try {
    // Isolation begins in SQL: only the authenticated owner's rows are read.
    const files = await findFilesByOwnerId(req.user.id);
    return res.status(200).json({ files: files.map(presentFile) });
  } catch (error) {
    return next(error);
  }
}

async function getFile(req, res, next) {
  try {
    const result = await getAuthorizedFile(req.params.id, req.user.id);

    if (!result.file) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(200).json({ file: presentFile(result.file) });
  } catch (error) {
    return next(error);
  }
}

async function downloadFile(req, res, next) {
  try {
    const result = await getAuthorizedFile(req.params.id, req.user.id);

    if (!result.file) {
      return res.status(result.status).json({ error: result.error });
    }

    const file = result.file;
    const fileStats = await fsPromises.stat(file.storage_path);

    if (!fileStats.isFile()) {
      throw new Error(`Storage path is not a file: ${file.storage_path}`);
    }

    res.status(200);
    res.attachment(file.file_name);
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', String(fileStats.size));

    const fileStream = fs.createReadStream(file.storage_path);
    fileStream.on('error', next);
    return fileStream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

module.exports = { getFiles, getFile, downloadFile };
