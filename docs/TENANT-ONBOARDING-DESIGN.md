# Tenant Onboarding & Multi-Tenant Portal Design

## Overview

This document outlines the complete workflow for onboarding new tenants (clinics) after they sign up through Stripe, providing them with their own secure portal, and managing their phone number setup.

---

## 1. User Roles & Access Control

### Role Types

| Role | Description | Access |
|------|-------------|--------|
| **Super Admin** | Echo Desk team (you) | All tenants, all settings, billing admin |
| **Tenant Admin** | Clinic owner/manager | Their tenant only, full config access |
| **Tenant Staff** | Clinic receptionist | Their tenant only, view calls/alerts, limited config |

### Database Schema: Users

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'tenant_admin', -- 'super_admin', 'tenant_admin', 'tenant_staff'
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Super admins have tenant_id = NULL (can access all tenants)
-- Tenant users have tenant_id set (can only access their tenant)
```

---

## 2. Onboarding Flow (After Stripe Payment)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STRIPE CHECKOUT                                  │
│  Customer selects plan → Enters payment → Payment succeeds              │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    STRIPE WEBHOOK (checkout.session.completed)           │
│  1. Create tenant record with basic info from Stripe                     │
│  2. Create user account (email from Stripe, temp password)               │
│  3. Send welcome email with:                                             │
│     - Login link                                                         │
│     - Temp password                                                      │
│     - Onboarding instructions                                            │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FIRST LOGIN EXPERIENCE                              │
│  1. User logs in with temp password                                      │
│  2. Forced password change                                               │
│  3. Multi-step onboarding wizard begins                                  │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    ONBOARDING WIZARD (7-8 STEPS)                         │
│                                                                          │
│  STEP 1: BUSINESS INFO                                                   │
│  ├── Clinic name (prefilled from Stripe if available)                    │
│  ├── Business address (street, city, state, postcode)                    │
│  ├── Phone number (main line)                                            │
│  ├── Email (prefilled from Stripe)                                       │
│  └── Website URL (optional)                                              │
│                                                                          │
│  STEP 2: TIMEZONE & HOURS                                                │
│  ├── Timezone selection (Australia/Brisbane, etc.)                       │
│  ├── Business hours per day                                              │
│  │   ├── Monday: Open ☑ 8:00 AM - 5:00 PM                               │
│  │   ├── Tuesday: Open ☑ 8:00 AM - 5:00 PM                              │
│  │   ├── Wednesday: Open ☑ 8:00 AM - 5:00 PM                            │
│  │   ├── Thursday: Open ☑ 8:00 AM - 5:00 PM                             │
│  │   ├── Friday: Open ☑ 8:00 AM - 5:00 PM                               │
│  │   ├── Saturday: Closed ☐                                             │
│  │   └── Sunday: Closed ☐                                               │
│  └── Holiday closures (optional, can add later)                          │
│                                                                          │
│  STEP 3: VOICE SETTINGS                                                  │
│  ├── AI Voice selection (with audio preview)                             │
│  │   ├── Olivia (Australian Female) - Recommended                        │
│  │   ├── Nicole (Australian Female)                                      │
│  │   ├── Matthew (American Male)                                         │
│  │   └── Amy (British Female)                                            │
│  ├── Custom greeting message                                             │
│  │   └── Default: "Thanks for calling [Clinic Name]. How can I help?"    │
│  ├── After-hours message                                                 │
│  │   └── Default: "We're currently closed. Our hours are..."             │
│  └── Hold message (optional)                                             │
│                                                                          │
│  STEP 4: PHONE SETUP (Critical!)                                         │
│  ├── Option A: New Twilio Number (Recommended)                           │
│  │   ├── Select area code preference (02, 03, 07, 08)                    │
│  │   ├── We provision number automatically                               │
│  │   └── Display: "Your AI number: 02 XXXX XXXX"                         │
│  │                                                                       │
│  ├── Option B: Forward Your Existing Number                              │
│  │   ├── Enter your current clinic number                                │
│  │   ├── Choose forwarding trigger:                                      │
│  │   │   ├── After hours only                                            │
│  │   │   ├── When busy/no answer                                         │
│  │   │   └── All calls (full AI handling)                                │
│  │   └── We provide Twilio number to forward TO                          │
│  │                                                                       │
│  └── Option C: Port Your Number (Coming Soon)                            │
│      └── Transfer existing number to our system                          │
│                                                                          │
│  STEP 5: CLINIKO INTEGRATION                                             │
│  ├── Do you use Cliniko? ☑ Yes / ☐ No                                   │
│  │                                                                       │
│  │  IF YES:                                                              │
│  │  ├── Cliniko API Key (with link to help guide)                        │
│  │  ├── Region/Shard (auto-detect from API test)                         │
│  │  │   ├── au1, au2, au3, au4                                          │
│  │  │   ├── uk1                                                          │
│  │  │   └── us1                                                          │
│  │  ├── [TEST CONNECTION] button                                         │
│  │  ├── Select Business (if multiple)                                    │
│  │  ├── Select Default Practitioner(s)                                   │
│  │  ├── Select Appointment Types                                         │
│  │  │   ├── Existing Patient Type                                        │
│  │  │   └── New Patient Type                                             │
│  │  └── Test booking (optional dry run)                                  │
│  │                                                                       │
│  │  IF NO:                                                               │
│  │  └── Skip to next step (AI will collect info, send alerts)            │
│                                                                          │
│  STEP 6: FAQs & KNOWLEDGE BASE                                           │
│  ├── Common questions (with suggested defaults)                          │
│  │   ├── "What are your hours?" → Auto-filled from Step 2                │
│  │   ├── "Where are you located?" → Auto-filled from Step 1              │
│  │   ├── "Do you bulk bill?" → [Enter answer]                            │
│  │   ├── "What services do you offer?" → [Enter answer]                  │
│  │   ├── "How long is a consultation?" → [Enter answer]                  │
│  │   ├── "Do I need a referral?" → [Enter answer]                        │
│  │   ├── "Is there parking available?" → [Enter answer]                  │
│  │   └── "Do you see children/paediatrics?" → [Enter answer]             │
│  ├── Custom FAQs (add unlimited)                                         │
│  │   └── [+ Add FAQ] Question / Answer / Category                        │
│  └── "We can generate more FAQs from call transcripts later!"            │
│                                                                          │
│  STEP 7: NOTIFICATIONS & ALERTS                                          │
│  ├── Alert email address(es)                                             │
│  │   └── Where to send urgent alerts (multiple supported)                │
│  ├── Alert types to enable                                               │
│  │   ├── ☑ Human request alerts                                         │
│  │   ├── ☑ Booking failure alerts                                       │
│  │   ├── ☑ After-hours call summary                                     │
│  │   └── ☑ Weekly analytics report                                      │
│  └── SMS notifications (if enabled in plan)                              │
│                                                                          │
│  STEP 8: REVIEW & ACTIVATE                                               │
│  ├── Summary of all settings                                             │
│  ├── Test call option                                                    │
│  │   └── [MAKE TEST CALL] - Calls your number to demo AI                 │
│  ├── Activation toggle                                                   │
│  │   └── "Activate AI Receptionist" (OFF by default)                     │
│  └── [COMPLETE SETUP] button                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phone Number Options in Detail

### Option A: Provision New Twilio Number

**Best for:** New practices, practices wanting a dedicated AI line

**Flow:**
1. Tenant selects preferred area code (or we suggest based on location)
2. Backend calls Twilio API to search available numbers
3. Display 3-5 number options
4. Tenant selects one
5. Backend purchases number ($1.50/mo AUD, included in subscription)
6. Number is configured with webhooks automatically
7. Tenant advertises this number as their "bookings line" or "after-hours line"

**Implementation:**
```typescript
// server/services/twilioProvisioning.ts
async function provisionNumber(tenantId: number, areaCode: string) {
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // Search for available numbers
  const numbers = await client.availablePhoneNumbers('AU')
    .local.list({ areaCode, limit: 5 });

  // Let tenant choose or auto-select first
  const selected = numbers[0];

  // Purchase and configure
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: selected.phoneNumber,
    voiceUrl: `${PUBLIC_BASE_URL}/api/voice/incoming?tenantId=${tenantId}`,
    smsUrl: `${PUBLIC_BASE_URL}/api/sms/incoming?tenantId=${tenantId}`,
    friendlyName: `Echo Desk - ${tenant.clinicName}`
  });

  // Store in tenant record
  await updateTenant(tenantId, {
    twilioPhoneNumber: purchased.phoneNumber,
    twilioPhoneSid: purchased.sid,
    phoneSetupType: 'provisioned'
  });
}
```

### Option B: Forward Existing Number

**Best for:** Established practices with known numbers, after-hours only usage

**Flow:**
1. We provision a Twilio number for this tenant (same as Option A)
2. Tenant configures call forwarding on their existing number/PBX:
   - After-hours forward: Forward to Twilio number when closed
   - Busy/no-answer forward: Forward if staff don't answer within X rings
   - Unconditional forward: All calls go through AI
3. We provide clear instructions for common phone systems
4. Tenant can toggle forwarding on/off from their end

**Instructions we provide:**
```markdown
## Setting Up Call Forwarding

Your AI receptionist number is: **02 XXXX XXXX**

### For After-Hours Forwarding:

**Telstra Business:**
1. Log into My Account
2. Go to Phone Settings → Call Forwarding
3. Set "After Hours Forward" to: 02 XXXX XXXX
4. Set your business hours

**VoIP/PBX Systems:**
1. Access your PBX admin panel
2. Create a "No Answer" or "After Hours" rule
3. Forward to: 02 XXXX XXXX

**Mobile (iPhone):**
1. Settings → Phone → Call Forwarding
2. Enter: 02 XXXX XXXX
3. Toggle on when leaving office

**Mobile (Android):**
1. Phone app → Settings → Calls → Call Forwarding
2. Enter: 02 XXXX XXXX
```

### Option C: Number Porting (Future)

**Best for:** Practices wanting AI to fully replace existing line

**Complexity:** High (requires carrier coordination, 2-4 week process)

**Future implementation - mark as "Coming Soon"**

---

## 4. Tenant Portal (Self-Service Dashboard)

### URL Structure

```
https://app.echodesk.com.au/                    → Login page
https://app.echodesk.com.au/dashboard           → Tenant dashboard (their data only)
https://app.echodesk.com.au/calls               → Their calls
https://app.echodesk.com.au/faqs                → Their FAQs
https://app.echodesk.com.au/settings            → Their settings
https://app.echodesk.com.au/billing             → Their billing

https://app.echodesk.com.au/admin               → Super admin only
https://app.echodesk.com.au/admin/tenants       → All tenants list
https://app.echodesk.com.au/admin/tenants/:id   → View/edit any tenant
```

### Portal Features by Role

| Feature | Tenant Staff | Tenant Admin | Super Admin |
|---------|--------------|--------------|-------------|
| View calls/recordings | ✅ | ✅ | ✅ All tenants |
| View/dismiss alerts | ✅ | ✅ | ✅ All tenants |
| Manage FAQs | ❌ | ✅ | ✅ All tenants |
| Update business hours | ❌ | ✅ | ✅ All tenants |
| Change voice settings | ❌ | ✅ | ✅ All tenants |
| Update Cliniko settings | ❌ | ✅ | ✅ All tenants |
| Manage billing | ❌ | ✅ | ✅ All tenants |
| Add team members | ❌ | ✅ | ✅ All tenants |
| Activate/deactivate AI | ❌ | ✅ | ✅ All tenants |
| Access all tenants | ❌ | ❌ | ✅ |
| Create new tenants | ❌ | ❌ | ✅ |
| System health/config | ❌ | ❌ | ✅ |

---

## 5. Database Schema Updates

### New Tables

```sql
-- Users table (auth)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'tenant_admin',
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  must_change_password BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table (for express-session with connect-pg-simple)
CREATE TABLE sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_sessions_expire ON sessions(expire);

-- Audit log for tenant changes
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  tenant_id INTEGER REFERENCES tenants(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Tenant Table Updates

```sql
ALTER TABLE tenants ADD COLUMN
  -- Phone setup
  phone_setup_type VARCHAR(50) DEFAULT 'pending', -- pending, provisioned, forwarding
  twilio_phone_sid VARCHAR(255),
  forwarding_source_number VARCHAR(50),
  forwarding_schedule VARCHAR(50) DEFAULT 'after_hours', -- after_hours, busy, always

  -- Activation status
  is_active BOOLEAN DEFAULT FALSE,
  activated_at TIMESTAMP,

  -- Onboarding progress
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,

  -- Contact preferences
  alert_emails TEXT[], -- Array of email addresses
  weekly_report_enabled BOOLEAN DEFAULT TRUE,

  -- Business details
  address_street VARCHAR(255),
  address_city VARCHAR(100),
  address_state VARCHAR(50),
  address_postcode VARCHAR(20),
  website_url VARCHAR(255),

  -- Additional settings
  after_hours_message TEXT,
  hold_message TEXT;
```

---

## 6. API Routes

### Authentication Routes

```
POST /api/auth/login              - Login with email/password
POST /api/auth/logout             - Logout (clear session)
POST /api/auth/forgot-password    - Send password reset email
POST /api/auth/reset-password     - Reset password with token
POST /api/auth/change-password    - Change password (logged in)
GET  /api/auth/me                 - Get current user & tenant
```

### Tenant Self-Service Routes

```
GET  /api/tenant                  - Get current tenant (from session)
PATCH /api/tenant                 - Update current tenant settings
GET  /api/tenant/calls            - List tenant's calls
GET  /api/tenant/alerts           - List tenant's alerts
GET  /api/tenant/faqs             - List tenant's FAQs
POST /api/tenant/faqs             - Create FAQ
PATCH /api/tenant/faqs/:id        - Update FAQ
DELETE /api/tenant/faqs/:id       - Delete FAQ
GET  /api/tenant/stats            - Tenant statistics
GET  /api/tenant/team             - List team members
POST /api/tenant/team             - Invite team member
DELETE /api/tenant/team/:userId   - Remove team member
```

### Phone Management Routes

```
GET  /api/tenant/phone/available  - Search available Twilio numbers
POST /api/tenant/phone/provision  - Provision new number
GET  /api/tenant/phone/status     - Get phone setup status
POST /api/tenant/phone/test       - Initiate test call
```

### Admin Routes (Super Admin Only)

```
GET  /api/admin/tenants           - List all tenants
POST /api/admin/tenants           - Create tenant manually
GET  /api/admin/tenants/:id       - Get tenant details
PATCH /api/admin/tenants/:id      - Update any tenant
DELETE /api/admin/tenants/:id     - Delete tenant
POST /api/admin/impersonate/:id   - Login as tenant (for support)
GET  /api/admin/users             - List all users
GET  /api/admin/audit-log         - View audit log
```

---

## 7. Email Templates Needed

1. **Welcome Email** (after Stripe payment)
   - Login URL
   - Temporary password
   - Quick start guide link

2. **Email Verification**
   - Verification link
   - Expiry time

3. **Password Reset**
   - Reset link
   - Expiry time
   - Security notice

4. **Team Invite**
   - Invitation link
   - Clinic name
   - Role assigned

5. **Weekly Report**
   - Call statistics
   - Top intents
   - Alerts summary

6. **Subscription Changes**
   - Upgrade confirmation
   - Downgrade warning
   - Payment failed

---

## 8. Security Considerations

### Password Requirements
- Minimum 8 characters
- At least 1 uppercase, 1 lowercase, 1 number
- bcrypt hashing with salt rounds = 12

### Session Security
- HTTP-only cookies
- Secure flag in production
- 24-hour session expiry
- CSRF protection

### Rate Limiting
- Login: 5 attempts per 15 minutes per IP
- Password reset: 3 requests per hour per email
- API: 100 requests per minute per tenant

### Data Isolation
- All queries include tenant_id filter
- Middleware validates tenant access
- Admin impersonation logged to audit

### Sensitive Data
- Cliniko API keys encrypted at rest
- Passwords never logged
- PII redacted in logs

---

## 9. Implementation Priority

### Phase 1: Foundation (Week 1-2)
1. ✅ Design document (this file)
2. Database schema updates (users, sessions, audit)
3. Authentication system (login, logout, sessions)
4. Basic middleware (auth check, tenant resolution)

### Phase 2: Tenant Portal (Week 2-3)
5. Tenant dashboard (scoped to their data)
6. Settings page (update their config)
7. FAQs management
8. Team management

### Phase 3: Onboarding Wizard (Week 3-4)
9. Multi-step form components
10. Phone number provisioning
11. Cliniko connection wizard
12. Activation flow

### Phase 4: Admin & Polish (Week 4-5)
13. Super admin dashboard
14. Impersonation feature
15. Audit logging
16. Email notifications
17. Weekly reports

---

## 10. Free Tier Considerations

For free tier (50 calls/month):
- Still need phone number (cost: ~$1.50/mo)
- Options:
  1. **Trial Period:** 14-day free trial with provisioned number
  2. **Forwarding Only:** They set up forwarding, we provide number
  3. **Shared Pool:** Use shared number with extension routing (complex)
  4. **BYOT (Bring Your Own Twilio):** They create Twilio account, we configure

**Recommended:** Option 2 (Forwarding) for free tier
- We provision number but include in our cost
- They only pay if they upgrade or exceed limits
- Easy upgrade path to paid tier

---

## Next Steps

1. Review and approve this design
2. Create database migration for new tables
3. Implement authentication system
4. Build onboarding wizard UI
5. Add phone provisioning API
6. Test end-to-end flow
