import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  Zap,
  Building2,
  Phone,
  MessageSquare,
  FileText,
  BarChart3,
  Loader2,
  ArrowRight
} from "lucide-react";

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

interface TiersResponse {
  configured: boolean;
  tiers: Tier[];
}

export default function Pricing() {
  const [, setLocation] = useLocation();

  const { data: tiersData, isLoading } = useQuery<TiersResponse>({
    queryKey: ["/api/billing/tiers"],
  });

  const tiers = tiersData?.tiers || [];

  const handleGetStarted = (tierId: string) => {
    setLocation(`/signup?plan=${tierId}`);
  };

  const formatFeature = (key: string, value: boolean | number) => {
    const labels: Record<string, { label: string; icon: React.ReactNode }> = {
      maxCallsPerMonth: { label: "calls/month", icon: <Phone className="h-4 w-4" /> },
      recording: { label: "Call recording", icon: <FileText className="h-4 w-4" /> },
      transcription: { label: "AI transcription", icon: <MessageSquare className="h-4 w-4" /> },
      qaAnalysis: { label: "QA analysis", icon: <BarChart3 className="h-4 w-4" /> },
      faq: { label: "FAQ answers", icon: <MessageSquare className="h-4 w-4" /> },
      sms: { label: "SMS notifications", icon: <MessageSquare className="h-4 w-4" /> },
    };

    const config = labels[key] || { label: key, icon: null };

    if (typeof value === "boolean") {
      return (
        <div key={key} className="flex items-center gap-3 py-2">
          {value ? (
            <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
          ) : (
            <X className="h-5 w-5 text-gray-300 flex-shrink-0" />
          )}
          <span className={value ? "text-foreground" : "text-muted-foreground"}>
            {config.label}
          </span>
        </div>
      );
    }

    return (
      <div key={key} className="flex items-center gap-3 py-2">
        <Check className="h-5 w-5 text-green-500 flex-shrink-0" />
        <span>
          <strong>{value === -1 ? "Unlimited" : value.toLocaleString()}</strong> {config.label}
        </span>
      </div>
    );
  };

  const tierDescriptions: Record<string, string> = {
    free: "Perfect for trying out Echo Desk",
    starter: "For small clinics getting started",
    pro: "For growing practices with high volume",
    enterprise: "For large clinics and multi-location practices",
  };

  const popularTier = "pro";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Phone className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">Echo Desk</span>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => setLocation("/login")}>
                Log in
              </Button>
              <Button onClick={() => setLocation("/signup")}>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 md:py-24 text-center">
        <div className="max-w-4xl mx-auto px-4">
          <Badge variant="secondary" className="mb-4">
            AI-Powered Reception
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Never miss a patient call again
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Echo Desk answers your clinic's phone 24/7, books appointments, and answers patient questions -
            all while seamlessly integrating with Cliniko.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Simple, transparent pricing</h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Start free and scale as you grow. All plans include a 14-day free trial of Pro features.
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {tiers.map((tier) => {
                const isPopular = tier.id === popularTier;

                return (
                  <Card
                    key={tier.id}
                    className={`relative flex flex-col ${
                      isPopular
                        ? "border-primary shadow-lg scale-105 z-10"
                        : "border-border"
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-primary-foreground">
                          Most Popular
                        </Badge>
                      </div>
                    )}
                    <CardHeader className="pb-4">
                      <div className="flex items-center gap-2 mb-2">
                        {tier.id === "enterprise" ? (
                          <Building2 className="h-5 w-5 text-primary" />
                        ) : (
                          <Zap className="h-5 w-5 text-primary" />
                        )}
                        <CardTitle>{tier.name}</CardTitle>
                      </div>
                      <CardDescription>
                        {tierDescriptions[tier.id] || ""}
                      </CardDescription>
                      <div className="pt-4">
                        <span className="text-4xl font-bold">${tier.price}</span>
                        {tier.price > 0 && (
                          <span className="text-muted-foreground">/month</span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <div className="space-y-1">
                        {Object.entries(tier.features).map(([key, value]) =>
                          formatFeature(key, value)
                        )}
                      </div>
                    </CardContent>
                    <CardFooter className="pt-4">
                      <Button
                        className="w-full"
                        variant={isPopular ? "default" : "outline"}
                        size="lg"
                        onClick={() => handleGetStarted(tier.id)}
                      >
                        {tier.price === 0 ? "Start Free" : "Get Started"}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 bg-muted/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Everything you need to automate your reception</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Phone className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">24/7 Call Handling</h3>
              <p className="text-muted-foreground text-sm">
                AI answers every call, day or night. No more missed appointments or after-hours voicemail.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Smart Conversations</h3>
              <p className="text-muted-foreground text-sm">
                Natural language understanding handles complex requests, FAQs, and appointment scheduling.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Cliniko Integration</h3>
              <p className="text-muted-foreground text-sm">
                Direct integration with Cliniko for real-time availability and automatic appointment creation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to transform your reception?</h2>
          <p className="text-muted-foreground mb-8">
            Join hundreds of clinics using Echo Desk to handle their calls.
            Set up takes less than 10 minutes.
          </p>
          <Button size="lg" onClick={() => setLocation("/signup")}>
            Start Your Free Trial
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold">Echo Desk</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Echo Desk. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
