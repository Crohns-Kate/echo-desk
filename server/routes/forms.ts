import { Express, Request, Response } from "express";
import { storage } from "../storage";
import { updateClinikoPatient } from "../integrations/cliniko";

/**
 * Form collection routes
 * Handles new patient intake forms sent via SMS
 */
export function registerForms(app: Express) {

  /**
   * GET /intake/:token
   * Displays the new patient intake form
   * Optional query param: patientId - Cliniko patient ID for direct updates
   */
  app.get("/intake/:token", async (req: Request, res: Response) => {
    const { token } = req.params;
    const { patientId, edit } = req.query;  // Cliniko patient ID if available, edit flag

    // Validate token format
    if (!token || !token.startsWith('form_')) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invalid Link</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
            .error { color: #d32f2f; background: #ffebee; padding: 20px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Invalid Link</h2>
            <p>This link is not valid. Please check your text message or call us directly.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Check if THIS SPECIFIC TOKEN has already been submitted
    // (Not per-callSid - group bookings have multiple tokens, one per patient)
    let existingSubmission: any = null;
    try {
      const callSid = token.split('_')[1];
      console.log('[GET /intake/:token] Token:', token);
      console.log('[GET /intake/:token] Extracted callSid:', callSid);
      console.log('[GET /intake/:token] PatientId from URL:', patientId || 'NOT PROVIDED');

      const call = await storage.getCallByCallSid(callSid);
      console.log('[GET /intake/:token] Call found:', !!call, 'conversationId:', call?.conversationId);

      if (call?.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const context = conversation?.context as any;

        // Check formSubmissions map for this specific token
        console.log('[GET /intake/:token] ═══════════════════════════════════');
        console.log('[GET /intake/:token] Token requested:', token);
        console.log('[GET /intake/:token] Edit mode:', edit === 'true' ? 'YES' : 'NO');
        console.log('[GET /intake/:token] All tokens in formSubmissions:', Object.keys(context?.formSubmissions || {}));

        // Get submission for THIS specific token only
        existingSubmission = context?.formSubmissions?.[token];

        // CRITICAL: Check BOTH that submission exists AND has submittedAt
        // This matches the POST handler check at line 379
        const hasBeenSubmitted = existingSubmission && existingSubmission.submittedAt;

        console.log('[GET /intake/:token] Submission for this token:', hasBeenSubmitted ? 'SUBMITTED' : 'NOT SUBMITTED');
        if (existingSubmission) {
          console.log('[GET /intake/:token]   - firstName:', existingSubmission.firstName);
          console.log('[GET /intake/:token]   - submittedAt:', existingSubmission.submittedAt);
        }
        console.log('[GET /intake/:token] ═══════════════════════════════════');

        // If already submitted AND NOT in edit mode, show success message
        // CRITICAL: Use hasBeenSubmitted (checks submittedAt) not just existingSubmission
        if (hasBeenSubmitted && edit !== 'true') {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Form Already Submitted</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
                .success { color: #2e7d32; background: #e8f5e9; padding: 20px; border-radius: 8px; }
                .edit-link { margin-top: 15px; }
                .edit-link a { color: #1565c0; text-decoration: none; }
              </style>
            </head>
            <body>
              <div class="success">
                <h2>✓ Form Already Submitted</h2>
                <p>Thanks ${existingSubmission.firstName}! Your details have already been received.</p>
                <p class="edit-link">Need to make changes? <a href="/intake/${token}?patientId=${patientId || existingSubmission.clinikoPatientId || ''}&edit=true">Click here to update</a></p>
              </div>
            </body>
            </html>
          `);
        }
      }
    } catch (err) {
      console.error('[GET /intake/:token] Error checking form status:', err);
    }

    // Determine if this is an edit (pre-fill form with existing data)
    const isEdit = edit === 'true' && existingSubmission;
    const prefillFirstName = isEdit ? existingSubmission.firstName || '' : '';
    const prefillLastName = isEdit ? existingSubmission.lastName || '' : '';
    const prefillEmail = isEdit ? existingSubmission.email || '' : '';
    const prefillPhone = isEdit ? existingSubmission.phone || '' : '';

    // Display form (fresh or edit mode)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>New Patient Intake - Echo Desk Chiropractic</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          .container {
            max-width: 500px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 32px;
          }
          h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-bottom: 32px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
          }
          input, select {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
          }
          input:focus, select:focus {
            outline: none;
            border-color: #667eea;
          }
          .required { color: #d32f2f; }
          button {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            margin-top: 8px;
          }
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
          }
          button:active {
            transform: translateY(0);
          }
          button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
          }
          .error-message {
            color: #d32f2f;
            font-size: 14px;
            margin-top: 8px;
            display: none;
          }
          .success-message {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            display: none;
            text-align: center;
          }
          .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${isEdit ? 'Update Your Details' : 'Welcome to Echo Desk'}</h1>
          <p class="subtitle">${isEdit ? 'Update your information below' : 'Please complete your details below (takes 30 seconds)'}</p>

          <form id="intakeForm">
            <div class="form-group">
              <label for="firstName">First Name <span class="required">*</span></label>
              <input type="text" id="firstName" name="firstName" required autocomplete="given-name" value="${prefillFirstName}">
            </div>

            <div class="form-group">
              <label for="lastName">Last Name <span class="required">*</span></label>
              <input type="text" id="lastName" name="lastName" required autocomplete="family-name" value="${prefillLastName}">
            </div>

            <div class="form-group">
              <label for="email">Email Address <span class="required">*</span></label>
              <input type="email" id="email" name="email" required autocomplete="email" value="${prefillEmail}">
            </div>

            <div class="form-group">
              <label for="phone">Mobile Number <span class="required">*</span></label>
              <input type="tel" id="phone" name="phone" required autocomplete="tel" placeholder="04XX XXX XXX" value="${prefillPhone}">
            </div>

            <button type="submit" id="submitBtn">
              <span id="btnText">${isEdit ? 'Update' : 'Submit'}</span>
              <span id="btnSpinner" class="spinner" style="display:none;"></span>
            </button>
          </form>

          <div class="error-message" id="errorMessage"></div>
          <div class="success-message" id="successMessage">
            ✓ Thanks! Your details have been ${isEdit ? 'updated' : 'received'}. You can return to your call now.
          </div>
        </div>

        <script>
          const form = document.getElementById('intakeForm');
          const submitBtn = document.getElementById('submitBtn');
          const btnText = document.getElementById('btnText');
          const btnSpinner = document.getElementById('btnSpinner');
          const errorMessage = document.getElementById('errorMessage');
          const successMessage = document.getElementById('successMessage');
          const token = '${token}';
          // Use patientId from URL, or from existing submission (for edit mode)
          const clinikoPatientId = '${patientId || (existingSubmission?.clinikoPatientId) || ''}';
          // CRITICAL: Tell server this is an edit (allows re-submission of same token)
          const isEdit = ${isEdit ? 'true' : 'false'};

          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Disable form
            submitBtn.disabled = true;
            btnText.style.display = 'none';
            btnSpinner.style.display = 'inline-block';
            errorMessage.style.display = 'none';

            // Get form data
            const formData = {
              firstName: document.getElementById('firstName').value.trim(),
              lastName: document.getElementById('lastName').value.trim(),
              email: document.getElementById('email').value.trim(),
              phone: document.getElementById('phone').value.trim()
            };

            try {
              const response = await fetch('/api/forms/submit', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  token: token,
                  clinikoPatientId: clinikoPatientId || undefined,
                  isEdit: isEdit,  // CRITICAL: Allow re-submission for edits
                  ...formData
                })
              });

              const result = await response.json();

              if (response.ok) {
                // Success!
                form.style.display = 'none';
                successMessage.style.display = 'block';
              } else {
                throw new Error(result.error || 'Failed to submit form');
              }
            } catch (err) {
              console.error('Form submission error:', err);
              errorMessage.textContent = err.message || 'Failed to submit. Please try again.';
              errorMessage.style.display = 'block';
              submitBtn.disabled = false;
              btnText.style.display = 'inline';
              btnSpinner.style.display = 'none';
            }
          });
        </script>
      </body>
      </html>
    `);
  });

  /**
   * POST /api/forms/submit
   * Handles form submission
   * Accepts optional clinikoPatientId for direct patient updates
   */
  app.post("/api/forms/submit", async (req: Request, res: Response) => {
    try {
      const { token, firstName, lastName, email, phone, clinikoPatientId, isEdit } = req.body;

      // Validate inputs
      if (!token || !firstName || !lastName || !email || !phone) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      // Extract callSid from token
      const callSid = token.split('_')[1];
      if (!callSid) {
        return res.status(400).json({ error: 'Invalid token' });
      }

      // Find call and update conversation context
      const call = await storage.getCallByCallSid(callSid);
      if (!call?.conversationId) {
        return res.status(404).json({ error: 'Call not found' });
      }

      // Store form data in conversation context
      const formData = {
        firstName,
        lastName,
        email,
        phone
      };

      console.log('[POST /api/forms/submit] Storing form data in conversation context:');
      console.log('[POST /api/forms/submit]   - token:', token);
      console.log('[POST /api/forms/submit]   - callSid:', callSid);
      console.log('[POST /api/forms/submit]   - conversationId:', call.conversationId);
      console.log('[POST /api/forms/submit]   - clinikoPatientId:', clinikoPatientId || 'NOT PROVIDED');
      console.log('[POST /api/forms/submit]   - isEdit:', isEdit || false);
      console.log('[POST /api/forms/submit]   - formData:', formData);

      // CRITICAL: Re-read context to get LATEST formSubmissions
      // This handles race conditions where two people submit at the same time
      const conversation = await storage.getConversation(call.conversationId);
      const existingContext = (conversation?.context || {}) as any;
      const existingFormSubmissions = existingContext.formSubmissions || {};

      console.log('[POST /api/forms/submit] Existing context state:', existingContext.state);
      console.log('[POST /api/forms/submit] Existing form submissions:', Object.keys(existingFormSubmissions));

      // Check if this specific token has already been submitted (409 Conflict)
      // CRITICAL: Allow re-submission if isEdit=true (user is updating their details)
      const alreadySubmitted = existingFormSubmissions[token] && existingFormSubmissions[token].submittedAt;
      if (alreadySubmitted && !isEdit) {
        console.log('[POST /api/forms/submit] ⚠️ Token already submitted (not edit mode):', token);
        console.log('[POST /api/forms/submit]   Previously submitted at:', existingFormSubmissions[token].submittedAt);
        return res.status(409).json({
          error: 'Form already submitted',
          message: 'This form has already been submitted. Use the edit link if you need to update your details.',
          submittedAt: existingFormSubmissions[token].submittedAt
        });
      }

      if (alreadySubmitted && isEdit) {
        console.log('[POST /api/forms/submit] 📝 EDIT MODE: Updating existing submission for token:', token);
      }

      // CRITICAL: Re-read context AGAIN right before write (prevents race condition)
      // This handles the case where two people submit forms at the same time:
      // Without this re-read, Person 2's submission would overwrite Person 1's.
      const latestConversation = await storage.getConversation(call.conversationId);
      const latestContext = (latestConversation?.context || {}) as any;
      const latestFormSubmissions = latestContext.formSubmissions || {};

      console.log('[POST /api/forms/submit] Re-read latest formSubmissions:', Object.keys(latestFormSubmissions));

      // Store/update this submission keyed by token (allows multiple forms for group booking)
      // For edits, this overwrites the existing submission with new data
      const updatedFormSubmissions = {
        ...latestFormSubmissions,  // Use LATEST from DB to prevent race condition
        [token]: {
          ...formData,
          submittedAt: new Date().toISOString(),
          updatedAt: isEdit ? new Date().toISOString() : undefined,  // Track edit time
          clinikoPatientId: clinikoPatientId || latestFormSubmissions[token]?.clinikoPatientId || null
        }
      };

      await storage.updateConversation(call.conversationId, {
        context: {
          ...latestContext,  // Use LATEST context from DB
          formToken: token,  // Track latest token (backward compatibility)
          formData: formData,  // Keep legacy field (backward compatibility)
          formSubmissions: updatedFormSubmissions,  // Per-token submissions with race condition fix
          formSubmittedAt: new Date().toISOString()
        }
      });

      console.log('[POST /api/forms/submit] ✅ Form data stored for token:', token, isEdit ? '(EDIT)' : '(NEW)');
      console.log('[POST /api/forms/submit] Total form submissions:', Object.keys(updatedFormSubmissions).length);

      // Update patient in Cliniko with correct details
      // CRITICAL: Only update if we have an explicit patientId - NEVER fall back to phone lookup
      // Phone lookup can match the WRONG patient (e.g., existing patient "john smith" instead of new caller)
      const effectivePatientId = clinikoPatientId || existingFormSubmissions[token]?.clinikoPatientId;

      if (effectivePatientId) {
        try {
          console.log('[POST /api/forms/submit] Using direct clinikoPatientId:', effectivePatientId);

          // Update patient with correct name spelling, email, and phone
          const callerPhone = call.fromNumber;
          const updatePayload: {
            first_name: string;
            last_name: string;
            email: string;
            phone_numbers?: Array<{ label: string; number: string }>;
          } = {
            first_name: firstName,
            last_name: lastName,
            email: email
          };

          // If user provided a different phone number, update it
          if (phone && phone !== callerPhone) {
            console.log('[POST /api/forms/submit] User provided different phone number:', phone, '(original:', callerPhone, ')');
            updatePayload.phone_numbers = [
              { label: 'Mobile', number: phone }
            ];
          }

          await updateClinikoPatient(effectivePatientId, updatePayload);
          console.log('[POST /api/forms/submit] ✅ Cliniko patient updated with form data');

          res.json({
            success: true,
            message: isEdit ? 'Details updated successfully' : 'Form submitted successfully',
            clinikoUpdated: true
          });
        } catch (clinikoError: any) {
          // ═══════════════════════════════════════════════════════════════════
          // CRITICAL: Cliniko update FAILED - create alert for manual sync
          // ═══════════════════════════════════════════════════════════════════
          console.error('[POST /api/forms/submit] ❌ CRITICAL: Cliniko update FAILED:', clinikoError?.message || clinikoError);
          console.error('[POST /api/forms/submit]   - patientId:', effectivePatientId);
          console.error('[POST /api/forms/submit]   - formData:', formData);

          // Create alert for clinic to manually sync this patient
          try {
            const alertConversation = await storage.getConversation(call.conversationId);
            const tenantId = alertConversation?.tenantId;

            if (tenantId) {
              await storage.createAlert({
                tenantId,
                conversationId: call.conversationId || undefined,
                reason: 'cliniko_sync_failed',
                payload: {
                  callSid,
                  clinikoPatientId: effectivePatientId,
                  formData,
                  callerPhone: call.fromNumber,
                  error: clinikoError?.message || 'Unknown error',
                  message: 'Cliniko patient update failed - manual sync required'
                },
                status: 'open'
              });
              console.log('[POST /api/forms/submit] ✅ Created alert for Cliniko sync failure');
            }
          } catch (alertErr) {
            console.error('[POST /api/forms/submit] Failed to create Cliniko sync alert:', alertErr);
          }

          // Form data is saved in context, but Cliniko wasn't updated
          // Return success with a warning so user knows to contact clinic
          res.json({
            success: true,
            message: 'Your details have been saved. There was an issue updating our system - our team will confirm your details shortly.',
            clinikoUpdated: false,
            clinikoError: clinikoError?.message || 'Update failed'
          });
        }
      } else {
        // NO patientId provided - do NOT attempt phone lookup (prevents wrong patient updates)
        // Form data is saved in conversation context - team will manually confirm details
        console.error('[POST /api/forms/submit] ⚠️ NO patientId provided - cannot update Cliniko safely');
        console.error('[POST /api/forms/submit]   - callSid:', callSid);
        console.error('[POST /api/forms/submit]   - conversationId:', call.conversationId);
        console.error('[POST /api/forms/submit]   - formData:', formData);

        // Create alert for team to manually confirm patient details
        try {
          // Get tenant ID from call or conversation
          const conversation = await storage.getConversation(call.conversationId);
          const tenantId = conversation?.tenantId;

          if (tenantId) {
            await storage.createAlert({
              tenantId,
              conversationId: call.conversationId || undefined,
              reason: 'form_missing_patient_id',
              payload: {
                callSid,
                formData,
                callerPhone: call.fromNumber,
                message: 'Intake form submitted without patient ID - manual confirmation required'
              },
              status: 'open'
            });
            console.log('[POST /api/forms/submit] ✅ Created alert for manual review');
          }
        } catch (alertError) {
          console.error('[POST /api/forms/submit] Failed to create alert:', alertError);
        }

        // Return success to user - their form data is saved, team will follow up
        res.json({
          success: true,
          message: 'Form received; our team will confirm your details'
        });
      }

    } catch (err) {
      console.error('[POST /api/forms/submit] Error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /email-collect - Email collection form
   */
  app.get("/email-collect", async (req: Request, res: Response) => {
    const { callSid } = req.query;

    if (!callSid) {
      return res.status(400).send('<h1>Invalid Link</h1><p>Missing call information</p>');
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Collection - Echo Desk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            max-width: 400px;
            width: 100%;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 32px;
          }
          h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-bottom: 32px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
          }
          input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
          }
          input:focus {
            outline: none;
            border-color: #667eea;
          }
          button {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          }
          button:hover {
            transform: translateY(-2px);
          }
          button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
          }
          .success {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            display: none;
            text-align: center;
          }
          .error {
            background: #ffebee;
            color: #d32f2f;
            padding: 12px;
            border-radius: 8px;
            margin-top: 12px;
            display: none;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📧 Email Address</h1>
          <p class="subtitle">Enter your email for confirmation</p>

          <form id="emailForm">
            <div class="form-group">
              <label for="email">Email Address</label>
              <input type="email" id="email" name="email" required autocomplete="email" placeholder="your.email@example.com">
            </div>

            <button type="submit" id="submitBtn">Submit</button>
          </form>

          <div class="success" id="successMessage">
            ✓ Thanks! Your email has been saved.
          </div>
          <div class="error" id="errorMessage"></div>
        </div>

        <script>
          const form = document.getElementById('emailForm');
          const submitBtn = document.getElementById('submitBtn');
          const errorMessage = document.getElementById('errorMessage');
          const successMessage = document.getElementById('successMessage');
          const callSid = '${callSid}';

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            errorMessage.style.display = 'none';

            const email = document.getElementById('email').value.trim();

            try {
              const response = await fetch('/api/email-collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callSid, email })
              });

              const result = await response.json();

              if (response.ok) {
                form.style.display = 'none';
                successMessage.style.display = 'block';
              } else {
                throw new Error(result.error || 'Failed to save email');
              }
            } catch (err) {
              console.error(err);
              errorMessage.textContent = err.message || 'Failed to save. Please try again.';
              errorMessage.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit';
            }
          });
        </script>
      </body>
      </html>
    `);
  });

  /**
   * GET /name-verify - Name verification form
   */
  app.get("/name-verify", async (req: Request, res: Response) => {
    const { callSid } = req.query;

    if (!callSid) {
      return res.status(400).send('<h1>Invalid Link</h1><p>Missing call information</p>');
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Name Verification - Echo Desk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            max-width: 400px;
            width: 100%;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 32px;
          }
          h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-bottom: 32px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
          }
          input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
          }
          input:focus {
            outline: none;
            border-color: #667eea;
          }
          button {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          }
          button:hover {
            transform: translateY(-2px);
          }
          button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
          }
          .success {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            display: none;
            text-align: center;
          }
          .error {
            background: #ffebee;
            color: #d32f2f;
            padding: 12px;
            border-radius: 8px;
            margin-top: 12px;
            display: none;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✏️ Verify Your Name</h1>
          <p class="subtitle">Please enter your full name</p>

          <form id="nameForm">
            <div class="form-group">
              <label for="firstName">First Name</label>
              <input type="text" id="firstName" name="firstName" required autocomplete="given-name">
            </div>

            <div class="form-group">
              <label for="lastName">Last Name</label>
              <input type="text" id="lastName" name="lastName" required autocomplete="family-name">
            </div>

            <button type="submit" id="submitBtn">Submit</button>
          </form>

          <div class="success" id="successMessage">
            ✓ Thanks! Your name has been saved.
          </div>
          <div class="error" id="errorMessage"></div>
        </div>

        <script>
          const form = document.getElementById('nameForm');
          const submitBtn = document.getElementById('submitBtn');
          const errorMessage = document.getElementById('errorMessage');
          const successMessage = document.getElementById('successMessage');
          const callSid = '${callSid}';

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            errorMessage.style.display = 'none';

            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();

            try {
              const response = await fetch('/api/name-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callSid, firstName, lastName })
              });

              const result = await response.json();

              if (response.ok) {
                form.style.display = 'none';
                successMessage.style.display = 'block';
              } else {
                throw new Error(result.error || 'Failed to save name');
              }
            } catch (err) {
              console.error(err);
              errorMessage.textContent = err.message || 'Failed to save. Please try again.';
              errorMessage.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit';
            }
          });
        </script>
      </body>
      </html>
    `);
  });

  /**
   * GET /verify-details - Post-call data verification form
   */
  app.get("/verify-details", async (req: Request, res: Response) => {
    const { callSid } = req.query;

    if (!callSid) {
      return res.status(400).send('<h1>Invalid Link</h1><p>Missing call information</p>');
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Verify Details - Echo Desk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            max-width: 400px;
            width: 100%;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 32px;
          }
          h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
            text-align: center;
          }
          .subtitle {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-bottom: 32px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            font-weight: 600;
            color: #333;
            margin-bottom: 8px;
            font-size: 14px;
          }
          input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
          }
          input:focus {
            outline: none;
            border-color: #667eea;
          }
          button {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          }
          button:hover {
            transform: translateY(-2px);
          }
          button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
          }
          .success {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            display: none;
            text-align: center;
          }
          .error {
            background: #ffebee;
            color: #d32f2f;
            padding: 12px;
            border-radius: 8px;
            margin-top: 12px;
            display: none;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ Verify Your Details</h1>
          <p class="subtitle">Please confirm your information</p>

          <form id="detailsForm">
            <div class="form-group">
              <label for="firstName">First Name</label>
              <input type="text" id="firstName" name="firstName" required autocomplete="given-name">
            </div>

            <div class="form-group">
              <label for="lastName">Last Name</label>
              <input type="text" id="lastName" name="lastName" required autocomplete="family-name">
            </div>

            <div class="form-group">
              <label for="email">Email Address</label>
              <input type="email" id="email" name="email" required autocomplete="email" placeholder="your.email@example.com">
            </div>

            <button type="submit" id="submitBtn">Submit</button>
          </form>

          <div class="success" id="successMessage">
            ✓ Thanks! Your details have been saved.
          </div>
          <div class="error" id="errorMessage"></div>
        </div>

        <script>
          const form = document.getElementById('detailsForm');
          const submitBtn = document.getElementById('submitBtn');
          const errorMessage = document.getElementById('errorMessage');
          const successMessage = document.getElementById('successMessage');
          const callSid = '${callSid}';

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';
            errorMessage.style.display = 'none';

            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            const email = document.getElementById('email').value.trim();

            try {
              // Save name
              await fetch('/api/name-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callSid, firstName, lastName })
              });

              // Save email
              await fetch('/api/email-collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callSid, email })
              });

              form.style.display = 'none';
              successMessage.style.display = 'block';
            } catch (err) {
              console.error(err);
              errorMessage.textContent = err.message || 'Failed to save. Please try again.';
              errorMessage.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Submit';
            }
          });
        </script>
      </body>
      </html>
    `);
  });
}
