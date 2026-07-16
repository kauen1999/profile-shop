const path = require('path');
const admin = require('firebase-admin');

// Singleton init, same pattern as src/db.js's Prisma singleton: this module
// is require()'d from multiple places (routes, scripts) but the SDK must
// only be initialized once per process.
if (!admin.apps.length) {
  // FIREBASE_SERVICE_ACCOUNT_JSON (conteúdo do JSON inline) é a opção usada em
  // hosts de deploy, já que o arquivo apontado por FIREBASE_SERVICE_ACCOUNT_PATH
  // está no .gitignore e não existe fora da máquina local.
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccountPath = path.resolve(
      __dirname,
      '..',
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    serviceAccount = require(serviceAccountPath);
  } else {
    throw new Error(
      'Nem FIREBASE_SERVICE_ACCOUNT_JSON nem FIREBASE_SERVICE_ACCOUNT_PATH definidos — necessário um dos dois para inicializar o Firebase Admin SDK.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = { admin };
