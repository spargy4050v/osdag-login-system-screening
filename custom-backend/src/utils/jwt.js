const { randomUUID } = require('crypto');
const jsonwebtoken = require('jsonwebtoken');
const env = require('../config/env');

function signToken(user) {
  return jsonwebtoken.sign(
    { email: user.email },
    env.jwtSecret,
    {
      algorithm: 'HS256',
      subject: user.id,
      jwtid: randomUUID(),
      expiresIn: env.jwtExpiry,
    },
  );
}

function verifyToken(token) {
  // Restrict verification to the algorithm used when signing our tokens.
  return jsonwebtoken.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };
