# Echo Desk - Client Onboarding Guide

Complete guide for onboarding new clients to Echo Desk, including free tier signups.

## Overview

Echo Desk now supports multi-tenant client onboarding with:
- **Free tier** - No payment required, instant signup
- **Paid tiers** (Starter, Pro, Enterprise) - Stripe payment integration
- **Email verification** - Secure account activation
- **Password reset** - Self-service password recovery
- **Client dashboard** - Full settings management UI

---

## Quick Start (5 minutes)

### 1. Environment Setup

Add to your `.env` file:

```bash
# JWT Secret (REQUIRED - change this!)
JWT_SECRET=your-super-secret-random-string-change-this-now

# Public URL for email links
PUBLIC_BASE_URL=https://yourdomain.com

# Stripe (optional, only needed for paid tiers)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Generate a secure JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2. Database Migration

Create the `users` table:

```bash
npx drizzle-kit push
```

### 3. Start Dashboard UI

```bash
cd client
npm install
npm run dev
```

Dashboard runs on: http://localhost:3001

### 4. Start Backend API

```bash
npm run dev
```

API runs on: http://localhost:5000

---

## Client Signup Flows

### Option 1: Free Tier Signup (Instant)

**Landing page** → **Signup form** → **Email verification** → **Dashboard**

**Signup Request:**
```http
POST /api/dashboard/signup
Content-Type: application/json

{
  "email": "kate@clinic.com",
  "password": "securepassword123",
  "firstName": "Kate",
  "lastName": "Smith",
  "clinicName": "Spinologic Chiropractic",
  "timezone": "Australia/Brisbane",
  "tier": "free"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "kate@clinic.com",
    "firstName": "Kate",
    "emailVerified": false
  },
  "tenant": {
    "id": 1,
    "slug": "spinologic-chiropractic",
    "clinicName": "Spinologic Chiropractic",
    "subscriptionTier": "free"
  },
  "message": "Account created! Please check your email to verify your account."
}
```

**What Happens:**
1. Tenant created with unique slug (e.g., `spinologic-chiropractic`)
2. User account created with hashed password
3. Email verification token generated
4. JWT token returned (client can log in immediately)
5. Verification email sent (TODO: integrate email service)

### Option 2: Paid Tier Signup (via Stripe)

**Landing page** → **Select plan** → **Stripe checkout** → **Signup form** → **Dashboard**

**Step 1: Create Stripe checkout session**

From your marketing site:
```javascript
async function signupWithPlan(tier) {
  // tier = 'starter' | 'pro' | 'enterprise'

  // Create temporary tenant
  const tenantRes = await fetch('/api/admin/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: 'temp-' + Date.now(),
      clinicName: 'New Clinic',
      email: 'temp@example.com'
    })
  });

  const { id } = await tenantRes.json();

  // Create Stripe checkout
  const checkoutRes = await fetch(`/api/billing/${id}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier })
  });

  const { url } = await checkoutRes.json();

  // Redirect to Stripe
  window.location.href = url;
}
```

**Step 2: After Stripe payment**

Stripe redirects to: `https://yourdomain.com/signup?stripeCustomerId=cus_xxx&email=kate@clinic.com`

**Step 3: Complete signup**

```http
POST /api/dashboard/signup
Content-Type: application/json

{
  "email": "kate@clinic.com",
  "password": "securepassword123",
  "firstName": "Kate",
  "lastName": "Smith",
  "clinicName": "Spinologic Chiropractic",
  "timezone": "Australia/Brisbane",
  "tier": "starter",
  "stripeCustomerId": "cus_xxx"
}
```

---

## Authentication Flows

### Login

```http
POST /api/dashboard/login
Content-Type: application/json

{
  "email": "kate@clinic.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "kate@clinic.com",
    "firstName": "Kate",
    "role": "owner"
  },
  "tenant": {
    "id": 1,
    "slug": "spinologic-chiropractic",
    "clinicName": "Spinologic Chiropractic",
    "subscriptionTier": "starter"
  }
}
```

**Using the token:**
```javascript
// Store token
localStorage.setItem('token', data.token);

// Use in API requests
fetch('/api/dashboard/me', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});
```

### Email Verification

**Verify email:**
```http
GET /api/dashboard/verify-email?token=abc123...
```

**Resend verification:**
```http
POST /api/dashboard/resend-verification
Content-Type: application/json

{
  "email": "kate@clinic.com"
}
```

### Password Reset

**Request reset link:**
```http
POST /api/dashboard/forgot-password
Content-Type: application/json

{
  "email": "kate@clinic.com"
}
```

**Reset password:**
```http
POST /api/dashboard/reset-password
Content-Type: application/json

{
  "token": "reset-token-from-email",
  "password": "newpassword123"
}
```

---

## Dashboard API Endpoints

All dashboard endpoints require authentication header:
```
Authorization: Bearer <JWT_TOKEN>
```

### Get Current User & Tenant Info

```http
GET /api/dashboard/me
```

### Update Clinic Information

```http
PATCH /api/dashboard/clinic-info
Content-Type: application/json

{
  "clinicName": "Updated Clinic Name",
  "email": "info@clinic.com",
  "phoneNumber": "+61401234567",
  "address": "123 Main St, Brisbane QLD",
  "timezone": "Australia/Brisbane"
}
```

### Manage FAQs

**List FAQs:**
```http
GET /api/dashboard/faqs
```

**Create FAQ:**
```http
POST /api/dashboard/faqs
Content-Type: application/json

{
  "category": "duration",
  "question": "How long is a consultation?",
  "answer": "A standard consultation is 30 minutes.",
  "keywords": ["how long", "duration", "time"],
  "priority": 5,
  "isActive": true
}
```

**Update FAQ:**
```http
PATCH /api/dashboard/faqs/123
Content-Type: application/json

{
  "answer": "Updated answer text"
}
```

**Delete FAQ:**
```http
DELETE /api/dashboard/faqs/123
```

### View Call Logs

```http
GET /api/dashboard/call-logs?limit=50
```

### View Statistics

```http
GET /api/dashboard/stats
```

### Billing (Paid Tiers)

**View subscription:**
```http
GET /api/dashboard/billing/subscription
```

**Upgrade plan:**
```http
POST /api/dashboard/billing/upgrade
Content-Type: application/json

{
  "tier": "pro"
}
```

**Manage billing (redirects to Stripe):**
```http
POST /api/dashboard/billing/portal
```

---

## Frontend Implementation

### Example React Login Component

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('/api/dashboard/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (data.success) {
        localStorage.setItem('token', data.token);
        navigate('/dashboard');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to log in');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log In</h1>
      {error && <div className="error">{error}</div>}

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
      />

      <button type="submit">Log In</button>
      <a href="/forgot-password">Forgot password?</a>
    </form>
  );
}
```

### Example Signup Component

```tsx
import { useState } from 'react';

export function Signup() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    clinicName: '',
    timezone: 'Australia/Brisbane',
    tier: 'free'
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch('/api/dashboard/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const data = await res.json();

    if (data.success) {
      // Store token and redirect
      localStorage.setItem('token', data.token);
      window.location.href = '/dashboard';
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Create Your Account</h1>
      <input
        type="text"
        placeholder="First Name"
        value={formData.firstName}
        onChange={e => setFormData({...formData, firstName: e.target.value})}
      />
      <input
        type="text"
        placeholder="Last Name"
        value={formData.lastName}
        onChange={e => setFormData({...formData, lastName: e.target.value})}
      />
      <input
        type="email"
        placeholder="Email"
        value={formData.email}
        onChange={e => setFormData({...formData, email: e.target.value})}
        required
      />
      <input
        type="password"
        placeholder="Password (min 8 characters)"
        value={formData.password}
        onChange={e => setFormData({...formData, password: e.target.value})}
        required
      />
      <input
        type="text"
        placeholder="Clinic Name"
        value={formData.clinicName}
        onChange={e => setFormData({...formData, clinicName: e.target.value})}
        required
      />
      <button type="submit">Create Account (Free)</button>
    </form>
  );
}
```

---

## Subscription Tiers

| Tier | Price | Max Calls/Month | Features |
|------|-------|----------------|----------|
| **Free** | $0 | 50 | Basic FAQ, no recordings |
| **Starter** | $99/mo | 500 | Recording + transcription |
| **Pro** | $299/mo | 2000 | + QA analysis, SMS |
| **Enterprise** | $599/mo | Unlimited | All features |

---

## Security Checklist

- [x] JWT tokens expire after 7 days
- [x] Passwords hashed with bcrypt (10 rounds)
- [x] Email verification required
- [x] Password minimum 8 characters
- [x] Reset tokens expire after 1 hour
- [x] Tenant data isolation (users only see own data)
- [ ] TODO: Rate limiting on auth endpoints
- [ ] TODO: HTTPS only in production
- [ ] TODO: Email service integration (SendGrid/AWS SES)

---

## Email Integration (TODO)

Currently, verification and reset links are logged to console. To send actual emails:

### Option 1: SendGrid

```javascript
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendVerificationEmail(email, token) {
  await sgMail.send({
    to: email,
    from: 'noreply@yourservice.com',
    subject: 'Verify your email',
    html: `Click <a href="${BASE_URL}/verify-email?token=${token}">here</a> to verify`
  });
}
```

### Option 2: AWS SES

```javascript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: 'us-east-1' });

async function sendVerificationEmail(email, token) {
  await ses.send(new SendEmailCommand({
    Source: 'noreply@yourservice.com',
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: 'Verify your email' },
      Body: {
        Html: { Data: `Click <a href="${BASE_URL}/verify-email?token=${token}">here</a> to verify` }
      }
    }
  }));
}
```

---

## Support & Maintenance

- **For you (admin)**: Access all tenants at `/api/admin/tenants`
- **Impersonation**: Log in as any client to fix their setup
- **Call logs**: View all calls at `/api/admin/system-health`
- **Billing**: Manage subscriptions via Stripe dashboard

---

## Getting Started Checklist

- [ ] Add `JWT_SECRET` to `.env`
- [ ] Run `npx drizzle-kit push` to create users table
- [ ] Start backend: `npm run dev`
- [ ] Start dashboard: `cd client && npm install && npm run dev`
- [ ] Test free signup at http://localhost:3001/signup
- [ ] Integrate email service (SendGrid/AWS SES)
- [ ] Deploy to production
- [ ] Set up Stripe products & prices
- [ ] Create marketing landing page

**You're ready to onboard clients!** 🎉
