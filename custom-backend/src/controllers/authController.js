const env = require('../config/env');
const {
  clearLoginAttempts,
  findLoginAttempt,
  recordFailedAttempt,
} = require('../models/loginAttemptModel');
const { addRevokedToken } = require('../models/revokedTokenModel');
const { createUser, findUserByEmail } = require('../models/userModel');
const { comparePassword, hashPassword } = require('../utils/hash');
const { signToken } = require('../utils/jwt');

const INVALID_CREDENTIALS = { error: 'Invalid email or password' };
const LOCKED_OUT = { error: 'Too many failed attempts. Try again shortly.' };

// Unknown accounts still perform bcrypt work, making them harder to identify
// from response timing. The plaintext that produced this hash is irrelevant.
const DUMMY_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6OeWZJQp/Y.P0sW5tYI8FYbY4rX0oOW';

const cookieOptions = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
});

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function register(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email) || password.length < 8) {
      return res.status(400).json({
        error: 'A valid email and a password of at least 8 characters are required',
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);

    // The client contract requires this exact top-level shape.
    return res.status(201).json({ id: user.id, email: user.email });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(401).json(INVALID_CREDENTIALS);
    }

    const loginAttempt = await findLoginAttempt(email);

    // Check the lock before fetching the user or running bcrypt, as required.
    if (
      loginAttempt?.locked_until
      && new Date(loginAttempt.locked_until).getTime() > Date.now()
    ) {
      return res.status(429).json(LOCKED_OUT);
    }

    const user = await findUserByEmail(email);
    const passwordMatches = await comparePassword(
      password,
      user?.password_hash || DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      await recordFailedAttempt(email);

      // Never reveal whether the account exists or only its password was wrong.
      return res.status(401).json(INVALID_CREDENTIALS);
    }

    await clearLoginAttempts(email);
    const token = signToken(user);

    res.cookie(env.cookieName, token, cookieOptions);
    return res.status(200).json({ id: user.id, email: user.email });
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    // Persisting jti until the JWT expires makes this token unusable even if a
    // copied cookie is presented after the browser's cookie has been cleared.
    await addRevokedToken(req.user.jti, req.user.expiresAt);
    res.clearCookie(env.cookieName, cookieOptions);

    return res.status(200).json({ message: 'Logged out' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, logout };
