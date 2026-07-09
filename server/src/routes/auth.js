import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const { rows } = await pool.query(
    "SELECT * FROM superadmins WHERE email = $1",
    [email]
  );
  const admin = rows[0];
  if (!admin) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  req.session.superadminId = admin.id;
  res.json({ id: admin.id, name: admin.name, email: admin.email });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, email FROM superadmins WHERE id = $1",
    [req.session.superadminId]
  );
  if (!rows[0]) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(rows[0]);
});

router.patch("/profile", requireAuth, async (req, res) => {
  const { name, email, password } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  if (name) {
    updates.push(`name = $${i++}`);
    values.push(name);
  }
  if (email) {
    updates.push(`email = $${i++}`);
    values.push(email);
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    updates.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  values.push(req.session.superadminId);
  try {
    const { rows } = await pool.query(
      `UPDATE superadmins SET ${updates.join(", ")} WHERE id = $${i} RETURNING id, name, email`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
