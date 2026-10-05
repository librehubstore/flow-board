// Base dédiée par fichier de test, supprimée à la fin (voir helpers.close).
process.env.MONGO_URL = `mongodb://localhost:27017/flowboard_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'adminadmin12';
process.env.COOKIE_SECURE = 'false';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), `flowboard-test-${process.pid}`);
