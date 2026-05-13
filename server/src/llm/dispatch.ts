export interface LLMProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

export async function callLLM(
  provider: LLMProviderConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!provider.apiKey) throw new Error(`No API key configured for provider "${provider.id}"`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: provider.maxTokens,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 5000));
      return callLLM(provider, systemPrompt, userPrompt);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Provider error ${res.status}: ${body}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timer);
  }
}
