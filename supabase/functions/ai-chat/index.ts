/**
 * AlpasFarm AI Chat — Supabase Edge Function
 * URL: https://bsotlxbvanpwengftfli.supabase.co/functions/v1/ai-chat
 *
 * Calls Groq API server-side. GROQ_API_KEY is a Supabase secret, never exposed to browser.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = Deno.env.get('GROQ_MODEL') ?? 'llama-3.1-8b-instant';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'AI not configured. Add GROQ_API_KEY to Supabase secrets.', code: 'NO_API_KEY' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { messages?: Array<{ role: string; content: string }>; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { messages = [] } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array is required.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate messages
  for (const msg of messages) {
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return new Response(JSON.stringify({ error: 'Invalid message role.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const groqResp = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages.slice(-20),
        stream: false,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text().catch(() => '');
      console.error('Groq error:', groqResp.status, errText.slice(0, 200));

      if (groqResp.status === 401) {
        return new Response(JSON.stringify({ error: 'Invalid Groq API key.', code: 'INVALID_KEY' }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (groqResp.status === 429) {
        return new Response(JSON.stringify({ error: 'AI busy. Try again in a moment.', code: 'RATE_LIMIT' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: `AI error (${groqResp.status}). Please try again.`, code: 'PROVIDER_ERROR' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await groqResp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';

    // Return as SSE so the existing FloatingAICloud streaming parser works
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Emit word by word to simulate streaming
        const words = content.split(' ');
        for (let i = 0; i < words.length; i++) {
          const token = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: 'AI encountered an unexpected error. Please try again.', code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
