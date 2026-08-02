const { Pool } = require('pg');
const env = require('./env');

// A pool reuses a bounded set of PostgreSQL connections across requests.
const pool = new Pool({ connectionString: env.databaseUrl });

pool.on('error', (error) => {
  // Idle connection failures happen outside an Express request lifecycle.
  console.error('Unexpected PostgreSQL pool error:', error);
});

module.exports = pool;
