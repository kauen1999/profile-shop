const { prisma } = require('./db');
const { admin } = require('./firebaseAdmin');
const { asyncHandler } = require('./asyncHandler');

// Shared by any route that needs to know "who is logged in" (reused by
// GET /stores/me and POST /stores, at minimum — see src/routes/stores.js).
// Verifies the Firebase ID token the same way src/routes/auth.js's
// POST /auth/google does, then resolves it to our own `User` row via
// `firebaseUid` and attaches it as `req.currentUser`. Returns a clean 401
// (same error-response shape as auth.js) on any failure — missing header,
// invalid/expired token, or no matching User (e.g. token valid but the user
// never completed POST /auth/google).
// Wrapped in asyncHandler (same as every route in this project) so a
// rejected promise here — e.g. Neon hiccup on the User lookup — hits the
// global error middleware instead of crashing the process.
const requireAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, idToken] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !idToken) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('Falha ao verificar idToken do Firebase:', err.message);
    return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }

  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });

  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado para este token.' });
  }

  req.currentUser = user;
  next();
});

module.exports = { requireAuth };
