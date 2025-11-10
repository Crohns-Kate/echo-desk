# 🚀 Complete Deployment Guide - EchoDesk Webhook

## ✅ Fix Applied

**Problem:** `/api/voice/incoming` returned 400/404 in production due to Twilio signature validation  
**Solution:** Added `DISABLE_TWILIO_VALIDATION` environment variable for testing

---

## 📋 Routes Available

| Route | Validation | Purpose |
|-------|-----------|---------|
| `GET /health` | ❌ None | Server health check |
| `POST /api/voice/test` | ❌ None | Test TwiML (always works) |
| `POST /api/voice/incoming` | ⚠️ Conditional | Twilio webhook entry point |
| `POST /api/voice/handle` | ⚠️ Conditional | Conversation flow handler |

**Conditional validation:**
- **Dev mode** (`NODE_ENV !== "production"`): Validation disabled
- **Production mode**: Validation enabled by default (secure)
- **Production testing**: Set `DISABLE_TWILIO_VALIDATION=true` to disable validation

---

## 🧪 Testing Before Deployment

### Local Development (All routes work)

```bash
# Health check
curl http://localhost:5000/health

# Test route (no signature needed)
curl -X POST http://localhost:5000/api/voice/test

# Incoming route (validation disabled in dev)
curl -X POST http://localhost:5000/api/voice/incoming \
  -d "CallSid=TEST123" \
  -d "From=%2B61400000000"
```

### Production Build Testing

```bash
# Build for production
npm run build

# Test with validation DISABLED (for curl testing)
DISABLE_TWILIO_VALIDATION=true NODE_ENV=production npm start

# Then test:
curl http://localhost:5000/health
curl -X POST http://localhost:5000/api/voice/incoming -d "CallSid=TEST"
```

---

## 🔐 Configuring Secrets in Replit Deployments

### Step 1: Access Secrets Tool

**Method 1 - Tool Dock:**
1. Click the **nine dots icon** (⋮⋮⋮) in the left sidebar
2. Select **"Secrets"** (lock icon 🔒)

**Method 2 - Search:**
1. Press `Ctrl+K` (or `Cmd+K` on Mac)
2. Type "Secrets"
3. Select it from results

### Step 2: Add Required Secrets

Add these secrets one by one (click **"New Secret"** for each):

#### Database (Required)
```
DATABASE_URL
```
Value: Your PostgreSQL connection string (already created by Replit if you have DB enabled)

#### Twilio (Required)
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
```
Get these from [Twilio Console](https://console.twilio.com/)

#### Cliniko (Required)
```
CLINIKO_API_KEY
CLINIKO_BUSINESS_ID
CLINIKO_PRACTITIONER_ID
CLINIKO_APPT_TYPE_ID
CLINIKO_REGION
```
Get these from [Cliniko Settings](https://www.cliniko.com/settings)

#### Optional (Recommended)
```
SESSION_SECRET
```
Value: Any random string (e.g., generate with `openssl rand -base64 32`)

```
TZ
```
Value: `Australia/Brisbane` (or your clinic's timezone)

```
PUBLIC_BASE_URL
```
Value: Your deployment URL (e.g., `https://your-app.replit.app`)

#### Testing Secret (Optional - for curl testing in production)
```
DISABLE_TWILIO_VALIDATION
```
Value: `true` (only add this if you need to test with curl in production)

**⚠️ IMPORTANT:** Remove `DISABLE_TWILIO_VALIDATION` after testing! Real Twilio calls should have validation enabled.

### Step 3: Verify Secrets

After adding secrets, they're automatically available as environment variables:
- In code: `process.env.TWILIO_ACCOUNT_SID`
- Replit Deployments automatically injects all secrets at runtime

---

## 🚀 Deploy to Production

### Step 1: Build Locally (Optional - verify first)

```bash
npm run build
```

Expected output:
```
Externalizing dependencies: body-parser, cors, dayjs, dotenv, express, twilio...
✓ Build complete — deps externalized. Output: dist/index.js
```

### Step 2: Deploy via Replit Deployments

1. Click **"Deployments"** tab in left sidebar
2. Click **"Deploy"** button
3. Wait ~30 seconds for build
4. Your app will be live at: `https://your-app-name.replit.app`

### Step 3: Test Deployed App

```bash
# Test health endpoint
curl https://your-app-name.replit.app/health

# Test the test route
curl -X POST https://your-app-name.replit.app/api/voice/test

# If you added DISABLE_TWILIO_VALIDATION=true, test incoming:
curl -X POST https://your-app-name.replit.app/api/voice/incoming \
  -d "CallSid=TEST" \
  -d "From=%2B61400000000"
```

### Step 4: Remove Test Secret (Important!)

After verifying deployment works:

1. Go to **Secrets** tool
2. Find `DISABLE_TWILIO_VALIDATION`
3. Click **Delete**
4. **Redeploy** (this enables signature validation for security)

---

## 📞 Configure Twilio Webhook

### Step 1: Get Your Deployment URL

After deployment, your webhook URL is:
```
https://your-app-name.replit.app/api/voice/incoming
```

### Step 2: Configure in Twilio Console

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Click your phone number
3. Scroll to **"Voice Configuration"**
4. Under **"A CALL COMES IN"**:
   - **Configure with:** Webhooks, TwiML Bins, Functions, Studio, or Proxy
   - **Method:** `POST`
   - **URL:** `https://your-app-name.replit.app/api/voice/incoming`
5. Click **Save**

### Step 3: Test Real Call

Call your Twilio number! You should hear:
> "Hello and welcome to your clinic. How can I help you today?"

---

## 🐛 Troubleshooting

### Issue: 404 Not Found

**Cause:** Routes not registered or deployment failed  
**Fix:**
1. Check deployment logs: `Deployments` → `View Logs`
2. Verify build succeeded
3. Check routes are in bundle: `grep -c "api/voice/incoming" dist/index.js` (should be > 0)

### Issue: 400 Bad Request (Signature Validation Failed)

**Cause:** Testing production with curl (no Twilio signature)  
**Fix:**
- **For testing:** Add `DISABLE_TWILIO_VALIDATION=true` secret
- **For production:** This is CORRECT behavior! Only real Twilio calls should work

### Issue: 500 Internal Server Error

**Cause:** Missing environment variables  
**Fix:**
1. Go to **Secrets** tool
2. Verify all required secrets are added
3. Check deployment logs for specific error

### Issue: Twilio says "Connection Refused"

**Cause:** App not responding or wrong URL  
**Fix:**
1. Test health endpoint: `curl https://your-app.replit.app/health`
2. If it fails, check deployment status
3. If it works, verify webhook URL in Twilio matches exactly

---

## 📊 Quick Reference

### Your URLs

**Dev Server:**
```
http://localhost:5000
```

**Public Dev URL:**
```
https://workspace.mbjltd70.repl.co
```

**Deployment URL (after deploying):**
```
https://your-app-name.replit.app
```

### Test Commands

```bash
# Health check (should always work)
curl https://your-app.replit.app/health

# Test route (should always work)
curl -X POST https://your-app.replit.app/api/voice/test

# Incoming route (only works if DISABLE_TWILIO_VALIDATION=true OR real Twilio call)
curl -X POST https://your-app.replit.app/api/voice/incoming \
  -d "CallSid=TEST" \
  -d "From=%2B61400000000"
```

---

## ✅ Deployment Checklist

- [ ] All secrets configured in Secrets tool
- [ ] `npm run build` succeeds locally
- [ ] Click "Deploy" in Deployments tab
- [ ] Deployment build succeeds
- [ ] Test health endpoint: `curl https://your-app.replit.app/health`
- [ ] Test voice test route: `curl -X POST https://your-app.replit.app/api/voice/test`
- [ ] Configure Twilio webhook URL
- [ ] Test real phone call to Twilio number
- [ ] (Optional) Remove `DISABLE_TWILIO_VALIDATION` secret after testing
- [ ] Redeploy to enable signature validation

---

## 🔒 Security Notes

**In Production (with signature validation enabled):**
- ✅ Only real Twilio calls with valid signatures are accepted
- ✅ Protects against unauthorized webhook calls
- ✅ Prevents replay attacks

**Testing Mode (DISABLE_TWILIO_VALIDATION=true):**
- ⚠️ Anyone can call your webhook with curl
- ⚠️ Only use for testing, then remove the secret
- ⚠️ Redeploy after removing to re-enable validation

---

## 🎉 Success!

Your EchoDesk webhook is now:
- ✅ Built with proper dependency externalization
- ✅ Testable locally with curl
- ✅ Testable in production (with optional flag)
- ✅ Secure in production (with validation)
- ✅ Ready for real Twilio calls

**Next:** Configure your secrets and deploy! 🚀
