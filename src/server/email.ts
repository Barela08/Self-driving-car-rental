import crypto from 'crypto';
import { db } from './db.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM_EMAIL = 'EliteDrive <noreply@nileshbarela.site>';

const PLACEHOLDER_EMAILS = new Set([
  'master@elitedrive.in',
  'admin@gmail.com',
  'staff@gmail.com',
  'fleet@elitedrive.in',
  'finance@elitedrive.in',
  'support@elitedrive.in',
  'concierge@elitedrive.in',
]);

function isDeliverableEmail(raw: string | undefined | null): raw is string {
  const clean = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return false;
  if (PLACEHOLDER_EMAILS.has(clean)) return false;
  if (clean.endsWith('@elitedrive.in') || clean.endsWith('@example.com')) return false;
  return true;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getResendApiKey(): string {
  return (process.env.RESEND_API_KEY || '').trim();
}

export function getResendFromEmail(): string {
  const configured = (process.env.RESEND_FROM_EMAIL || '').trim();
  return configured || DEFAULT_FROM_EMAIL;
}

export function isResendConfigured(): boolean {
  return Boolean(getResendApiKey());
}

function buildBrandedHtml(params: {
  title: string;
  body: string;
  brandName: string;
  appUrl: string;
}): string {
  const safeBrand = escapeHtml(params.brandName || 'EliteDrive');
  const safeTitle = escapeHtml(params.title);
  const safeBody = escapeHtml(params.body).replace(/\n/g, '<br />');
  const safeUrl = escapeHtml(params.appUrl || 'http://localhost:3000');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0f17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f5f2eb;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background-color:#0b0f17;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#111827;border:1px solid rgba(212,175,55,0.28);border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background-color:#0b0f17;border-bottom:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#d4af37;font-weight:700;">${safeBrand}</p>
              <h1 style="margin:6px 0 0;font-size:19px;line-height:1.35;color:#ffffff;font-weight:600;">${safeTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;font-size:14px;line-height:1.65;color:#e5e7eb;">
              <p style="margin:0;">${safeBody}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <a href="${safeUrl}/dashboard" style="display:inline-block;padding:10px 18px;background-color:#d4af37;color:#0b0f17;text-decoration:none;font-size:13px;font-weight:700;border-radius:8px;">Open EliteDrive Dashboard</a>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px;background-color:#0b0f17;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#9ca3af;">
              This is an automated update from ${safeBrand}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendResendEmail(params: {
  to: string | string[];
  subject: string;
  body: string;
  userId?: string;
  bookingId?: string;
  category?: string;
}): Promise<{ ok: boolean; status: 'Sent' | 'Failed' | 'Queued'; id?: string; error?: string }> {
  const recipients = (Array.isArray(params.to) ? params.to : [params.to])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => isDeliverableEmail(e));

  if (recipients.length === 0) {
    return { ok: false, status: 'Failed', error: 'No deliverable recipient email address.' };
  }

  const now = new Date().toISOString();
  const mailId = `mail-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const apiKey = getResendApiKey();
  const from = getResendFromEmail();

  if (!apiKey) {
    await db.collection('email_fallbacks').doc(mailId).set({
      id: mailId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.bookingId ? { bookingId: params.bookingId } : {}),
      toEmail: recipients.join(', '),
      subject: params.subject,
      body: params.body,
      provider: 'resend',
      status: 'Queued',
      createdAt: now,
    });
    return { ok: false, status: 'Queued', error: 'RESEND_API_KEY not configured' };
  }

  let brandName = 'EliteDrive';
  try {
    const settingsSnap = await db.collection('company_settings').doc('default').get();
    const s = settingsSnap.data() as { brandName?: string; companyName?: string } | undefined;
    brandName = s?.brandName || s?.companyName || 'EliteDrive';
  } catch {
    // ignore brand lookup error
  }

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const html = buildBrandedHtml({
    title: params.subject,
    body: params.body,
    brandName,
    appUrl,
  });

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: `${brandName}: ${params.subject}`,
        html,
        text: `${params.subject}\n\n${params.body}\n\nOpen Dashboard: ${appUrl}/dashboard`,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const errMsg = data?.message || `Resend HTTP ${res.status}`;
      await db.collection('email_fallbacks').doc(mailId).set({
        id: mailId,
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.bookingId ? { bookingId: params.bookingId } : {}),
        toEmail: recipients.join(', '),
        fromEmail: from,
        subject: params.subject,
        body: params.body,
        provider: 'resend',
        status: 'Failed',
        errorDetails: errMsg,
        createdAt: now,
      });
      console.warn('Resend email failed:', errMsg);
      return { ok: false, status: 'Failed', error: errMsg };
    }

    await db.collection('email_fallbacks').doc(mailId).set({
      id: mailId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.bookingId ? { bookingId: params.bookingId } : {}),
      toEmail: recipients.join(', '),
      fromEmail: from,
      subject: params.subject,
      body: params.body,
      provider: 'resend',
      resendMessageId: data?.id || '',
      status: 'Sent',
      sentAt: new Date().toISOString(),
      createdAt: now,
    });
    return { ok: true, status: 'Sent', id: data?.id };
  } catch (err: any) {
    const errMsg = err?.message || 'Resend network request failed';
    await db.collection('email_fallbacks').doc(mailId).set({
      id: mailId,
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.bookingId ? { bookingId: params.bookingId } : {}),
      toEmail: recipients.join(', '),
      fromEmail: from,
      subject: params.subject,
      body: params.body,
      provider: 'resend',
      status: 'Failed',
      errorDetails: errMsg,
      createdAt: now,
    });
    console.warn('Resend email error:', errMsg);
    return { ok: false, status: 'Failed', error: errMsg };
  }
}

export async function resolveUserEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const [userSnap, privSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('users').doc(userId).collection('private').doc('info').get(),
    ]);
    const privEmail = (privSnap.data() as { email?: string } | undefined)?.email;
    const pubEmail = (userSnap.data() as { email?: string } | undefined)?.email;
    const chosen = privEmail || pubEmail;
    return isDeliverableEmail(chosen) ? chosen.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function sendNotificationEmail(params: {
  userId?: string;
  recipientEmail?: string;
  title: string;
  body: string;
  bookingId?: string;
  category?: string;
}): Promise<{ ok: boolean; status: 'Sent' | 'Failed' | 'Queued'; id?: string; error?: string }> {
  let targetEmail = isDeliverableEmail(params.recipientEmail)
    ? params.recipientEmail.trim().toLowerCase()
    : null;
  if (!targetEmail && params.userId) {
    targetEmail = await resolveUserEmail(params.userId);
  }
  if (!targetEmail) {
    return { ok: false, status: 'Failed', error: 'No deliverable user email found' };
  }
  return sendResendEmail({
    to: targetEmail,
    subject: params.title,
    body: params.body,
    userId: params.userId,
    bookingId: params.bookingId,
    category: params.category,
  });
}

export async function sendAdminAlertEmail(params: {
  title: string;
  message: string;
  type?: string;
}): Promise<void> {
  try {
    const envAdminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL || '').trim().toLowerCase();
    const targets = new Set<string>();
    if (isDeliverableEmail(envAdminEmail)) {
      targets.add(envAdminEmail);
    }

    const settingsSnap = await db.collection('company_settings').doc('default').get();
    const s = settingsSnap.data() as { supportEmail?: string; email?: string } | undefined;
    if (isDeliverableEmail(s?.supportEmail)) targets.add(s!.supportEmail!.trim().toLowerCase());
    if (isDeliverableEmail(s?.email)) targets.add(s!.email!.trim().toLowerCase());

    if (targets.size === 0) return;

    await sendResendEmail({
      to: Array.from(targets),
      subject: `[Admin Alert] ${params.title}`,
      body: params.message,
      category: params.type || 'admin_alert',
    });
  } catch (err) {
    console.warn('Admin alert email skipped:', err);
  }
}
