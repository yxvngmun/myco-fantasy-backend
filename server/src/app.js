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

const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
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

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  return app;
}
