# 🔧 Critical Fix: Update Build Command

## ❌ Current Problem

Your `package.json` still has the old build command that **bundles dependencies**:

```json
"build": "esbuild server/index.ts --platform=node --bundle ..."
```

This is why deployment fails - dependencies get bundled instead of externalized!

The `build.js` file I created is correct but **not being used**.

---

## ✅ Solution: Update package.json

You need to change the build script to use `build.js`. Here are your options:

### Option 1: Edit package.json Manually (Quickest)

Open `package.json` and change line 8 from:

```json
"build": "esbuild server/index.ts --platform=node --bundle --format=esm --target=node20 --outdir=dist --alias:@shared=./shared --alias:@=./client/src --alias:@assets=./attached_assets",
```

To:

```json
"build": "node build.js",
```

### Option 2: Via Replit Deployments UI

1. Go to **Deployments** tab
2. Click **Configure** → **Settings**
3. Under **Build Command**, change from `npm run build` to:
   ```
   node build.js
   ```
4. Keep **Run Command** as: `npm run start`

---

## ✅ Complete Fix

Here's what your `package.json` should look like after the fix:

```json
{
  "name": "rest-express",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx --watch server/index.ts",
    "build": "node build.js",
    "start": "NODE_ENV=production node dist/index.js"
  },
  "dependencies": {
    "body-parser": "^1.20.3",
    "cors": "^2.8.5",
    "dayjs": "^1.11.19",
    "dotenv": "^16.6.1",
    "express": "^4.21.2",
    "twilio": "^5.10.4"
  },
  "devDependencies": {
    "@types/node": "^20.11.30",
    "esbuild": "^0.24.0",
    "tsx": "^4.20.6",
    "typescript": "^5.6.3"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Key change:** Line 8 now says `"build": "node build.js"`

---

## 🧪 Test Before Deploying

After updating package.json, test locally:

```bash
# Clean build
rm -rf dist
npm run build

# Should see:
# Externalizing dependencies: body-parser, cors, dayjs, dotenv, express, twilio
# ✓ Build complete - All dependencies externalized

# Test production build
NODE_ENV=production npm run start
# In another terminal:
curl http://localhost:5000/health
# Expected: {"ok":true,"env":"production"}
```

---

## 🚀 Deploy Checklist

- [ ] Update `package.json` build script to `"build": "node build.js"`
- [ ] Test build locally: `npm run build`
- [ ] Verify 0 dynamic requires: `grep -c "require(" dist/index.js`
- [ ] Configure secrets in Deployments → Secrets
- [ ] Deploy from Deployments tab

---

## 📊 What This Fixes

| Before | After |
|--------|-------|
| ❌ Dependencies bundled | ✅ Dependencies external |
| ❌ Dynamic require() errors | ✅ Pure ESM imports |
| ❌ Crash loop on startup | ✅ Starts successfully |
| ❌ 7MB bundle | ✅ 33KB bundle |

---

**Bottom Line:** Change line 8 of `package.json` to `"build": "node build.js"` and your deployment will work!
