import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, ArrowLeft, Check, X, Save, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ClinicSettings {
  id: number;
  clinicName: string;
  address: string;
  phoneNumber: string;
  email: string;
  timezone: string;
  businessHours: any;
  greeting: string;
  voiceName: string;
  parkingText: string;
  servicesText: string;
  firstVisitText: string;
  aboutText: string;
  healthText: string;
  faqJson: any[];
}

export default function Settings() {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<ClinicSettings>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch clinic settings
  const { data: settings, isLoading, error } = useQuery<ClinicSettings>({
    queryKey: ["/api/admin/settings"],
  });

  // Update form data when settings load
  useEffect(() => {
    if (settings) {
      setFormData(settings);
      setHasChanges(false);
    }
  }, [settings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<ClinicSettings>) => {
      return apiRequest("PUT", "/api/admin/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "Your clinic settings have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error saving settings",
        description: error.message || "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleChange = (field: keyof ClinicSettings, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  // Check environment features
  const features = {
    recording: import.meta.env.VITE_CALL_RECORDING_ENABLED === 'true',
    transcription: import.meta.env.VITE_TRANSCRIPTION_ENABLED === 'true',
    qaEngine: import.meta.env.VITE_QA_ENGINE_ENABLED !== 'false',
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <SettingsIcon className="h-6 w-6" />
              Admin Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure your clinic settings and voice assistant behavior
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                Unsaved changes
              </Badge>
            )}
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
          </div>
        </div>

        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4">
              <p className="text-sm text-destructive">Failed to load settings. Please refresh the page.</p>
            </CardContent>
          </Card>
        )}

        {/* Clinic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clinic Information</CardTitle>
            <CardDescription>Basic contact and location details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clinicName">Clinic Name</Label>
                <Input
                  id="clinicName"
                  value={formData.clinicName || ''}
                  onChange={(e) => handleChange('clinicName', e.target.value)}
                  placeholder="Your Clinic Name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phoneNumber">Phone Number</Label>
                <Input
                  id="phoneNumber"
                  value={formData.phoneNumber || ''}
                  onChange={(e) => handleChange('phoneNumber', e.target.value)}
                  placeholder="+61..."
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address || ''}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="123 Main Street, Brisbane QLD 4000"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="reception@clinic.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={formData.timezone || 'Australia/Brisbane'}
                  onChange={(e) => handleChange('timezone', e.target.value)}
                  placeholder="Australia/Brisbane"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Voice Assistant Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Voice Assistant</CardTitle>
            <CardDescription>Configure how the AI greets and responds to callers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="greeting">Greeting Message</Label>
              <Textarea
                id="greeting"
                value={formData.greeting || ''}
                onChange={(e) => handleChange('greeting', e.target.value)}
                placeholder="Thanks for calling [Clinic Name]..."
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                The first message callers hear when they call
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceName">Voice Name</Label>
              <Input
                id="voiceName"
                value={formData.voiceName || 'Polly.Olivia-Neural'}
                onChange={(e) => handleChange('voiceName', e.target.value)}
                placeholder="Polly.Olivia-Neural"
              />
              <p className="text-xs text-muted-foreground">
                AWS Polly voice (e.g., Polly.Olivia-Neural, Polly.Matthew-Neural)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Base Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Knowledge Base</CardTitle>
            <CardDescription>
              Information the voice assistant uses to answer caller questions.
              This is the single source of truth for your clinic.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aboutText">About the Clinic / Health Text</Label>
              <Textarea
                id="aboutText"
                value={formData.aboutText || ''}
                onChange={(e) => handleChange('aboutText', e.target.value)}
                placeholder="We are a family-friendly chiropractic clinic specializing in..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                General information about your clinic that the AI can reference
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="healthText">Health Information / Specialties</Label>
              <Textarea
                id="healthText"
                value={formData.healthText || ''}
                onChange={(e) => handleChange('healthText', e.target.value)}
                placeholder="We specialize in treating back pain, neck pain, headaches..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Health conditions and specialties your clinic focuses on
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="servicesText">Services Offered</Label>
              <Textarea
                id="servicesText"
                value={formData.servicesText || ''}
                onChange={(e) => handleChange('servicesText', e.target.value)}
                placeholder="Chiropractic adjustments, soft tissue therapy, rehabilitation exercises, posture assessments..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                List of services your clinic provides
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="parkingText">Parking Information</Label>
              <Textarea
                id="parkingText"
                value={formData.parkingText || ''}
                onChange={(e) => handleChange('parkingText', e.target.value)}
                placeholder="We have free parking at the rear of the building. Street parking is also available..."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstVisitText">First Visit Information</Label>
              <Textarea
                id="firstVisitText"
                value={formData.firstVisitText || ''}
                onChange={(e) => handleChange('firstVisitText', e.target.value)}
                placeholder="For your first visit, please arrive 10 minutes early. Bring comfortable clothing..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                What new patients should know before their first appointment
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Feature Flags (Read-only) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feature Status</CardTitle>
            <CardDescription>System features (configured via environment)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Call Recording</span>
                <p className="text-xs text-muted-foreground">Record all incoming calls</p>
              </div>
              <div className="flex items-center gap-2">
                {features.recording ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Transcription</span>
                <p className="text-xs text-muted-foreground">Generate text transcripts using AssemblyAI</p>
              </div>
              <div className="flex items-center gap-2">
                {features.transcription ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">QA Engine</span>
                <p className="text-xs text-muted-foreground">Automatic quality analysis with AI</p>
              </div>
              <div className="flex items-center gap-2">
                {features.qaEngine ? (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <Badge variant="default">Enabled</Badge>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline">Disabled</Badge>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Actions</CardTitle>
            <CardDescription>Maintenance and diagnostic tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Cliniko Health Check</span>
                <p className="text-xs text-muted-foreground">Test Cliniko API connectivity</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/__cliniko/health" target="_blank" rel="noopener noreferrer">
                  Run Test
                </a>
              </Button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">Timezone Check</span>
                <p className="text-xs text-muted-foreground">Verify server timezone configuration</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/__tz/now" target="_blank" rel="noopener noreferrer">
                  Check Time
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
