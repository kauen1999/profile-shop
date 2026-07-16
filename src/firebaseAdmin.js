const path = require('path');
const admin = require('firebase-admin');

// Singleton init, same pattern as src/db.js's Prisma singleton: this module
// is require()'d from multiple places (routes, scripts) but the SDK must
// only be initialized once per process.
if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH não definido no .env — necessário para inicializar o Firebase Admin SDK.'
    );
  }

  const serviceAccountPath = path.resolve(
    __dirname,
    '..',
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  );

  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
  });
}

module.exports = { admin };
