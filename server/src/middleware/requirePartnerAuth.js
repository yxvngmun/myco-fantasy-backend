import { pool } from "../db.js";
import { verifyJwt } from "../lib/jwt.js";

export async function requirePartnerAuth(req, res, next) {
  let subdomain = req.headers["x-partner-subdomain"] || req.query.subdomain || "footypool";
  if (subdomain === "copa-media" || subdomain === "copa") {
    subdomain = "footypool";
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

    // 2. Resolve end-user session via signed JWT token containing { userId, partnerId, subdomain, exp }
    const authHeader = req.headers["authorization"];
    let token = req.query.token;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    if (token) {
      if (token.startsWith("mock-") && process.env.NODE_ENV !== "production") {
        // Dev fallback for mock testing tokens
        req.user = {
          id: "dev-mock-user-12345",
          name: "Mock Dev Manager",
          email: "dev@myco.io",
          country: "United Kingdom",
        };
      } else {
        // Validate signed HS256 JWT with partner secret key
        const payload = verifyJwt(token, partner.id);
        if (payload) {
          // Verify claim matches current tenant partner subdomain if specified
          if (payload.subdomain && payload.subdomain !== partner.subdomain) {
            console.warn(`JWT Subdomain mismatch: payload '${payload.subdomain}' !== tenant '${partner.subdomain}'`);
          } else {
            req.user = {
              id: payload.userId || payload.id,
              name: payload.username || payload.name || "Fantasy Manager",
              email: payload.email || "",
              country: payload.country || "United Kingdom",
            };
          }
        }
      }
    }

    if (req.user) {
      try {
        await pool.query(
          `INSERT INTO partner_users (partner_id, user_identifier, name, email, country, last_active_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (partner_id, user_identifier)
           DO UPDATE SET
             name = COALESCE(NULLIF(EXCLUDED.name, ''), partner_users.name),
             email = COALESCE(NULLIF(EXCLUDED.email, ''), partner_users.email),
             country = COALESCE(NULLIF(EXCLUDED.country, ''), partner_users.country),
             last_active_at = now()`,
          [partner.id, req.user.id, req.user.name, req.user.email, req.user.country]
        );
      } catch (syncErr) {
        console.warn("Failed to sync partner user in middleware:", syncErr.message);
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
