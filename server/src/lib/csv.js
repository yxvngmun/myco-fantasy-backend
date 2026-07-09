export function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((col) => `"${String(row[col] ?? "").replaceAll('"', '""')}"`)
        .join(",")
    );
  }
  return lines.join("\n");
}
