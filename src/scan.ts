import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';

const client = new Anthropic();

export interface ScanConfig {
  venueTypes: string[];
  technologies: string[];
  projectValues: string[];
  sources: string[];
}

export interface Opportunity {
  id: number;
  priority: 'hot' | 'warm' | 'watch';
  type: string;
  icon: string;
  title: string;
  location: string;
  value: string;
  stage: string;
  announced: string;
  rfpEta: string;
  summary: string;
  sources: { name: string; date: string; snippet: string }[];
  bdFit: string;
}

function send(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildSystemPrompt(config: ScanConfig): string {
  const venues =
    config.venueTypes.length > 0
      ? config.venueTypes.join(', ')
      : 'Stadium, Arena, Airport, Convention Center, Hospital, University';
  const techs =
    config.technologies.length > 0
      ? config.technologies.join(', ')
      : 'DAS, Wi-Fi, 5G, CBRS';
  const values =
    config.projectValues.length > 0
      ? config.projectValues.join(' / ')
      : '$50M+';

  return `You are a BD intelligence agent for StemSmart, a company that provides DAS (Distributed Antenna Systems) and Wi-Fi network solutions for large venues in the United States.

Your task: search the public web for REAL, CURRENT US construction and venue development projects announced or progressed in the last 90 days that will need wireless network infrastructure (DAS, Wi-Fi, 5G/CBRS, neutral-host).

Scan criteria:
- Venue types to target: ${venues}
- Technologies of interest: ${techs}
- Minimum project value: ${values}

Search strategy — run 4-6 distinct searches covering:
1. New stadium or arena construction announcements
2. Airport terminal expansion / new terminal projects
3. Convention center expansion or new builds
4. University campus large capital projects
5. Hospital or healthcare campus expansions
6. Any active technology RFPs for in-building wireless at large venues

For each real opportunity found, extract:
- Confirmed project name, location, owner/developer
- Project budget / value
- Current development stage
- Whether an RFP for technology/DAS/Wi-Fi has been issued or is expected
- Key stakeholders: owner, general contractor, architect, AV/IT consultants
- BD fit score for a DAS/Wi-Fi neutral-host provider like StemSmart

After all searches are complete, return ONLY a valid JSON array — no markdown code fences, no explanation text, just the raw JSON array starting with [ and ending with ].

JSON schema (return 4-6 opportunities):
[
  {
    "priority": "hot" | "warm" | "watch",
    "type": "Stadium" | "Arena" | "Airport" | "Convention Ctr" | "Hospital" | "University" | "Transit Hub" | "Hotel",
    "icon": "single relevant emoji",
    "title": "Full Project Name — Venue/Owner Name",
    "location": "City, ST",
    "value": "$XM" or "$XB",
    "stage": "Concept" | "Planning" | "Design Phase" | "Approved" | "Procurement",
    "announced": "X days ago" | "X weeks ago",
    "rfpEta": "Q# YYYY" | "YYYY+" | "Active — due MMM DD",
    "summary": "2-3 sentences on why this is relevant for a DAS/Wi-Fi provider",
    "sources": [
      { "name": "Publication Name", "date": "Mon DD YYYY", "snippet": "direct quote or key fact from source" }
    ],
    "bdFit": "Specific fit assessment and recommended BD action for StemSmart"
  }
]

Priority definitions:
- hot: Active RFP live now, or procurement / design phase with RFP expected within 6 months
- warm: Project approved and funded, RFP expected 6–18 months out
- watch: Early stage, planning or concept, RFP 18+ months away but worth tracking`;
}

export async function streamScan(config: ScanConfig, res: Response): Promise<void> {
  send(res, { type: 'log', message: '→ Initialising BD intelligence scan...' });

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        'Search for current US construction and venue projects needing DAS/Wi-Fi networks. Run multiple targeted searches. Return ONLY a raw JSON array of opportunities — no other text.',
    },
  ];

  const MAX_ITERATIONS = 6;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(config),
      // web_search_20260209 is a server-side tool — Anthropic runs searches internally
      tools: [{ type: 'web_search_20260209' as any, name: 'web_search' }],
      messages,
    });

    // Track server_tool_use blocks so we can log each search query as it fires
    const pendingInputs = new Map<number, string>(); // block index → accumulated JSON

    for await (const event of stream) {
      const e = event as any;

      // A new server-side tool call is starting
      if (e.type === 'content_block_start' && e.content_block?.type === 'server_tool_use') {
        pendingInputs.set(e.index as number, '');
      }

      // Accumulate the tool input JSON delta by delta
      if (e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
        const idx = e.index as number;
        if (pendingInputs.has(idx)) {
          pendingInputs.set(idx, pendingInputs.get(idx)! + e.delta.partial_json);
        }
      }

      // Tool call finished — parse query and log it
      if (e.type === 'content_block_stop') {
        const idx = e.index as number;
        const accumulated = pendingInputs.get(idx);
        if (accumulated !== undefined) {
          try {
            const parsed = JSON.parse(accumulated) as { query?: string };
            if (parsed.query) {
              send(res, { type: 'log', message: `→ Searching: "${parsed.query}"` });
            }
          } catch {
            send(res, { type: 'log', message: '→ Running web search...' });
          }
          pendingInputs.delete(idx);
        }
      }
    }

    const finalMsg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: finalMsg.content });

    if (finalMsg.stop_reason === 'end_turn') {
      // Extract the JSON array from the response text
      const textBlock = finalMsg.content.find((b) => b.type === 'text');
      if (textBlock?.type === 'text') {
        send(res, { type: 'log', message: '→ Analysing and scoring opportunities...' });

        const raw = textBlock.text.trim();
        // Strip markdown fences if the model included them despite instructions
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          try {
            const opportunities = JSON.parse(jsonMatch[0]) as Partial<Opportunity>[];
            const count = opportunities.length;
            send(res, {
              type: 'log',
              message: `✓ Scan complete — ${count} opportunit${count !== 1 ? 'ies' : 'y'} found`,
            });
            for (let i = 0; i < opportunities.length; i++) {
              send(res, { type: 'opportunity', data: { ...opportunities[i], id: i + 1 } });
            }
          } catch (parseErr) {
            send(res, { type: 'error', message: 'Failed to parse opportunity data from AI response' });
          }
        } else {
          send(res, { type: 'error', message: 'No structured data returned — try again' });
        }
      }

      send(res, { type: 'done' });
      return;
    }

    if (finalMsg.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its internal limit; re-send to continue
      send(res, { type: 'log', message: '→ Continuing search pass...' });
      continue;
    }

    // Unexpected stop — bail out
    break;
  }

  send(res, { type: 'done' });
}
