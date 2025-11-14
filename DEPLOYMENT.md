# EchoDesk Deployment Guide

## Overview

This guide covers deploying EchoDesk to Replit's Autoscale deployment platform.

## Pre-Deployment Checklist

### 1. Port Configuration

**IMPORTANT**: For Autoscale deployments, only **one port mapping** should be configured in `.replit`:

```toml
[[ports]]
localPort = 5000
externalPort = 80
```

If you see multiple port mappings in your `.replit` file, remove all except the one above. The deployment system expects a single port mapping to external port 80.

### 2. Required Production Secrets

The following environment variables **must** be set in your Replit Deployment configuration:

#### Database
- `DATABASE_URL` - PostgreSQL connection string (Neon serverless format)

#### Application
- `PUBLIC_BASE_URL` - Your deployment URL (e.g., `https://your-app.replit.app`)
- `NODE_ENV` - Set to `production` (automatically set by Replit for deployments)

#### Twilio Integration
- `TWILIO_ACCOUNT_SID` - Your Twilio account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio authentication token
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number (E.164 format, e.g., `+61412345678`)

#### Cliniko Integration
- `CLINIKO_API_KEY` - Your Cliniko API key (from Cliniko > Account Settings > API)
- `CLINIKO_REGION` - Your Cliniko region (e.g., `au4` for Australia)
- `CLINIKO_BUSINESS_ID` - Your Cliniko business/practice ID
- `CLINIKO_PRACTITIONER_ID` - The practitioner ID for appointments
- `CLINIKO_APPT_TYPE_ID` - The appointment type ID to use for bookings

#### Optional (AI Features)
- `OPENAI_API_KEY` - OpenAI API key for GPT-4o-mini intent detection (falls back to regex matching if not set)

### 3. How to Set Deployment Secrets

1. Open your Repl in Replit
2. Click on "Deploy" in the left sidebar
3. Click "Configure" or "Settings"
4. Find the "Environment Variables" or "Secrets" section
5. Add each required secret listed above
6. Save your configuration

### 4. Build Configuration

The deployment uses the following build commands (already configured in `.replit`):

```toml
[deployment]
deploymentTarget = "autoscale"
build = ["npm", "run", "build"]
run = ["npm", "run", "start"]
```

This will:
- Run `npm run build` to compile TypeScript and bundle the frontend
- Run `npm run start` to launch the production server

### 5. Verify Deployment

After deployment, check the logs for:

1. **Successful startup**:
   ```
   serving on port 5000
   ```

2. **Cliniko configuration** (should show last 4 digits of IDs):
   ```
   [Cliniko] Configuration:
     Region: au4
     Business ID: ...0197
     Practitioner ID: ...8878
     Appointment Type ID: ...8673
   ```

3. **No missing secrets warnings**:
   ```
   [STARTUP ERROR] Missing required production secrets: ...
   ```

If you see missing secrets warnings, review step 3 above and ensure all required secrets are set.

### 6. Post-Deployment Configuration

#### Configure Twilio Webhooks

After deployment, update your Twilio phone number configuration:

1. Go to Twilio Console > Phone Numbers
2. Select your phone number
3. Under "Voice & Fax" > "A Call Comes In":
   - Set to: `https://your-deployment-url.replit.app/api/voice/incoming`
   - Method: `POST`
4. Under "Messaging":
   - Set to: `https://your-deployment-url.replit.app/api/voice/sms`
   - Method: `POST`
5. Save your configuration

## Troubleshooting

### Deployment fails with "application not listening on correct port"

- Verify only one port mapping exists in `.replit` (port 5000 -> 80)
- Check that `PORT` environment variable is not overridden in deployment config
- Review startup logs for errors

### Missing production secrets

- Double-check all required secrets are set in Deployment configuration
- Verify secret names match exactly (case-sensitive)
- Check for typos in secret values

### Database connection errors

- Ensure `DATABASE_URL` is correctly formatted for Neon serverless
- Verify the database is accessible from Replit's deployment network
- Check database credentials are still valid

### Twilio webhook failures

- Confirm `PUBLIC_BASE_URL` is set to your actual deployment URL
- Verify Twilio webhook URLs include the full path
- Check Twilio signature validation isn't blocking requests

## Support

For issues specific to:
- **Replit deployment**: Contact Replit support
- **Twilio integration**: Check Twilio Console > Monitor > Logs
- **Cliniko API**: Review Cliniko API documentation at api.cliniko.com/docs
