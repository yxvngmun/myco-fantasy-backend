import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

const CRICKET_PLAYERS = [
  { id: 90001, name: "Virat Kohli", club: "India", short: "IND", color: "#0080C8", pos: "BAT", val: 12 },
  { id: 90002, name: "Rohit Sharma", club: "India", short: "IND", color: "#0080C8", pos: "BAT", val: 11 },
  { id: 90003, name: "Jasprit Bumrah", club: "India", short: "IND", color: "#0080C8", pos: "BOWL", val: 11 },
  { id: 90004, name: "Suryakumar Yadav", club: "India", short: "IND", color: "#0080C8", pos: "BAT", val: 10 },
  { id: 90005, name: "Hardik Pandya", club: "India", short: "IND", color: "#0080C8", pos: "AR", val: 9 },
  { id: 90006, name: "Ravindra Jadeja", club: "India", short: "IND", color: "#0080C8", pos: "AR", val: 9 },
  { id: 90007, name: "KL Rahul", club: "India", short: "IND", color: "#0080C8", pos: "WK", val: 8 },
  { id: 90008, name: "Babar Azam", club: "Pakistan", short: "PAK", color: "#006837", pos: "BAT", val: 12 },
  { id: 90009, name: "Shaheen Afridi", club: "Pakistan", short: "PAK", color: "#006837", pos: "BOWL", val: 10 },
  { id: 90010, name: "Mohammad Rizwan", club: "Pakistan", short: "PAK", color: "#006837", pos: "WK", val: 9 },
  { id: 90011, name: "Fakhar Zaman", club: "Pakistan", short: "PAK", color: "#006837", pos: "BAT", val: 8 },
  { id: 90012, name: "Shadab Khan", club: "Pakistan", short: "PAK", color: "#006837", pos: "AR", val: 8 },
  { id: 90013, name: "Pat Cummins", club: "Australia", short: "AUS", color: "#FFD700", pos: "BOWL", val: 11 },
  { id: 90014, name: "Steve Smith", club: "Australia", short: "AUS", color: "#FFD700", pos: "BAT", val: 10 },
  { id: 90015, name: "Mitchell Starc", club: "Australia", short: "AUS", color: "#FFD700", pos: "BOWL", val: 10 },
  { id: 90016, name: "David Warner", club: "Australia", short: "AUS", color: "#FFD700", pos: "BAT", val: 9 },
  { id: 90017, name: "Glenn Maxwell", club: "Australia", short: "AUS", color: "#FFD700", pos: "AR", val: 8 },
  { id: 90018, name: "Jos Buttler", club: "England", short: "ENG", color: "#003478", pos: "WK", val: 10 },
  { id: 90019, name: "Ben Stokes", club: "England", short: "ENG", color: "#003478", pos: "AR", val: 11 },
  { id: 90020, name: "Jofra Archer", club: "England", short: "ENG", color: "#003478", pos: "BOWL", val: 9 },
  { id: 90021, name: "Joe Root", club: "England", short: "ENG", color: "#003478", pos: "BAT", val: 10 },
  { id: 90022, name: "Kane Williamson", club: "New Zealand", short: "NZ", color: "#000000", pos: "BAT", val: 10 },
  { id: 90023, name: "Trent Boult", club: "New Zealand", short: "NZ", color: "#000000", pos: "BOWL", val: 9 },
  { id: 90024, name: "Devon Conway", club: "New Zealand", short: "NZ", color: "#000000", pos: "BAT", val: 8 },
  { id: 90025, name: "Quinton de Kock", club: "South Africa", short: "SA", color: "#007749", pos: "WK", val: 9 },
  { id: 90026, name: "Kagiso Rabada", club: "South Africa", short: "SA", color: "#007749", pos: "BOWL", val: 10 },
  { id: 90027, name: "Rashid Khan", club: "Afghanistan", short: "AFG", color: "#D32011", pos: "AR", val: 9 },
  { id: 90028, name: "Wanindu Hasaranga", club: "Sri Lanka", short: "SL", color: "#0033A0", pos: "AR", val: 8 },
];

async function seed() {
  const tournamentId = '6b8cf2ff-e3f4-4a71-8285-11d93bfdec84'; // FP Cric Bash

  const { rows: [{ count: existingCount }] } = await pool.query(
    `SELECT count(*) FROM players WHERE tournament_id = $1`,
    [tournamentId]
  );
  console.log(`Current player count for FP Cric Bash: ${existingCount}`);

  if (parseInt(existingCount) > 0) {
    console.log("Players already exist, skipping seed.");
    await pool.end();
    return;
  }

  console.log(`Seeding ${CRICKET_PLAYERS.length} cricket players...`);
  for (const p of CRICKET_PLAYERS) {
    await pool.query(
      `INSERT INTO players (tournament_id, id, name, club, short, color, pos, val)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [tournamentId, p.id, p.name, p.club, p.short, p.color, p.pos, p.val]
    );
  }

  // Also seed 3 fixtures
  const now = new Date();
  const fixtures = [
    { home: "India", hCode: "IND", hColor: "#0080C8", away: "Australia", aCode: "AUS", aColor: "#FFD700", date: new Date(now.getTime() + 2 * 86400000), status: "NS" },
    { home: "Pakistan", hCode: "PAK", hColor: "#006837", away: "England", aCode: "ENG", aColor: "#003478", date: new Date(now.getTime() + 4 * 86400000), status: "NS" },
    { home: "New Zealand", hCode: "NZ", hColor: "#000000", away: "South Africa", aCode: "SA", aColor: "#007749", date: new Date(now.getTime() + 6 * 86400000), status: "NS" },
  ];

  for (const f of fixtures) {
    await pool.query(
      `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tournamentId, "Group Stage", f.date.toISOString(), `Match Day`, f.home, f.hCode, f.hColor, f.away, f.aCode, f.aColor, f.status]
    );
  }

  const { rows: [{ count: newCount }] } = await pool.query(
    `SELECT count(*) FROM players WHERE tournament_id = $1`,
    [tournamentId]
  );
  console.log(`✅ Done! Now ${newCount} players in FP Cric Bash.`);

  await pool.end();
}

seed();
