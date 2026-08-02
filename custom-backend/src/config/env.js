const path = require('path');

// Resolve from this file so `npm start` works from any current directory.
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});

const requiredVariables = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRY',
  'COOKIE_NAME',
  'PORT',
];

const missingVariables = requiredVariables.filter(
  (variableName) => !process.env[variableName]?.trim(),
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVariables.join(', ')}`,
  );
}

const port = Number(process.env.PORT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters');
}

module.exports = Object.freeze({
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY,
  cookieName: process.env.COOKIE_NAME,
  port,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5000',
});
