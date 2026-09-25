import {
  sql,
  initDb,
  ensureAdmin,
  createSession
} from "../_lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "الطريقة غير مسموحة"
      });
    }

    await initDb();
    await ensureAdmin();

    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        error: "اكتب اسم المستخدم وكلمة المرور"
      });
    }

    const users = await sql`
      SELECT id, username, name, role, permissions
      FROM app_users
      WHERE username = ${username}
        AND password = ${password}
      LIMIT 1
    `;

    if (users.length === 0) {
      return res.status(401).json({
        error: "اسم المستخدم أو كلمة المرور غير صحيحة"
      });
    }

    const user = users[0];
    const token = await createSession(user.id);

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        permissions: user.permissions
      }
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "تعذر الاتصال بالخادم"
    });
  }
}