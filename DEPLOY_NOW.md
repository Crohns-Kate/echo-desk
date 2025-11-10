# 🚀 Deploy EchoDesk NOW - Quick Guide

**Status:** ✅ All secrets configured - Ready to deploy immediately!

---

## Step 1: Deploy to Replit (30 seconds)

### Option A: Via Deployments Tab (Recommended)
1. Click **"Deployments"** in the left sidebar
2. Click the **"Deploy"** button
3. Wait for build to complete (~30 seconds)
4. Copy your deployment URL (format: `https://YOUR_APP_NAME.replit.app`)

### Option B: Via Deploy Button (Top Right)
1. Look for **"Deploy"** button in top-right corner of Replit
2. Click it and follow the prompts
3. Wait for deployment to complete
4. Copy your deployment URL

---

## Step 2: Test Your Deployment (1 minute)

Once deployed, test these endpoints:

### Test 1: Health Check
```bash
curl https://YOUR_APP_NAME.replit.app/health
```
Expected response:
```json
{"ok":true,"env":"production"}
```

### Test 2: Test Route
```bash
curl -X POST https://YOUR_APP_NAME.replit.app/api/voice/test
```
Expected: Valid TwiML with Australian voice

### Test 3: Incoming Route (requires signature validation bypass)
Skip this test for now - we'll test with a real call instead!

---

## Step 3: Configure Twilio Webhook (1 minute)

### Find Your Deployment URL
After deployment, your URL will be:
```
https://YOUR_APP_NAME.replit.app
```

### Configure in Twilio Console

1. **Go to Twilio Console:**
   - https://console.twilio.com/us1/develop/phone-numbers/manage/incoming

2. **Select Your Phone Number:**
   - Click on your Twilio phone number

3. **Configure Voice Settings:**
   - Scroll to **"Voice & Fax"** section
   - Under **"A CALL COMES IN"**:
     - Method: **POST** (dropdown)
     - URL: `https://YOUR_APP_NAME.replit.app/api/voice/incoming`
   
4. **Save:**
   - Click **"Save"** at the bottom

---

## Step 4: Test with Real Call! 📞

**Call your Twilio number from your phone**

### Expected Flow:

1. **Call Connects:**
   - You should hear: *"Hello and welcome to your clinic. How can I help you today?"*

2. **System Listens:**
   - Try saying: **"I'd like to book an appointment"**

3. **System Responds:**
   - Should ask about booking and guide you through the flow

4. **Other Test Phrases:**
   - "Reschedule" - Should ask for phone number
   - "Cancel" - Should ask for phone number
   - "Talk to someone" - Should offer callback

### If Something Goes Wrong:

**Silence or No Response?**
- Check Twilio webhook URL is correct
- Check secrets are configured in Deployments
- Check deployment logs in Replit

**Wrong Voice?**
- Should be Australian accent (Olivia)
- If not, check deployment is using production build

---

## Step 5: Monitor Your First Calls

### View Logs in Replit:
1. Go to Deployments tab
2. Click on your active deployment
3. Click "Logs" to see live webhook calls

### View Calls in Twilio:
1. Go to: https://console.twilio.com/us1/monitor/logs/calls
2. See all incoming calls and their status
3. Click any call to see detailed logs

---

## 🎯 Quick Checklist

- [ ] Deployed to Replit Deployments
- [ ] Copied deployment URL
- [ ] Tested `/health` endpoint
- [ ] Configured Twilio webhook
- [ ] Made test call
- [ ] Heard Australian voice greeting
- [ ] Tested booking flow

---

## 🔧 Troubleshooting

### Deployment Failed?
- Check build logs in Deployments tab
- Verify all secrets are set
- Try redeploying

### Call Not Working?
1. **Check Twilio Webhook:**
   - URL must be `https://YOUR_APP.replit.app/api/voice/incoming`
   - Method must be **POST**
   - Save changes!

2. **Check Deployment:**
   - Is deployment active? (green status)
   - Are secrets configured in Deployments → Secrets?
   - Check deployment logs for errors

3. **Check Secrets:**
   - Go to Deployments → Your Deployment → Secrets
   - Verify all secrets are present
   - Note: Deployment secrets are separate from dev workspace secrets!

### Call Connects but Silent?
- Check deployment logs for TwiML errors
- Verify `CLINIKO_*` secrets are correct
- Test with `/api/voice/test` route first

---

## 📊 Expected Deployment Info

**Build Command:** `npm run build` (uses `build.js`)  
**Start Command:** `node dist/index.js`  
**Bundle Size:** ~34KB  
**Port:** 5000 (auto-configured)  
**Node Version:** 20+ (Replit default)

---

## 🎉 Success Metrics

Your deployment is working if:
- ✅ Health check returns `{"ok":true,"env":"production"}`
- ✅ Test route returns valid TwiML
- ✅ Real call connects and you hear Australian voice
- ✅ System responds to "book appointment" command
- ✅ No errors in deployment logs

---

## 📞 Your Deployment URLs

Once deployed, your webhook URLs will be:

```
Health Check:    https://YOUR_APP.replit.app/health
Test Route:      https://YOUR_APP.replit.app/api/voice/test
Twilio Webhook:  https://YOUR_APP.replit.app/api/voice/incoming
```

**Replace `YOUR_APP` with your actual deployment name!**

---

## 🚨 Important Reminders

1. **Secrets in Deployments:**
   - Deployment secrets are SEPARATE from dev workspace secrets
   - After deploying, add secrets in: Deployments → Your Deployment → Secrets
   - All required secrets must be configured there

2. **Webhook URL Format:**
   - Must be full HTTPS URL
   - Must end with `/api/voice/incoming`
   - Must use deployment URL (not dev workspace URL)

3. **Testing:**
   - Dev workspace URL won't work for Twilio webhooks
   - Must test with actual deployment URL
   - Real call testing is most reliable

---

## ✅ You're Ready!

All secrets are configured. Click **"Deploy"** and you'll be live in 30 seconds! 🚀

After deploying, come back here and I'll help you test everything works.
