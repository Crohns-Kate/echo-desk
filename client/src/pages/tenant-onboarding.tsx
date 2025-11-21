import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Phone,
  Globe,
  Mic,
  Key,
  Settings,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OnboardingData {
  // Step 1: Basic Info
  clinicName: string;
  slug: string;
  // Step 2: Contact
  phoneNumber: string;
  email: string;
  address: string;
  // Step 3: Voice Settings
  timezone: string;
  voiceName: string;
  greeting: string;
  fallbackMessage: string;
  // Step 4: Cliniko Integration
  clinikoApiKey: string;
  clinikoShard: string;
  clinikoPractitionerId: string;
  clinikoStandardApptTypeId: string;
  clinikoNewPatientApptTypeId: string;
  // Step 5: Features
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  qaAnalysisEnabled: boolean;
  faqEnabled: boolean;
  smsEnabled: boolean;
}

const defaultData: OnboardingData = {
  clinicName: "",
  slug: "",
  phoneNumber: "",
  email: "",
  address: "",
  timezone: "Australia/Brisbane",
  voiceName: "Polly.Olivia-Neural",
  greeting: "Thanks for calling",
  fallbackMessage: "I'm sorry, I didn't catch that. Could you please repeat?",
  clinikoApiKey: "",
  clinikoShard: "au1",
  clinikoPractitionerId: "",
  clinikoStandardApptTypeId: "",
  clinikoNewPatientApptTypeId: "",
  recordingEnabled: true,
  transcriptionEnabled: true,
  qaAnalysisEnabled: true,
  faqEnabled: true,
  smsEnabled: true,
};

const timezones = [
  { value: "Australia/Brisbane", label: "Australia/Brisbane (AEST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Australia/Melbourne (AEST/AEDT)" },
  { value: "Australia/Perth", label: "Australia/Perth (AWST)" },
  { value: "Australia/Adelaide", label: "Australia/Adelaide (ACST/ACDT)" },
  { value: "Pacific/Auckland", label: "New Zealand (NZST/NZDT)" },
];

const voices = [
  { value: "Polly.Olivia-Neural", label: "Olivia (Australian Female)" },
  { value: "Polly.Nicole-Neural", label: "Nicole (Australian Female)" },
  { value: "Polly.Matthew", label: "Matthew (US Male)" },
  { value: "Polly.Amy-Neural", label: "Amy (British Female)" },
];

const clinikoShards = [
  { value: "au1", label: "Australia 1 (au1)" },
  { value: "au2", label: "Australia 2 (au2)" },
  { value: "au3", label: "Australia 3 (au3)" },
  { value: "au4", label: "Australia 4 (au4)" },
  { value: "uk1", label: "UK 1 (uk1)" },
  { value: "us1", label: "US 1 (us1)" },
];

const steps = [
  { id: 1, title: "Basic Info", icon: Building2, description: "Clinic name and identifier" },
  { id: 2, title: "Contact", icon: Phone, description: "Phone and email details" },
  { id: 3, title: "Voice", icon: Mic, description: "Voice and greeting settings" },
  { id: 4, title: "Cliniko", icon: Key, description: "Practice management integration" },
  { id: 5, title: "Features", icon: Settings, description: "Enable/disable features" },
];

export default function TenantOnboarding() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(defaultData);

  const createMutation = useMutation({
    mutationFn: async (tenantData: OnboardingData) => {
      // First create the tenant
      const createRes = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tenantData.slug,
          clinicName: tenantData.clinicName,
          phoneNumber: tenantData.phoneNumber,
          email: tenantData.email,
          timezone: tenantData.timezone,
          voiceName: tenantData.voiceName,
          greeting: tenantData.greeting,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || "Failed to create tenant");
      }

      const tenant = await createRes.json();

      // Then update with remaining fields
      const updateRes = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: tenantData.address,
          fallbackMessage: tenantData.fallbackMessage,
          clinikoApiKey: tenantData.clinikoApiKey || undefined,
          clinikoShard: tenantData.clinikoShard,
          clinikoPractitionerId: tenantData.clinikoPractitionerId || undefined,
          clinikoStandardApptTypeId: tenantData.clinikoStandardApptTypeId || undefined,
          clinikoNewPatientApptTypeId: tenantData.clinikoNewPatientApptTypeId || undefined,
          recordingEnabled: tenantData.recordingEnabled,
          transcriptionEnabled: tenantData.transcriptionEnabled,
          qaAnalysisEnabled: tenantData.qaAnalysisEnabled,
          faqEnabled: tenantData.faqEnabled,
          smsEnabled: tenantData.smsEnabled,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.json();
        throw new Error(err.error || "Failed to update tenant settings");
      }

      return updateRes.json();
    },
    onSuccess: (tenant) => {
      toast({
        title: "Clinic Created",
        description: `${tenant.clinicName} has been set up successfully.`,
      });
      setLocation("/tenants");
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  };

  const handleNameChange = (name: string) => {
    setData({
      ...data,
      clinicName: name,
      slug: data.slug || generateSlug(name),
    });
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return data.clinicName.trim().length > 0 && data.slug.trim().length > 0;
      case 2:
        return true; // Contact info is optional
      case 3:
        return data.greeting.trim().length > 0;
      case 4:
        return true; // Cliniko integration is optional
      case 5:
        return true; // Features have defaults
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 5) {
        setCurrentStep(currentStep + 1);
      } else {
        createMutation.mutate(data);
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clinicName">Clinic Name *</Label>
              <Input
                id="clinicName"
                value={data.clinicName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Brisbane Family Physio"
              />
              <p className="text-xs text-muted-foreground">
                The display name for your clinic
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL Identifier *</Label>
              <Input
                id="slug"
                value={data.slug}
                onChange={(e) => setData({ ...data, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="brisbane-family-physio"
              />
              <p className="text-xs text-muted-foreground">
                Unique identifier used in URLs (lowercase, no spaces)
              </p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Twilio Phone Number</Label>
              <Input
                id="phoneNumber"
                value={data.phoneNumber}
                onChange={(e) => setData({ ...data, phoneNumber: e.target.value })}
                placeholder="+61400000000"
              />
              <p className="text-xs text-muted-foreground">
                The Twilio number that routes to this clinic
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Contact Email</Label>
              <Input
                id="email"
                type="email"
                value={data.email}
                onChange={(e) => setData({ ...data, email: e.target.value })}
                placeholder="reception@clinic.com.au"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={data.address}
                onChange={(e) => setData({ ...data, address: e.target.value })}
                placeholder="123 Main Street, Brisbane QLD 4000"
                rows={2}
              />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={data.timezone} onValueChange={(v) => setData({ ...data, timezone: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceName">AI Voice</Label>
              <Select value={data.voiceName} onValueChange={(v) => setData({ ...data, voiceName: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="greeting">Greeting Message *</Label>
              <Textarea
                id="greeting"
                value={data.greeting}
                onChange={(e) => setData({ ...data, greeting: e.target.value })}
                placeholder="Thanks for calling Brisbane Family Physio. How can I help you today?"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                The first thing callers hear when they call
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallbackMessage">Fallback Message</Label>
              <Textarea
                id="fallbackMessage"
                value={data.fallbackMessage}
                onChange={(e) => setData({ ...data, fallbackMessage: e.target.value })}
                placeholder="I'm sorry, I didn't catch that. Could you please repeat?"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Said when the AI doesn't understand the caller
              </p>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                Connect to Cliniko to enable appointment booking. You can skip this step and configure it later.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinikoApiKey">Cliniko API Key</Label>
              <Input
                id="clinikoApiKey"
                type="password"
                value={data.clinikoApiKey}
                onChange={(e) => setData({ ...data, clinikoApiKey: e.target.value })}
                placeholder="Enter your Cliniko API key"
              />
              <p className="text-xs text-muted-foreground">
                Found in Cliniko Settings &gt; Integrations &gt; API Keys
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinikoShard">Cliniko Region</Label>
              <Select value={data.clinikoShard} onValueChange={(v) => setData({ ...data, clinikoShard: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clinikoShards.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clinikoPractitionerId">Practitioner ID</Label>
                <Input
                  id="clinikoPractitionerId"
                  value={data.clinikoPractitionerId}
                  onChange={(e) => setData({ ...data, clinikoPractitionerId: e.target.value })}
                  placeholder="123456"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clinikoStandardApptTypeId">Standard Appt Type ID</Label>
                <Input
                  id="clinikoStandardApptTypeId"
                  value={data.clinikoStandardApptTypeId}
                  onChange={(e) => setData({ ...data, clinikoStandardApptTypeId: e.target.value })}
                  placeholder="789012"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clinikoNewPatientApptTypeId">New Patient Appt Type ID</Label>
                <Input
                  id="clinikoNewPatientApptTypeId"
                  value={data.clinikoNewPatientApptTypeId}
                  onChange={(e) => setData({ ...data, clinikoNewPatientApptTypeId: e.target.value })}
                  placeholder="345678"
                />
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enable or disable features for this clinic. All features are enabled by default.
            </p>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">Call Recording</p>
                  <p className="text-xs text-muted-foreground">Record all incoming calls</p>
                </div>
                <Switch
                  checked={data.recordingEnabled}
                  onCheckedChange={(checked) => setData({ ...data, recordingEnabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">Transcription</p>
                  <p className="text-xs text-muted-foreground">Convert calls to text using AI</p>
                </div>
                <Switch
                  checked={data.transcriptionEnabled}
                  onCheckedChange={(checked) => setData({ ...data, transcriptionEnabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">QA Analysis</p>
                  <p className="text-xs text-muted-foreground">AI-powered call quality scoring</p>
                </div>
                <Switch
                  checked={data.qaAnalysisEnabled}
                  onCheckedChange={(checked) => setData({ ...data, qaAnalysisEnabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">FAQ Answers</p>
                  <p className="text-xs text-muted-foreground">Answer common questions automatically</p>
                </div>
                <Switch
                  checked={data.faqEnabled}
                  onCheckedChange={(checked) => setData({ ...data, faqEnabled: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">SMS Notifications</p>
                  <p className="text-xs text-muted-foreground">Send appointment confirmations via SMS</p>
                </div>
                <Switch
                  checked={data.smsEnabled}
                  onCheckedChange={(checked) => setData({ ...data, smsEnabled: checked })}
                />
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">New Clinic Setup</h1>
          <p className="text-sm text-muted-foreground">
            Set up a new clinic in just a few steps
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-between">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <div key={step.id} className="flex flex-col items-center relative">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                    isCompleted
                      ? "bg-primary border-primary text-primary-foreground"
                      : isActive
                      ? "border-primary text-primary"
                      : "border-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={`text-xs mt-2 ${
                    isActive ? "text-primary font-medium" : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
                {index < steps.length - 1 && (
                  <div
                    className={`absolute top-5 left-full w-full h-0.5 -translate-y-1/2 ${
                      isCompleted ? "bg-primary" : "bg-muted"
                    }`}
                    style={{ width: "calc(100% - 2.5rem)", marginLeft: "1.25rem" }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => {
                const StepIcon = steps[currentStep - 1].icon;
                return <StepIcon className="h-5 w-5" />;
              })()}
              {steps[currentStep - 1].title}
            </CardTitle>
            <CardDescription>{steps[currentStep - 1].description}</CardDescription>
          </CardHeader>
          <CardContent>{renderStepContent()}</CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 1}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={nextStep}
            disabled={!validateStep(currentStep) || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : currentStep === 5 ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create Clinic
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
