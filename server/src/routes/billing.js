import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { computePartnerBilling, generateInvoiceNumber, currentPeriod } from "../lib/billing.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM partners ORDER BY name");
  res.json(
    rows.map((row) => ({
      partnerId: row.id,
      partnerName: row.name,
      subdomain: row.subdomain,
      ...computePartnerBilling(row),
    }))
  );
});

router.post("/:partnerId/invoices", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM partners WHERE id = $1", [
    req.params.partnerId,
  ]);
  const partner = rows[0];
  if (!partner) return res.status(404).json({ error: "Partner not found" });

  const billing = computePartnerBilling(partner);
  const invoiceNumber = generateInvoiceNumber(partner);

  const { rows: invoiceRows } = await pool.query(
    `INSERT INTO invoices (partner_id, invoice_number, period, total_entry_fees, our_share, partner_share, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      partner.id,
      invoiceNumber,
      currentPeriod(),
      billing.totalEntryFees,
      billing.ourShare,
      billing.partnerShare,
      billing.paymentStatus,
    ]
  );

  res.status(201).json(invoiceRows[0]);
});

router.get("/:partnerId/invoices", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM invoices WHERE partner_id = $1 ORDER BY generated_at DESC",
    [req.params.partnerId]
  );
  res.json(rows);
});

export default router;
