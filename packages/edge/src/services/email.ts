// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { Env, SendEmailMessage, SendEmailRecipient } from '../env';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailOptions {
  to: string | EmailRecipient | (string | EmailRecipient)[];
  subject: string;
  html: string;
  text?: string;
  from?: string | EmailRecipient;
  headers?: Record<string, string>;
  category?: 'verification' | 'invitation' | 'scan_digest' | 'security_alert' | 'waitlist';
  rateLimitKey?: string;
  cooldownSeconds?: number;
}

export interface EmailSendResult {
  success: boolean;
  simulated: boolean;
  rateLimited?: boolean;
  error?: string;
}

// Global in-memory collector for development / testing
const devSentEmails: SendEmailMessage[] = [];

export function getDevSentEmails(): SendEmailMessage[] {
  return [...devSentEmails];
}

export function clearDevSentEmails(): void {
  devSentEmails.length = 0;
}

const DEFAULT_SENDER = 'Swazz <notifications@secmy.app>';

/**
 * Escapes unsafe HTML characters to prevent XSS / HTML injection in email bodies.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates and sanitizes URLs before putting them into href attributes.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '#';
}

/**
 * Strips CR/LF characters from email subject lines to prevent CRLF header injection.
 */
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Strips HTML tags to produce a clean plain-text fallback.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Formats a recipient into a string for logging / headers.
 */
function recipientToString(r: string | EmailRecipient): string {
  if (typeof r === 'string') return r;
  return r.name ? `"${r.name}" <${r.email}>` : r.email;
}

/**
 * Extracts raw email addresses from recipient parameter.
 */
function extractEmailAddress(r: string | EmailRecipient): string {
  if (typeof r === 'string') {
    const match = r.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase().trim() : r.toLowerCase().trim();
  }
  return r.email.toLowerCase().trim();
}

/**
 * Base template layout with Swazz branding.
 */
function wrapEmailLayout(contentHtml: string, previewText?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swazz</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0; }
    .container { max-width: 600px; margin: 0 auto; padding: 32px 20px; }
    .card { background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 32px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); }
    .header { margin-bottom: 24px; text-align: left; }
    .logo { font-size: 22px; font-weight: 800; color: #38bdf8; text-decoration: none; letter-spacing: -0.5px; }
    .logo-badge { font-size: 11px; font-weight: 700; background: #0284c7; color: #ffffff; padding: 2px 6px; border-radius: 4px; margin-left: 6px; text-transform: uppercase; }
    .content { font-size: 15px; line-height: 1.6; color: #cbd5e1; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin: 20px 0; text-align: center; }
    .footer { margin-top: 32px; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5; }
    .footer a { color: #94a3b8; text-decoration: underline; }
    .stat-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
    .stat-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  </style>
</head>
<body>
  ${previewText ? `<div style="display:none;font-size:1px;color:#333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText}</div>` : ''}
  <div class="container">
    <div class="card">
      <div class="header">
        <a href="https://swazz.secmy.app" class="logo">⚡ SWAZZ <span class="logo-badge">Security</span></a>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Swazz Security Platform. All rights reserved.</p>
      <p>Sent from <a href="https://swazz.secmy.app">swazz.secmy.app</a></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends a transactional email using Cloudflare Workers send_email binding,
 * enforcing rate limits and falling back gracefully in dev/test.
 */
export async function sendTransactionalEmail(
  env: Env,
  options: EmailOptions
): Promise<EmailSendResult> {
  const primaryRecipient = Array.isArray(options.to) ? options.to[0] : options.to;
  const rawEmail = extractEmailAddress(primaryRecipient);

  // 1. Anti-abuse rate-limiting via KV
  const category = options.category || 'general';
  const rateLimitKey = options.rateLimitKey || `ratelimit:email:${category}:${rawEmail}`;
  const cooldownSeconds = options.cooldownSeconds || 300; // Default 5 mins

  if (env.SESSION_CACHE) {
    try {
      const activeCooldown = await env.SESSION_CACHE.get(rateLimitKey);
      if (activeCooldown) {
        return {
          success: false,
          simulated: false,
          rateLimited: true,
          error: `Rate limit cooldown active for ${rawEmail}`,
        };
      }
    } catch {
      // Non-fatal if KV fails
    }
  }

  const plainText = options.text || htmlToPlainText(options.html);
  const fromSender = options.from || DEFAULT_SENDER;

  const defaultHeaders: Record<string, string> = {
    'Auto-Submitted': 'auto-generated',
    'X-Mailer': 'Swazz Security Platform',
    'Precedence': 'bulk',
    ...(options.headers || {}),
  };

  const emailMessage: SendEmailMessage = {
    from: fromSender,
    to: options.to as any,
    subject: options.subject,
    html: options.html,
    text: plainText,
    headers: defaultHeaders,
  };

  // 2. Local dev / test simulation fallback
  if (!env.SEND_EMAIL || env.NODE_ENV === 'test' || env.NODE_ENV === 'development') {
    devSentEmails.push(emailMessage);
    // eslint-disable-next-line no-console
    console.log(`[Email Simulation] To: ${recipientToString(primaryRecipient)} | Subject: ${options.subject}`);

    if (env.SESSION_CACHE && cooldownSeconds > 0) {
      try {
        await env.SESSION_CACHE.put(rateLimitKey, '1', { expirationTtl: cooldownSeconds });
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      simulated: true,
    };
  }

  // 3. Real dispatch via Cloudflare Workers SEND_EMAIL binding
  try {
    await env.SEND_EMAIL.send(emailMessage);

    if (env.SESSION_CACHE && cooldownSeconds > 0) {
      try {
        await env.SESSION_CACHE.put(rateLimitKey, '1', { expirationTtl: cooldownSeconds });
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      simulated: false,
    };
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`[Email Error] Failed to send email to ${rawEmail}:`, err);
    return {
      success: false,
      simulated: false,
      error: err?.message || String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Specific Email Template Renderers & Helper Dispatchers
// ---------------------------------------------------------------------------

export function renderVerificationEmail(params: {
  username?: string;
  verifyUrl: string;
}): { subject: string; html: string; text: string } {
  const safeUsername = params.username ? escapeHtml(params.username) : undefined;
  const safeVerifyUrl = sanitizeUrl(params.verifyUrl);
  const greeting = safeUsername ? `Hi ${safeUsername},` : 'Hello,';
  const content = `
    <h2 style="color: #f8fafc; margin-top: 0; font-size: 20px;">Verify your email address</h2>
    <p>${greeting}</p>
    <p>Thanks for joining Swazz. Please confirm that you own this email address by clicking the button below:</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${safeVerifyUrl}" class="btn" style="background-color:#0284c7;color:#fff;">Verify Email</a>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">Or paste this link into your browser:<br>
      <a href="${safeVerifyUrl}" style="color: #38bdf8; word-break: break-all;">${safeVerifyUrl}</a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin-top: 24px;">This verification link will expire in 24 hours. If you did not sign up for Swazz, you can safely ignore this email.</p>
  `;
  const subject = 'Verify your email for Swazz';
  return {
    subject,
    html: wrapEmailLayout(content, 'Please verify your email address to activate your account.'),
    text: htmlToPlainText(content),
  };
}

export function renderProjectInvitationEmail(params: {
  inviterName?: string;
  projectName: string;
  inviteUrl: string;
  roles: string[];
  expiresAt: string;
}): { subject: string; html: string; text: string } {
  const inviter = escapeHtml(params.inviterName || 'A team member');
  const safeProjectName = escapeHtml(params.projectName);
  const safeInviteUrl = sanitizeUrl(params.inviteUrl);
  const roleBadges = params.roles
    .map(r => `<span style="background:#1e293b;border:1px solid #334155;color:#38bdf8;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:4px;">${escapeHtml(r)}</span>`)
    .join(' ');

  const content = `
    <h2 style="color: #f8fafc; margin-top: 0; font-size: 20px;">Project Collaboration Invitation</h2>
    <p><strong>${inviter}</strong> has invited you to collaborate on the project <strong>${safeProjectName}</strong> on Swazz.</p>
    <p>Assigned Roles: ${roleBadges}</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${safeInviteUrl}" class="btn" style="background-color:#0284c7;color:#fff;">Accept Invitation</a>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">Or open this link directly:<br>
      <a href="${safeInviteUrl}" style="color: #38bdf8; word-break: break-all;">${safeInviteUrl}</a>
    </p>
    <p style="font-size: 12px; color: #64748b; margin-top: 24px;">This invitation link will expire on ${new Date(params.expiresAt).toLocaleDateString()}.</p>
  `;
  const subject = sanitizeSubject(`Invitation to collaborate on ${params.projectName} on Swazz`);
  return {
    subject,
    html: wrapEmailLayout(content, `${inviter} invited you to collaborate on ${safeProjectName}.`),
    text: htmlToPlainText(content),
  };
}

export function renderScanCompletedDigestEmail(params: {
  projectName: string;
  targetUrl: string;
  scanId: string;
  reportUrl: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  completedAt: string;
  aiBriefing?: { summary: string; key_recommendations?: string[] };
}): { subject: string; html: string; text: string } {
  const hasCritical = params.criticalCount > 0;
  const statusColor = hasCritical ? '#f43f5e' : (params.highCount > 0 ? '#fb923c' : '#22c55e');
  const safeProjectName = escapeHtml(params.projectName);
  const safeTargetUrl = escapeHtml(params.targetUrl);
  const safeScanId = escapeHtml(params.scanId);
  const safeReportUrl = sanitizeUrl(params.reportUrl);

  let aiBriefingHtml = '';
  if (params.aiBriefing && params.aiBriefing.summary) {
    const recs = params.aiBriefing.key_recommendations || [];
    const recsHtml = recs.length > 0
      ? `<ul style="margin: 8px 0 0 0; padding-left: 18px; color: #cbd5e1; font-size: 13px;">${recs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : '';
    aiBriefingHtml = `
      <div class="stat-box" style="background:#1e293b;border:1px solid #0284c7;border-radius:8px;padding:16px;margin:20px 0;">
        <div style="color:#38bdf8;font-weight:700;margin-bottom:6px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">🤖 AI Executive Risk Briefing</div>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#e2e8f0;">${escapeHtml(params.aiBriefing.summary)}</p>
        ${recsHtml}
      </div>
    `;
  }

  const content = `
    <h2 style="color: #f8fafc; margin-top: 0; font-size: 20px;">⚡ Залетай и смотри, мы насканировали!</h2>
    <p>Сканирование безопасности для проекта <strong>${safeProjectName}</strong> успешно завершено.</p>
    <div class="stat-box" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;margin:20px 0;">
      <div style="margin-bottom: 8px;"><strong>Target:</strong> <code style="color:#38bdf8;">${safeTargetUrl}</code></div>
      <div style="margin-bottom: 8px;"><strong>Scan ID:</strong> <code style="color:#94a3b8;">${safeScanId}</code></div>
      <div style="margin-bottom: 8px;"><strong>Total Findings:</strong> <span style="font-weight:bold;color:${statusColor};">${params.totalFindings}</span></div>
      <div style="display: flex; gap: 8px; margin-top: 12px; font-size: 13px;">
        <span style="background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);padding:2px 8px;border-radius:4px;">Critical: ${params.criticalCount}</span>
        <span style="background:rgba(251,146,60,0.15);color:#fb923c;border:1px solid rgba(251,146,60,0.3);padding:2px 8px;border-radius:4px;">High: ${params.highCount}</span>
        <span style="background:rgba(250,204,21,0.15);color:#facc15;border:1px solid rgba(250,204,21,0.3);padding:2px 8px;border-radius:4px;">Medium: ${params.mediumCount}</span>
        <span style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);padding:2px 8px;border-radius:4px;">Low: ${params.lowCount}</span>
      </div>
    </div>
    ${aiBriefingHtml}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${safeReportUrl}" class="btn" style="background-color:#0284c7;color:#fff;">View Full Scan Report</a>
    </div>
  `;
  const subject = sanitizeSubject(`[Scan Completed] ${params.projectName}: ${params.totalFindings} findings discovered`);
  return {
    subject,
    html: wrapEmailLayout(content, `Scan completed for ${safeProjectName}: ${params.totalFindings} findings discovered.`),
    text: htmlToPlainText(content),
  };
}

export function renderSecurityAlertEmail(params: {
  title: string;
  description: string;
  details?: Record<string, string>;
  actionUrl?: string;
  actionText?: string;
}): { subject: string; html: string; text: string } {
  let detailsHtml = '';
  if (params.details && Object.keys(params.details).length > 0) {
    detailsHtml = `<div class="stat-box" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;margin:16px 0;font-size:13px;">`;
    for (const [k, v] of Object.entries(params.details)) {
      detailsHtml += `<div><strong>${escapeHtml(k)}:</strong> <span style="color:#cbd5e1;">${escapeHtml(v)}</span></div>`;
    }
    detailsHtml += `</div>`;
  }

  let actionHtml = '';
  if (params.actionUrl) {
    const safeActionUrl = sanitizeUrl(params.actionUrl);
    actionHtml = `
      <div style="text-align: center; margin: 20px 0;">
        <a href="${safeActionUrl}" class="btn" style="background-color:#0284c7;color:#fff;">${escapeHtml(params.actionText || 'Review Activity')}</a>
      </div>
    `;
  }

  const safeTitle = escapeHtml(params.title);
  const safeDescription = escapeHtml(params.description);
  const content = `
    <h2 style="color: #f43f5e; margin-top: 0; font-size: 20px;">🛡️ Security Alert: ${safeTitle}</h2>
    <p>${safeDescription}</p>
    ${detailsHtml}
    ${actionHtml}
    <p style="font-size: 12px; color: #64748b; margin-top: 24px;">If you did not perform or authorize this action, please review your project security settings immediately.</p>
  `;
  const subject = sanitizeSubject(`[Security Alert] ${params.title}`);
  return {
    subject,
    html: wrapEmailLayout(content, `Security Alert: ${safeTitle}`),
    text: htmlToPlainText(content),
  };
}

// ---------------------------------------------------------------------------
// High-Level Dispatchers
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
  env: Env,
  params: { email: string; token: string; username?: string; baseUrl?: string }
): Promise<EmailSendResult> {
  const origin = params.baseUrl || 'https://swazz.secmy.app';
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(params.token)}`;
  const template = renderVerificationEmail({ username: params.username, verifyUrl });

  return sendTransactionalEmail(env, {
    to: params.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: 'verification',
    cooldownSeconds: 300, // 5 min cooldown between verification requests
  });
}

export async function sendProjectInvitationEmail(
  env: Env,
  params: {
    to: string;
    projectName: string;
    inviterName?: string;
    inviteUrl: string;
    roles: string[];
    expiresAt: string;
  }
): Promise<EmailSendResult> {
  const template = renderProjectInvitationEmail(params);
  return sendTransactionalEmail(env, {
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: 'invitation',
    cooldownSeconds: 86400, // Anti-spam: max 1 invite per email per 24 hours
  });
}

export async function sendScanCompletedDigestEmail(
  env: Env,
  params: {
    to: string;
    projectName: string;
    targetUrl: string;
    scanId: string;
    reportUrl: string;
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    completedAt: string;
    aiBriefing?: { summary: string; key_recommendations?: string[] };
  }
): Promise<EmailSendResult> {
  const template = renderScanCompletedDigestEmail(params);
  return sendTransactionalEmail(env, {
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: 'scan_digest',
    cooldownSeconds: 60, // 1 min cooldown per recipient
  });
}

export async function sendSecurityAlertEmail(
  env: Env,
  params: {
    to: string;
    title: string;
    description: string;
    details?: Record<string, string>;
    actionUrl?: string;
    actionText?: string;
  }
): Promise<EmailSendResult> {
  const template = renderSecurityAlertEmail(params);
  return sendTransactionalEmail(env, {
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: 'security_alert',
    cooldownSeconds: 60,
  });
}
