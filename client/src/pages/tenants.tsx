import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Globe, Clock } from "lucide-react";
import { Link } from "wouter";
import type { Tenant } from "@shared/schema";

export default function Tenants() {
  const { data: tenants, isLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">Tenants</h1>
            <p className="text-sm text-muted-foreground">
              Manage clinic configurations and settings
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-dashboard">
              Back to Dashboard
            </Button>
          </Link>
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
                      Clinic configurations will appear here
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            tenants.map((tenant) => (
              <Card key={tenant.id} className="hover-elevate" data-testid={`card-tenant-${tenant.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base" data-testid={`text-clinic-name-${tenant.id}`}>
                          {tenant.clinicName}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-mono" data-testid={`text-slug-${tenant.id}`}>{tenant.slug}</span>
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">Active</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <dt className="text-xs font-medium text-muted-foreground">Greeting Message</dt>
                    <dd className="text-sm" data-testid={`text-greeting-${tenant.id}`}>
                      "{tenant.greeting}"
                    </dd>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Timezone
                      </dt>
                      <dd className="text-sm font-mono" data-testid={`text-timezone-${tenant.id}`}>
                        {tenant.timezone}
                      </dd>
                    </div>

                    <div className="space-y-2">
                      <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Created
                      </dt>
                      <dd className="text-sm" data-testid={`text-created-${tenant.id}`}>
                        {new Date(tenant.createdAt!).toLocaleDateString('en-AU', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </dd>
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
