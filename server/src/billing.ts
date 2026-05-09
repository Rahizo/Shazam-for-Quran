import Stripe from "stripe";
import { AppStore } from "./store";
import { PlanId, StoredUser } from "./saasTypes";

function appUrl() {
  return process.env.APP_URL || "http://localhost:8787";
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function priceIdFor(interval: unknown) {
  return interval === "year" ? process.env.STRIPE_YEARLY_PRICE_ID : process.env.STRIPE_MONTHLY_PRICE_ID;
}

export async function createCheckoutSession(store: AppStore, user: StoredUser, interval: unknown) {
  const stripe = stripeClient();
  const price = priceIdFor(interval);
  if (!stripe || !price) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY and price IDs.");
  }

  const customer =
    user.stripeCustomerId ||
    (
      await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id }
      })
    ).id;

  if (!user.stripeCustomerId) {
    await store.updateUserBilling(user.id, { stripeCustomerId: customer });
  }

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl()}/?checkout=success`,
    cancel_url: `${appUrl()}/?checkout=cancelled`,
    metadata: {
      userId: user.id,
      plan: interval === "year" ? "pro_yearly" : "pro_monthly"
    },
    subscription_data: {
      metadata: {
        userId: user.id,
        plan: interval === "year" ? "pro_yearly" : "pro_monthly"
      }
    }
  });
}

function planFromStripe(value: unknown): PlanId {
  return value === "pro_yearly" ? "pro_yearly" : "pro_monthly";
}

export async function handleStripeWebhook(store: AppStore, body: Buffer, signature?: string) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret || !signature) {
    throw new Error("Stripe webhook is not configured.");
  }

  const event = stripe.webhooks.constructEvent(body, signature, secret);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    if (userId && session.customer) {
      await store.updateUserBilling(userId, {
        plan: planFromStripe(session.metadata?.plan),
        stripeCustomerId: String(session.customer),
        stripeSubscriptionId: session.subscription ? String(session.subscription) : undefined,
        subscriptionStatus: "active"
      });
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const user = subscription.customer ? await store.findUserByStripeCustomerId(String(subscription.customer)) : null;
    if (user) {
      const active = subscription.status === "active" || subscription.status === "trialing";
      await store.updateUserBilling(user.id, {
        plan: active ? planFromStripe(subscription.metadata?.plan) : "free",
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status
      });
    }
  }

  return { received: true };
}
