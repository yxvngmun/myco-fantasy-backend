import { pool } from "../db.js";
import { verifyJwt } from "../lib/jwt.js";

const JWT_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

export function requireAuth(req, res, next) {
  // 1. Check for JWT token in Authorization header
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const payload = verifyJwt(token, JWT_SECRET);
      if (payload && payload.superadminId) {
        req.session.superadminId = payload.superadminId;
        return next();
      }
    } catch (err) {
      // Token verification failed
    }
  }

  return res.status(401).json({ error: "Not authenticated" });
}
