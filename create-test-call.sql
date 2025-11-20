-- Insert a test call with realistic transcript for QA Engine demo
INSERT INTO call_logs (
  tenant_id,
  conversation_id,
  call_sid,
  from_number,
  to_number,
  intent,
  summary,
  recording_status,
  transcript,
  duration,
  created_at
) VALUES (
  1,
  100,
  'QA_TEST_CALL_001',
  '+61412345678',
  '+61712345678',
  'book_appointment',
  'New patient Sarah booked appointment for tomorrow 9am',
  'completed',
  'AI: Thanks for calling. Is this your first visit with us?

Caller: Yes, it''s my first time.

AI: Perfect! I''ll send you a text with a link to fill out a quick form. Is the number ending in 678 the best one to text you at? Press 1 for yes, 2 for no.

Caller: Yes, that''s fine.

AI: Great! I''ve sent you a text with a link. I''ll wait right here while you fill it out - takes about 30 seconds.

[Caller fills out form]

AI: Got it! Thanks Sarah. What brings you in today?

Caller: I''ve been having some lower back pain for about a week now.

AI: Sorry to hear about your back pain. Let me find the next available appointment.

AI: I have 3 options available. Option 1: 9:00am tomorrow morning. Option 2: 2:30pm tomorrow afternoon. Option 3: 10:00am Monday morning. Which works best? Press 1, 2, or 3.

Caller: I''ll take option 1, 9am tomorrow.

AI: Sarah, perfect! You''re all set for 9:00am tomorrow with Dr. Michael. I''ll text you a confirmation now.

Caller: Great, thank you!

AI: Anything else I can help with?

Caller: No, that''s all. Thanks!

AI: Perfect! See you soon. Bye!',
  180,
  NOW()
);
