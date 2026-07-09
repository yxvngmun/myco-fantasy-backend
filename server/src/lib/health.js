export function getPartnerHealth(partner) {
  if (partner.status !== "Active") {
    return { label: "Red", color: "red", score: 35 };
  }

  if (partner.liveTournaments > 0 && partner.users >= 25000) {
    return { label: "Green", color: "green", score: 88 };
  }

  return { label: "Yellow", color: "gold", score: 62 };
}
