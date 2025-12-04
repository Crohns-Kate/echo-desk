/**
 * Email Service using Resend
 * Handles transactional emails for authentication, onboarding, and notifications
 */

import { Resend } from "resend";

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Email configuration
const EMAIL_CONFIG = {
  from: process.env.EMAIL_FROM || "Echo Desk <noreply@echodesk.com.au>",
  replyTo: process.env.EMAIL_REPLY_TO || "support@echodesk.com.au",
  baseUrl: process.env.PUBLIC_BASE_URL || "https://app.echodesk.com.au",
};

// Check if email is configured
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Send a welcome email to new tenant after Stripe signup
 */
export async function sendWelcomeEmail(
  email: string,
  clinicName: string,
  tempPassword: string
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.log("[Email] Resend not configured, skipping welcome email");
    return { success: true, id: "skipped" };
  }

  try {
    const result = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: `Welcome to Echo Desk - ${clinicName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Echo Desk</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin-bottom: 10px;">Welcome to Echo Desk</h1>
    <p style="color: #666; font-size: 18px;">Your AI Receptionist is Ready</p>
  </div>

  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p>Hi there,</p>
    <p>Thank you for signing up <strong>${clinicName}</strong> with Echo Desk! Your 7-day free trial has started.</p>
    <p>To get started, please log in and complete your setup:</p>
  </div>

  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p style="margin: 0 0 10px 0;"><strong>Login URL:</strong></p>
    <p style="margin: 0 0 15px 0;"><a href="${EMAIL_CONFIG.baseUrl}/login" style="color: #2563eb;">${EMAIL_CONFIG.baseUrl}/login</a></p>

    <p style="margin: 0 0 10px 0;"><strong>Email:</strong></p>
    <p style="margin: 0 0 15px 0;">${email}</p>

    <p style="margin: 0 0 10px 0;"><strong>Temporary Password:</strong></p>
    <p style="margin: 0; font-family: monospace; font-size: 18px; background: #fff; padding: 10px; border-radius: 4px;">${tempPassword}</p>
  </div>

  <p style="color: #ef4444; font-weight: 500;">You'll be asked to change your password on first login.</p>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #666; font-size: 14px;">Need help? Reply to this email or visit our <a href="https://echodesk.com.au/help" style="color: #2563eb;">help center</a>.</p>
    <p style="color: #666; font-size: 14px;">- The Echo Desk Team</p>
  </div>
</body>
</html>
      `,
      text: `
Welcome to Echo Desk!

Thank you for signing up ${clinicName} with Echo Desk. Your 7-day free trial has started.

Login URL: ${EMAIL_CONFIG.baseUrl}/login
Email: ${email}
Temporary Password: ${tempPassword}

You'll be asked to change your password on first login.

Need help? Reply to this email.

- The Echo Desk Team
      `,
    });

    console.log(`[Email] Sent welcome email to ${email}`);
    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error("[Email] Failed to send welcome email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  clinicName?: string
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.log("[Email] Resend not configured, skipping password reset email");
    return { success: true, id: "skipped" };
  }

  const resetUrl = `${EMAIL_CONFIG.baseUrl}/reset-password?token=${resetToken}`;

  try {
    const result = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: "Reset Your Echo Desk Password",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin-bottom: 10px;">Password Reset</h1>
  </div>

  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p>Hi${clinicName ? ` (${clinicName})` : ""},</p>
    <p>We received a request to reset your Echo Desk password. Click the button below to create a new password:</p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 500;">Reset Password</a>
  </div>

  <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0; color: #92400e; font-size: 14px;">
      <strong>This link expires in 1 hour.</strong><br>
      If you didn't request this reset, you can safely ignore this email.
    </p>
  </div>

  <p style="color: #666; font-size: 14px;">
    Or copy this link into your browser:<br>
    <a href="${resetUrl}" style="color: #2563eb; word-break: break-all;">${resetUrl}</a>
  </p>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #666; font-size: 14px;">- The Echo Desk Team</p>
  </div>
</body>
</html>
      `,
      text: `
Password Reset

We received a request to reset your Echo Desk password.

Reset your password: ${resetUrl}

This link expires in 1 hour.

If you didn't request this reset, you can safely ignore this email.

- The Echo Desk Team
      `,
    });

    console.log(`[Email] Sent password reset email to ${email}`);
    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error("[Email] Failed to send password reset email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Send trial reminder email (day 5)
 */
export async function sendTrialReminderEmail(
  email: string,
  clinicName: string,
  daysLeft: number,
  callCount: number
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.log("[Email] Resend not configured, skipping trial reminder email");
    return { success: true, id: "skipped" };
  }

  try {
    const result = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: `Your Echo Desk trial ends in ${daysLeft} days`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trial Reminder</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin-bottom: 10px;">Your Trial is Ending Soon</h1>
    <p style="color: #666; font-size: 18px;">${daysLeft} days left</p>
  </div>

  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p>Hi ${clinicName},</p>
    <p>Your Echo Desk trial is ending in <strong>${daysLeft} days</strong>.</p>
    <p>During your trial, your AI receptionist has handled <strong>${callCount} calls</strong>!</p>
  </div>

  <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <h3 style="margin-top: 0; color: #059669;">Keep your AI receptionist active</h3>
    <p>Upgrade to a paid plan to continue receiving:</p>
    <ul style="color: #065f46;">
      <li>24/7 AI call handling</li>
      <li>Automatic appointment booking</li>
      <li>Call recordings & transcripts</li>
      <li>Quality analysis reports</li>
    </ul>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${EMAIL_CONFIG.baseUrl}/billing" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 500;">View Plans & Upgrade</a>
  </div>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #666; font-size: 14px;">Questions? Reply to this email - we're happy to help!</p>
    <p style="color: #666; font-size: 14px;">- The Echo Desk Team</p>
  </div>
</body>
</html>
      `,
      text: `
Your Trial is Ending Soon

Hi ${clinicName},

Your Echo Desk trial is ending in ${daysLeft} days.

During your trial, your AI receptionist has handled ${callCount} calls!

Upgrade to keep your AI receptionist active: ${EMAIL_CONFIG.baseUrl}/billing

- The Echo Desk Team
      `,
    });

    console.log(`[Email] Sent trial reminder email to ${email}`);
    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error("[Email] Failed to send trial reminder email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Send team invite email
 */
export async function sendTeamInviteEmail(
  email: string,
  clinicName: string,
  inviterName: string,
  role: string,
  inviteToken: string
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.log("[Email] Resend not configured, skipping team invite email");
    return { success: true, id: "skipped" };
  }

  const inviteUrl = `${EMAIL_CONFIG.baseUrl}/accept-invite?token=${inviteToken}`;

  try {
    const result = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: `You've been invited to join ${clinicName} on Echo Desk`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #2563eb; margin-bottom: 10px;">You're Invited!</h1>
  </div>

  <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p>Hi there,</p>
    <p><strong>${inviterName}</strong> has invited you to join <strong>${clinicName}</strong> on Echo Desk as a <strong>${role}</strong>.</p>
    <p>Echo Desk is an AI-powered receptionist that handles phone calls, books appointments, and manages patient inquiries.</p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 500;">Accept Invitation</a>
  </div>

  <p style="color: #666; font-size: 14px;">
    Or copy this link into your browser:<br>
    <a href="${inviteUrl}" style="color: #2563eb; word-break: break-all;">${inviteUrl}</a>
  </p>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #666; font-size: 14px;">- The Echo Desk Team</p>
  </div>
</body>
</html>
      `,
      text: `
You're Invited!

${inviterName} has invited you to join ${clinicName} on Echo Desk as a ${role}.

Accept invitation: ${inviteUrl}

- The Echo Desk Team
      `,
    });

    console.log(`[Email] Sent team invite email to ${email}`);
    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error("[Email] Failed to send team invite email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(
  email: string,
  clinicName: string,
  amountDue: string
): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.log("[Email] Resend not configured, skipping payment failed email");
    return { success: true, id: "skipped" };
  }

  try {
    const result = await resend.emails.send({
      from: EMAIL_CONFIG.from,
      to: email,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: `Action Required: Payment Failed for ${clinicName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #ef4444; margin-bottom: 10px;">Payment Failed</h1>
  </div>

  <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
    <p>Hi ${clinicName},</p>
    <p>We were unable to process your payment of <strong>${amountDue}</strong> for your Echo Desk subscription.</p>
    <p>Please update your payment method to keep your AI receptionist active.</p>
  </div>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${EMAIL_CONFIG.baseUrl}/billing" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 500;">Update Payment Method</a>
  </div>

  <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
    <p style="margin: 0; color: #92400e; font-size: 14px;">
      <strong>Important:</strong> If we can't collect payment within 7 days, your AI receptionist will be temporarily disabled.
    </p>
  </div>

  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="color: #666; font-size: 14px;">Need help? Reply to this email.</p>
    <p style="color: #666; font-size: 14px;">- The Echo Desk Team</p>
  </div>
</body>
</html>
      `,
      text: `
Payment Failed

Hi ${clinicName},

We were unable to process your payment of ${amountDue} for your Echo Desk subscription.

Please update your payment method: ${EMAIL_CONFIG.baseUrl}/billing

Important: If we can't collect payment within 7 days, your AI receptionist will be temporarily disabled.

- The Echo Desk Team
      `,
    });

    console.log(`[Email] Sent payment failed email to ${email}`);
    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error("[Email] Failed to send payment failed email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}
