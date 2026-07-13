import { pool } from "../db.js";
import { verifyJwt } from "../lib/jwt.js";

export async function requirePartnerAuth(req, res, next) {
  const subdomain = req.headers["x-partner-subdomain"] || req.query.subdomain;

  if (!subdomain) {
    return res.status(400).json({ error: "Missing x-partner-subdomain header or subdomain query parameter" });
  }

  try {
    // 1. Fetch partner to ensure they exist, are Active, and to get their ID as the JWT secret
    const { rows } = await pool.query(
      "SELECT id, name, status, sports, commission, monthly_fee FROM partners WHERE subdomain = $1",
      [subdomain]
    );

    const partner = rows[0];
    if (!partner) {
      return res.status(404).json({ error: `Partner with subdomain '${subdomain}' not found` });
    }

    if (partner.status !== "Active") {
      return res.status(403).json({ error: `Partner '${partner.name}' is not currently active` });
    }

    // Attach partner context to request
    req.partner = {
      id: partner.id,
      name: partner.name,
      subdomain,
      sports: partner.sports,
    };

    // 2. Resolve optional end-user session via JWT token
    const authHeader = req.headers["authorization"];
    let token = req.query.token;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    if (token) {
      // Use partner's ID UUID as the secret key
      const payload = verifyJwt(token, partner.id);
      if (payload) {
        req.user = {
          id: payload.userId,
          name: payload.username || payload.name,
          email: payload.email,
        };
      }
    }

    next();
  } catch (err) {
    console.error("Partner auth middleware error:", err.message);
    res.status(500).json({ error: "Authentication check failed" });
  }
}

// Sub-middleware to enforce user authentication on write routes (e.g. saving team)
export function requireUserAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "End-user authentication token is missing or invalid" });
  }
  next();
}
