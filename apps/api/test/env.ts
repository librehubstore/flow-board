// Base dédiée par fichier de test, supprimée à la fin (voir helpers.close).
// TEST_MONGO_URL : serveur Mongo des tests (service `mongo` en CI), local par défaut.
process.env.MONGO_URL = `${process.env.TEST_MONGO_URL ?? 'mongodb://localhost:27017'}/flowboard_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'adminadmin12';
process.env.COOKIE_SECURE = 'false';
process.env.UPLOAD_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  `flowboard-test-${process.pid}`,
);
// Client OAuth Google factice : l'échange de code est simulé dans les tests (fetch intercepté).
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.APP_URL = 'http://flowboard.test';
