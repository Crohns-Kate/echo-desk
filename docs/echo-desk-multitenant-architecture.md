# Echo Desk Multi-Tenant Architecture

## Overview

This document describes the multi-tenant architecture design for Echo Desk, enabling multiple clinics to use the system independently with isolated data, configurations, and customizations.

## Goals

1. **Data Isolation**: Each clinic's data (calls, patients, appointments, FAQs) is completely isolated
2. **Configuration Flexibility**: Per-clinic settings for voice, greetings, appointment types, hours
3. **Scalability**: Support 100+ tenants without performance degradation
4. **Security**: No cross-tenant data access; API keys isolated per tenant
5. **Billing Ready**: Track usage per tenant for subscription billing

---

## Data Model

### Tenants Table (Enhanced)

```sql
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,        -- URL-safe identifier (e.g., "michael-bishopp-chiro")
  clinic_name VARCHAR(255) NOT NULL,

  -- Contact Info
  phone_number VARCHAR(20) UNIQUE,         -- Twilio phone number for this clinic
  email VARCHAR(255),
  address TEXT,

  -- Timezone
  timezone VARCHAR(50) DEFAULT 'Australia/Brisbane',

  -- Voice Configuration
  voice_name VARCHAR(50) DEFAULT 'Polly.Olivia-Neural',
  greeting_message TEXT,                    -- Custom greeting (optional)
  fallback_message TEXT,                    -- Custom error message (optional)

  -- Business Hours (JSON)
  business_hours JSONB DEFAULT '{}',        -- {"monday": [["09:00", "17:00"]], ...}

  -- Cliniko Integration
  cliniko_api_key_encrypted TEXT,           -- Encrypted API key
  cliniko_shard VARCHAR(50),                -- API shard (au1, au2, etc.)
  cliniko_practitioner_id VARCHAR(50),
  cliniko_standard_appt_type_id VARCHAR(50),
  cliniko_new_patient_appt_type_id VARCHAR(50),

  -- Feature Flags
  recording_enabled BOOLEAN DEFAULT true,
  transcription_enabled BOOLEAN DEFAULT true,
  qa_analysis_enabled BOOLEAN DEFAULT true,
  faq_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT true,

  -- Subscription/Billing
  subscription_tier VARCHAR(20) DEFAULT 'free',  -- free, starter, pro, enterprise
  subscription_status VARCHAR(20) DEFAULT 'active',
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);
```

### Phone Number Mapping

```sql
CREATE TABLE phone_map (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,        -- E.164 format
  patient_id VARCHAR(100),                   -- Cliniko patient ID (optional)
  full_name VARCHAR(255),
  email VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(tenant_id, phone_number)
);
```

### FAQs Per Tenant

```sql
CREATE TABLE faqs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[],
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_faqs_tenant ON faqs(tenant_id);
```

### Call Logs Per Tenant

```sql
ALTER TABLE call_logs ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX idx_call_logs_tenant ON call_logs(tenant_id);
```

### Alerts Per Tenant

```sql
ALTER TABLE alerts ADD COLUMN tenant_id INTEGER REFERENCES tenants(id);
CREATE INDEX idx_alerts_tenant ON alerts(tenant_id);
```

---

## Call-to-Tenant Mapping

### How a Call is Routed to a Tenant

1. **Twilio Webhook** receives incoming call with `Called` (To) number
2. **Lookup tenant** by `phone_number` in `tenants` table
3. **Load tenant config** (greeting, voice, Cliniko credentials)
4. **Execute call flow** with tenant-specific settings
5. **Log call** with `tenant_id`

### Implementation

```typescript
// server/services/tenantResolver.ts

export async function resolveTenant(calledNumber: string): Promise<Tenant | null> {
  const normalized = normalizePhoneNumber(calledNumber);

  // Query tenant by phone number
  const tenant = await storage.getTenantByPhone(normalized);

  if (!tenant) {
    console.warn(`[TenantResolver] No tenant found for phone: ${normalized}`);
    return null;
  }

  if (!tenant.isActive) {
    console.warn(`[TenantResolver] Tenant inactive: ${tenant.slug}`);
    return null;
  }

  return tenant;
}

export async function getTenantContext(tenant: Tenant): Promise<TenantContext> {
  return {
    id: tenant.id,
    slug: tenant.slug,
    clinicName: tenant.clinicName,
    timezone: tenant.timezone,
    voiceName: tenant.voiceName || 'Polly.Olivia-Neural',
    greeting: tenant.greetingMessage,
    businessHours: tenant.businessHours,
    cliniko: {
      apiKey: decrypt(tenant.clinikoApiKeyEncrypted),
      shard: tenant.clinikoShard,
      practitionerId: tenant.clinikoPractitionerId,
      standardApptTypeId: tenant.clinikoStandardApptTypeId,
      newPatientApptTypeId: tenant.clinikoNewPatientApptTypeId
    },
    features: {
      recording: tenant.recordingEnabled,
      transcription: tenant.transcriptionEnabled,
      qaAnalysis: tenant.qaAnalysisEnabled,
      faq: tenant.faqEnabled,
      sms: tenant.smsEnabled
    }
  };
}
```

### Voice Route Integration

```typescript
// server/routes/voice.ts

app.post("/api/voice/incoming", async (req: Request, res: Response) => {
  const calledNumber = req.body.Called || req.body.To;
  const callSid = req.body.CallSid;
  const from = req.body.From;

  // Resolve tenant from called number
  const tenant = await resolveTenant(calledNumber);

  if (!tenant) {
    // No tenant found - play error message
    const vr = new twilio.twiml.VoiceResponse();
    saySafe(vr, "Sorry, this number is not configured. Please call our main line.");
    vr.hangup();
    return res.type("text/xml").send(vr.toString());
  }

  // Get tenant context
  const ctx = await getTenantContext(tenant);

  // Log call with tenant_id
  await storage.logCall({
    tenantId: tenant.id,
    callSid,
    fromNumber: from,
    toNumber: calledNumber,
    intent: "incoming",
    summary: "Call initiated"
  });

  // Continue with tenant-specific call flow...
});
```

---

## Isolation Strategies

### 1. Data Isolation

- **Row-level**: All tables include `tenant_id` column
- **Query filtering**: All storage methods accept `tenantId` parameter
- **Index strategy**: Composite indexes on `(tenant_id, ...)` for common queries

```typescript
// Example: Isolated call listing
async function listCalls(tenantId: number, limit: number = 50) {
  return db.select()
    .from(callLogs)
    .where(eq(callLogs.tenantId, tenantId))
    .orderBy(desc(callLogs.createdAt))
    .limit(limit);
}
```

### 2. Configuration Isolation

- **Cliniko credentials**: Encrypted per-tenant, loaded at call time
- **Voice settings**: Per-tenant voice name, greeting
- **Business hours**: Per-tenant JSON configuration
- **FAQs**: Per-tenant FAQ sets

### 3. Feature Isolation

- **Feature flags per tenant**: Enable/disable features per subscription tier
- **Usage limits**: Track API calls, SMS sends, recording minutes per tenant

---

## Environment Variables

### Global (Shared)
```env
# Database
DATABASE_URL=postgresql://...

# Twilio Account (shared across tenants)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# AssemblyAI (shared)
ASSEMBLYAI_API_KEY=...

# OpenAI (shared for QA)
OPENAI_API_KEY=...

# Security
ENCRYPTION_KEY=32-byte-key-for-cliniko-credentials

# Default Settings
DEFAULT_TIMEZONE=Australia/Brisbane
DEFAULT_VOICE_NAME=Polly.Olivia-Neural
```

### Per-Tenant (Database)
- Cliniko API key (encrypted)
- Cliniko shard
- Practitioner ID
- Appointment type IDs
- Custom greeting
- Business hours
- Feature flags

---

## Settings UI Per Clinic

### Admin Dashboard Routes

```
/admin/tenants                    # List all tenants (super-admin only)
/admin/tenants/:slug              # View/edit specific tenant
/admin/tenants/:slug/settings     # General settings
/admin/tenants/:slug/cliniko      # Cliniko integration
/admin/tenants/:slug/voice        # Voice configuration
/admin/tenants/:slug/faqs         # FAQ management
/admin/tenants/:slug/hours        # Business hours
/admin/tenants/:slug/billing      # Subscription & usage
```

### Tenant Settings API

```typescript
// GET /api/admin/tenants/:slug/settings
// PATCH /api/admin/tenants/:slug/settings

interface TenantSettings {
  general: {
    clinicName: string;
    email: string;
    address: string;
    timezone: string;
  };
  voice: {
    voiceName: string;
    greetingMessage?: string;
    fallbackMessage?: string;
  };
  features: {
    recordingEnabled: boolean;
    transcriptionEnabled: boolean;
    qaAnalysisEnabled: boolean;
    faqEnabled: boolean;
    smsEnabled: boolean;
  };
  cliniko: {
    apiKey: string;       // Write-only (never returned)
    shard: string;
    practitionerId: string;
    standardApptTypeId: string;
    newPatientApptTypeId: string;
  };
  businessHours: BusinessHours;
}
```

---

## Migration Plan

### Phase 1: Schema Updates
1. Add `tenant_id` to existing tables
2. Create default tenant for existing data
3. Update storage layer to accept `tenantId`

### Phase 2: Tenant Resolver
1. Implement `resolveTenant()` service
2. Update voice routes to load tenant context
3. Update Cliniko service to use tenant credentials

### Phase 3: Admin UI
1. Create tenant management pages
2. Add settings forms
3. Implement tenant-scoped dashboard

### Phase 4: Onboarding Flow
1. New tenant registration
2. Phone number provisioning (Twilio)
3. Cliniko connection wizard
4. FAQ import/setup

---

## Security Considerations

### API Key Encryption
```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32 bytes
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
```

### Access Control
- **Super Admin**: Full access to all tenants
- **Tenant Admin**: Access only to their tenant
- **Tenant User**: Read-only access to their tenant's calls

---

## Billing Integration (Stripe)

### Subscription Tiers

| Tier | Price/mo | Calls/mo | Recordings | Transcription | QA | SMS |
|------|----------|----------|------------|---------------|-----|-----|
| Free | $0 | 50 | No | No | No | 10 |
| Starter | $49 | 500 | Yes | No | No | 100 |
| Pro | $149 | 2000 | Yes | Yes | Yes | 500 |
| Enterprise | Custom | Unlimited | Yes | Yes | Yes | Unlimited |

### Usage Tracking

```sql
CREATE TABLE usage_records (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  calls_count INTEGER DEFAULT 0,
  recording_minutes INTEGER DEFAULT 0,
  transcription_minutes INTEGER DEFAULT 0,
  sms_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Implementation Steps

### Immediate (Week 1)
1. Create `tenants` table migration
2. Add `tenant_id` to call_logs, alerts, faqs
3. Implement `resolveTenant()` service
4. Update voice routes for tenant context

### Week 2
1. Create tenant settings API endpoints
2. Build admin dashboard pages
3. Implement Cliniko credential encryption
4. Add per-tenant FAQ management

### Week 3
1. Implement tenant onboarding wizard
2. Add Twilio phone provisioning
3. Build billing integration (Stripe)
4. Create usage tracking

### Week 4
1. Add tenant-scoped analytics
2. Implement access control
3. Load testing with multiple tenants
4. Documentation and training materials

---

## Testing Strategy

1. **Unit Tests**: Tenant isolation in storage layer
2. **Integration Tests**: End-to-end call flow with tenant context
3. **Security Tests**: Cross-tenant access prevention
4. **Load Tests**: Performance with 100+ tenants

---

## Success Metrics

- Tenant onboarding time < 10 minutes
- Zero cross-tenant data leakage
- < 100ms overhead for tenant resolution
- 99.9% uptime per tenant

---

## Future Enhancements

1. **White-label**: Custom domains per tenant
2. **API Access**: Tenant-scoped API keys for integrations
3. **Custom Flows**: Per-tenant voice flow customization
4. **Multi-location**: Multiple locations per tenant
5. **Team Management**: Multiple users per tenant with roles
