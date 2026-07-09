export function computePartnerBilling(partner) {
  const entryFees = Number(partner.entry_fees_collected ?? 0);
  const commission = Number(partner.commission ?? 0);
  const revenueShareAmount = Math.round(entryFees * (commission / 100));
  const ourShare = revenueShareAmount + Number(partner.monthly_fee ?? 0);
  const partnerShare = entryFees - revenueShareAmount;

  return {
    monthlyFee: Number(partner.monthly_fee ?? 0),
    revenueSharePercent: commission,
    totalEntryFees: entryFees,
    ourShare,
    partnerShare,
    paymentStatus: partner.payment_status ?? "Pending",
  };
}

export function generateInvoiceNumber(partner) {
  const stamp = new Date().toISOString().slice(0, 7).replace("-", "");
  return `INV-${stamp}-${partner.subdomain.toUpperCase()}`;
}

export function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}
