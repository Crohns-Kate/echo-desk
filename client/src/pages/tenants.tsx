import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Building2,
  Globe,
  Clock,
  Phone,
  Plus,
  Pencil,
  CheckCircle,
  XCircle,
  Mic,
  Settings,
  Key,
  HelpCircle,
  Wand2,
  CreditCard
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface Tenant {
  id: number;
  slug: string;
  clinicName: string;
  phoneNumber?: string;
  email?: string;
  timezone: string;
  voiceName?: string;
  greeting: string;
  isActive?: boolean;
  subscriptionTier?: string;
  subscriptionStatus?: string;
  hasClinikoKey?: boolean;
  recordingEnabled?: boolean;
  transcriptionEnabled?: boolean;
  faqEnabled?: boolean;
  smsEnabled?: boolean;
  createdAt?: string;
}

interface TenantFormData {
  slug: string;
  clinicName: string;
  phoneNumber: string;
  email: string;
  timezone: string;
  voiceName: string;
  greeting: string;
  clinikoApiKey?: string;
  clinikoShard: string;
  clinikoPractitionerId: string;
  clinikoStandardApptTypeId: string;
  clinikoNewPatientApptTypeId: string;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  faqEnabled: boolean;
  smsEnabled: boolean;
}

const defaultFormData: TenantFormData = {
  slug: "",
  clinicName: "",
  phoneNumber: "",
  email: "",
  timezone: "Australia/Brisbane",
  voiceName: "Polly.Olivia-Neural",
  greeting: "Thanks for calling",
  clinikoApiKey: "",
  clinikoShard: "au1",
  clinikoPractitionerId: "",
  clinikoStandardApptTypeId: "",
  clinikoNewPatientApptTypeId: "",
  recordingEnabled: true,
  transcriptionEnabled: true,
  faqEnabled: true,
  smsEnabled: true,
};

export default function Tenants() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [formData, setFormData] = useState<TenantFormData>(defaultFormData);

  const { data: tenants, isLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/admin/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: TenantFormData) => {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create tenant");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setIsCreateOpen(false);
      setFormData(defaultFormData);
      toast({ title: "Tenant created", description: "New clinic has been added successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TenantFormData> }) => {
      const res = await fetch(`/api/admin/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update tenant");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      setEditingTenant(null);
      setFormData(defaultFormData);
      toast({ title: "Tenant updated", description: "Clinic settings have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openEditDialog = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setFormData({
      slug: tenant.slug,
      clinicName: tenant.clinicName,
      phoneNumber: tenant.phoneNumber || "",
      email: tenant.email || "",
      timezone: tenant.timezone,
      voiceName: tenant.voiceName || "Polly.Olivia-Neural",
      greeting: tenant.greeting,
      clinikoApiKey: "",
      clinikoShard: "au1",
      clinikoPractitionerId: "",
      clinikoStandardApptTypeId: "",
      clinikoNewPatientApptTypeId: "",
      recordingEnabled: tenant.recordingEnabled ?? true,
      transcriptionEnabled: tenant.transcriptionEnabled ?? true,
      faqEnabled: tenant.faqEnabled ?? true,
      smsEnabled: tenant.smsEnabled ?? true,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const TenantForm = () => (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="slug">Slug (URL identifier)</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
            placeholder="my-clinic"
            disabled={!!editingTenant}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clinicName">Clinic Name</Label>
          <Input
            id="clinicName"
            value={formData.clinicName}
            onChange={(e) => setFormData({ ...formData, clinicName: e.target.value })}
            placeholder="My Clinic"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phoneNumber">Twilio Phone Number</Label>
          <Input
            id="phoneNumber"
            value={formData.phoneNumber}
            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
            placeholder="+61400000000"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="clinic@example.com"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            value={formData.timezone}
            onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
            placeholder="Australia/Brisbane"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="voiceName">Voice (Polly)</Label>
          <Input
            id="voiceName"
            value={formData.voiceName}
            onChange={(e) => setFormData({ ...formData, voiceName: e.target.value })}
            placeholder="Polly.Olivia-Neural"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="greeting">Greeting Message</Label>
        <Input
          id="greeting"
          value={formData.greeting}
          onChange={(e) => setFormData({ ...formData, greeting: e.target.value })}
          placeholder="Thanks for calling"
        />
      </div>

      <div className="pt-4 border-t">
        <h4 className="text-sm font-medium mb-3">Cliniko Integration</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="clinikoApiKey">API Key {editingTenant?.hasClinikoKey && "(configured)"}</Label>
            <Input
              id="clinikoApiKey"
              type="password"
              value={formData.clinikoApiKey}
              onChange={(e) => setFormData({ ...formData, clinikoApiKey: e.target.value })}
              placeholder={editingTenant?.hasClinikoKey ? "Leave blank to keep current" : "Enter API key"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinikoShard">Region/Shard</Label>
            <Input
              id="clinikoShard"
              value={formData.clinikoShard}
              onChange={(e) => setFormData({ ...formData, clinikoShard: e.target.value })}
              placeholder="au1"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="clinikoPractitionerId">Practitioner ID</Label>
            <Input
              id="clinikoPractitionerId"
              value={formData.clinikoPractitionerId}
              onChange={(e) => setFormData({ ...formData, clinikoPractitionerId: e.target.value })}
              placeholder="123456"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinikoStandardApptTypeId">Standard Appt Type</Label>
            <Input
              id="clinikoStandardApptTypeId"
              value={formData.clinikoStandardApptTypeId}
              onChange={(e) => setFormData({ ...formData, clinikoStandardApptTypeId: e.target.value })}
              placeholder="123456"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinikoNewPatientApptTypeId">New Patient Type</Label>
            <Input
              id="clinikoNewPatientApptTypeId"
              value={formData.clinikoNewPatientApptTypeId}
              onChange={(e) => setFormData({ ...formData, clinikoNewPatientApptTypeId: e.target.value })}
              placeholder="123456"
            />
          </div>
        </div>
      </div>

      <div className="pt-4 border-t">
        <h4 className="text-sm font-medium mb-3">Feature Flags</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="recordingEnabled">Call Recording</Label>
            <Switch
              id="recordingEnabled"
              checked={formData.recordingEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, recordingEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="transcriptionEnabled">Transcription</Label>
            <Switch
              id="transcriptionEnabled"
              checked={formData.transcriptionEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, transcriptionEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="faqEnabled">FAQ System</Label>
            <Switch
              id="faqEnabled"
              checked={formData.faqEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, faqEnabled: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="smsEnabled">SMS Notifications</Label>
            <Switch
              id="smsEnabled"
              checked={formData.smsEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, smsEnabled: checked })}
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => {
          setIsCreateOpen(false);
          setEditingTenant(null);
          setFormData(defaultFormData);
        }}>
          Cancel
        </Button>
        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
          {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingTenant ? "Save Changes" : "Create Tenant"}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">Tenant Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage clinic configurations, Cliniko integrations, and settings
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/tenants/new">
              <Button variant="outline">
                <Wand2 className="h-4 w-4 mr-2" />
                Setup Wizard
              </Button>
            </Link>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => { setFormData(defaultFormData); setEditingTenant(null); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Quick Add
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Tenant</DialogTitle>
                  <DialogDescription>
                    Add a new clinic to the system. Each tenant gets isolated data and settings.
                  </DialogDescription>
                </DialogHeader>
                <TenantForm />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Tenants List */}
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-12">
                <div className="flex items-center justify-center">
                  <div className="animate-pulse text-sm text-muted-foreground">Loading tenants...</div>
                </div>
              </CardContent>
            </Card>
          ) : !tenants || tenants.length === 0 ? (
            <Card>
              <CardContent className="p-12">
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                  <Building2 className="h-12 w-12 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No tenants configured</p>
                    <p className="text-xs text-muted-foreground">
                      Click "Add Tenant" to create your first clinic
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            tenants.map((tenant) => (
              <Card key={tenant.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{tenant.clinicName}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{tenant.slug}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tenant.isActive !== false ? "default" : "secondary"}>
                        {tenant.isActive !== false ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{tenant.subscriptionTier || "free"}</Badge>
                      <Link href={`/tenants/${tenant.id}/faqs`}>
                        <Button variant="ghost" size="sm" title="Manage FAQs">
                          <HelpCircle className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Link href={`/tenants/${tenant.id}/billing`}>
                        <Button variant="ghost" size="sm" title="Billing & Subscription">
                          <CreditCard className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Dialog open={editingTenant?.id === tenant.id} onOpenChange={(open) => !open && setEditingTenant(null)}>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => openEditDialog(tenant)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Edit Tenant: {tenant.clinicName}</DialogTitle>
                            <DialogDescription>
                              Update clinic settings and integrations
                            </DialogDescription>
                          </DialogHeader>
                          <TenantForm />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> Phone
                      </div>
                      <div className="font-mono text-xs">
                        {tenant.phoneNumber || <span className="text-muted-foreground">Not set</span>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Timezone
                      </div>
                      <div className="font-mono text-xs">{tenant.timezone}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Mic className="h-3 w-3" /> Voice
                      </div>
                      <div className="font-mono text-xs">{tenant.voiceName || "Default"}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Key className="h-3 w-3" /> Cliniko
                      </div>
                      <div className="flex items-center gap-1">
                        {tenant.hasClinikoKey ? (
                          <><CheckCircle className="h-3 w-3 text-green-500" /> <span className="text-xs">Connected</span></>
                        ) : (
                          <><XCircle className="h-3 w-3 text-muted-foreground" /> <span className="text-xs text-muted-foreground">Not configured</span></>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Greeting</div>
                    <p className="text-sm italic">"{tenant.greeting}"</p>
                  </div>

                  <div className="pt-2 border-t flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs">
                      <div className={`h-2 w-2 rounded-full ${tenant.recordingEnabled !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className={tenant.recordingEnabled !== false ? '' : 'text-muted-foreground'}>Recording</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className={`h-2 w-2 rounded-full ${tenant.transcriptionEnabled !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className={tenant.transcriptionEnabled !== false ? '' : 'text-muted-foreground'}>Transcription</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className={`h-2 w-2 rounded-full ${tenant.faqEnabled !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className={tenant.faqEnabled !== false ? '' : 'text-muted-foreground'}>FAQ</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <div className={`h-2 w-2 rounded-full ${tenant.smsEnabled !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className={tenant.smsEnabled !== false ? '' : 'text-muted-foreground'}>SMS</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
