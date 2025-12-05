import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Phone,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Building2,
  Mail,
  User,
  CreditCard,
  Zap
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

interface TiersResponse {
  configured: boolean;
  tiers: Tier[];
}

type Step = "info" | "plan" | "checkout";

export default function Signup() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();

  // Parse query params
  const params = new URLSearchParams(searchString);
  const preselectedPlan = params.get("plan") || "starter";

  const [step, setStep] = useState<Step>("info");
  const [formData, setFormData] = useState({
    clinicName: "",
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [selectedPlan, setSelectedPlan] = useState(preselectedPlan);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: tiersData, isLoading: tiersLoading } = useQuery<TiersResponse>({
    queryKey: ["/api/billing/tiers"],
  });

  const tiers = tiersData?.tiers || [];
  const selectedTier = tiers.find((t) => t.id === selectedPlan);

  // Signup mutation
  const signupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          plan: selectedPlan,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Signup failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Redirect to Stripe checkout
        window.location.href = data.checkoutUrl;
      } else if (data.redirectUrl) {
        // Free plan - redirect to onboarding
        setLocation(data.redirectUrl);
      } else {
        // Fallback
        toast({
          title: "Account created!",
          description: "Check your email for login instructions.",
        });
        setLocation("/login");
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Signup failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const validateInfo = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.clinicName.trim()) {
      newErrors.clinicName = "Clinic name is required";
    }
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email";
    }
    if (!formData.firstName.trim()) {
      newErrors.firstName = "First name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === "info") {
      if (validateInfo()) {
        setStep("plan");
      }
    } else if (step === "plan") {
      setStep("checkout");
    }
  };

  const handleBack = () => {
    if (step === "plan") {
      setStep("info");
    } else if (step === "checkout") {
      setStep("plan");
    }
  };

  const handleSubmit = () => {
    signupMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/pricing")}>
              <Phone className="h-6 w-6 text-primary" />
              <span className="font-bold text-xl">Echo Desk</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">Already have an account?</span>
              <Button variant="ghost" onClick={() => setLocation("/login")}>
                Log in
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="flex items-center justify-center gap-2 mb-8">
          {["info", "plan", "checkout"].map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s
                    ? "bg-primary text-primary-foreground"
                    : ["info", "plan", "checkout"].indexOf(step) > i
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {["info", "plan", "checkout"].indexOf(step) > i ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 2 && (
                <div
                  className={`w-16 h-0.5 mx-2 ${
                    ["info", "plan", "checkout"].indexOf(step) > i
                      ? "bg-primary"
                      : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form Content */}
      <div className="max-w-2xl mx-auto px-4 pb-12">
        {step === "info" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Tell us about your clinic
              </CardTitle>
              <CardDescription>
                We'll use this to set up your account and customize your AI receptionist.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="clinicName">Clinic Name *</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="clinicName"
                    placeholder="e.g., Sunrise Chiropractic"
                    className="pl-10"
                    value={formData.clinicName}
                    onChange={(e) =>
                      setFormData({ ...formData, clinicName: e.target.value })
                    }
                  />
                </div>
                {errors.clinicName && (
                  <p className="text-sm text-destructive">{errors.clinicName}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    placeholder="Jane"
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData({ ...formData, firstName: e.target.value })
                    }
                  />
                  {errors.firstName && (
                    <p className="text-sm text-destructive">{errors.firstName}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Smith"
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData({ ...formData, lastName: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="jane@sunrisechiro.com"
                    className="pl-10"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number (optional)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+61 4XX XXX XXX"
                    className="pl-10"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={() => setLocation("/pricing")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === "plan" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Choose your plan
              </CardTitle>
              <CardDescription>
                All plans include a 14-day free trial. Cancel anytime.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tiersLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <RadioGroup
                  value={selectedPlan}
                  onValueChange={setSelectedPlan}
                  className="space-y-3"
                >
                  {tiers.map((tier) => (
                    <div
                      key={tier.id}
                      className={`relative flex items-start gap-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                        selectedPlan === tier.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => setSelectedPlan(tier.id)}
                    >
                      <RadioGroupItem value={tier.id} id={tier.id} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={tier.id} className="font-semibold cursor-pointer">
                            {tier.name}
                          </Label>
                          {tier.id === "pro" && (
                            <Badge variant="secondary" className="text-xs">
                              Popular
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {tier.features.maxCallsPerMonth === -1
                            ? "Unlimited"
                            : tier.features.maxCallsPerMonth.toLocaleString()}{" "}
                          calls/month
                          {tier.features.recording && " • Recording"}
                          {tier.features.transcription && " • Transcription"}
                          {tier.features.qaAnalysis && " • QA"}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-bold">${tier.price}</span>
                        {tier.price > 0 && (
                          <span className="text-muted-foreground text-sm">/mo</span>
                        )}
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleNext}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === "checkout" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Confirm your subscription
              </CardTitle>
              <CardDescription>
                Review your details before continuing to payment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary */}
              <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Clinic</span>
                  <span className="font-medium">{formData.clinicName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Account email</span>
                  <span className="font-medium">{formData.email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium">{selectedTier?.name}</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="font-semibold">Monthly total</span>
                  <span className="text-2xl font-bold">
                    ${selectedTier?.price || 0}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </span>
                </div>
              </div>

              {/* What happens next */}
              <div className="space-y-2">
                <h4 className="font-medium">What happens next?</h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  {selectedTier?.price && selectedTier.price > 0 ? (
                    <>
                      <li>You'll be redirected to our secure payment page</li>
                      <li>After payment, you'll receive login credentials via email</li>
                      <li>Complete the onboarding wizard to set up your AI receptionist</li>
                      <li>Start receiving calls within minutes!</li>
                    </>
                  ) : (
                    <>
                      <li>Your account will be created immediately</li>
                      <li>You'll receive login credentials via email</li>
                      <li>Complete the onboarding wizard to set up your AI receptionist</li>
                      <li>Start your free trial!</li>
                    </>
                  )}
                </ol>
              </div>

              <p className="text-xs text-muted-foreground">
                By continuing, you agree to our Terms of Service and Privacy Policy.
                {selectedTier?.price && selectedTier.price > 0 && (
                  <> You can cancel your subscription anytime from the billing portal.</>
                )}
              </p>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={signupMutation.isPending}
                size="lg"
              >
                {signupMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : selectedTier?.price && selectedTier.price > 0 ? (
                  <CreditCard className="h-4 w-4 mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {selectedTier?.price && selectedTier.price > 0
                  ? "Continue to Payment"
                  : "Create Free Account"}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
