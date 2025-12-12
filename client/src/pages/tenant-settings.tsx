/**
 * Tenant Settings Page
 * Self-service settings for tenant admins to configure their clinic
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Settings,
  Save,
  Loader2,
  MapPin,
  Building2,
  Users,
  Mic,
  Plus,
  Pencil,
  Trash2,
  Star,
  ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Types
interface TenantProfile {
  id: number;
  slug: string;
  clinicName: string;
  phoneNumber: string | null;
  email: string | null;
  address: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostcode: string | null;
  googleMapsUrl: string | null;
  timezone: string;
  voiceName: string | null;
  greeting: string;
  afterHoursMessage: string | null;
  holdMessage: string | null;
  businessHours: any;
  alertEmails: string[] | null;
  weeklyReportEnabled: boolean;
}

interface Practitioner {
  id: number;
  tenantId: number;
  name: string;
  clinikoPractitionerId: string | null;
  isActive: boolean;
  isDefault: boolean;
  schedule: any;
  createdAt: string;
  updatedAt: string;
}

export default function TenantSettings() {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Partial<TenantProfile>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("clinic");

  // Practitioner dialog state
  const [practitionerDialogOpen, setPractitionerDialogOpen] = useState(false);
  const [editingPractitioner, setEditingPractitioner] = useState<Practitioner | null>(null);
  const [practitionerForm, setPractitionerForm] = useState({
    name: "",
    clinikoPractitionerId: "",
    isDefault: false,
  });

  // Fetch tenant profile
  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<TenantProfile>({
    queryKey: ["tenantProfile"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/profile", { credentials: "include" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to fetch profile" }));
        throw new Error(err.error || "Failed to fetch profile");
      }
      return response.json();
    },
    retry: false, // Don't retry on error (super admin case)
  });

  // Fetch practitioners
  const { data: practitioners, isLoading: practitionersLoading } = useQuery<Practitioner[]>({
    queryKey: ["tenantPractitioners"],
    queryFn: async () => {
      const response = await fetch("/api/tenant/practitioners", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch practitioners");
      return response.json();
    },
  });

  // Update form when profile loads
  useEffect(() => {
    if (profile) {
      setFormData(profile);
      setHasChanges(false);
    }
  }, [profile]);

  // Save profile mutation
  const saveProfileMutation = useMutation({
    mutationFn: async (data: Partial<TenantProfile>) => {
      const response = await fetch("/api/tenant/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenantProfile"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "Your clinic settings have been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create practitioner mutation
  const createPractitionerMutation = useMutation({
    mutationFn: async (data: { name: string; clinikoPractitionerId?: string; isDefault?: boolean }) => {
      const response = await fetch("/api/tenant/practitioners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create practitioner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenantPractitioners"] });
      setPractitionerDialogOpen(false);
      resetPractitionerForm();
      toast({
        title: "Practitioner added",
        description: "The practitioner has been added successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error adding practitioner",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update practitioner mutation
  const updatePractitionerMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Practitioner> }) => {
      const response = await fetch(`/api/tenant/practitioners/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update practitioner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenantPractitioners"] });
      setPractitionerDialogOpen(false);
      setEditingPractitioner(null);
      resetPractitionerForm();
      toast({
        title: "Practitioner updated",
        description: "The practitioner has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating practitioner",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete practitioner mutation
  const deletePractitionerMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/tenant/practitioners/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete practitioner");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenantPractitioners"] });
      toast({
        title: "Practitioner removed",
        description: "The practitioner has been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error removing practitioner",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleChange = (field: keyof TenantProfile, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveProfileMutation.mutate(formData);
  };

  const resetPractitionerForm = () => {
    setPractitionerForm({ name: "", clinikoPractitionerId: "", isDefault: false });
    setEditingPractitioner(null);
  };

  const openEditPractitioner = (practitioner: Practitioner) => {
    setEditingPractitioner(practitioner);
    setPractitionerForm({
      name: practitioner.name,
      clinikoPractitionerId: practitioner.clinikoPractitionerId || "",
      isDefault: practitioner.isDefault,
    });
    setPractitionerDialogOpen(true);
  };

  const handlePractitionerSubmit = () => {
    if (!practitionerForm.name.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a practitioner name.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name: practitionerForm.name.trim(),
      clinikoPractitionerId: practitionerForm.clinikoPractitionerId.trim() || undefined,
      isDefault: practitionerForm.isDefault,
    };

    if (editingPractitioner) {
      updatePractitionerMutation.mutate({ id: editingPractitioner.id, data });
    } else {
      createPractitionerMutation.mutate(data);
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Handle case where super admin has no tenant or profile failed to load
  if (!profile || profileError) {
    return (
      <div className="container mx-auto py-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              No Tenant Selected
            </CardTitle>
            <CardDescription>
              As a super admin, you need to access tenant settings from the Tenants page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              To edit clinic settings, go to the Tenants page and click the edit icon next to the tenant you want to configure.
            </p>
            <Link href="/tenants">
              <Button>
                <Building2 className="h-4 w-4 mr-2" />
                Go to Tenants
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Clinic Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure your clinic details, practitioners, and AI voice settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
              Unsaved changes
            </Badge>
          )}
          <Button onClick={handleSave} disabled={!hasChanges || saveProfileMutation.isPending}>
            {saveProfileMutation.isPending ? (
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="clinic" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Clinic Details
          </TabsTrigger>
          <TabsTrigger value="practitioners" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Practitioners
          </TabsTrigger>
          <TabsTrigger value="voice" className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Voice Settings
          </TabsTrigger>
        </TabsList>

        {/* Clinic Details Tab */}
        <TabsContent value="clinic" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basic Information</CardTitle>
              <CardDescription>Your clinic name and contact details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clinicName">Clinic Name</Label>
                  <Input
                    id="clinicName"
                    value={formData.clinicName || ""}
                    onChange={(e) => handleChange("clinicName", e.target.value)}
                    placeholder="Your Clinic Name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email || ""}
                    onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="reception@clinic.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={formData.timezone || "Australia/Brisbane"}
                  onChange={(e) => handleChange("timezone", e.target.value)}
                  placeholder="Australia/Brisbane"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location
              </CardTitle>
              <CardDescription>Your clinic address and directions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="address">Full Address</Label>
                <Input
                  id="address"
                  value={formData.address || ""}
                  onChange={(e) => handleChange("address", e.target.value)}
                  placeholder="123 Main Street, Brisbane QLD 4000"
                />
                <p className="text-xs text-muted-foreground">
                  This is what the AI will read to callers asking for directions
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="addressStreet">Street</Label>
                  <Input
                    id="addressStreet"
                    value={formData.addressStreet || ""}
                    onChange={(e) => handleChange("addressStreet", e.target.value)}
                    placeholder="123 Main Street"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressCity">City/Suburb</Label>
                  <Input
                    id="addressCity"
                    value={formData.addressCity || ""}
                    onChange={(e) => handleChange("addressCity", e.target.value)}
                    placeholder="Brisbane"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="addressState">State</Label>
                  <Input
                    id="addressState"
                    value={formData.addressState || ""}
                    onChange={(e) => handleChange("addressState", e.target.value)}
                    placeholder="QLD"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressPostcode">Postcode</Label>
                  <Input
                    id="addressPostcode"
                    value={formData.addressPostcode || ""}
                    onChange={(e) => handleChange("addressPostcode", e.target.value)}
                    placeholder="4000"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="googleMapsUrl">Google Maps Link</Label>
                <Input
                  id="googleMapsUrl"
                  value={formData.googleMapsUrl || ""}
                  onChange={(e) => handleChange("googleMapsUrl", e.target.value)}
                  placeholder="https://maps.google.com/..."
                />
                <p className="text-xs text-muted-foreground">
                  When callers request directions, this link will be sent via SMS
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notifications</CardTitle>
              <CardDescription>Email alerts and reporting preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Weekly Report</Label>
                  <p className="text-xs text-muted-foreground">
                    Receive a weekly summary of call activity
                  </p>
                </div>
                <Switch
                  checked={formData.weeklyReportEnabled ?? true}
                  onCheckedChange={(checked) => handleChange("weeklyReportEnabled", checked)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Practitioners Tab */}
        <TabsContent value="practitioners" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Practitioners</CardTitle>
                  <CardDescription>
                    Manage practitioners who handle appointments. The AI will mention the default
                    practitioner when callers ask who they'll see.
                  </CardDescription>
                </div>
                <Dialog open={practitionerDialogOpen} onOpenChange={(open) => {
                  setPractitionerDialogOpen(open);
                  if (!open) resetPractitionerForm();
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Practitioner
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {editingPractitioner ? "Edit Practitioner" : "Add Practitioner"}
                      </DialogTitle>
                      <DialogDescription>
                        Enter the practitioner's details. The Cliniko ID is used to match appointments.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="practitionerName">Name</Label>
                        <Input
                          id="practitionerName"
                          value={practitionerForm.name}
                          onChange={(e) =>
                            setPractitionerForm((prev) => ({ ...prev, name: e.target.value }))
                          }
                          placeholder="Dr Michael Smith"
                        />
                        <p className="text-xs text-muted-foreground">
                          This name will be spoken by the AI (e.g., "You'll be seeing Dr Michael")
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="clinikoPractitionerId">Cliniko Practitioner ID</Label>
                        <Input
                          id="clinikoPractitionerId"
                          value={practitionerForm.clinikoPractitionerId}
                          onChange={(e) =>
                            setPractitionerForm((prev) => ({
                              ...prev,
                              clinikoPractitionerId: e.target.value,
                            }))
                          }
                          placeholder="123456"
                        />
                        <p className="text-xs text-muted-foreground">
                          Find this in Cliniko under Practitioners settings
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="isDefault"
                          checked={practitionerForm.isDefault}
                          onCheckedChange={(checked) =>
                            setPractitionerForm((prev) => ({ ...prev, isDefault: checked }))
                          }
                        />
                        <Label htmlFor="isDefault">Default practitioner</Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        The default practitioner is mentioned when callers ask "who will I see?"
                      </p>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPractitionerDialogOpen(false);
                          resetPractitionerForm();
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handlePractitionerSubmit}
                        disabled={
                          createPractitionerMutation.isPending || updatePractitionerMutation.isPending
                        }
                      >
                        {(createPractitionerMutation.isPending ||
                          updatePractitionerMutation.isPending) && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        {editingPractitioner ? "Update" : "Add"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {practitionersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : practitioners && practitioners.length > 0 ? (
                <div className="space-y-3">
                  {practitioners.map((practitioner) => (
                    <div
                      key={practitioner.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            practitioner.isActive ? "bg-green-500" : "bg-gray-300"
                          }`}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{practitioner.name}</p>
                            {practitioner.isDefault && (
                              <Badge variant="secondary" className="text-xs">
                                <Star className="h-3 w-3 mr-1" />
                                Default
                              </Badge>
                            )}
                          </div>
                          {practitioner.clinikoPractitionerId && (
                            <p className="text-xs text-muted-foreground">
                              Cliniko ID: {practitioner.clinikoPractitionerId}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditPractitioner(practitioner)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Practitioner</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {practitioner.name}? This action cannot
                                be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deletePractitionerMutation.mutate(practitioner.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No practitioners added yet</p>
                  <p className="text-sm">Add your first practitioner to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Voice Settings Tab */}
        <TabsContent value="voice" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Greeting Message</CardTitle>
              <CardDescription>
                The first message callers hear when they call your clinic
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="greeting">Greeting</Label>
                <Textarea
                  id="greeting"
                  value={formData.greeting || ""}
                  onChange={(e) => handleChange("greeting", e.target.value)}
                  placeholder="Thanks for calling [Clinic Name]. This is Sarah, how can I help you today?"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">After Hours Message</CardTitle>
              <CardDescription>
                Message played when callers reach you outside business hours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="afterHoursMessage">After Hours Message</Label>
                <Textarea
                  id="afterHoursMessage"
                  value={formData.afterHoursMessage || ""}
                  onChange={(e) => handleChange("afterHoursMessage", e.target.value)}
                  placeholder="Thanks for calling. We're currently closed. Our office hours are Monday to Friday, 9am to 5pm. Please call back during business hours or leave a message."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hold Message</CardTitle>
              <CardDescription>Message played when callers are put on hold</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="holdMessage">Hold Message</Label>
                <Textarea
                  id="holdMessage"
                  value={formData.holdMessage || ""}
                  onChange={(e) => handleChange("holdMessage", e.target.value)}
                  placeholder="Please hold while I check that for you."
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Voice</CardTitle>
              <CardDescription>Configure the AI voice settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="voiceName">Voice Name</Label>
                <Input
                  id="voiceName"
                  value={formData.voiceName || "Polly.Olivia-Neural"}
                  onChange={(e) => handleChange("voiceName", e.target.value)}
                  placeholder="Polly.Olivia-Neural"
                />
                <p className="text-xs text-muted-foreground">
                  AWS Polly neural voice (e.g., Polly.Olivia-Neural for Australian female,
                  Polly.Matthew-Neural for American male)
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
