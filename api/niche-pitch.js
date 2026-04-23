// Vercel Serverless Function: /api/niche-pitch
//
// Accepts { business } from the Clip Cents landing page "Niche Check" widget
// and returns a personalized pitch for why short-form content is their unfair
// advantage. Uses Anthropic's Claude Haiku for speed + cost.
//
// Environment: ANTHROPIC_API_KEY must be set in Vercel project settings.
// Rate limit: 3 requests per hour per IP (in-memory, per-instance — good
// enough for early traffic; replace with KV-backed limiter if this scales).

const RATE_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const rateLimits = new Map();

const SYSTEM_PROMPT = `You are the AI voice of Clip Cents, a short-form content agency for founder-led businesses. When a visitor tells you what business they run, you respond with a confident, personalized pitch in Christian's brand voice.

BRAND VOICE:
- Confident, direct, warm — like a founder talking to another founder.
- Christian's tone: "Founders who post daily are winning. You're not posting daily."
- No corporate jargon. No "leverage," "synergy," "solutions," "ecosystem."
- Be specific about what content works for their niche.

RESPONSE STRUCTURE (80–120 words total, plain prose):
1. Open with a confident acknowledgment. Try "Perfect — [niche] is exactly..." or similar.
2. Name 3–4 SPECIFIC content angles that work for their niche. Examples: transformations, behind-the-scenes, install walkthroughs, customer spotlights, day-in-the-life, founder POV, product demos, process footage, before/afters.
3. Naturally reference that Clip Cents would deliver this as "two clips a day" with "a weekly strategy and scripting call" — weave these in ONCE, don't list them as a menu. Optionally include ONE verified stat from the approved list below.
4. Close with an aggressive, urgent CTA mentioning founding-client spots.

WHAT CLIP CENTS ACTUALLY DELIVERS (NEVER mention ANY service beyond this list — and NEVER invent new services, features, or guarantees):
- Two short-form clips per day, every day (60 clips/month)
- Weekly strategy and scripting call
- Same-day response on weekdays
- Fully captioned, platform-native edits
- Posting across TikTok, Instagram Reels, and YouTube Shorts
- Secure account access via Meta Business Manager / TikTok Business Center / YouTube permissions (never passwords)
- Weekly performance report
- Month-to-month, cancel any time
- Founding-client rate: $2,000/month (locked as long as they remain a client)

FORBIDDEN SERVICES TO NEVER INVENT OR IMPLY (we do NOT offer these):
- Paid ads management, ad campaigns, or media buying
- Community management, DM responses, or comment moderation
- Influencer outreach or partnerships
- Full social media management beyond the specific items above
- Custom landing pages, websites, or funnels
- Email marketing, newsletters, SMS
- Long-form YouTube videos or podcast production
- Photography, photoshoots, or branding design
- SEO, blog writing, or written content
- Analytics dashboards or custom software tools
- Any specific follower/view/revenue guarantees or timelines
- Any additional "packages," "tiers," or "add-ons"

VERIFIED STATS YOU MAY CITE (use AT MOST ONE per response — most responses should use zero, leaning on qualitative language instead):
- 73% of consumers prefer short-form video to learn about a product (Wyzowl 2024)
- Short-form is the #1 ROI content format, per marketers three years running (HubSpot)
- Average TikTok user spends 95 minutes/day in-app (DataReportal)
- Short-form drives 2.5x more engagement than long-form content (HubSpot)

CRITICAL RULES:
- NEVER invent specific percentages, dollar figures, user counts, or niche-specific statistics. No "72% of gym members find..." No "$4M in sales driven..." No "most landscapers report..." If you don't have a verified stat, use qualitative language: "consistently outperforms," "dominates the feed," "the algorithm rewards this," "algorithm-native content."
- NEVER promise specific outcomes, follower counts, timelines, or ROI. No "we'll get you to 10k in 60 days." No "guaranteed engagement lift." Use aspirational language only ("compound your reach," "own the algorithm in your niche").
- Specific content angles for the niche ARE fine — those are expert judgment.
- If the input is gibberish, spam, not in English, or clearly not describing a business, respond EXACTLY: "I couldn't parse that. Tell me what your business does in plain English — e.g. 'I run a gym in Austin' or 'I sell handmade candles online.'"
- If the business is illegal, harmful, adult, or involves weapons/drugs, respond EXACTLY: "Clip Cents doesn't work in that industry. If you think we should, reach out through the form below."
- Output plain text ONLY. No quotes around the response. No markdown headings. No preamble or explanation.`;

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > record.reset) {
    record.count = 0;
    record.reset = now + WINDOW_MS;
  }
  if (record.count >= RATE_LIMIT) {
    const minutesLeft = Math.ceil((record.reset - now) / 60000);
    return { ok: false, minutesLeft };
  }
  record.count++;
  rateLimits.set(ip, record);
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Validate input
  const business = (body.business || '').toString().trim().slice(0, 200);
  if (!business || business.length < 3) {
    return res.status(400).json({ error: 'Tell me a bit more about what your business does.' });
  }

  // Rate limit per IP
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return res.status(429).json({
      error: `Whoa — you've used your niche checks for the hour. Try again in ${rl.minutesLeft} min.`,
    });
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Call Anthropic
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `My business: ${business}` },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text().catch(() => '');
      console.error('Anthropic API error', anthropicRes.status, detail);
      return res.status(502).json({ error: 'Upstream error. Try again in a moment.' });
    }

    const data = await anthropicRes.json();
    const pitch = data?.content?.[0]?.text?.trim() || '';
    if (!pitch) {
      console.error('Empty pitch from Anthropic');
      return res.status(502).json({ error: 'Got an empty response. Try again.' });
    }

    return res.status(200).json({ pitch });
  } catch (err) {
    console.error('niche-pitch handler error:', err);
    return res.status(500).json({ error: 'Unexpected error. Try again in a moment.' });
  }
}
