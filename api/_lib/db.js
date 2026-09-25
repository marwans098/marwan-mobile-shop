import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NO_SSL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error("لم يتم العثور على رابط قاعدة البيانات");
}

export const sql = neon(connectionString);

export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password TEXT NOT NULL,
      permissions JSONB DEFAULT '[]'::jsonb
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
}

export async function ensureAdmin() {
  const result = await sql`
    SELECT id FROM app_users WHERE username = 'admin' LIMIT 1
  `;

  if (result.length === 0) {
    await sql`
      INSERT INTO app_users
        (username, name, role, password, permissions)
      VALUES
        (
          'admin',
          'المدير',
          'مدير',
          'admin123',
          '["all"]'::jsonb
        )
    `;
  }
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");

  await sql`
    INSERT INTO app_sessions
      (token, user_id, expires_at)
    VALUES
      (${token}, ${userId}, NOW() + INTERVAL '30 days')
  `;

  return token;
}

export async function getUserByToken(token) {
  if (!token) return null;

  const result = await sql`
    SELECT u.id, u.username, u.name, u.role, u.permissions
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return result[0] || null;
}