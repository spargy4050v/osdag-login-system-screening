const app = require('./app');
const pool = require('./config/db');
const env = require('./config/env');

const server = app.listen(env.port, () => {
  console.log(`Custom backend listening on http://localhost:${env.port}`);
});

async function shutDown(signal) {
  console.log(`${signal} received; shutting down gracefully`);

  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('Failed to close the PostgreSQL pool:', error);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
