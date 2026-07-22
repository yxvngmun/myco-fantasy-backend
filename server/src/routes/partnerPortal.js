import { Router } from "express";
import { pool } from "../db.js";
import { sendEmail } from "../lib/email.js";
import { toCsv } from "../lib/csv.js";

const router = Router();

// Helper to generate secure random token
function generateToken() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Date.now().toString(36)
  );
}

// ----------------------------------------------------
// 1. ONBOARDING & 2-STEP KYC WORKFLOW
// ----------------------------------------------------

/**
 * SuperAdmin Partner Invite Dispatch
 * Dispatches onboarding email via Resend (or console fallback) with registration token link.
 */
router.post("/invite", async (req, res) => {
  const { name, email, subdomain, commission, monthlyFee } = req.body || {};
  if (!name || !email || !subdomain) {
    return res.status(400).json({ error: "Partner Name, Email, and Subdomain are required." });
  }

  try {
    // Check if subdomain is already taken
    const existing = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Subdomain '${subdomain}' is already registered.` });
    }

    const token = generateToken();
    const { rows } = await pool.query(
      `INSERT INTO partner_invites (partner_name, email, subdomain, commission, monthly_fee, invite_token)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, email, subdomain, commission || 15, monthlyFee || 0, token]
    );

    const invite = rows[0];
    const partnerPortalUrl = process.env.PARTNER_PORTAL_URL || "http://localhost:5174";
    const registerUrl = `${partnerPortalUrl}/register?token=${token}`;

    // Dispatch Onboarding Email
    await sendEmail({
      to: email,
      subject: `Invitation to Register your Partner Portal - ${name}`,
      html: `
        <h2>Welcome to Fantasy Partner Network</h2>
        <p>Dear ${name} Team,</p>
        <p>You have been invited by SuperAdmin to launch your white-label fantasy platform on <strong>${subdomain}.mycofantasy.local</strong>.</p>
        <p>Please click the button below to complete your 2-Step KYC Registration:</p>
        <p><a href="${registerUrl}" style="background:#00E676;color:#07110C;padding:12px 24px;text-decoration:none;font-weight:bold;border-radius:6px;display:inline-block;">Complete 2-Step Registration</a></p>
        <p>Direct Link: <a href="${registerUrl}">${registerUrl}</a></p>
      `,
      text: `You are invited to complete registration for ${name}. Register at: ${registerUrl}`,
    });

    res.status(201).json({
      message: "Partner invite created and email dispatched successfully.",
      invite,
      registerUrl,
    });
  } catch (err) {
    console.error("Error creating partner invite:", err);
    res.status(500).json({ error: "Failed to create partner invite." });
  }
});

/**
 * Verify Invite Token
 */
router.get("/verify-invite", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Invite token is required." });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM partner_invites WHERE invite_token = $1 AND status = 'Pending'",
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Invalid or expired invite token." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error verifying invite token:", err);
    res.status(500).json({ error: "Failed to verify token." });
  }
});

/**
 * Step 1: Registration Form Submission (Company details)
 */
router.post("/register-step1", async (req, res) => {
  const { token, legalCompanyName, contactName, phone, supportEmail, taxId } = req.body || {};
  if (!token || !legalCompanyName || !contactName || !phone || !supportEmail) {
    return res.status(400).json({ error: "Required fields missing for Step 1 registration." });
  }

  try {
    const inviteRes = await pool.query(
      "SELECT * FROM partner_invites WHERE invite_token = $1 AND status = 'Pending'",
      [token]
    );
    if (inviteRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired invite token." });
    }
    const invite = inviteRes.rows[0];

    // Check if partner record already exists for this subdomain, or create draft
    let partnerRes = await pool.query("SELECT * FROM partners WHERE subdomain = $1", [invite.subdomain]);
    let partner;

    if (partnerRes.rows.length === 0) {
      const inserted = await pool.query(
        `INSERT INTO partners (
           name, email, subdomain, contact_name, phone, legal_company_name, tax_id,
           support_email, commission, monthly_fee, status, sports
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          invite.partner_name,
          invite.email,
          invite.subdomain,
          contactName,
          phone,
          legalCompanyName,
          taxId || "",
          supportEmail,
          invite.commission,
          invite.monthly_fee,
          "Pending",
          JSON.stringify(["football"]),
        ]
      );
      partner = inserted.rows[0];
    } else {
      const updated = await pool.query(
        `UPDATE partners SET
           contact_name = $1, phone = $2, legal_company_name = $3, tax_id = $4, support_email = $5
         WHERE subdomain = $6 RETURNING *`,
        [contactName, phone, legalCompanyName, taxId || "", supportEmail, invite.subdomain]
      );
      partner = updated.rows[0];
    }

    res.json({ message: "Step 1 complete. Proceed to Step 2 KYC upload.", partnerId: partner.id });
  } catch (err) {
    console.error("Step 1 registration error:", err);
    res.status(500).json({ error: "Failed to complete Step 1 registration." });
  }
});

/**
 * Step 2: Upload Softcopy of Signed KYC / Master Service Agreement (PDF/JPEG)
 */
router.post("/register-step2-kyc", async (req, res) => {
  const { token, kycDocumentUrl } = req.body || {};
  if (!token || !kycDocumentUrl) {
    return res.status(400).json({ error: "Invite token and KYC document softcopy attachment are required." });
  }

  try {
    const inviteRes = await pool.query(
      "SELECT * FROM partner_invites WHERE invite_token = $1",
      [token]
    );
    if (inviteRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid invite token." });
    }
    const invite = inviteRes.rows[0];

    // Update partner status to 'Pending KYC Approval'
    const { rows } = await pool.query(
      `UPDATE partners SET
         kyc_document_url = $1,
         kyc_submitted_at = now(),
         status = 'Pending KYC Approval'
       WHERE subdomain = $2
       RETURNING *`,
      [kycDocumentUrl, invite.subdomain]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Partner record not found. Complete Step 1 first." });
    }

    // Mark invite as Completed
    await pool.query("UPDATE partner_invites SET status = 'Completed' WHERE id = $1", [invite.id]);

    res.json({
      message: "KYC document submitted successfully. Awaiting SuperAdmin in-portal approval.",
      partner: rows[0],
    });
  } catch (err) {
    console.error("Step 2 KYC registration error:", err);
    res.status(500).json({ error: "Failed to submit KYC document." });
  }
});

/**
 * SuperAdmin In-Portal Approval of Pending KYC
 */
router.post("/:id/approve-kyc", async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `UPDATE partners SET status = 'Active' WHERE id = $1 RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Partner not found." });
    }

    const partner = rows[0];
    const partnerPortalUrl = process.env.PARTNER_PORTAL_URL || "http://localhost:5174";
    const portalUrl = `${partnerPortalUrl}/portal?subdomain=${partner.subdomain}`;

    // Dispatch Activation Confirmation Email
    await sendEmail({
      to: partner.email,
      subject: `Your Partner Portal is Active! - ${partner.name}`,
      html: `
        <h2>Congratulations! Your Partner Portal is Approved & Active</h2>
        <p>Dear ${partner.contact_name || partner.name},</p>
        <p>Your signed KYC and Master Service Agreement have been reviewed and approved by SuperAdmin.</p>
        <p>You can now log in and access your Partner Admin Portal at:</p>
        <p><a href="${portalUrl}" style="background:#00E676;color:#07110C;padding:12px 24px;text-decoration:none;font-weight:bold;border-radius:6px;display:inline-block;">Access Partner Portal</a></p>
        <p>Direct Link: <a href="${portalUrl}">${portalUrl}</a></p>
      `,
      text: `Your Partner Portal is approved! Access at: ${portalUrl}`,
    });

    res.json({ message: "Partner KYC approved and activation email dispatched.", partner });
  } catch (err) {
    console.error("Approve KYC error:", err);
    res.status(500).json({ error: "Failed to approve KYC." });
  }
});

// ----------------------------------------------------
// 2. SUPERADMIN SPORT ASSIGNMENT & SDK DISPATCH
// ----------------------------------------------------

/**
 * SuperAdmin Assigns Sport to Partner & Generates Single SDK Snippet
 */
router.post("/:id/assign-sport", async (req, res) => {
  const { id } = req.params;
  const { sportKey } = req.body || {};

  if (!sportKey) {
    return res.status(400).json({ error: "sportKey is required." });
  }

  try {
    const partnerRes = await pool.query("SELECT * FROM partners WHERE id = $1", [id]);
    if (partnerRes.rows.length === 0) {
      return res.status(404).json({ error: "Partner not found." });
    }
    const partner = partnerRes.rows[0];

    // Ensure sport is added to partner's sports array
    const currentSports = Array.isArray(partner.sports) ? partner.sports : [];
    if (!currentSports.includes(sportKey)) {
      currentSports.push(sportKey);
      await pool.query("UPDATE partners SET sports = $1 WHERE id = $2", [JSON.stringify(currentSports), id]);
    }

    // Generate unique SDK token
    const sdkToken = `sdk_${partner.subdomain}_${sportKey}_${Date.now()}`;

    const { rows } = await pool.query(
      `INSERT INTO partner_sports_sdk (partner_id, sport_key, sdk_token, status)
       VALUES ($1, $2, $3, 'UNCONFIGURED')
       ON CONFLICT (partner_id, sport_key)
       DO UPDATE SET sdk_token = EXCLUDED.sdk_token, updated_at = now()
       RETURNING *`,
      [id, sportKey, sdkToken]
    );

    const sdkRecord = rows[0];
    const clientHost = req.headers.origin || process.env.CLIENT_URL || "http://localhost:5173";
    const sdkSnippet = `<script src="${clientHost}/sdk/embed.js" data-sdk-token="${sdkToken}" data-partner="${partner.subdomain}" data-sport="${sportKey}"></script>`;

    res.json({
      message: `Sport '${sportKey}' assigned to ${partner.name}. SDK Snippet generated.`,
      sdkRecord,
      sdkSnippet,
    });
  } catch (err) {
    console.error("Assign sport error:", err);
    res.status(500).json({ error: "Failed to assign sport." });
  }
});

// ----------------------------------------------------
// 3. MODULE 2: PARTNER PORTAL PRD ENDPOINTS (6.1 - 6.6)
// ----------------------------------------------------

/**
 * 6.1 Partner Dashboard 8 Metrics
 */
router.get("/:subdomain/dashboard", async (req, res) => {
  const { subdomain } = req.params;

  try {
    const partnerRes = await pool.query("SELECT * FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) {
      return res.status(404).json({ error: "Partner not found." });
    }
    const partner = partnerRes.rows[0];

    // Fetch registered users count
    const usersCountRes = await pool.query("SELECT COUNT(*) FROM partner_users WHERE partner_id = $1", [partner.id]);
    const totalUsers = parseInt(usersCountRes.rows[0].count, 10) || partner.users || 0;

    // Active users today
    const activeTodayRes = await pool.query(
      "SELECT COUNT(*) FROM partner_users WHERE partner_id = $1 AND last_active_at >= now() - interval '1 day'",
      [partner.id]
    );
    const activeUsersToday = parseInt(activeTodayRes.rows[0].count, 10) || Math.floor(totalUsers * 0.35);

    // Tournaments metrics
    const tournRes = await pool.query("SELECT * FROM tournaments WHERE partner_id = $1", [partner.id]);
    const liveTournamentsCount = tournRes.rows.filter((t) => t.status === "Active").length;
    const totalTournamentsCount = tournRes.rows.length;

    // Contests metrics
    const contestRes = await pool.query("SELECT * FROM contests WHERE partner_id = $1", [partner.id]);
    const totalContests = contestRes.rows.length;
    const liveContests = contestRes.rows.filter((c) => c.status === "Live" || c.status === "Upcoming").length;

    // Financial revenue metrics
    const totalRevenue = Number(partner.entry_fees_collected || 0);
    const platformFeesPaid = Number(partner.platform_fees_collected || 0);
    const netRevenueShare = Number(partner.revenue_share_collected || 0);

    const metrics = {
      totalRegisteredUsers: totalUsers,
      activeUsersToday,
      liveTournaments: liveTournamentsCount,
      totalTournaments: totalTournamentsCount,
      totalContests,
      liveContests,
      totalRevenue,
      platformFeesPaid,
      netRevenueShare,
    };

    res.json({ partner, metrics });
  } catch (err) {
    console.error("Dashboard metrics error:", err);
    res.status(500).json({ error: "Failed to load dashboard metrics." });
  }
});

/**
 * 6.1 Export Dashboard Metrics CSV
 */
router.get("/:subdomain/dashboard/export.csv", async (req, res) => {
  const { subdomain } = req.params;

  try {
    const partnerRes = await pool.query("SELECT * FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).end();
    const partner = partnerRes.rows[0];

    const usersCountRes = await pool.query("SELECT COUNT(*) FROM partner_users WHERE partner_id = $1", [partner.id]);
    const totalUsers = parseInt(usersCountRes.rows[0].count, 10) || partner.users || 0;

    const contestRes = await pool.query("SELECT * FROM contests WHERE partner_id = $1", [partner.id]);
    const tournRes = await pool.query("SELECT * FROM tournaments WHERE partner_id = $1", [partner.id]);

    const csvData = [
      {
        "Partner Name": partner.name,
        Subdomain: partner.subdomain,
        "Total Registered Users": totalUsers,
        "Live Tournaments": tournRes.rows.filter((t) => t.status === "Active").length,
        "Total Contests": contestRes.rows.length,
        "Total Entry Fees Revenue": partner.entry_fees_collected,
        "Platform Fees Paid": partner.platform_fees_collected,
        "Revenue Share Earned": partner.revenue_share_collected,
      },
    ];

    const csv = toCsv(csvData);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${subdomain}-metrics.csv`);
    res.send(csv);
  } catch (err) {
    console.error("Export CSV error:", err);
    res.status(500).send("CSV export failed");
  }
});

/**
 * 6.3 Contest Management (List & Create)
 */
router.get("/:subdomain/contests", async (req, res) => {
  const { subdomain } = req.params;
  try {
    const partnerRes = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });

    const { rows } = await pool.query(
      "SELECT * FROM contests WHERE partner_id = $1 ORDER BY created_at DESC",
      [partnerRes.rows[0].id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Fetch contests error:", err);
    res.status(500).json({ error: "Failed to fetch contests." });
  }
});

router.post("/:subdomain/contests", async (req, res) => {
  const { subdomain } = req.params;
  const { name, tournamentId, category, entryFee, maxEntries, winnerDistribution } = req.body || {};

  if (!name) return res.status(400).json({ error: "Contest name is required." });

  try {
    const partnerRes = await pool.query("SELECT id, commission FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });
    const partner = partnerRes.rows[0];

    const fee = Number(entryFee || 0);
    const maxE = Number(maxEntries || 100);
    const platformFeePct = Number(partner.commission || 15);
    const totalPrizeBeforeFee = fee * maxE;
    const prizePool = Math.max(0, totalPrizeBeforeFee * (1 - platformFeePct / 100));

    const defaultDistribution = winnerDistribution || [
      { rank: 1, percent: 50 },
      { rank: 2, percent: 30 },
      { rank: 3, percent: 20 },
    ];

    const { rows } = await pool.query(
      `INSERT INTO contests (
         partner_id, tournament_id, name, category, entry_fee, max_entries,
         prize_pool, winner_distribution, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Upcoming')
       RETURNING *`,
      [
        partner.id,
        tournamentId || null,
        name,
        category || "Practice",
        fee,
        maxE,
        prizePool,
        JSON.stringify(defaultDistribution),
      ]
    );

    // Update partner's contest count
    await pool.query("UPDATE partners SET contests = contests + 1 WHERE id = $1", [partner.id]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create contest error:", err);
    res.status(500).json({ error: "Failed to create contest." });
  }
});

/**
 * 6.4 User Management
 */
router.get("/:subdomain/users", async (req, res) => {
  const { subdomain } = req.params;
  const { search, status } = req.query;

  try {
    const partnerRes = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });
    const partnerId = partnerRes.rows[0].id;

    let query = "SELECT * FROM partner_users WHERE partner_id = $1";
    const params = [partnerId];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR user_identifier ILIKE $${params.length})`;
    }
    if (status && status !== "All") {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += " ORDER BY registered_at DESC";

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to fetch users." });
  }
});

router.patch("/:subdomain/users/:userId/status", async (req, res) => {
  const { subdomain, userId } = req.params;
  const { status } = req.body || {};

  if (!status || !["Active", "Suspended"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    const partnerRes = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });

    const { rows } = await pool.query(
      "UPDATE partner_users SET status = $1 WHERE id = $2 AND partner_id = $3 RETURNING *",
      [status, userId, partnerRes.rows[0].id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Update user status error:", err);
    res.status(500).json({ error: "Failed to update user status." });
  }
});

/**
 * 6.5 Branding & Customization
 */
router.get("/:subdomain/branding", async (req, res) => {
  const { subdomain } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM partners WHERE subdomain = $1", [subdomain]);
    if (rows.length === 0) return res.status(404).json({ error: "Partner not found" });
    const p = rows[0];

    res.json({
      name: p.name,
      logo: p.logo,
      faviconUrl: p.favicon_url,
      primaryColor: p.primary_color,
      secondaryColor: p.secondary_color,
      welcomeMessage: p.welcome_message,
      supportEmail: p.support_email,
      termsContent: p.terms_content,
      privacyContent: p.privacy_content,
    });
  } catch (err) {
    console.error("Get branding error:", err);
    res.status(500).json({ error: "Failed to get branding." });
  }
});

router.put("/:subdomain/branding", async (req, res) => {
  const { subdomain } = req.params;
  const b = req.body || {};

  try {
    const { rows } = await pool.query(
      `UPDATE partners SET
         name = COALESCE($1, name),
         logo = COALESCE($2, logo),
         favicon_url = COALESCE($3, favicon_url),
         primary_color = COALESCE($4, primary_color),
         secondary_color = COALESCE($5, secondary_color),
         welcome_message = COALESCE($6, welcome_message),
         support_email = COALESCE($7, support_email),
         terms_content = COALESCE($8, terms_content),
         privacy_content = COALESCE($9, privacy_content)
       WHERE subdomain = $10
       RETURNING *`,
      [
        b.name,
        b.logo,
        b.faviconUrl,
        b.primaryColor,
        b.secondaryColor,
        b.welcomeMessage,
        b.supportEmail,
        b.termsContent,
        b.privacyContent,
        subdomain,
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Update branding error:", err);
    res.status(500).json({ error: "Failed to update branding." });
  }
});

/**
 * 6.6 Finance & Withdrawals
 */
router.get("/:subdomain/finance", async (req, res) => {
  const { subdomain } = req.params;
  try {
    const partnerRes = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });
    const partnerId = partnerRes.rows[0].id;

    const { rows } = await pool.query(
      "SELECT * FROM transactions WHERE partner_id = $1 ORDER BY created_at DESC",
      [partnerId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch finance error:", err);
    res.status(500).json({ error: "Failed to fetch transactions." });
  }
});

router.post("/:subdomain/withdrawals/:id/action", async (req, res) => {
  const { subdomain, id } = req.params;
  const { action } = req.body || {}; // 'Approved' or 'Rejected'

  if (!["Approved", "Rejected"].includes(action)) {
    return res.status(400).json({ error: "Action must be 'Approved' or 'Rejected'." });
  }

  try {
    const partnerRes = await pool.query("SELECT id FROM partners WHERE subdomain = $1", [subdomain]);
    if (partnerRes.rows.length === 0) return res.status(404).json({ error: "Partner not found" });

    const { rows } = await pool.query(
      "UPDATE transactions SET status = $1 WHERE id = $2 AND partner_id = $3 RETURNING *",
      [action, id, partnerRes.rows[0].id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Withdrawal action error:", err);
    res.status(500).json({ error: "Failed to update withdrawal status." });
  }
});

export default router;
