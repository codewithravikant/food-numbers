import { Resend } from 'resend';
import { SMTPClient } from 'smtp-client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

function appName() {
  return process.env.NEXT_PUBLIC_APP_NAME || 'FitNexus';
}

type InlineLogoAttachment = {
  contentId: string;
  filename: string;
  contentType: string;
  contentBase64: string;
};

type EmailBranding = {
  logoSrc?: string;
  inlineLogo?: InlineLogoAttachment;
};

const INLINE_LOGO_CID = 'fitnexus-logo';

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function asSafeHttpsUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return undefined;
    if (isLocalHost(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function defaultEmailLogoSrc(): string | undefined {
  const baseUrl = asSafeHttpsUrl(appUrl());
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, '')}/Fit_Email_Logo.svg`;
}

/** Public URL for logo image in emails (must be public https and not localhost). */
function emailLogoSrc(): string | undefined {
  return asSafeHttpsUrl(process.env.NEXT_PUBLIC_EMAIL_LOGO_URL) || defaultEmailLogoSrc();
}

function extensionToMimeType(ext: string): string | undefined {
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return undefined;
}

function filenameFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base || 'email-logo.png';
}

function inferFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const fromPath = parsed.pathname.split('/').pop();
    if (fromPath && fromPath.trim()) return fromPath;
  } catch {
    // Ignore parse issues and use fallback.
  }
  return 'email-logo.png';
}

function toInlineLogo(filename: string, contentType: string, buffer: Buffer): InlineLogoAttachment {
  return {
    contentId: INLINE_LOGO_CID,
    filename,
    contentType,
    contentBase64: buffer.toString('base64'),
  };
}

async function loadInlineLogoFromPath(filePath: string): Promise<InlineLogoAttachment | undefined> {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  const ext = path.extname(resolved).toLowerCase();
  const mime = extensionToMimeType(ext);
  if (!mime) return undefined;
  const fileBuffer = await readFile(resolved);
  return toInlineLogo(filenameFromPath(resolved), mime, fileBuffer);
}

async function loadInlineLogoFromUrl(url: string): Promise<InlineLogoAttachment | undefined> {
  const safeUrl = asSafeHttpsUrl(url);
  if (!safeUrl) return undefined;
  const response = await fetch(safeUrl);
  if (!response.ok) return undefined;
  const contentTypeHeader = response.headers.get('content-type')?.toLowerCase() || '';
  const contentType = contentTypeHeader.split(';')[0];
  if (!contentType.startsWith('image/')) return undefined;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType)) {
    return undefined;
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return toInlineLogo(inferFilenameFromUrl(safeUrl), contentType, buffer);
}

async function resolveInlineLogo(): Promise<InlineLogoAttachment | undefined> {
  const filePath = process.env.EMAIL_INLINE_LOGO_PATH?.trim();
  if (filePath) {
    try {
      const fromPath = await loadInlineLogoFromPath(filePath);
      if (fromPath) return fromPath;
    } catch {
      // Ignore logo read errors and continue with non-inline rendering.
    }
  }

  const inlineUrl = process.env.EMAIL_INLINE_LOGO_URL?.trim();
  if (inlineUrl) {
    try {
      const fromUrl = await loadInlineLogoFromUrl(inlineUrl);
      if (fromUrl) return fromUrl;
    } catch {
      // Ignore logo fetch errors and continue with non-inline rendering.
    }
  }

  return undefined;
}

async function resolveEmailBranding(): Promise<EmailBranding> {
  const inlineLogo = await resolveInlineLogo();
  if (inlineLogo) {
    return {
      logoSrc: `cid:${inlineLogo.contentId}`,
      inlineLogo,
    };
  }
  const remoteLogo = emailLogoSrc();
  return { logoSrc: remoteLogo };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Transactional HTML: table layout, inline styles, bulletproof button (works in common clients).
 */
function buildTransactionalEmail(opts: {
  preheader: string;
  title: string;
  intro: string;
  buttonLabel: string;
  actionUrl: string;
  secondaryHint: string;
  logoSrc?: string;
}): string {
  const name = escapeHtml(appName());
  const logoUrl = opts.logoSrc ? escapeHtml(opts.logoSrc) : undefined;
  const title = escapeHtml(opts.title);
  const intro = escapeHtml(opts.intro);
  const buttonLabel = escapeHtml(opts.buttonLabel);
  const actionUrl = escapeHtml(opts.actionUrl);
  const preheader = escapeHtml(opts.preheader);
  const secondaryHint = escapeHtml(opts.secondaryHint);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#070712;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#070712;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background-color:#111827;border:1px solid rgba(139,92,246,0.28);border-radius:16px;">
          <tr>
            <td style="padding:32px 28px 8px 28px;" align="center">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${name}" width="200" height="44" style="display:block;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;" />`
                  : `<div style="display:block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:#f5f3ff;">${name}</div>`
              }
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:600;color:#f5f3ff;">${title}</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#9ca3af;">${intro}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td align="center" bgcolor="#8b5cf6" style="border-radius:10px;">
                    <a href="${actionUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;font-weight:600;color:#140a2a;text-decoration:none;border-radius:10px;">${buttonLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#6b7280;">${secondaryHint}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;">
                <a href="${actionUrl}" style="color:#7dd3fc;text-decoration:underline;">${actionUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
              ${name} — numbers that don&apos;t lie
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function extractEmailAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim();
  if (trimmed.includes('@') && !trimmed.includes(' ')) return trimmed;
  return undefined;
}

function envelopeFromAddress() {
  return (
    extractEmailAddress(process.env.EMAIL_FROM) ||
    extractEmailAddress(process.env.SMTP_USER) ||
    'onboarding@resend.dev'
  );
}

function fromAddress() {
  return process.env.EMAIL_FROM || envelopeFromAddress();
}

function smtpEnabled() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Trimmed key; empty/whitespace-only env must not count as configured. */
function resendApiKey(): string | undefined {
  const v = process.env.RESEND_API_KEY?.trim();
  return v || undefined;
}

function hasResendConfigured(): boolean {
  return Boolean(resendApiKey());
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  inlineLogo?: InlineLogoAttachment
) {
  const key = resendApiKey();
  if (!key) {
    throw new Error('RESEND_API_KEY is missing or whitespace-only');
  }
  const resend = new Resend(key);
  await resend.emails.send({
    from: fromAddress(),
    to,
    subject,
    html,
    attachments: inlineLogo
      ? [
          {
            filename: inlineLogo.filename,
            content: inlineLogo.contentBase64,
            contentType: inlineLogo.contentType,
            contentId: inlineLogo.contentId,
          },
        ]
      : undefined,
  });
}

function chunkBase64(base64: string): string {
  return base64.match(/.{1,76}/g)?.join('\r\n') || base64;
}

function buildSmtpMessage(
  to: string,
  subject: string,
  html: string,
  inlineLogo?: InlineLogoAttachment
): string {
  if (!inlineLogo) {
    return [
      `From: ${fromAddress()}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html.trim(),
      '',
    ].join('\r\n');
  }

  const boundary = `fitnexus-related-${Date.now().toString(36)}`;
  const encodedImage = chunkBase64(inlineLogo.contentBase64);
  return [
    `From: ${fromAddress()}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html.trim(),
    '',
    `--${boundary}`,
    `Content-Type: ${inlineLogo.contentType}; name="${inlineLogo.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: inline; filename="${inlineLogo.filename}"`,
    `Content-ID: <${inlineLogo.contentId}>`,
    '',
    encodedImage,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function sendViaSmtp(
  to: string,
  subject: string,
  html: string,
  inlineLogo?: InlineLogoAttachment
) {
  if (!smtpEnabled()) {
    return;
  }

  const host = process.env.SMTP_HOST as string;
  const user = process.env.SMTP_USER as string;
  const pass = process.env.SMTP_PASS as string;
  const port = Number(process.env.SMTP_PORT || '465');
  const secure = port === 465;
  const client = new SMTPClient({
    host,
    port,
    secure,
  });

  await client.connect();
  try {
    await client.greet({ hostname: 'localhost' });
    await client.authPlain({ username: user, password: pass });
    // SMTP envelope sender must be a plain email address (no display name).
    await client.mail({ from: envelopeFromAddress() });
    await client.rcpt({ to });

    const message = buildSmtpMessage(to, subject, html, inlineLogo);

    await client.data(message);
  } finally {
    await client.quit();
  }
}

async function sendEmailWithTemplate(
  to: string,
  subject: string,
  template: Omit<Parameters<typeof buildTransactionalEmail>[0], 'logoSrc'>
) {
  const branding = await resolveEmailBranding();
  const html = buildTransactionalEmail({
    ...template,
    logoSrc: branding.logoSrc,
  });

  const hasSmtp = smtpEnabled();
  const hasResend = hasResendConfigured();

  if (hasSmtp) {
    try {
      await sendViaSmtp(to, subject, html, branding.inlineLogo);
      return;
    } catch (error) {
      if (!hasResend) {
        throw error;
      }
    }
  }

  if (hasResend) {
    await sendViaResend(to, subject, html, branding.inlineLogo);
    return;
  }

  if (!hasSmtp && !hasResend) {
    throw new Error('No email provider configured');
  }
}

export async function sendVerificationEmail(email: string, token: string) {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmailWithTemplate(email, `Verify your ${appName()} account`, {
    preheader: 'Confirm your email to activate your account.',
    title: 'Verify your email',
    intro:
      'Thanks for signing up. Tap the button below to confirm your email address and finish setting up your account.',
    buttonLabel: 'Verify email',
    actionUrl: link,
    secondaryHint: "If the button doesn't work, copy and paste this link into your browser:",
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmailWithTemplate(email, `Reset your ${appName()} password`, {
    preheader: 'Reset your password securely.',
    title: 'Reset your password',
    intro:
      'We received a request to reset your password. Use the button below to choose a new password. If you didn’t ask for this, you can ignore this email.',
    buttonLabel: 'Reset password',
    actionUrl: link,
    secondaryHint: "If the button doesn't work, copy and paste this link into your browser:",
  });
}

export const __emailInternals = {
  smtpEnabled,
  hasResendConfigured,
};
