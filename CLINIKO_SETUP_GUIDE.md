# Cliniko Configuration Guide for Echo Desk

## Problem Summary

Your Echo Desk system is failing to retrieve appointment availability from Cliniko, causing calls to fail with:

> "I apologize, I'm having trouble accessing the schedule right now. Please try calling back in a few minutes..."

## Root Cause

The system requires Cliniko API credentials to fetch available appointment slots, but these are not currently configured. The error occurs in `server/services/cliniko.ts` when `getAvailability()` cannot access the Cliniko API.

## What I've Fixed

✅ **Auto-fetch Business ID** - Modified `getAvailability()` to automatically fetch your Cliniko business ID from the API if not configured. This eliminates one required configuration step.

✅ **Better Error Messages** - Improved error messages to clearly indicate what's missing and how to fix it.

✅ **Diagnostic Tools** - Added helper scripts to test your configuration and fetch the required IDs.

## What You Need to Configure

### Required Fields

| Field | Description | How to Get It |
|-------|-------------|---------------|
| **CLINIKO_API_KEY** | Your Cliniko API authentication key | Settings → API Keys in Cliniko |
| **CLINIKO_PRACTITIONER_ID** | The ID of the practitioner for bookings | Run `setup-cliniko-config.mjs` |
| **CLINIKO_APPT_TYPE_ID** | Standard appointment type ID | Run `setup-cliniko-config.mjs` |
| **CLINIKO_REGION** | Your Cliniko region (au1, au2, au3, au4, etc.) | Check your Cliniko URL |

### Optional Fields

| Field | Description |
|-------|-------------|
| **CLINIKO_NEW_PATIENT_APPT_TYPE_ID** | Appointment type for new patients |
| **CLINIKO_BUSINESS_ID** | Business ID (now auto-fetched!) |

## Step-by-Step Setup

### Step 1: Get Your Cliniko API Key

1. Log in to your Cliniko account
2. Go to **Settings → API Keys**
3. Click **Create API Key**
4. Give it a name (e.g., "Echo Desk")
5. Ensure it has **read and write** permissions
6. Copy the API key (you'll only see it once!)

### Step 2: Identify Your Cliniko Region

Look at your Cliniko URL:
- `https://app.au1.cliniko.com/` → Region is **au1**
- `https://app.au2.cliniko.com/` → Region is **au2**
- `https://app.au3.cliniko.com/` → Region is **au3**
- `https://app.au4.cliniko.com/` → Region is **au4**

### Step 3: Fetch Your Configuration IDs

Run the setup script with your API key:

```bash
CLINIKO_API_KEY=your_api_key_here CLINIKO_REGION=au4 node setup-cliniko-config.mjs
```

This will output all the IDs you need:

```
✅ CONFIGURATION COMPLETE

Add these to your .env file or deployment environment:

──────────────────────────────────────────────────────────────────────
CLINIKO_API_KEY=your_api_key_here
CLINIKO_REGION=au4
CLINIKO_BUSINESS_ID=12345
CLINIKO_PRACTITIONER_ID=67890
CLINIKO_APPT_TYPE_ID=11111
CLINIKO_NEW_PATIENT_APPT_TYPE_ID=22222
──────────────────────────────────────────────────────────────────────
```

### Step 4: Configure Your Deployment

Choose one of these methods:

#### Option A: Environment Variables (Recommended for Cloud Deployments)

Add the configuration to your deployment platform:

**For Vercel/Netlify/Railway:**
1. Go to your project settings
2. Find "Environment Variables" section
3. Add each variable:
   - `CLINIKO_API_KEY`
   - `CLINIKO_REGION`
   - `CLINIKO_PRACTITIONER_ID`
   - `CLINIKO_APPT_TYPE_ID`
   - `CLINIKO_NEW_PATIENT_APPT_TYPE_ID` (optional)
4. Redeploy your application

**For local development:**

Create a `.env` file in the project root:

```bash
# Copy .env.example first
cp .env.example .env

# Then edit .env and add your Cliniko configuration
```

#### Option B: Database Configuration (Multi-Tenant Setup)

If you're using the multi-tenant features, configure each tenant in the database:

```sql
UPDATE tenants
SET
  cliniko_api_key_encrypted = 'your_encrypted_api_key',
  cliniko_shard = 'au4',
  cliniko_practitioner_id = '67890',
  cliniko_standard_appt_type_id = '11111',
  cliniko_new_patient_appt_type_id = '22222'
WHERE slug = 'your-clinic-slug';
```

**Note:** The API key should be encrypted using the `encrypt()` function from `server/services/tenantResolver.ts`.

### Step 5: Verify Configuration

After configuring, test your setup:

```bash
# Test Cliniko connectivity
node test-cliniko-availability.mjs

# Check tenant configuration (if using database config)
node check-tenant-config.mjs
```

Expected output:
```
=== Cliniko Availability Diagnostic ===

1. Checking environment variables:
   ✓ CLINIKO_API_KEY: abcd...xyz
   ✓ CLINIKO_BUSINESS_ID: 1234...5678
   ✓ CLINIKO_PRACTITIONER_ID: 9012...3456
   ✓ CLINIKO_APPT_TYPE_ID: 7890...1234

2. Testing Cliniko API connectivity:
   ✓ API connection successful

3. Testing practitioner configuration:
   ✓ Practitioner found with 5 appointment types

4. Validating appointment type configuration:
   ✓ Appointment type found: Standard Consultation (30min)

5. Testing availability retrieval for TODAY:
   ✓ Found 3 available slots for today

=== ✓ ALL TESTS PASSED ===
```

## Troubleshooting

### "Missing Cliniko configuration: practitionerId is required"

**Solution:** Set `CLINIKO_PRACTITIONER_ID` in your environment or tenant config.

### "Missing Cliniko configuration: appointmentTypeId is required"

**Solution:** Set `CLINIKO_APPT_TYPE_ID` in your environment or tenant config.

### "Cliniko API error 401: Unauthorized"

**Causes:**
- Invalid API key
- API key was revoked
- Wrong Cliniko region

**Solution:**
1. Verify your API key in Cliniko Settings
2. Ensure `CLINIKO_REGION` matches your Cliniko URL
3. Generate a new API key if needed

### "No appointment types found for practitioner"

**Cause:** The practitioner doesn't have any appointment types with "Show in online bookings" enabled.

**Solution:**
1. Log in to Cliniko
2. Go to **Setup → Appointment Types**
3. Edit your appointment types
4. Enable **"Show in online bookings"**

### "No availability found for today"

This is **not an error** - it means there genuinely are no available slots today. The system will inform the caller that there's no availability and offer alternative days.

## Demo Mode (For Testing Only)

If you want to test the system without configuring Cliniko, ensure that:
1. `CLINIKO_API_KEY` is **NOT** set in environment variables
2. No tenant has `cliniko_api_key_encrypted` set in the database

The system will automatically return demo appointment slots instead of real ones.

**⚠️ Warning:** Demo mode should only be used for testing, not production.

## What Happens After Configuration

Once configured correctly, the call flow will work as follows:

1. **Caller says:** "I'd like to book an appointment for today"
2. **System:** Calls `getAvailability()` with today's date
3. **Cliniko API:** Returns available time slots
4. **System:** Presents options: "I have 2 options available. Option 1: 9:00 AM. Option 2: 2:00 PM."
5. **Caller:** Selects a time
6. **System:** Creates the appointment in Cliniko
7. **System:** Confirms the booking

## Need Help?

1. Run the diagnostic scripts:
   ```bash
   node test-cliniko-availability.mjs
   node setup-cliniko-config.mjs
   ```

2. Check the application logs for detailed error messages

3. Verify your Cliniko account has:
   - Active practitioners with online booking enabled
   - Appointment types with online booking enabled
   - Available time slots in the calendar

## Files Modified

- `server/services/cliniko.ts` - Auto-fetch business ID logic
- `test-cliniko-availability.mjs` - Diagnostic tool (new)
- `setup-cliniko-config.mjs` - Configuration helper (new)
- `check-tenant-config.mjs` - Tenant config checker (new)

## Summary

✅ The code fix is complete and pushed to `claude/new-session-018La4WFp2S1uLL4bn9T5V9E`

📋 Next steps:
1. Get your Cliniko API key
2. Run `setup-cliniko-config.mjs` to get your IDs
3. Configure your deployment with the environment variables
4. Redeploy and test!

Your appointment booking should work immediately after configuration. 🎉
