const env = require('../config/env');
const { isTokenRevoked } = require('../models/revokedTokenModel');
const { verifyToken } = require('../utils/jwt');

async function authenticate(req, res, next) {
  const token = req.cookies[env.cookieName];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // jsonwebtoken verifies both the signature and the exp claim.
    const payload = verifyToken(token);

    // JWT verification alone cannot detect logout, so every protected request
    // checks the server-side revocation list by the token's unique jti.
    if (!payload.jti || await isTokenRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      jti: payload.jti,
      expiresAt: new Date(payload.exp * 1000),
    };

    return next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError'
      || error.name === 'TokenExpiredError'
      || error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    return next(error);
  }
}

module.exports = { authenticate };
