const express = require('express');
const {
  downloadFile,
  getFile,
  getFiles,
} = require('../controllers/fileController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.get('/files', authenticate, getFiles);
router.get('/files/:id/download', authenticate, downloadFile);
router.get('/files/:id', authenticate, getFile);

module.exports = router;
