import express from "express";
import cors from "cors";
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
  app.use("/api/public", publicRoutes);

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  return app;
}
