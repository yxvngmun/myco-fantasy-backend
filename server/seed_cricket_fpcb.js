import dotenv from "dotenv";
dotenv.config();
import { pool } from "./src/db.js";

const cricketPlayers = [
  { id: 1001, name: "Virat Kohli", club: "RCB", short: "Kohli", pos: "Batsman", val: 10.5 },
  { id: 1002, name: "Rohit Sharma", club: "MI", short: "Sharma", pos: "Batsman", val: 10.0 },
  { id: 1003, name: "Jasprit Bumrah", club: "MI", short: "Bumrah", pos: "Bowler", val: 9.5 },
  { id: 1004, name: "Rashid Khan", club: "GT", short: "Rashid", pos: "Bowler", val: 9.0 },
  { id: 1005, name: "Hardik Pandya", club: "MI", short: "Pandya", pos: "All-Rounder", val: 8.5 },
  { id: 1006, name: "KL Rahul", club: "LSG", short: "Rahul", pos: "Wicket-Keeper", val: 9.0 },
  { id: 1007, name: "Rishabh Pant", club: "DC", short: "Pant", pos: "Wicket-Keeper", val: 8.5 },
  { id: 1008, name: "Suryakumar Yadav", club: "MI", short: "SKY", pos: "Batsman", val: 9.5 },
  { id: 1009, name: "Shubman Gill", club: "GT", short: "Gill", pos: "Batsman", val: 9.0 },
  { id: 1010, name: "Ravindra Jadeja", club: "CSK", short: "Jadeja", pos: "All-Rounder", val: 8.5 },
  { id: 1011, name: "Mohammed Shami", club: "GT", short: "Shami", pos: "Bowler", val: 8.5 },
  { id: 1012, name: "Yuzvendra Chahal", club: "RR", short: "Chahal", pos: "Bowler", val: 8.0 },
  { id: 1013, name: "Jos Buttler", club: "RR", short: "Buttler", pos: "Wicket-Keeper", val: 10.0 },
  { id: 1014, name: "Glenn Maxwell", club: "RCB", short: "Maxwell", pos: "All-Rounder", val: 8.5 },
  { id: 1015, name: "Trent Boult", club: "RR", short: "Boult", pos: "Bowler", val: 8.5 },
  { id: 1016, name: "Sanju Samson", club: "RR", short: "Samson", pos: "Wicket-Keeper", val: 8.5 },
  { id: 1017, name: "Rinku Singh", club: "KKR", short: "Rinku", pos: "Batsman", val: 7.5 },
  { id: 1018, name: "Yashasvi Jaiswal", club: "RR", short: "Jaiswal", pos: "Batsman", val: 8.5 },
  { id: 1019, name: "Axar Patel", club: "DC", short: "Axar", pos: "All-Rounder", val: 8.0 },
  { id: 1020, name: "Arshdeep Singh", club: "PBKS", short: "Arshdeep", pos: "Bowler", val: 8.0 },
  { id: 1021, name: "Babar Azam", club: "PZ", short: "Babar", pos: "Batsman", val: 9.5 },
  { id: 1022, name: "Shaheen Afridi", club: "LQ", short: "Shaheen", pos: "Bowler", val: 9.0 },
  { id: 1023, name: "Mohammad Rizwan", club: "MS", short: "Rizwan", pos: "Wicket-Keeper", val: 9.0 },
  { id: 1024, name: "Shadab Khan", club: "ISLU", short: "Shadab", pos: "All-Rounder", val: 8.5 }
];

const cricketFixtures = [
  { round: "Match 1", date: "2026-08-10", dateLabel: "10 Aug 2026", homeName: "India", homeCode: "IND", homeColor: "#00E676", awayName: "Pakistan", awayCode: "PAK", awayColor: "#FF5252", status: "NS" },
  { round: "Match 2", date: "2026-08-12", dateLabel: "12 Aug 2026", homeName: "Australia", homeCode: "AUS", homeColor: "#FFD700", awayName: "England", awayCode: "ENG", awayColor: "#1E88E5", status: "NS" },
  { round: "Match 3", date: "2026-08-15", dateLabel: "15 Aug 2026", homeName: "South Africa", homeCode: "SA", homeColor: "#4CAF50", awayName: "New Zealand", awayCode: "NZ", awayColor: "#212121", status: "NS" }
];

async function run() {
  const { rows: tourns } = await pool.query("SELECT id FROM tournaments WHERE sport_key = 'cricket'");
  for (const t of tourns) {
    const tournamentId = t.id;
    console.log("Seeding cricket data for tournament", tournamentId);

    for (const f of cricketFixtures) {
      await pool.query(
        `INSERT INTO fixtures (tournament_id, round, event_date, date_label, home_name, home_code, home_color, away_name, away_code, away_color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tournament_id, round, home_name, away_name) DO NOTHING`,
        [tournamentId, f.round, f.date, f.dateLabel, f.homeName, f.homeCode, f.homeColor, f.awayName, f.awayCode, f.awayColor, f.status]
      );
    }

    for (const p of cricketPlayers) {
      const breakdown = JSON.stringify([
        { gw: 1, runs: 45, wickets: p.pos === "Bowler" ? 2 : 0, maidens: 0, catches: 1, runOuts: 0, stumpings: 0, overs: 4, economy: 6.5, pts: 65 },
        { gw: 2, runs: 28, wickets: p.pos === "Bowler" ? 1 : 0, maidens: 0, catches: 0, runOuts: 0, stumpings: 0, overs: 4, economy: 7.2, pts: 38 },
        { gw: 3, runs: 72, wickets: p.pos === "Bowler" ? 3 : 0, maidens: 1, catches: 2, runOuts: 0, stumpings: 0, overs: 4, economy: 5.0, pts: 110 }
      ]);
      const priceHistory = JSON.stringify([p.val - 0.2, p.val - 0.1, p.val]);

      await pool.query(
        `INSERT INTO players (tournament_id, id, name, club, short, color, jersey_number, pos, val, pts, total_pts, matches, status, opp, fixture_date, stats_breakdown, price_history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (tournament_id, id) DO UPDATE SET
           name = EXCLUDED.name, club = EXCLUDED.club, pos = EXCLUDED.pos, val = EXCLUDED.val, pts = EXCLUDED.pts, total_pts = EXCLUDED.total_pts, updated_at = now()`,
        [tournamentId, p.id, p.name, p.club, p.short, "#00E676", "18", p.pos, p.val, 65, 213, 3, "available", "PAK (H)", "10 Aug 2026", breakdown, priceHistory]
      );
    }
  }
  console.log("Cricket seeding completed!");
  await pool.end();
}

run();
