import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;

  // 1. SMTP Transporter Fallback (if SMTP settings configured)
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.RESEND_FROM_EMAIL || "Myco Fantasy <onboarding@resend.dev>",
        to,
        subject,
        html: html || `<p>${text}</p>`,
        text,
      });

      console.log(`[SMTP Email Sent Successfully]: Message ID ${info.messageId} to ${to}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error("[SMTP Service Exception]:", err.message);
      logMockEmailBanner({ to, subject, html, text, error: `SMTP Error: ${err.message}` });
      return { success: false, error: err.message };
    }
  }

  // 2. Resend API
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
      logMockEmailBanner({ to, subject, html, text, error: `Resend Error: ${err.message}` });
      return { success: false, error: err.message };
    }
  } else {
    logMockEmailBanner({ to, subject, html, text });
    return { success: true, mocked: true };
  }
}

function logMockEmailBanner({ to, subject, html, text, error }) {
  console.log("\n" + "=".repeat(68));
  if (error) {
    console.log(` 📧 [MOCK EMAIL SERVICE] - Fallback triggered due to error:`);
    console.log(`    ⚠️ ${error}`);
  } else {
    console.log(" 📧 [MOCK EMAIL SERVICE] - No email credentials configured");
  }
  console.log("=".repeat(68));
  console.log(` 📬 TO:      ${Array.isArray(to) ? to.join(", ") : to}`);
  console.log(` 📌 SUBJECT: ${subject}`);
  console.log("-".repeat(68));
  const textContent = text || html?.replace(/<[^>]*>?/gm, "") || "";
  console.log(` 📝 CONTENT:\n${textContent.trim()}`);
  console.log("=".repeat(68) + "\n");
}
