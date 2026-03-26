import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';

const client = new Anthropic();

interface OpportunityInput {
  title?: string;
  location?: string;
  value?: string;
  stage?: string;
  rfpEta?: string;
  summary?: string;
  type?: string;
  bdFit?: string;
  [key: string]: unknown;
}

function send(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function streamAnalysis(opp: OpportunityInput, res: Response): Promise<void> {
  const prompt = `You are a senior BD intelligence analyst for StemSmart, a company that provides DAS (Distributed Antenna Systems), Wi-Fi, and neutral-host 5G/CBRS solutions for large US venues.

Produce a punchy, actionable BD briefing for the following opportunity. Write for a busy marketing and business development team — be specific, avoid fluff.

--- OPPORTUNITY ---
Project: ${opp.title ?? 'Unknown'}
Type: ${opp.type ?? 'Unknown'}
Location: ${opp.location ?? 'Unknown'}
Value: ${opp.value ?? 'Unknown'}
Stage: ${opp.stage ?? 'Unknown'}
RFP ETA: ${opp.rfpEta ?? 'Unknown'}
Summary: ${opp.summary ?? 'None provided'}
BD Fit Note: ${opp.bdFit ?? 'None provided'}
---

Structure your briefing with these five sections. Use bold headers exactly as shown:

**1. Why This Matters**
2–3 sentences on why this opportunity is strategically important for StemSmart. Mention scale, technology relevance, and timing.

**2. Likely Scope**
Bullet-point the DAS/Wi-Fi/5G requirements likely needed — coverage zones, carrier count, Wi-Fi density, broadcast infrastructure, etc.

**3. Immediate Actions**
Exactly 3 specific actions the BD team should take this week. Be concrete (e.g. "Call Turner Construction's technology procurement lead", not "reach out to GC").

**4. Key Contacts to Engage**
List the roles/organisations to approach first — owner, GC, AV/IT consultant, architect of record, technology advisor. Name real firms if known.

**5. Risks & Watch-outs**
2–3 bullet points on competition, procurement complexity, or project risks that could affect StemSmart's chances.`;

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      send(res, { type: 'text', text: event.delta.text });
    }
  }

  send(res, { type: 'done' });
}
