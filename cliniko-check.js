// cliniko-check.js
const API_KEY = process.env.CLINIKO_API_KEY;
const REGION = process.env.CLINIKO_REGION || "au4";
const BASE = `https://api.${REGION}.cliniko.com/v1`;

if (!API_KEY) {
  console.error("❌ Missing CLINIKO_API_KEY in Secrets.");
  process.exit(1);
}

async function clinikoFetch(endpoint) {
  const url = `${BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Basic ${Buffer.from(API_KEY + ":").toString("base64")}`,
      "Accept": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ ${endpoint} → ${res.status} ${text}`);
    return null;
  }
  return JSON.parse(text);
}

(async () => {
  console.log("🔍 Checking Cliniko API connectivity…");

  const businesses = await clinikoFetch("/businesses");
  const practitioners = await clinikoFetch("/practitioners");
  const apptTypes = await clinikoFetch("/appointment_types?per_page=100");

  if (!businesses || !practitioners || !apptTypes) {
    console.log("⚠️ One or more endpoints failed — check API key or region.");
    process.exit(1);
  }

  // Try to find active first, fall back to first available
  const activeBiz = (businesses.businesses || []).find(b => b.active) || (businesses.businesses || [])[0];
  const activePrac = (practitioners.practitioners || []).find(p => p.active) || (practitioners.practitioners || [])[0];
  const activeType = (apptTypes.appointment_types || []).find(a => a.active) || (apptTypes.appointment_types || [])[0];

  console.log("\n🏢 Businesses:");
  (businesses.businesses || []).forEach(b =>
    console.log(` - ${b.name || 'Unnamed'} (ID: ${b.id}) ${b.active ? "✅ Active" : "⚠️ Inactive"}`)
  );
  console.log("\n👨‍⚕️ Practitioners:");
  (practitioners.practitioners || []).forEach(p =>
    console.log(` - ${p.first_name} ${p.last_name} (ID: ${p.id}) ${p.active ? "✅ Active" : "⚠️ Inactive"}`)
  );
  console.log("\n📋 Appointment Types:");
  (apptTypes.appointment_types || []).forEach(a =>
    console.log(` - ${a.name} (${a.duration_in_minutes || a.duration || 'unknown'} min) (ID: ${a.id}) ${a.active ? "✅ Active" : "⚠️ Inactive"}`)
  );

  if (!activeBiz || !activePrac || !activeType) {
    console.log("\n❌ Could not find any IDs. Check Cliniko account.");
    process.exit(1);
  }

  console.log("\n✅ Selected IDs:");
  console.log(`CLINIKO_BUSINESS_ID=${activeBiz.id}`);
  console.log(`CLINIKO_PRACTITIONER_ID=${activePrac.id}`);
  console.log(`CLINIKO_APPT_TYPE_ID=${activeType.id}`);

  // Emit a machine-readable block so you can parse & set Secrets
  console.log("\n__CLINIKO_IDS_JSON__");
  console.log(JSON.stringify({
    region: "au4",
    businessId: activeBiz.id,
    practitionerId: activePrac.id,
    appointmentTypeId: activeType.id
  }, null, 2));
})().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
