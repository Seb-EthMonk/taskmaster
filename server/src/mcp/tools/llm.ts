import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callLLM } from '../../llm/dispatch.js';
import { loadSettings } from '../../routes/settings.js';

const DEFAULT_SYSTEM = 'You are a specialist assistant. Answer clearly and thoroughly.';

export function registerLLMTools(server: McpServer) {
  server.registerTool(
    'call_llm',
    {
      title: 'Call External LLM',
      description: [
        'Call an external LLM provider via OpenAI-compatible API.',
        'Use this to delegate subtasks to cheaper or faster models — file reading, research synthesis, coding.',
        'Pass files[] to have the server read and inline file contents before sending.',
        'Check available provider IDs in Model Settings (GET /api/settings).',
        'Common providers: kimi (long-context research), gemini-flash (fast ingestion), deepseek (coding), deepseek-v4-pro (coding via PPQ), deepseek-reasoner (step-by-step reasoning).'
      ].join(' '),
      inputSchema: z.object({
        provider: z.string().describe('Provider ID (e.g. "kimi", "gemini-flash", "deepseek", "deepseek-v4-pro", "deepseek-reasoner")'),
        prompt: z.string().describe('The task or question for the model'),
        system: z.string().optional().describe('System prompt override'),
        files: z.array(z.string()).optional().describe('Absolute file paths — server reads and inlines content into the prompt'),
      }),
    },
    async ({ provider: providerId, prompt, system, files }) => {
      try {
        const settings = await loadSettings();
        const provider = settings.providers.find(p => p.id === providerId);

        if (!provider) {
          const available = settings.providers.map(p => p.id).join(', ');
          return { content: [{ type: 'text' as const, text: `Error: unknown provider "${providerId}". Available: ${available}` }] };
        }

        if (!provider.apiKey) {
          return { content: [{ type: 'text' as const, text: `Error: no API key configured for provider "${providerId}". Add it in Model Settings.` }] };
        }

        let builtPrompt = prompt;

        if (files && files.length > 0) {
          const fileBlocks: string[] = [];
          for (const filePath of files) {
            try {
              const content = await readFile(filePath, 'utf-8');
              fileBlocks.push(`\`\`\`\nFILE: ${filePath}\n${content}\n\`\`\``);
            } catch {
              fileBlocks.push(`[Could not read file: ${filePath}]`);
            }
          }
          builtPrompt = fileBlocks.join('\n\n') + '\n\n' + prompt;
        }

        const response = await callLLM(provider, system ?? DEFAULT_SYSTEM, builtPrompt);
        return { content: [{ type: 'text' as const, text: response }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    }
  );
}
