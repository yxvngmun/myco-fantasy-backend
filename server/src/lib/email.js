/**
 * Abstracted Email Helper Service
 * Uses Resend API when RESEND_API_KEY is present in process.env.
 * Gracefully logs formatted email contents to console terminal fallback when key is missing.
 */

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || "Myco Fantasy <onboarding@resend.dev>",
          to: Array.isArray(to) ? to : [to],
          subject,
          html: html || `<p>${text}</p>`,
          text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error("[Resend Email Error]:", data);
        throw new Error(data.message || "Failed to send email via Resend");
      }
      console.log(`[Resend Email Sent Successfully]: Message ID ${data.id} to ${to}`);
      return { success: true, messageId: data.id };
    } catch (err) {
      console.error("[Email Service Exception]:", err.message);
      logMockEmailBanner({ to, subject, html, text, error: err.message });
      return { success: false, error: err.message };
    }
  } else {
    logMockEmailBanner({ to, subject, html, text });
    return { success: true, mocked: true };
  }
}

function logMockEmailBanner({ to, subject, html, text, error }) {
  console.log("\n" + "=".repeat(68));
  console.log(" 📧 [MOCK EMAIL SERVICE] - RESEND_API_KEY is not configured");
  if (error) {
    console.log(` ⚠️ Fallback triggered due to error: ${error}`);
  }
  console.log("=".repeat(68));
  console.log(` 📬 TO:      ${Array.isArray(to) ? to.join(", ") : to}`);
  console.log(` 📌 SUBJECT: ${subject}`);
  console.log("-".repeat(68));
  const textContent = text || html?.replace(/<[^>]*>?/gm, "") || "";
  console.log(` 📝 CONTENT:\n${textContent.trim()}`);
  console.log("=".repeat(68) + "\n");
}
