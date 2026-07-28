import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { toCsv } from "../lib/csv.js";
import { getPartnerHealth } from "../lib/health.js";
import { syncTournamentData } from "../lib/sync.js";

const router = Router();
router.use(requireAuth);

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    logo: row.logo,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    subdomain: row.subdomain,
    contactName: row.contact_name,
    phone: row.phone,
    businessType: row.business_type,
    commission: Number(row.commission),
    monthlyFee: Number(row.monthly_fee),
    status: row.status,
    sports: row.sports,
    users: row.users,
    contests: row.contests,
    platformFeesCollected: Number(row.platform_fees_collected),
    revenueShareCollected: Number(row.revenue_share_collected),
    entryFeesCollected: Number(row.entry_fees_collected),
    paymentStatus: row.payment_status,
    liveTournaments: row.live_tournaments,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    
    // KYC and Registration Details
    kyc_document_url: row.kyc_document_url,
    kycDocumentUrl: row.kyc_document_url,
    kyc_submitted_at: row.kyc_submitted_at,
    kycSubmittedAt: row.kyc_submitted_at,
    legal_company_name: row.legal_company_name,
    legalCompanyName: row.legal_company_name,
    tax_id: row.tax_id,
    taxId: row.tax_id,
    support_email: row.support_email,
    supportEmail: row.support_email,
  };
}

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM partners ORDER BY created_at DESC");
  res.json(rows.map(serialize));
});

router.get("/export.csv", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM partners ORDER BY created_at DESC");
  const partners = rows.map(serialize);
  const csv = toCsv(
    partners.map((partner) => ({
      "Partner Name": partner.name,
      Email: partner.email,
      Subdomain: partner.subdomain,
      Status: partner.status,
      "Business Type": partner.businessType,
      Sports: partner.sports.join(" / "),
      Users: partner.users,
      Contests: partner.contests,
      Revenue: partner.platformFeesCollected + partner.revenueShareCollected,
      Health: getPartnerHealth(partner).label,
    }))
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=partners.csv");
  res.send(csv);
});

router.get("/check-subdomain", async (req, res) => {
  const { subdomain, excludeId } = req.query;
  if (!subdomain) return res.status(400).json({ error: "subdomain required" });

  const { rows } = await pool.query(
    excludeId
      ? "SELECT id FROM partners WHERE subdomain = $1 AND id != $2"
      : "SELECT id FROM partners WHERE subdomain = $1",
    excludeId ? [subdomain, excludeId] : [subdomain]
  );
  res.json({ available: rows.length === 0 });
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.subdomain) {
    return res.status(400).json({ error: "name, email, and subdomain are required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO partners
        (name, email, logo, primary_color, secondary_color, subdomain, contact_name, phone,
         business_type, commission, monthly_fee, status, sports)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        b.name,
        b.email,
        b.logo || "",
        b.primaryColor || "#2563eb",
        b.secondaryColor || "#14b8a6",
        b.subdomain,
        b.contactName || "",
        b.phone || "",
        b.businessType || "Other",
        b.commission ?? 15,
        b.monthlyFee ?? 0,
        b.status || "Pending",
        JSON.stringify(b.sports || []),
      ]
    );
    res.status(201).json(serialize(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Subdomain already taken" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create partner" });
  }
});

const patchableFields = {
  name: "name",
  email: "email",
  logo: "logo",
  subdomain: "subdomain",
  primaryColor: "primary_color",
  secondaryColor: "secondary_color",
  contactName: "contact_name",
  phone: "phone",
  businessType: "business_type",
  commission: "commission",
  monthlyFee: "monthly_fee",
  status: "status",
  sports: "sports",
  users: "users",
  contests: "contests",
  platformFeesCollected: "platform_fees_collected",
  revenueShareCollected: "revenue_share_collected",
  entryFeesCollected: "entry_fees_collected",
  paymentStatus: "payment_status",
  liveTournaments: "live_tournaments",
};

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  const updates = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(patchableFields)) {
    if (key in b) {
      updates.push(`${column} = $${i++}`);
      values.push(key === "sports" ? JSON.stringify(b[key]) : b[key]);
    }
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  updates.push("last_activity_at = now()");
  values.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE partners SET ${updates.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Partner not found" });
    res.json(serialize(rows[0]));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Subdomain already taken" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update partner" });
  }
});

router.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM partners WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

router.get("/:id/tournaments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM tournaments WHERE partner_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch tournaments" });
  }
});

router.post("/:id/tournaments", async (req, res) => {
  const { 
    name, 
    sportKey, 
    status, 
    apiLeagueId, 
    apiSeason,
    splashTitle,
    logoUrl,
    primaryColor,
    secondaryColor,
    accentColor
  } = req.body || {};
  
  if (!name || !sportKey) {
    return res.status(400).json({ error: "name and sportKey are required" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO tournaments (
         partner_id, name, sport_key, status, api_league_id, api_season, 
         splash_title, logo_url, primary_color, secondary_color, accent_color
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.params.id, 
        name, 
        sportKey, 
        status || "Active", 
        apiLeagueId || null, 
        apiSeason || null,
        splashTitle || "",
        logoUrl || "",
        primaryColor || "#00E676",
        secondaryColor || "#00C965",
        accentColor || primaryColor || "#00E676"
      ]
    );
    
    // Update partner live_tournaments count
    await pool.query(
      "UPDATE partners SET live_tournaments = (SELECT COUNT(*) FROM tournaments WHERE partner_id = $1 AND status = 'Active') WHERE id = $1",
      [req.params.id]
    );

    // Trigger sync in background
    const tournament = rows[0];
    syncTournamentData(tournament.id, apiLeagueId, apiSeason).catch((err) => {
      console.error(`[Background Sync Error] for tournament ${tournament.id}:`, err.message || err);
    });

    res.status(201).json(tournament);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create tournament" });
  }
});

export default router;
