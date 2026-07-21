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

const PgSession = connectPgSimple(session);

function getAllowedOrigins() {
  const configured = process.env.CLIENT_ORIGIN || "http://127.0.0.1:5173,http://localhost:5173";
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function createApp() {
  const app = express();

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
            "http://127.0.0.1:*"
          ]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  // 2. Rate Limiting for Public Endpoints (120 requests per minute per IP)
  const publicApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
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
          /^https?:\/\/localhost:\d+$/.test(origin) ||
          /^https?:\/\/127\.0\.0\.1:\d+$/.test(origin);

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error(`CORS blocked origin: ${origin}`));
        }
      },
      credentials: true,
    })
  );
  app.use(express.json());

  app.use(
    session({
      store: new PgSession({ pool, tableName: "session" }),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/partners", partnersRoutes);
  app.use("/api/sports", sportsRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/public", publicApiLimiter, publicRoutes);

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  return app;
}
