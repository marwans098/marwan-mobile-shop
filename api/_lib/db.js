import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

function getConnectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NO_SSL ||
    process.env.NEON_DATABASE_URL ||
    null
  );
}

let sqlClient = null;

function getSql() {
  const connectionString = getConnectionString();

  if (!connectionString) {
    throw new Error("لم يتم العثور على رابط قاعدة البيانات");
  }

  if (!sqlClient) {
    sqlClient = neon(connectionString);
  }

  return sqlClient;
}

export function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

export async function initDb() {
  const db = getSql();

  await db`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password TEXT NOT NULL,
      permissions JSONB DEFAULT '[]'::jsonb
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
}

export async function ensureAdmin() {
  const db = getSql();
  const result = await db`
    SELECT id FROM app_users WHERE username = 'admin' LIMIT 1
  `;

  if (result.length === 0) {
    await db`
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
  const db = getSql();
  const token = crypto.randomBytes(32).toString("hex");

  await db`
    INSERT INTO app_sessions
      (token, user_id, expires_at)
    VALUES
      (${token}, ${userId}, NOW() + INTERVAL '30 days')
  `;

  return token;
}

export async function getUserByToken(token) {
  const normalizedToken = String(token ?? "").trim();

  if (!normalizedToken) return null;

  const db = getSql();
  const result = await db`
    SELECT u.id, u.username, u.name, u.role, u.permissions
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token = ${normalizedToken}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return result[0] || null;
}