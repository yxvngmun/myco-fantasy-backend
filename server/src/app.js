import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.js";
import partnersRoutes from "./routes/partners.js";
import sportsRoutes from "./routes/sports.js";
import settingsRoutes from "./routes/settings.js";
import billingRoutes from "./routes/billing.js";
import publicRoutes from "./routes/public.js";
import partnerPortalRoutes from "./routes/partnerPortal.js";

const PgSession = connectPgSimple(session);

function getAllowedOrigins() {
  const configured = process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173";
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  // 1. Helmet Security Headers with Frame Ancestors CSP for OTT Embedding (myco.io)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "http:", "https:", "ws:", "wss:"],
          frameAncestors: [
            "'self'",
            "https://myco.io",
            "https://*.myco.io",
            "http://localhost:*",
            "http://127.0.0.1:*",
            "http://192.168.*:*",
            "http://10.*:*",
            "http://172.16.*:*",
            "http://172.17.*:*",
            "http://172.18.*:*",
            "http://172.19.*:*",
            "http://172.20.*:*",
            "http://172.21.*:*",
            "http://172.22.*:*",
            "http://172.23.*:*",
            "http://172.24.*:*",
            "http://172.25.*:*",
            "http://172.26.*:*",
            "http://172.27.*:*",
            "http://172.28.*:*",
            "http://172.29.*:*",
            "http://172.30.*:*",
            "http://172.31.*:*"
          ]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  // 2. Rate Limiting for Public Endpoints (120 requests per minute per IP, relaxed in dev)
  const isDev = process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
  const publicApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: isDev ? 10000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again later." }
  });
  const allowedOrigins = getAllowedOrigins();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowedOrigins = getAllowedOrigins();
        const isAllowed = allowedOrigins.includes(origin) ||
          origin.endsWith(".vercel.app") ||
          origin.includes("ngrok") ||
          origin.endsWith(".loca.lt") ||
          /^https?:\/\/localhost:\d+$/.test(origin) ||
          /^https?:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
          /^https?:\/\/(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/.test(origin);

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error(`CORS blocked origin: ${origin}`));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/kyc", express.static("public/kyc"));

  app.use(
    session({
      store: new PgSession({ pool, tableName: "session" }),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false, // dynamically overridden
        sameSite: "lax", // dynamically overridden
      },
    })
  );

  // Dynamic session cookie configuration for local vs tunnel/production HTTPS
  app.use((req, res, next) => {
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (isSecure) {
      req.session.cookie.secure = true;
      req.session.cookie.sameSite = "none";
    } else {
      req.session.cookie.secure = false;
      req.session.cookie.sameSite = "lax";
    }
    next();
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/partners", partnersRoutes);
  app.use("/api/sports", sportsRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/partner-portal", partnerPortalRoutes);
  app.use("/api/public", publicApiLimiter, publicRoutes);

  // Run lightweight data patch on startup to zero out unplayed Round 4 stats in DB
  (async () => {
    try {
      const { rows } = await pool.query("SELECT tournament_id, id, stats_breakdown FROM players");
      for (const p of rows) {
        if (Array.isArray(p.stats_breakdown) && p.stats_breakdown.length > 0) {
          let changed = false;
          const updated = p.stats_breakdown.map((row) => {
            if (row.gw === 4 && (row.pts > 0 || row.mins > 0)) {
              changed = true;
              return { ...row, mins: 0, goals: 0, assists: 0, cleanSheet: false, yellowCards: 0, redCards: 0, saves: 0, pts: 0 };
            }
            return row;
          });
          if (changed) {
            await pool.query(
              "UPDATE players SET stats_breakdown = $1, updated_at = now() WHERE tournament_id = $2 AND id = $3",
              [JSON.stringify(updated), p.tournament_id, p.id]
            );
          }
        }
      }
    } catch (e) {
      console.error("Startup stats patch error:", e.message);
    }
  })();

  return app;
}
