import { Express, Request, Response } from "express";
import { storage } from "../storage";

/**
 * Form collection routes
 * Handles new patient intake forms sent via SMS
 */
export function registerForms(app: Express) {

  /**
   * GET /intake/:token
   * Displays the new patient intake form
   */
  app.get("/intake/:token", async (req: Request, res: Response) => {
    const { token } = req.params;

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

    // Check if form already completed
    try {
      const callSid = token.split('_')[1];
      const call = await storage.getCallByCallSid(callSid);

      if (call?.conversationId) {
        const conversation = await storage.getConversation(call.conversationId);
        const context = conversation?.context as any;

        if (context?.formData) {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Form Already Submitted</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
                .success { color: #2e7d32; background: #e8f5e9; padding: 20px; border-radius: 8px; }
              </style>
            </head>
            <body>
              <div class="success">
                <h2>✓ Form Already Submitted</h2>
                <p>Thanks ${context.formData.firstName}! Your details have already been received.</p>
              </div>
            </body>
            </html>
          `);
        }
      }
    } catch (err) {
      console.error('[GET /intake/:token] Error checking form status:', err);
    }

    // Display form
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
          <h1>Welcome to Echo Desk</h1>
          <p class="subtitle">Please complete your details below (takes 30 seconds)</p>

          <form id="intakeForm">
            <div class="form-group">
              <label for="firstName">First Name <span class="required">*</span></label>
              <input type="text" id="firstName" name="firstName" required autocomplete="given-name">
            </div>

            <div class="form-group">
              <label for="lastName">Last Name <span class="required">*</span></label>
              <input type="text" id="lastName" name="lastName" required autocomplete="family-name">
            </div>

            <div class="form-group">
              <label for="email">Email Address <span class="required">*</span></label>
              <input type="email" id="email" name="email" required autocomplete="email">
            </div>

            <div class="form-group">
              <label for="phone">Mobile Number <span class="required">*</span></label>
              <input type="tel" id="phone" name="phone" required autocomplete="tel" placeholder="04XX XXX XXX">
            </div>

            <button type="submit" id="submitBtn">
              <span id="btnText">Submit</span>
              <span id="btnSpinner" class="spinner" style="display:none;"></span>
            </button>
          </form>

          <div class="error-message" id="errorMessage"></div>
          <div class="success-message" id="successMessage">
            ✓ Thanks! Your details have been received. You can return to your call now.
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
   */
  app.post("/api/forms/submit", async (req: Request, res: Response) => {
    try {
      const { token, firstName, lastName, email, phone } = req.body;

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
      console.log('[POST /api/forms/submit]   - callSid:', callSid);
      console.log('[POST /api/forms/submit]   - conversationId:', call.conversationId);
      console.log('[POST /api/forms/submit]   - formData:', formData);

      await storage.updateConversation(call.conversationId, {
        context: {
          formToken: token,
          formData: formData,
          formSubmittedAt: new Date().toISOString()
        }
      });

      console.log('[POST /api/forms/submit] ✅ Form data stored successfully');

      res.json({
        success: true,
        message: 'Form submitted successfully'
      });

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
