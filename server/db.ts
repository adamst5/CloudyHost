import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Check for DATABASE_URL for production
let databaseUrl = process.env.DATABASE_URL;

// Development fallback only for Replit environment
if (!databaseUrl && process.env.NODE_ENV !== 'production') {
  console.log('Using development fallback DATABASE_URL');
  databaseUrl = 'postgresql://neondb_owner:npg_UOdt8j4YTcpP@ep-orange-tooth-aelqtiu4.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

console.log('Database connection configured for production');

// Create the database connection pool
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(pool);
export { pool };