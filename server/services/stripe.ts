/**
 * Stripe Billing Service
 *
 * Handles subscription management, webhooks, and billing operations.
 * Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET environment variables.
 */

import Stripe from "stripe";
import { storage } from "../storage";

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
let stripe: Stripe | null = null;

if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2025-11-17.clover",
  });
}

// Subscription tier pricing (Stripe Price IDs)
export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    price: 0,
    priceId: null,
    features: {
      maxCallsPerMonth: 50,
      recording: false,
      transcription: false,
      qaAnalysis: false,
      faq: true,
      sms: false,
    },
  },
  starter: {
    name: "Starter",
    price: 99,
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    features: {
      maxCallsPerMonth: 500,
      recording: true,
      transcription: false,
      qaAnalysis: false,
      faq: true,
      sms: true,
    },
  },
  pro: {
    name: "Professional",
    price: 299,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    features: {
      maxCallsPerMonth: 2000,
      recording: true,
      transcription: true,
      qaAnalysis: true,
      faq: true,
      sms: true,
    },
  },
  enterprise: {
    name: "Enterprise",
    price: 599,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    features: {
      maxCallsPerMonth: -1, // unlimited
      recording: true,
      transcription: true,
      qaAnalysis: true,
      faq: true,
      sms: true,
    },
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!stripe;
}

/**
 * Create a Stripe customer for a tenant
 */
export async function createCustomer(tenantId: number, email: string, clinicName: string): Promise<string | null> {
  if (!stripe) {
    console.warn("[Stripe] Not configured - skipping customer creation");
    return null;
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name: clinicName,
      metadata: {
        tenantId: tenantId.toString(),
      },
    });

    // Update tenant with customer ID
    await storage.updateTenant(tenantId, {
      stripeCustomerId: customer.id,
    });

    console.log(`[Stripe] Created customer ${customer.id} for tenant ${tenantId}`);
    return customer.id;
  } catch (error) {
    console.error("[Stripe] Failed to create customer:", error);
    return null;
  }
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession(
  tenantId: number,
  tier: SubscriptionTier,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string } | { error: string }> {
  if (!stripe) {
    return { error: "Stripe is not configured" };
  }

  const tierConfig = SUBSCRIPTION_TIERS[tier];
  if (!tierConfig.priceId) {
    return { error: `No price configured for tier: ${tier}` };
  }

  const tenant = await storage.getTenantById(tenantId);
  if (!tenant) {
    return { error: "Tenant not found" };
  }

  try {
    // Create customer if doesn't exist
    let customerId = tenant.stripeCustomerId;
    if (!customerId && tenant.email) {
      customerId = await createCustomer(tenantId, tenant.email, tenant.clinicName);
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: tierConfig.priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        tenantId: tenantId.toString(),
        tier,
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else if (tenant.email) {
      sessionParams.customer_email = tenant.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log(`[Stripe] Created checkout session ${session.id} for tenant ${tenantId}`);
    return { url: session.url! };
  } catch (error: any) {
    console.error("[Stripe] Failed to create checkout session:", error);
    return { error: error.message || "Failed to create checkout session" };
  }
}

/**
 * Create a billing portal session for subscription management
 */
export async function createPortalSession(
  tenantId: number,
  returnUrl: string
): Promise<{ url: string } | { error: string }> {
  if (!stripe) {
    return { error: "Stripe is not configured" };
  }

  const tenant = await storage.getTenantById(tenantId);
  if (!tenant) {
    return { error: "Tenant not found" };
  }

  if (!tenant.stripeCustomerId) {
    return { error: "No billing account found. Please subscribe first." };
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  } catch (error: any) {
    console.error("[Stripe] Failed to create portal session:", error);
    return { error: error.message || "Failed to create portal session" };
  }
}

/**
 * Get subscription details for a tenant
 */
export async function getSubscription(tenantId: number): Promise<{
  tier: SubscriptionTier;
  status: string;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
} | null> {
  const tenant = await storage.getTenantById(tenantId);
  if (!tenant) {
    return null;
  }

  // If no Stripe subscription, return free tier
  if (!tenant.stripeSubscriptionId || !stripe) {
    return {
      tier: (tenant.subscriptionTier as SubscriptionTier) || "free",
      status: tenant.subscriptionStatus || "active",
    };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);

    return {
      tier: (tenant.subscriptionTier as SubscriptionTier) || "free",
      status: subscription.status,
      currentPeriodEnd: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : undefined,
      cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
    };
  } catch (error) {
    console.error("[Stripe] Failed to get subscription:", error);
    return {
      tier: (tenant.subscriptionTier as SubscriptionTier) || "free",
      status: tenant.subscriptionStatus || "active",
    };
  }
}

/**
 * Cancel a subscription (at period end)
 */
export async function cancelSubscription(tenantId: number): Promise<{ success: boolean; error?: string }> {
  if (!stripe) {
    return { success: false, error: "Stripe is not configured" };
  }

  const tenant = await storage.getTenantById(tenantId);
  if (!tenant) {
    return { success: false, error: "Tenant not found" };
  }

  if (!tenant.stripeSubscriptionId) {
    return { success: false, error: "No active subscription" };
  }

  try {
    await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await storage.updateTenant(tenantId, {
      subscriptionStatus: "canceling",
    });

    console.log(`[Stripe] Subscription ${tenant.stripeSubscriptionId} marked for cancellation`);
    return { success: true };
  } catch (error: any) {
    console.error("[Stripe] Failed to cancel subscription:", error);
    return { success: false, error: error.message || "Failed to cancel subscription" };
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhook(
  payload: string | Buffer,
  signature: string
): Promise<{ received: boolean; error?: string }> {
  if (!stripe) {
    return { received: false, error: "Stripe is not configured" };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { received: false, error: "Webhook secret not configured" };
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe] Webhook signature verification failed:", err.message);
    return { received: false, error: `Webhook Error: ${err.message}` };
  }

  console.log(`[Stripe] Received webhook: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }

    return { received: true };
  } catch (error: any) {
    console.error("[Stripe] Error handling webhook:", error);
    return { received: false, error: error.message };
  }
}

/**
 * Handle completed checkout session
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId;
  const tier = session.metadata?.tier as SubscriptionTier;

  if (!tenantId) {
    console.error("[Stripe] No tenantId in checkout session metadata");
    return;
  }

  const id = parseInt(tenantId, 10);

  // Update tenant with customer and subscription IDs, and activate
  await storage.updateTenant(id, {
    stripeCustomerId: session.customer as string,
    stripeSubscriptionId: session.subscription as string,
    subscriptionTier: tier,
    subscriptionStatus: "active",
    isActive: true,
  });

  console.log(`[Stripe] Checkout completed for tenant ${id}, tier: ${tier}`);
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  // Find tenant by customer ID
  const customerId = subscription.customer as string;
  const tenants = await storage.listTenants();
  const tenant = tenants.find(t => t.stripeCustomerId === customerId);

  if (!tenant) {
    console.error(`[Stripe] No tenant found for customer ${customerId}`);
    return;
  }

  // Map Stripe status to our status
  let status = "active";
  if (subscription.status === "past_due") status = "past_due";
  else if (subscription.status === "canceled") status = "canceled";
  else if (subscription.status === "unpaid") status = "unpaid";
  else if (subscription.cancel_at_period_end) status = "canceling";

  await storage.updateTenant(tenant.id, {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: status,
  });

  console.log(`[Stripe] Subscription updated for tenant ${tenant.id}: ${status}`);
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const tenants = await storage.listTenants();
  const tenant = tenants.find(t => t.stripeCustomerId === customerId);

  if (!tenant) {
    console.error(`[Stripe] No tenant found for customer ${customerId}`);
    return;
  }

  // Downgrade to free tier
  await storage.updateTenant(tenant.id, {
    stripeSubscriptionId: null,
    subscriptionTier: "free",
    subscriptionStatus: "canceled",
  });

  console.log(`[Stripe] Subscription canceled for tenant ${tenant.id}, downgraded to free`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const tenants = await storage.listTenants();
  const tenant = tenants.find(t => t.stripeCustomerId === customerId);

  if (!tenant) {
    console.error(`[Stripe] No tenant found for customer ${customerId}`);
    return;
  }

  await storage.updateTenant(tenant.id, {
    subscriptionStatus: "past_due",
  });

  console.log(`[Stripe] Payment failed for tenant ${tenant.id}`);

  // TODO: Send notification email to tenant
}

/**
 * Check if a tenant has access to a feature based on their tier
 */
export function hasFeatureAccess(tier: SubscriptionTier, feature: keyof typeof SUBSCRIPTION_TIERS.free.features): boolean {
  const tierConfig = SUBSCRIPTION_TIERS[tier];
  if (!tierConfig) return false;

  const value = tierConfig.features[feature];

  // For numeric limits, -1 means unlimited
  if (typeof value === "number") {
    return value > 0 || value === -1;
  }

  return value;
}

/**
 * Check call limits for a tenant
 */
export async function checkCallLimit(tenantId: number): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}> {
  const tenant = await storage.getTenantById(tenantId);
  if (!tenant) {
    return { allowed: false, used: 0, limit: 0, remaining: 0 };
  }

  const tier = (tenant.subscriptionTier as SubscriptionTier) || "free";
  const tierConfig = SUBSCRIPTION_TIERS[tier];
  const limit = tierConfig.features.maxCallsPerMonth;

  // Unlimited calls
  if (limit === -1) {
    return { allowed: true, used: 0, limit: -1, remaining: -1 };
  }

  // Count calls this month
  const stats = await storage.getStats(tenantId);
  const used = stats.todayCalls * 30; // Approximate monthly (TODO: implement proper monthly count)

  const remaining = Math.max(0, limit - used);
  const allowed = remaining > 0;

  return { allowed, used, limit, remaining };
}
