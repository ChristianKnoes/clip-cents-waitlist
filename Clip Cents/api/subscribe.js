// Vercel Serverless Function: /api/subscribe
//
// Receives { name, email } from the Clip Cents landing page form and forwards
// the signup to Buttondown. The Buttondown API key is read from the
// BUTTONDOWN_API_KEY environment variable set in the Vercel dashboard — it is
// NEVER sent to the client.
//
// Tags each new signup so you can segment course-seller agency leads from any
// future audiences you build in Buttondown.

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic rate-limit-friendly input parsing
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const name = (body.name || '').toString().trim().slice(0, 120);
  const email = (body.email || '').toString().trim().toLowerCase().slice(0, 254);

  // Validate
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !emailOk) {
    return res.status(400).json({ error: 'Invalid name or email' });
  }

  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    console.error('Missing BUTTONDOWN_API_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    const bdRes = await fetch('https://api.buttondown.com/v1/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        type: 'regular',
        tags: ['agency-lead', 'course-seller'],
        notes: `Name: ${name} · Source: clipcents.app landing page`,
        metadata: {
          name,
          source: 'landing-page',
          signup_at: new Date().toISOString(),
        },
      }),
    });

    // 201 = created. 400 with already-subscribed message is common and safe to treat as success.
    if (bdRes.ok) {
      return res.status(200).json({ ok: true });
    }

    // Read error details for logs; still return a user-friendly response.
    const detail = await bdRes.text().catch(() => '');
    const alreadyExists = bdRes.status === 400 && /already|exists|duplicate/i.test(detail);

    if (alreadyExists) {
      // Treat duplicates as success so the visitor sees confirmation.
      return res.status(200).json({ ok: true, duplicate: true });
    }

    console.error('Buttondown error', bdRes.status, detail);
    return res.status(502).json({ error: 'Upstream error' });
  } catch (err) {
    console.error('Subscribe handler error', err);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
