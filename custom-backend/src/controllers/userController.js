const { findUserById } = require('../models/userModel');

async function getMe(req, res, next) {
  try {
    const user = await findUserById(req.user.id);

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    return res.status(200).json({
      id: user.id,
      email: user.email,
      profile: {
        fullName: user.full_name,
        displayName: user.display_name,
        bio: user.bio,
        role: user.role,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getMe };
