const VOWEL = { a: "e", e: "a", i: "y", o: "u", u: "o", A: "E", E: "A", I: "Y", O: "U", U: "O" };

export function twist(word) {
  if (word.length <= 2) return word;
  return [...word]
    .map((ch, i) => (i === 0 || i === word.length - 1 ? ch : VOWEL[ch] ?? ch))
    .join("");
}

export function recognizableName(fullName) {
  const parts = fullName.split(" ");
  if (parts.length === 1) return twist(parts[0]);
  const surname = parts.pop();
  return [...parts, twist(surname)].join(" ");
}
