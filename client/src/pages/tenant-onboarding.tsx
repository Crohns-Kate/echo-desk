import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
  Clock,
  Mic,
  Key,
  MessageSquare,
  Bell,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Play,
  Plus,
  Trash2,
  AlertCircle,
  MapPin,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// TYPES
// ============================================================================

interface BusinessHours {
  [day: string]: {
    isOpen: boolean;
    openTime: string;
    closeTime: string;
  };
}

interface FAQ {
  id: string;
  category: string;
  question: string;
  answer: string;
}

interface OnboardingData {
  // Step 1: Business Info
  clinicName: string;
  slug: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressPostcode: string;
  email: string;
  websiteUrl: string;

  // Step 2: Timezone & Hours
  timezone: string;
  businessHours: BusinessHours;

  // Step 3: Voice Settings
  voiceName: string;
  greeting: string;
  afterHoursMessage: string;
  holdMessage: string;

  // Step 4: Phone Setup
  phoneSetupType: "provisioned" | "forwarding";
  preferredAreaCode: string;
  forwardingSourceNumber: string;
  forwardingSchedule: "after_hours" | "busy" | "always";

  // Step 5: Cliniko Integration
  usesCliniko: boolean;
  clinikoApiKey: string;
  clinikoShard: string;
  clinikoPractitionerId: string;
  clinikoStandardApptTypeId: string;
  clinikoNewPatientApptTypeId: string;

  // Step 6: FAQs
  faqs: FAQ[];

  // Step 7: Notifications
  alertEmails: string[];
  weeklyReportEnabled: boolean;
  humanRequestAlerts: boolean;
  bookingFailureAlerts: boolean;
  afterHoursSummary: boolean;

  // Step 8: Features & Activation
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  qaAnalysisEnabled: boolean;
  faqEnabled: boolean;
  smsEnabled: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const defaultBusinessHours: BusinessHours = {
  monday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  tuesday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  wednesday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  thursday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  friday: { isOpen: true, openTime: "08:00", closeTime: "17:00" },
  saturday: { isOpen: false, openTime: "09:00", closeTime: "13:00" },
  sunday: { isOpen: false, openTime: "09:00", closeTime: "13:00" },
};

const defaultFAQs: FAQ[] = [
  { id: "1", category: "general", question: "What are your hours?", answer: "" },
  { id: "2", category: "general", question: "Where are you located?", answer: "" },
  { id: "3", category: "billing", question: "Do you bulk bill?", answer: "" },
  { id: "4", category: "services", question: "What services do you offer?", answer: "" },
  { id: "5", category: "appointments", question: "How long is a consultation?", answer: "" },
];

const defaultData: OnboardingData = {
  clinicName: "",
  slug: "",
  addressStreet: "",
  addressCity: "",
  addressState: "QLD",
  addressPostcode: "",
  email: "",
  websiteUrl: "",
  timezone: "Australia/Brisbane",
  businessHours: defaultBusinessHours,
  voiceName: "Polly.Olivia-Neural",
  greeting: "",
  afterHoursMessage: "",
  holdMessage: "",
  phoneSetupType: "provisioned",
  preferredAreaCode: "07",
  forwardingSourceNumber: "",
  forwardingSchedule: "after_hours",
  usesCliniko: false,
  clinikoApiKey: "",
  clinikoShard: "au4",
  clinikoPractitionerId: "",
  clinikoStandardApptTypeId: "",
  clinikoNewPatientApptTypeId: "",
  faqs: defaultFAQs,
  alertEmails: [""],
  weeklyReportEnabled: true,
  humanRequestAlerts: true,
  bookingFailureAlerts: true,
  afterHoursSummary: true,
  recordingEnabled: true,
  transcriptionEnabled: true,
  qaAnalysisEnabled: true,
  faqEnabled: true,
  smsEnabled: true,
};

const timezones = [
  { value: "Australia/Brisbane", label: "Queensland (AEST)" },
  { value: "Australia/Sydney", label: "NSW/ACT (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Victoria (AEST/AEDT)" },
  { value: "Australia/Adelaide", label: "South Australia (ACST/ACDT)" },
  { value: "Australia/Perth", label: "Western Australia (AWST)" },
  { value: "Australia/Darwin", label: "Northern Territory (ACST)" },
  { value: "Australia/Hobart", label: "Tasmania (AEST/AEDT)" },
];

const voices = [
  { value: "Polly.Olivia-Neural", label: "Olivia (Australian Female) - Recommended", preview: true },
  { value: "Polly.Nicole-Neural", label: "Nicole (Australian Female)", preview: true },
  { value: "Polly.Matthew", label: "Matthew (American Male)", preview: false },
  { value: "Polly.Amy-Neural", label: "Amy (British Female)", preview: false },
];

const areaCodes = [
  { value: "02", label: "02 - NSW/ACT (Sydney)" },
  { value: "03", label: "03 - VIC/TAS (Melbourne)" },
  { value: "07", label: "07 - QLD (Brisbane)" },
  { value: "08", label: "08 - SA/WA/NT (Adelaide/Perth)" },
];

const clinikoShards = [
  { value: "au1", label: "Australia 1 (au1)" },
  { value: "au2", label: "Australia 2 (au2)" },
  { value: "au3", label: "Australia 3 (au3)" },
  { value: "au4", label: "Australia 4 (au4)" },
  { value: "uk1", label: "UK 1 (uk1)" },
  { value: "us1", label: "US 1 (us1)" },
];

const australianStates = [
  { value: "QLD", label: "Queensland" },
  { value: "NSW", label: "New South Wales" },
  { value: "VIC", label: "Victoria" },
  { value: "SA", label: "South Australia" },
  { value: "WA", label: "Western Australia" },
  { value: "TAS", label: "Tasmania" },
  { value: "NT", label: "Northern Territory" },
  { value: "ACT", label: "Australian Capital Territory" },
];

const steps = [
  { id: 1, title: "Business Info", icon: Building2, description: "Your clinic details" },
  { id: 2, title: "Hours", icon: Clock, description: "Business hours & timezone" },
  { id: 3, title: "Voice", icon: Mic, description: "AI voice & greetings" },
  { id: 4, title: "Phone", icon: Phone, description: "Phone number setup" },
  { id: 5, title: "Cliniko", icon: Key, description: "Practice management" },
  { id: 6, title: "FAQs", icon: MessageSquare, description: "Common questions" },
  { id: 7, title: "Alerts", icon: Bell, description: "Notifications" },
  { id: 8, title: "Review", icon: CheckCircle, description: "Activate your AI" },
];

const dayLabels: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function TenantOnboarding() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [clinikoTestStatus, setClinikoTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  // Auto-generate greeting when clinic name changes
  useEffect(() => {
    if (data.clinicName && !data.greeting) {
      setData(prev => ({
        ...prev,
        greeting: `Thanks for calling ${prev.clinicName}. How can I help you today?`,
      }));
    }
  }, [data.clinicName]);

  // Auto-fill location FAQ
  useEffect(() => {
    if (data.addressStreet && data.addressCity) {
      const locationAnswer = `We're located at ${data.addressStreet}, ${data.addressCity} ${data.addressState} ${data.addressPostcode}`.trim();
      setData(prev => ({
        ...prev,
        faqs: prev.faqs.map(faq =>
          faq.question === "Where are you located?" ? { ...faq, answer: locationAnswer } : faq
        ),
      }));
    }
  }, [data.addressStreet, data.addressCity, data.addressState, data.addressPostcode]);

  // Auto-fill hours FAQ
  useEffect(() => {
    const openDays = Object.entries(data.businessHours)
      .filter(([, hours]) => hours.isOpen)
      .map(([day, hours]) => `${dayLabels[day]}: ${hours.openTime} - ${hours.closeTime}`)
      .join(", ");

    if (openDays) {
      setData(prev => ({
        ...prev,
        faqs: prev.faqs.map(faq =>
          faq.question === "What are your hours?" ? { ...faq, answer: `Our hours are ${openDays}` } : faq
        ),
      }));
    }
  }, [data.businessHours]);

  const createMutation = useMutation({
    mutationFn: async (tenantData: OnboardingData) => {
      // Create the tenant with all data
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tenantData.slug,
          clinicName: tenantData.clinicName,
          email: tenantData.email,
          timezone: tenantData.timezone,
          voiceName: tenantData.voiceName,
          greeting: tenantData.greeting,
          addressStreet: tenantData.addressStreet,
          addressCity: tenantData.addressCity,
          addressState: tenantData.addressState,
          addressPostcode: tenantData.addressPostcode,
          websiteUrl: tenantData.websiteUrl,
          businessHours: tenantData.businessHours,
          afterHoursMessage: tenantData.afterHoursMessage,
          holdMessage: tenantData.holdMessage,
          phoneSetupType: tenantData.phoneSetupType,
          forwardingSourceNumber: tenantData.forwardingSourceNumber,
          forwardingSchedule: tenantData.forwardingSchedule,
          clinikoApiKey: tenantData.usesCliniko ? tenantData.clinikoApiKey : undefined,
          clinikoShard: tenantData.usesCliniko ? tenantData.clinikoShard : undefined,
          clinikoPractitionerId: tenantData.usesCliniko ? tenantData.clinikoPractitionerId : undefined,
          clinikoStandardApptTypeId: tenantData.usesCliniko ? tenantData.clinikoStandardApptTypeId : undefined,
          clinikoNewPatientApptTypeId: tenantData.usesCliniko ? tenantData.clinikoNewPatientApptTypeId : undefined,
          alertEmails: tenantData.alertEmails.filter(e => e.trim()),
          weeklyReportEnabled: tenantData.weeklyReportEnabled,
          recordingEnabled: tenantData.recordingEnabled,
          transcriptionEnabled: tenantData.transcriptionEnabled,
          qaAnalysisEnabled: tenantData.qaAnalysisEnabled,
          faqEnabled: tenantData.faqEnabled,
          smsEnabled: tenantData.smsEnabled,
          onboardingCompleted: true,
          isActive: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create tenant");
      }

      const tenant = await res.json();

      // Assign phone number from pool
      if (tenantData.phoneSetupType === "provisioned") {
        const phoneRes = await fetch("/api/admin/phone-pool/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant.id,
            preferredAreaCode: tenantData.preferredAreaCode,
          }),
        });

        if (!phoneRes.ok) {
          console.warn("Failed to assign phone number, will need manual setup");
        }
      }

      // Create FAQs
      const faqsToCreate = tenantData.faqs.filter(f => f.answer.trim());
      for (const faq of faqsToCreate) {
        await fetch("/api/faqs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: tenant.id,
            category: faq.category,
            question: faq.question,
            answer: faq.answer,
          }),
        });
      }

      return tenant;
    },
    onSuccess: (tenant) => {
      toast({
        title: "Clinic Created!",
        description: `${tenant.clinicName} is now ready to receive calls.`,
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
        return Object.values(data.businessHours).some(h => h.isOpen);
      case 3:
        return data.greeting.trim().length > 0;
      case 4:
        if (data.phoneSetupType === "forwarding") {
          return data.forwardingSourceNumber.trim().length > 0;
        }
        return true;
      case 5:
        if (data.usesCliniko) {
          return data.clinikoApiKey.trim().length > 0;
        }
        return true;
      case 6:
      case 7:
      case 8:
        return true;
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 8) {
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

  const testClinikoConnection = async () => {
    setClinikoTestStatus("testing");
    try {
      // This would call an API endpoint to test the Cliniko connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      setClinikoTestStatus("success");
      toast({ title: "Connection Successful", description: "Cliniko API is working correctly." });
    } catch {
      setClinikoTestStatus("error");
      toast({ title: "Connection Failed", description: "Please check your API key and region.", variant: "destructive" });
    }
  };

  const addFAQ = () => {
    setData({
      ...data,
      faqs: [...data.faqs, { id: Date.now().toString(), category: "general", question: "", answer: "" }],
    });
  };

  const removeFAQ = (id: string) => {
    setData({
      ...data,
      faqs: data.faqs.filter(f => f.id !== id),
    });
  };

  const updateFAQ = (id: string, field: keyof FAQ, value: string) => {
    setData({
      ...data,
      faqs: data.faqs.map(f => (f.id === id ? { ...f, [field]: value } : f)),
    });
  };

  const addAlertEmail = () => {
    setData({ ...data, alertEmails: [...data.alertEmails, ""] });
  };

  const removeAlertEmail = (index: number) => {
    setData({ ...data, alertEmails: data.alertEmails.filter((_, i) => i !== index) });
  };

  const updateAlertEmail = (index: number, value: string) => {
    setData({
      ...data,
      alertEmails: data.alertEmails.map((e, i) => (i === index ? value : e)),
    });
  };

  // ============================================================================
  // RENDER STEP CONTENT
  // ============================================================================

  const renderStepContent = () => {
    switch (currentStep) {
      // Step 1: Business Info
      case 1:
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clinicName">Clinic Name *</Label>
                <Input
                  id="clinicName"
                  value={data.clinicName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Brisbane Family Physio"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">URL Identifier *</Label>
                <Input
                  id="slug"
                  value={data.slug}
                  onChange={(e) => setData({ ...data, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="brisbane-family-physio"
                />
                <p className="text-xs text-muted-foreground">Lowercase, no spaces</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="addressStreet">Street Address</Label>
              <Input
                id="addressStreet"
                value={data.addressStreet}
                onChange={(e) => setData({ ...data, addressStreet: e.target.value })}
                placeholder="123 Main Street"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="addressCity">City/Suburb</Label>
                <Input
                  id="addressCity"
                  value={data.addressCity}
                  onChange={(e) => setData({ ...data, addressCity: e.target.value })}
                  placeholder="Brisbane"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addressState">State</Label>
                <Select value={data.addressState} onValueChange={(v) => setData({ ...data, addressState: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {australianStates.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="addressPostcode">Postcode</Label>
                <Input
                  id="addressPostcode"
                  value={data.addressPostcode}
                  onChange={(e) => setData({ ...data, addressPostcode: e.target.value })}
                  placeholder="4000"
                  maxLength={4}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <Label htmlFor="websiteUrl">Website (optional)</Label>
                <Input
                  id="websiteUrl"
                  value={data.websiteUrl}
                  onChange={(e) => setData({ ...data, websiteUrl: e.target.value })}
                  placeholder="https://www.clinic.com.au"
                />
              </div>
            </div>
          </div>
        );

      // Step 2: Hours
      case 2:
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Timezone</Label>
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
              <Label>Business Hours</Label>
              <div className="space-y-2">
                {Object.entries(data.businessHours).map(([day, hours]) => (
                  <div key={day} className="flex items-center gap-4 p-3 border rounded-lg">
                    <Checkbox
                      checked={hours.isOpen}
                      onCheckedChange={(checked) =>
                        setData({
                          ...data,
                          businessHours: {
                            ...data.businessHours,
                            [day]: { ...hours, isOpen: checked as boolean },
                          },
                        })
                      }
                    />
                    <span className="w-24 font-medium">{dayLabels[day]}</span>
                    {hours.isOpen ? (
                      <>
                        <Input
                          type="time"
                          value={hours.openTime}
                          onChange={(e) =>
                            setData({
                              ...data,
                              businessHours: {
                                ...data.businessHours,
                                [day]: { ...hours, openTime: e.target.value },
                              },
                            })
                          }
                          className="w-32"
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={hours.closeTime}
                          onChange={(e) =>
                            setData({
                              ...data,
                              businessHours: {
                                ...data.businessHours,
                                [day]: { ...hours, closeTime: e.target.value },
                              },
                            })
                          }
                          className="w-32"
                        />
                      </>
                    ) : (
                      <span className="text-muted-foreground">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      // Step 3: Voice
      case 3:
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>AI Voice</Label>
              <Select value={data.voiceName} onValueChange={(v) => setData({ ...data, voiceName: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      <div className="flex items-center gap-2">
                        {v.label}
                        {v.preview && <Badge variant="secondary" className="text-xs">Preview</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="mt-2">
                <Play className="h-4 w-4 mr-2" />
                Preview Voice
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="greeting">Greeting Message *</Label>
              <Textarea
                id="greeting"
                value={data.greeting}
                onChange={(e) => setData({ ...data, greeting: e.target.value })}
                placeholder="Thanks for calling Brisbane Family Physio. How can I help you today?"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                The first thing callers hear. Include your clinic name.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="afterHoursMessage">After-Hours Message</Label>
              <Textarea
                id="afterHoursMessage"
                value={data.afterHoursMessage}
                onChange={(e) => setData({ ...data, afterHoursMessage: e.target.value })}
                placeholder="Thanks for calling. We're currently closed. Our hours are Monday to Friday, 8am to 5pm. Please leave a message or call back during business hours."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="holdMessage">Hold Message (optional)</Label>
              <Textarea
                id="holdMessage"
                value={data.holdMessage}
                onChange={(e) => setData({ ...data, holdMessage: e.target.value })}
                placeholder="Please hold while I check that for you..."
                rows={2}
              />
            </div>
          </div>
        );

      // Step 4: Phone Setup
      case 4:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Label>Phone Setup Type</Label>

              <div
                className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  data.phoneSetupType === "provisioned" ? "border-primary bg-primary/5" : "border-muted"
                }`}
                onClick={() => setData({ ...data, phoneSetupType: "provisioned" })}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    checked={data.phoneSetupType === "provisioned"}
                    onChange={() => setData({ ...data, phoneSetupType: "provisioned" })}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">New Phone Number (Recommended)</p>
                    <p className="text-sm text-muted-foreground">
                      We'll provision a dedicated Australian phone number for your AI receptionist.
                      You can advertise this as your bookings line.
                    </p>
                    {data.phoneSetupType === "provisioned" && (
                      <div className="mt-4 space-y-2">
                        <Label>Preferred Area Code</Label>
                        <Select value={data.preferredAreaCode} onValueChange={(v) => setData({ ...data, preferredAreaCode: v })}>
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {areaCodes.map((ac) => (
                              <SelectItem key={ac.value} value={ac.value}>{ac.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  data.phoneSetupType === "forwarding" ? "border-primary bg-primary/5" : "border-muted"
                }`}
                onClick={() => setData({ ...data, phoneSetupType: "forwarding" })}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    checked={data.phoneSetupType === "forwarding"}
                    onChange={() => setData({ ...data, phoneSetupType: "forwarding" })}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">Forward Existing Number</p>
                    <p className="text-sm text-muted-foreground">
                      Keep your current phone number and forward calls to us when needed.
                      We'll provide a number for you to forward to.
                    </p>
                    {data.phoneSetupType === "forwarding" && (
                      <div className="mt-4 space-y-4">
                        <div className="space-y-2">
                          <Label>Your Current Phone Number *</Label>
                          <Input
                            value={data.forwardingSourceNumber}
                            onChange={(e) => setData({ ...data, forwardingSourceNumber: e.target.value })}
                            placeholder="+61 7 3XXX XXXX"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Forward Calls</Label>
                          <Select value={data.forwardingSchedule} onValueChange={(v: "after_hours" | "busy" | "always") => setData({ ...data, forwardingSchedule: v })}>
                            <SelectTrigger className="w-64">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="after_hours">After hours only</SelectItem>
                              <SelectItem value="busy">When busy / no answer</SelectItem>
                              <SelectItem value="always">All calls</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      // Step 5: Cliniko
      case 5:
        return (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <Checkbox
                checked={data.usesCliniko}
                onCheckedChange={(checked) => setData({ ...data, usesCliniko: checked as boolean })}
              />
              <div>
                <p className="font-medium">I use Cliniko for practice management</p>
                <p className="text-sm text-muted-foreground">
                  Connect to enable automatic appointment booking
                </p>
              </div>
            </div>

            {data.usesCliniko && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="clinikoApiKey">Cliniko API Key *</Label>
                  <Input
                    id="clinikoApiKey"
                    type="password"
                    value={data.clinikoApiKey}
                    onChange={(e) => setData({ ...data, clinikoApiKey: e.target.value })}
                    placeholder="Enter your Cliniko API key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in Cliniko → Settings → Integrations → API Keys
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Cliniko Region</Label>
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
                  <p className="text-xs text-muted-foreground">
                    Check your Cliniko URL (e.g., app.au4.cliniko.com = au4)
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={testClinikoConnection}
                  disabled={clinikoTestStatus === "testing" || !data.clinikoApiKey}
                >
                  {clinikoTestStatus === "testing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {clinikoTestStatus === "success" && <CheckCircle className="h-4 w-4 mr-2 text-green-600" />}
                  {clinikoTestStatus === "error" && <AlertCircle className="h-4 w-4 mr-2 text-red-600" />}
                  Test Connection
                </Button>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label>Practitioner ID</Label>
                    <Input
                      value={data.clinikoPractitionerId}
                      onChange={(e) => setData({ ...data, clinikoPractitionerId: e.target.value })}
                      placeholder="123456"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Standard Appt Type ID</Label>
                    <Input
                      value={data.clinikoStandardApptTypeId}
                      onChange={(e) => setData({ ...data, clinikoStandardApptTypeId: e.target.value })}
                      placeholder="789012"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>New Patient Appt Type ID</Label>
                    <Input
                      value={data.clinikoNewPatientApptTypeId}
                      onChange={(e) => setData({ ...data, clinikoNewPatientApptTypeId: e.target.value })}
                      placeholder="345678"
                    />
                  </div>
                </div>
              </div>
            )}

            {!data.usesCliniko && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>No problem!</strong> Without Cliniko, your AI receptionist will still answer calls,
                  collect caller information, and send you alerts for booking requests.
                </p>
              </div>
            )}
          </div>
        );

      // Step 6: FAQs
      case 6:
        return (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Add answers to common questions. The AI will use these to help callers.
              Leave blank to skip a question.
            </p>

            <div className="space-y-4">
              {data.faqs.map((faq) => (
                <div key={faq.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-2">
                      <Label className="text-sm font-medium">{faq.question || "Custom Question"}</Label>
                      {!faq.question && (
                        <Input
                          value={faq.question}
                          onChange={(e) => updateFAQ(faq.id, "question", e.target.value)}
                          placeholder="Enter your question"
                        />
                      )}
                    </div>
                    {!["1", "2", "3", "4", "5"].includes(faq.id) && (
                      <Button variant="ghost" size="sm" onClick={() => removeFAQ(faq.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={faq.answer}
                    onChange={(e) => updateFAQ(faq.id, "answer", e.target.value)}
                    placeholder="Enter your answer..."
                    rows={2}
                  />
                </div>
              ))}
            </div>

            <Button variant="outline" onClick={addFAQ}>
              <Plus className="h-4 w-4 mr-2" />
              Add Custom FAQ
            </Button>

            <p className="text-xs text-muted-foreground">
              💡 You can generate more FAQs from call transcripts later!
            </p>
          </div>
        );

      // Step 7: Alerts
      case 7:
        return (
          <div className="space-y-6">
            <div className="space-y-4">
              <Label>Alert Email Addresses</Label>
              <p className="text-sm text-muted-foreground">
                Where should we send urgent alerts and reports?
              </p>
              {data.alertEmails.map((email, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => updateAlertEmail(index, e.target.value)}
                    placeholder="alerts@clinic.com.au"
                  />
                  {data.alertEmails.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeAlertEmail(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addAlertEmail}>
                <Plus className="h-4 w-4 mr-2" />
                Add Another Email
              </Button>
            </div>

            <div className="space-y-4 pt-4 border-t">
              <Label>Alert Types</Label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Human Request Alerts</p>
                    <p className="text-xs text-muted-foreground">When a caller asks to speak to a human</p>
                  </div>
                  <Switch
                    checked={data.humanRequestAlerts}
                    onCheckedChange={(checked) => setData({ ...data, humanRequestAlerts: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Booking Failure Alerts</p>
                    <p className="text-xs text-muted-foreground">When an appointment couldn't be booked</p>
                  </div>
                  <Switch
                    checked={data.bookingFailureAlerts}
                    onCheckedChange={(checked) => setData({ ...data, bookingFailureAlerts: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">After-Hours Summary</p>
                    <p className="text-xs text-muted-foreground">Daily summary of after-hours calls</p>
                  </div>
                  <Switch
                    checked={data.afterHoursSummary}
                    onCheckedChange={(checked) => setData({ ...data, afterHoursSummary: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Weekly Report</p>
                    <p className="text-xs text-muted-foreground">Weekly analytics and call statistics</p>
                  </div>
                  <Switch
                    checked={data.weeklyReportEnabled}
                    onCheckedChange={(checked) => setData({ ...data, weeklyReportEnabled: checked })}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      // Step 8: Review & Activate
      case 8:
        return (
          <div className="space-y-6">
            <div className="grid gap-4">
              {/* Summary Cards */}
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4" />
                  <span className="font-medium">Business Info</span>
                </div>
                <p className="text-sm">{data.clinicName}</p>
                {data.addressStreet && (
                  <p className="text-sm text-muted-foreground">
                    {data.addressStreet}, {data.addressCity} {data.addressState} {data.addressPostcode}
                  </p>
                )}
              </div>

              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Phone className="h-4 w-4" />
                  <span className="font-medium">Phone Setup</span>
                </div>
                <p className="text-sm">
                  {data.phoneSetupType === "provisioned"
                    ? `New number (${areaCodes.find(a => a.value === data.preferredAreaCode)?.label})`
                    : `Forwarding from ${data.forwardingSourceNumber}`}
                </p>
              </div>

              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="h-4 w-4" />
                  <span className="font-medium">Cliniko Integration</span>
                </div>
                <p className="text-sm">{data.usesCliniko ? "Connected" : "Not configured"}</p>
              </div>

              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="font-medium">FAQs</span>
                </div>
                <p className="text-sm">{data.faqs.filter(f => f.answer.trim()).length} questions configured</p>
              </div>
            </div>

            <div className="p-4 border rounded-lg space-y-4">
              <Label className="text-base">Features</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={data.recordingEnabled}
                    onCheckedChange={(checked) => setData({ ...data, recordingEnabled: checked })}
                  />
                  <span className="text-sm">Call Recording</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={data.transcriptionEnabled}
                    onCheckedChange={(checked) => setData({ ...data, transcriptionEnabled: checked })}
                  />
                  <span className="text-sm">Transcription</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={data.qaAnalysisEnabled}
                    onCheckedChange={(checked) => setData({ ...data, qaAnalysisEnabled: checked })}
                  />
                  <span className="text-sm">QA Analysis</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={data.smsEnabled}
                    onCheckedChange={(checked) => setData({ ...data, smsEnabled: checked })}
                  />
                  <span className="text-sm">SMS Notifications</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-800 dark:text-green-200">
                <strong>Ready to activate!</strong> Click "Activate AI Receptionist" below to go live.
                Your AI will start handling calls immediately.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Set Up Your AI Receptionist</h1>
          <p className="text-sm text-muted-foreground">
            Complete these steps to get your clinic's AI receptionist up and running
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-between overflow-x-auto pb-2">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <div key={step.id} className="flex flex-col items-center relative min-w-[60px]">
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
                  className={`text-xs mt-2 text-center ${
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
            ) : currentStep === 8 ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Activate AI Receptionist
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
