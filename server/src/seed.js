import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const sportsSeed = [
  {
    key: "football",
    name: "Football",
    status: "Active",
    ruleProfile: "UEFA/FPL style",
    dataProvider: "API-Football",
    squadSize: 11,
    positions: [
      { name: "Goalkeeper", min: 1, max: 1 },
      { name: "Defender", min: 3, max: 5 },
      { name: "Midfielder", min: 3, max: 5 },
      { name: "Forward", min: 1, max: 3 },
    ],
    defaultScoring: [
      { event: "Playing 60+ mins", points: 2 },
      { event: "Playing < 60 mins", points: 1 },
      { event: "Goal (Forward)", points: 8 },
      { event: "Goal (Midfielder)", points: 9 },
      { event: "Goal (Defender)", points: 10 },
      { event: "Goal (Goalkeeper)", points: 12 },
      { event: "Assist", points: 5 },
      { event: "Clean Sheet (GK/Def)", points: 5 },
      { event: "Clean Sheet (Mid)", points: 1 },
      { event: "Every 3 Saves (GK)", points: 1 },
      { event: "Penalty Save", points: 9 },
      { event: "Penalty Miss", points: -4 },
      { event: "Yellow Card", points: -1 },
      { event: "Red Card", points: -3 },
      { event: "Own Goal", points: -3 }
    ],
    tournamentTypes: ["Daily Fantasy", "Weekly/Season Long", "Head-to-Head", "Mega Contest"],
  },
  {
    key: "cricket",
    name: "Cricket",
    status: "Active",
    ruleProfile: "T20/ODI fantasy style",
    dataProvider: "Cricket API",
    squadSize: 11,
    positions: [
      { name: "Wicket-Keeper", min: 1, max: 1 },
      { name: "Batsman", min: 3, max: 5 },
      { name: "All-Rounder", min: 1, max: 3 },
      { name: "Bowler", min: 3, max: 4 },
    ],
    defaultScoring: [
      { event: "Per Run", points: 1 },
      { event: "Boundary (4)", points: 1 },
      { event: "Six", points: 2 },
      { event: "Duck (Out for 0)", points: -2 },
      { event: "Wicket (Bowler)", points: 25 },
      { event: "Maiden Over", points: 8 },
      { event: "Catch", points: 8 },
      { event: "Run Out (Direct)", points: 12 },
      { event: "Stumping", points: 12 },
      { event: "30+ Runs", points: 4 },
      { event: "50+ Runs", points: 8 },
      { event: "100+ Runs", points: 16 },
      { event: "3 Wickets", points: 4 },
      { event: "5 Wickets", points: 8 },
      { event: "Economy < 5", points: 6 },
      { event: "Economy 5-6", points: 4 },
      { event: "Economy > 10", points: -2 }
    ],
    tournamentTypes: ["Daily Fantasy", "Weekly/Season Long", "Head-to-Head", "Mega Contest"],
  },
];

const partnersSeed = [
  {
    name: "EPL Fantasy",
    email: "ops@footypool.example",
    subdomain: "footypool",
    contactName: "Footy Pool Manager",
    phone: "+1 555 0181",
    businessType: "Sports",
    primaryColor: "#00E676",
    secondaryColor: "#00C965",
    commission: 15,
    monthlyFee: 2000,
    status: "Active",
    sports: ["football"],
    users: 1000,
    contests: 10,
    platformFeesCollected: 500,
    revenueShareCollected: 300,
    entryFeesCollected: 5000,
    paymentStatus: "Paid",
    liveTournaments: 1,
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const sport of sportsSeed) {
      await client.query(
        `INSERT INTO sports_config
          (key, name, status, rule_profile, data_provider, squad_size, positions, default_scoring, tournament_types)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (key) DO NOTHING`,
        [
          sport.key,
          sport.name,
          sport.status,
          sport.ruleProfile,
          sport.dataProvider,
          sport.squadSize,
          JSON.stringify(sport.positions),
          JSON.stringify(sport.defaultScoring),
          JSON.stringify(sport.tournamentTypes),
        ]
      );
    }

    await client.query(
      `INSERT INTO global_settings (id, field_policies) VALUES (1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [
        JSON.stringify({
          minContestEntryFee: "customizable",
          maxContestEntryFee: "customizable",
          platformFeePercent: "locked",
          minPlayersPerContest: "customizable",
          maxPlayersPerContest: "customizable",
          userKycRequired: "locked",
          withdrawalMinAmount: "locked",
          maxTeamsPerUser: "customizable",
        }),
      ]
    );

    for (const partner of partnersSeed) {
      await client.query(
        `INSERT INTO partners
          (name, email, subdomain, contact_name, phone, business_type,
           primary_color, secondary_color, commission, monthly_fee, status, sports,
           users, contests, platform_fees_collected, revenue_share_collected, entry_fees_collected,
           payment_status, live_tournaments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (subdomain) DO NOTHING`,
        [
          partner.name,
          partner.email,
          partner.subdomain,
          partner.contactName,
          partner.phone,
          partner.businessType,
          partner.primaryColor,
          partner.secondaryColor,
          partner.commission,
          partner.monthlyFee,
          partner.status,
          JSON.stringify(partner.sports),
          partner.users,
          partner.contests,
          partner.platformFeesCollected,
          partner.revenueShareCollected,
          partner.entryFeesCollected,
          partner.paymentStatus,
          partner.liveTournaments,
        ]
      );
    }

    const email = process.env.SEED_SUPERADMIN_EMAIL || "admin@fantasycore.local";
    const password = process.env.SEED_SUPERADMIN_PASSWORD || "changeme123";
    const passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO superadmins (name, email, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO NOTHING`,
      ["Super Admin", email, passwordHash]
    );

    await client.query("COMMIT");
    console.log("Seed complete.");
    console.log(`Superadmin login -> ${email} / ${password}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
