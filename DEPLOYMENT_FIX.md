# Deployment Fix for ESM/Dotenv Bundling Issue

## ✅ Problem Solved

The deployment was failing because:
- esbuild was bundling `dotenv` which uses dynamic `require()` for Node.js built-ins
- This doesn't work in ESM output format
- Replit Deployments **automatically inject environment variables**, so dotenv is unnecessary in production

## 🔧 Fixes Applied

### 1. Created `build.js` - Proper esbuild configuration
```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',  // ← External packages not bundled
  alias: {
    '@shared': './shared',
    '@': './client/src',
    '@assets': './attached_assets'
  },
  banner: {
    js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`
  }
});
```

**Key changes:**
- `packages: 'external'` - All dependencies loaded from `node_modules` at runtime (not bundled)
- This eliminates the dotenv dynamic require issue
- Creates a 33KB bundle instead of 7.1MB

### 2. Updated `server/index.ts` - Conditional dotenv loading
```typescript
// Only load dotenv in development - Replit Deployments inject env vars automatically
if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}
```

This ensures:
- ✅ Dev mode: dotenv loads `.env` file for local testing
- ✅ Production: Skip dotenv, use Replit's injected environment variables

## 📋 Manual Configuration Required

Since I cannot edit `package.json` or `.replit` directly, you need to update the deployment configuration:

### Option 1: Update via Replit UI (Recommended)

1. Go to the **Deployments** tab in Replit
2. Click **Configure** or **Settings**
3. Update the **Build command** to:
   ```bash
   node build.js
   ```
4. Ensure **Run command** is:
   ```bash
   npm run start
   ```

### Option 2: Update package.json manually

Edit `package.json` and change the build script:
```json
"scripts": {
  "dev": "tsx --watch server/index.ts",
  "build": "node build.js",
  "start": "NODE_ENV=production node dist/index.js"
}
```

## ✅ Environment Variables Required

Ensure these secrets are configured in **Deployments → Configuration → Secrets**:

### Required Secrets
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption key
- `TWILIO_ACCOUNT_SID` - Twilio account identifier
- `TWILIO_AUTH_TOKEN` - Twilio authentication token
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number
- `CLINIKO_API_KEY` - Cliniko API key
- `CLINIKO_BUSINESS_ID` - Cliniko business ID
- `CLINIKO_PRACTITIONER_ID` - Cliniko practitioner ID
- `CLINIKO_APPT_TYPE_ID` - Cliniko appointment type ID
- `CLINIKO_REGION` - Cliniko region (e.g., "au4")

### Optional Settings
- `PUBLIC_BASE_URL` - Your deployment URL
- `PUBLIC_LOCALE` - Locale setting (default: "en-AU")
- `TZ` - Timezone (default: "Australia/Brisbane")
- `APP_MODE` - Application mode

## 🧪 Testing

### Local Build Test
```bash
node build.js
NODE_ENV=production PORT=5001 node dist/index.js
```

### Test Production Build
```bash
curl http://localhost:5001/health
# Expected: {"ok":true,"env":"production"}
```

## 📊 Build Output Verification

After running `node build.js`, you should see:
```
✓ Build complete

dist/
  index.js    (33KB - ESM bundle with external packages)
```

## 🚀 Deployment Checklist

- [x] `build.js` created with proper esbuild config
- [x] `server/index.ts` uses conditional dotenv import
- [x] Build tested locally (33KB bundle generated)
- [ ] Update deployment build command to `node build.js`
- [ ] Verify all secrets configured in Deployment Settings
- [ ] Deploy and test webhook endpoints

## 🔍 How It Works

**Development Mode** (`npm run dev`):
- Uses `tsx --watch` for hot reload
- Loads `.env` file via dotenv
- No bundling required

**Production Build** (`node build.js`):
- Bundles TypeScript → JavaScript (ESM)
- Marks all packages as external (not bundled)
- Skips dotenv (uses Replit's injected env vars)
- Creates optimized `dist/index.js`

**Production Runtime** (`npm run start`):
- Runs `dist/index.js` with `NODE_ENV=production`
- Loads dependencies from `node_modules`
- Uses environment variables from Replit Deployments
- No dotenv needed ✓

## 📚 References

- [Replit Deployments Documentation](https://docs.replit.com/deployments/about-deployments)
- Replit automatically injects secrets as `process.env` variables
- No need for dotenv in production deployments
