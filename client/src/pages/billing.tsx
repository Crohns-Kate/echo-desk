import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Check,
  X,
  CreditCard,
  Zap,
  Building2,
  Loader2,
  ExternalLink,
  AlertCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Tier {
  id: string;
  name: string;
  price: number;
  features: {
    maxCallsPerMonth: number;
    recording: boolean;
    transcription: boolean;
    qaAnalysis: boolean;
    faq: boolean;
    sms: boolean;
  };
}

interface Subscription {
  tier: string;
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  limits: {
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
  };
}

interface TiersResponse {
  configured: boolean;
  tiers: Tier[];
}

export default function Billing() {
  const { toast } = useToast();
  const [, params] = useRoute("/tenants/:tenantId/billing");
  const tenantId = params?.tenantId ? parseInt(params.tenantId, 10) : undefined;

  const { data: tiersData, isLoading: tiersLoading } = useQuery<TiersResponse>({
    queryKey: ["/api/billing/tiers"],
  });

  const { data: subscription, isLoading: subLoading } = useQuery<Subscription>({
    queryKey: [`/api/billing/${tenantId}/subscription`],
    enabled: !!tenantId,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await fetch(`/api/billing/${tenantId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create checkout session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/billing/${tenantId}/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create portal session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = tiersLoading || subLoading;
  const tiers = tiersData?.tiers || [];
  const currentTier = subscription?.tier || "free";

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "canceling":
        return <Badge variant="secondary">Canceling</Badge>;
      case "past_due":
        return <Badge variant="destructive">Past Due</Badge>;
      case "canceled":
        return <Badge variant="outline">Canceled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatFeature = (key: string, value: boolean | number) => {
    const labels: Record<string, string> = {
      maxCallsPerMonth: "Calls per month",
      recording: "Call recording",
      transcription: "AI transcription",
      qaAnalysis: "QA analysis",
      faq: "FAQ answers",
      sms: "SMS notifications",
    };

    const label = labels[key] || key;

    if (typeof value === "boolean") {
      return (
        <div key={key} className="flex items-center gap-2 text-sm">
          {value ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground" />
          )}
          <span className={value ? "" : "text-muted-foreground"}>{label}</span>
        </div>
      );
    }

    return (
      <div key={key} className="flex items-center gap-2 text-sm">
        <Check className="h-4 w-4 text-green-500" />
        <span>
          {value === -1 ? "Unlimited" : value.toLocaleString()} {label.toLowerCase()}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/tenants">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Billing & Subscription</h1>
          <p className="text-sm text-muted-foreground">
            Manage your subscription and billing settings
          </p>
        </div>

        {/* Stripe not configured warning */}
        {tiersData && !tiersData.configured && (
          <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">
                    Stripe not configured
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Payment processing is not available. Set STRIPE_SECRET_KEY environment variable to enable billing.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Current Subscription */}
        {subscription && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Current Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold capitalize">{currentTier}</span>
                    {getStatusBadge(subscription.status)}
                  </div>
                  {subscription.currentPeriodEnd && (
                    <p className="text-sm text-muted-foreground">
                      {subscription.cancelAtPeriodEnd
                        ? `Cancels on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                        : `Renews on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
                {currentTier !== "free" && tiersData?.configured && (
                  <Button
                    variant="outline"
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                  >
                    {portalMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <ExternalLink className="h-4 w-4 mr-2" />
                    )}
                    Manage Billing
                  </Button>
                )}
              </div>

              {/* Usage */}
              {subscription.limits && subscription.limits.limit > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Monthly Call Usage</span>
                    <span>
                      {subscription.limits.used.toLocaleString()} / {subscription.limits.limit === -1 ? "Unlimited" : subscription.limits.limit.toLocaleString()}
                    </span>
                  </div>
                  {subscription.limits.limit !== -1 && (
                    <Progress
                      value={(subscription.limits.used / subscription.limits.limit) * 100}
                      className="h-2"
                    />
                  )}
                  {!subscription.limits.allowed && (
                    <p className="text-sm text-destructive">
                      You've reached your monthly call limit. Upgrade to continue.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pricing Tiers */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Available Plans</h2>

          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {tiers.map((tier) => {
                const isCurrent = tier.id === currentTier;
                const isUpgrade = tiers.findIndex(t => t.id === tier.id) > tiers.findIndex(t => t.id === currentTier);

                return (
                  <Card
                    key={tier.id}
                    className={`relative ${isCurrent ? "border-primary ring-2 ring-primary" : ""}`}
                  >
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary">Current Plan</Badge>
                      </div>
                    )}
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        {tier.id === "enterprise" ? (
                          <Building2 className="h-5 w-5" />
                        ) : (
                          <Zap className="h-5 w-5" />
                        )}
                        {tier.name}
                      </CardTitle>
                      <CardDescription>
                        <span className="text-3xl font-bold">${tier.price}</span>
                        {tier.price > 0 && <span className="text-muted-foreground">/month</span>}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(tier.features).map(([key, value]) =>
                        formatFeature(key, value)
                      )}
                    </CardContent>
                    <CardFooter>
                      {isCurrent ? (
                        <Button variant="outline" className="w-full" disabled>
                          Current Plan
                        </Button>
                      ) : tier.price === 0 ? (
                        <Button variant="outline" className="w-full" disabled>
                          Free Forever
                        </Button>
                      ) : !tiersData?.configured ? (
                        <Button variant="outline" className="w-full" disabled>
                          Not Available
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          variant={isUpgrade ? "default" : "outline"}
                          onClick={() => checkoutMutation.mutate(tier.id)}
                          disabled={checkoutMutation.isPending}
                        >
                          {checkoutMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : null}
                          {isUpgrade ? "Upgrade" : "Switch"} to {tier.name}
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* FAQ */}
        <Card>
          <CardHeader>
            <CardTitle>Billing FAQ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium">What happens when I upgrade?</h4>
              <p className="text-sm text-muted-foreground">
                Your new plan features are available immediately. You'll be charged a prorated amount for the remainder of your billing period.
              </p>
            </div>
            <div>
              <h4 className="font-medium">Can I cancel anytime?</h4>
              <p className="text-sm text-muted-foreground">
                Yes! Cancel anytime from the billing portal. Your plan remains active until the end of the billing period.
              </p>
            </div>
            <div>
              <h4 className="font-medium">What happens if I exceed my call limit?</h4>
              <p className="text-sm text-muted-foreground">
                New calls won't be answered by the AI until you upgrade or your limit resets next month.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
