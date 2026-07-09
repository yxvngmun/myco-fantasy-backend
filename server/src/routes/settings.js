import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function serialize(row) {
  return {
    minContestEntryFee: Number(row.min_contest_entry_fee),
    maxContestEntryFee: Number(row.max_contest_entry_fee),
    platformFeePercent: Number(row.platform_fee_percent),
    minPlayersPerContest: row.min_players_per_contest,
    maxPlayersPerContest: row.max_players_per_contest,
    userKycRequired: row.user_kyc_required,
    withdrawalMinAmount: Number(row.withdrawal_min_amount),
    maxTeamsPerUser: row.max_teams_per_user,
    fieldPolicies: row.field_policies,
  };
}

router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM global_settings WHERE id = 1");
  res.json(serialize(rows[0]));
});

router.put("/", async (req, res) => {
  const b = req.body || {};
  const { rows } = await pool.query(
    `UPDATE global_settings SET
      min_contest_entry_fee = $1,
      max_contest_entry_fee = $2,
      platform_fee_percent = $3,
      min_players_per_contest = $4,
      max_players_per_contest = $5,
      user_kyc_required = $6,
      withdrawal_min_amount = $7,
      max_teams_per_user = $8,
      field_policies = $9
     WHERE id = 1
     RETURNING *`,
    [
      b.minContestEntryFee,
      b.maxContestEntryFee,
      b.platformFeePercent,
      b.minPlayersPerContest,
      b.maxPlayersPerContest,
      Boolean(b.userKycRequired),
      b.withdrawalMinAmount,
      b.maxTeamsPerUser,
      JSON.stringify(b.fieldPolicies || {}),
    ]
  );
  res.json(serialize(rows[0]));
});

export default router;
