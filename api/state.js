import { sql, initDb, getUserByToken } from "./_lib/db.js";

export default async function handler(req, res) {
  try {
    await initDb();

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : null;

    const user = await getUserByToken(token);

    if (!user) {
      return res.status(401).json({
        error: "غير مصرح بالدخول"
      });
    }

    if (req.method === "GET") {
      const rows = await sql`
        SELECT data
        FROM app_state
        WHERE id = 1
        LIMIT 1
      `;

      return res.status(200).json(
        rows.length ? rows[0].data : {}
      );
    }

    if (req.method === "PUT") {
      const data = req.body || {};

      await sql`
        INSERT INTO app_state (id, data, updated_at)
        VALUES (1, ${JSON.stringify(data)}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = NOW()
      `;

      return res.status(200).json({
        success: true
      });
    }

    return res.status(405).json({
      error: "الطريقة غير مسموحة"
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "تعذر الاتصال بالخادم"
    });
  }
}