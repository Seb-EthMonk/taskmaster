/**
 * Chat Router - Model routing for LLM providers
 * Routes chat requests to appropriate LLM APIs
 * 
 * POST /api/chat - Route to appropriate LLM
 * Body: { model, messages, systemPrompt, projectContext }
 * 
 * GET /api/chat/models - List available models
 */

import { Router } from 'express';

const router = Router();

// Project context type
interface ProjectContext {
  projectId?: string;
  projectName?: string;
  currentTier?: number;
  status?: string;
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    agent?: string;
    tier?: number;
  }>;
  agents?: Array<{
    name: string;
    taskId: string;
    pid: number;
  }>;
  logs?: Array<{
    agent: string;
    tag: string;
    timestamp: string;
    context: string;
    description: string;
  }>;
}

// Message type
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Model configurations (read from environment or config)
const MODEL_CONFIG = {
  claude: {
    name: 'Claude',
    enabled: !!process.env.ANTHROPIC_API_KEY,
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
    mcp: true  // 🪄 Full MCP access
  },
  kimi: {
    name: 'Kimi Code',
    enabled: !!process.env.KIMI_API_KEY,
    apiKey: process.env.KIMI_API_KEY,
    baseUrl: process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding/',
    model: process.env.KIMI_MODEL || 'kimi-k2.5',
    mcp: true  // 🪄 Full MCP access
  },
  gpt: {
    name: 'GPT-4',
    enabled: !!process.env.OPENAI_API_KEY,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4',
    mcp: false  // 💬 Read-only
  },
  gemini: {
    name: 'Gemini',
    enabled: !!process.env.GOOGLE_API_KEY,
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-pro',
    mcp: false  // 💬 Read-only
  },
  local: {
    name: 'Local (Ollama)',
    enabled: true, // Always attempt, may fail if not running
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama2',
    mcp: false  // 💬 Read-only
  }
};

// Anthropic-format tool definitions for Taskmaster API
const TASKMASTER_TOOLS = [
  {
    name: 'list_projects',
    description: 'List all TaskMaster projects with their status, tier, and task counts.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_project',
    description: 'Get full details for a specific project including all tasks.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' }
      },
      required: ['projectId']
    }
  },
  {
    name: 'list_agents',
    description: 'List all available agents and their capabilities.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_running_agents',
    description: 'Get currently running agents with their PIDs and assigned tasks.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'create_task',
    description: 'Create a new task in a project.',
    input_schema: {
      type: 'object',
      properties: {
        projectId:   { type: 'string', description: 'Project ID to add the task to' },
        title:       { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        tier:        { type: 'number', description: 'Task tier (0-5)' },
        priority:    { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
      },
      required: ['projectId', 'title']
    }
  },
  {
    name: 'update_task',
    description: 'Update a task status or details.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        taskId:    { type: 'string', description: 'Task ID' },
        status:    { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed'] },
        priority:  { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        title:     { type: 'string' },
        description: { type: 'string' }
      },
      required: ['projectId', 'taskId']
    }
  },
  {
    name: 'spawn_agent',
    description: 'Spawn an agent to work on a task.',
    input_schema: {
      type: 'object',
      properties: {
        agentId:   { type: 'string', description: 'Agent ID to spawn (e.g. "coder", "artist")' },
        projectId: { type: 'string', description: 'Project ID' },
        taskId:    { type: 'string', description: 'Task ID for the agent to work on' }
      },
      required: ['agentId']
    }
  },
  {
    name: 'terminate_agent',
    description: 'Terminate a running agent by its process ID.',
    input_schema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process ID of the agent to terminate' }
      },
      required: ['pid']
    }
  },
  {
    name: 'get_project_logs',
    description: 'Get recent activity logs for a project.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        limit:     { type: 'number', description: 'Number of log entries to return (default 20)' }
      },
      required: ['projectId']
    }
  }
] as const;

// Execute a tool call against the Taskmaster REST API
async function executeToolCall(toolName: string, toolInput: any, baseUrl: string): Promise<string> {
  try {
    switch (toolName) {
      case 'list_projects': {
        const r = await fetch(`${baseUrl}/api/projects`);
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'get_project': {
        const r = await fetch(`${baseUrl}/api/projects/${toolInput.projectId}`);
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'list_agents': {
        const r = await fetch(`${baseUrl}/api/agents`);
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'get_running_agents': {
        const r = await fetch(`${baseUrl}/api/agents/status/running`);
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'create_task': {
        const { projectId, ...body } = toolInput;
        const r = await fetch(`${baseUrl}/api/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'update_task': {
        const { projectId, taskId, ...body } = toolInput;
        const r = await fetch(`${baseUrl}/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'spawn_agent': {
        const { agentId, ...body } = toolInput;
        const r = await fetch(`${baseUrl}/api/agents/${agentId}/spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'terminate_agent': {
        const r = await fetch(`${baseUrl}/api/agents/${toolInput.pid}/terminate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        return JSON.stringify(await r.json(), null, 2);
      }
      case 'get_project_logs': {
        const limit = toolInput.limit || 20;
        const r = await fetch(`${baseUrl}/api/logs/agent/projects/${toolInput.projectId}?limit=${limit}`);
        return JSON.stringify(await r.json(), null, 2);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Tool execution failed' });
  }
}

// MCP Tools notice injected into system prompt
const MCP_TOOLS = `
You have access to Taskmaster tools and can call them directly. Use them when the user asks about projects, tasks, or agents — or when you need fresh data to answer accurately.

Available tools: list_projects, get_project, list_agents, get_running_agents, create_task, update_task, spawn_agent, terminate_agent, get_project_logs.

Always confirm before executing destructive operations (spawn, terminate, update).
`;

const READ_ONLY_NOTICE = `
You are in read-only mode. You can see the project state and help plan,
suggest tasks, and review work, but cannot execute actions directly.
Suggest actions and I'll help you implement them.
`;

/**
 * Build context from projectContext for LLM system prompt
 */
function buildContext(projectContext?: ProjectContext): string {
  if (!projectContext) {
    return '';
  }

  const { projectId, projectName, currentTier, status, tasks, agents, logs } = projectContext;
  
  if (!projectId) {
    return '';
  }

  let context = `You are assisting with a TaskMaster project.\n\n`;
  context += `ACTIVE PROJECT: ${projectName || projectId} (ID: ${projectId})\n`;
  context += `CURRENT TIER: ${currentTier ?? 0}\n`;
  context += `STATUS: ${status || 'active'}\n\n`;

  // Active tasks
  if (tasks && tasks.length > 0) {
    const activeTasks = tasks.filter(t => t.status !== 'done');
    context += `ACTIVE TASKS (${activeTasks.length}):\n`;
    for (const task of activeTasks) {
      const symbol = task.status === 'in_progress' ? '⟳' : '○';
      const agentInfo = task.agent ? ` — ${task.agent}` : '';
      context += `[${symbol} ${task.id}] ${task.status} — ${task.title}${agentInfo}\n`;
    }
    context += '\n';
  }

  // Active agents
  if (agents && agents.length > 0) {
    context += `ACTIVE AGENTS:\n`;
    for (const agent of agents) {
      context += `- ${agent.name} working on ${agent.taskId} (PID: ${agent.pid})\n`;
    }
    context += '\n';
  }

  // Recent logs
  if (logs && logs.length > 0) {
    context += `RECENT LOGS:\n`;
    const recentLogs = logs.slice(-10); // Last 10 logs
    for (const log of recentLogs) {
      context += `[AGENT: ${log.tag}] ${log.timestamp} | ${log.context} | ${log.description}\n`;
    }
  }

  return context;
}

/**
 * POST /api/chat
 * Route chat request to appropriate LLM provider
 * Body: { model, messages, systemPrompt, projectContext }
 */
router.post('/', async (req, res) => {
  const { model, messages, systemPrompt, projectContext, apiKey, baseUrl, modelName } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Model is required' });
  }

  if (!MODEL_CONFIG[model as keyof typeof MODEL_CONFIG]) {
    return res.status(400).json({ error: `Unknown model: ${model}` });
  }

  // Start with server config, then overlay any client-provided values from app settings
  const config = { ...MODEL_CONFIG[model as keyof typeof MODEL_CONFIG] } as any;
  if (apiKey) {
    config.apiKey = apiKey;
    config.enabled = true;
  }
  if (baseUrl) config.baseUrl = baseUrl;
  if (modelName) config.model = modelName;

  if (!config.enabled) {
    return res.status(503).json({
      error: `${config.name} not configured`,
      message: `No API key found — add one in the app settings or set ${model.toUpperCase()}_API_KEY on the server`
    });
  }

  // Build full system prompt with context
  const contextSection = buildContext(projectContext);
  const mcpSection = config.mcp ? MCP_TOOLS : READ_ONLY_NOTICE;
  const fullSystemPrompt = systemPrompt 
    ? `${contextSection}\n\n${systemPrompt}\n\n${mcpSection}`
    : `${contextSection}\n\n${mcpSection}`;

  try {
    switch (model) {
      case 'claude':
        return await handleClaude(req, res, config, messages, fullSystemPrompt);
      case 'kimi':
        return await handleKimi(req, res, config, messages, fullSystemPrompt);
      case 'gpt':
        return await handleGPT(req, res, config, messages, fullSystemPrompt);
      case 'gemini':
        return await handleGemini(req, res, config, messages, fullSystemPrompt);
      case 'local':
        return await handleLocal(req, res, config, messages, fullSystemPrompt);
      default:
        return res.status(400).json({ error: `Unsupported model: ${model}` });
    }
  } catch (error) {
    console.error('[Chat] Error:', error);
    return res.status(500).json({
      error: 'Chat request failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/chat/models
 * List available models and their status
 * Returns: { models: [{ id, name, enabled, mcp, indicator }], defaultModel }
 */
router.get('/models', (req, res) => {
  const models = Object.entries(MODEL_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    enabled: config.enabled,
    mcp: config.mcp,
    indicator: config.mcp ? '🪄 Taskmaster Enabled' : '💬 Chat Only'
  }));

  res.json({
    models,
    defaultModel: 'claude'
  });
});

// Shared agentic tool loop for Anthropic-format APIs (Claude + Kimi)
async function runAnthropicWithTools(
  anthropic: any,
  model: string,
  systemPrompt: string,
  initialMessages: any[],
  baseUrl: string
): Promise<string> {
  const MAX_ROUNDS = 6;
  const conversation = [...initialMessages];
  let finalText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: conversation,
      tools: TASKMASTER_TOOLS
    });

    // Collect any text blocks from this turn
    const textBlocks = response.content.filter((b: any) => b.type === 'text');
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b: any) => b.text).join('\n');
    }

    // No tool calls — done
    const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      break;
    }

    // Add assistant turn (contains tool_use blocks) to conversation
    conversation.push({ role: 'assistant', content: response.content });

    // Execute each tool call and collect results
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block: any) => {
        console.log(`[Chat] Tool call: ${block.name}`, block.input);
        const result = await executeToolCall(block.name, block.input, baseUrl);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: result
        };
      })
    );

    // Add tool results as a user turn
    conversation.push({ role: 'user', content: toolResults });
  }

  return finalText || 'No response';
}

// Handler for Kimi (uses Anthropic-compatible API)
async function handleKimi(
  req: any,
  res: any,
  config: any,
  messages: any[],
  systemPrompt: string
) {
  try {
    const Anthropic = await import('@anthropic-ai/sdk').then(m => m.default || m);
    const anthropic = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.kimi.moonshot.cn/v1'
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const formattedMessages = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const text = await runAnthropicWithTools(
      anthropic,
      config.model || 'kimi-k2.5',
      systemPrompt,
      formattedMessages,
      baseUrl
    );

    return res.json({ text, model: config.name });
  } catch (error) {
    console.error('[Chat] Kimi error:', error);
    return res.status(502).json({
      error: 'Kimi API error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Handler for Anthropic Claude
async function handleClaude(
  req: any,
  res: any,
  config: any,
  messages: any[],
  systemPrompt: string
) {
  try {
    const Anthropic = await import('@anthropic-ai/sdk').then(m => m.default || m);
    const anthropic = new Anthropic({ apiKey: config.apiKey });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const formattedMessages = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const text = await runAnthropicWithTools(
      anthropic,
      config.model,
      systemPrompt,
      formattedMessages,
      baseUrl
    );

    return res.json({ text, model: config.name });
  } catch (error) {
    console.error('[Chat] Claude error:', error);
    return res.status(502).json({
      error: 'Claude API error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Handler for OpenAI GPT
async function handleGPT(
  req: any,
  res: any,
  config: any,
  messages: any[],
  systemPrompt: string
) {
  try {
    const OpenAI = await import('openai').then(m => m.default || m);
    const openai = new OpenAI({ apiKey: config.apiKey });

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    const response = await openai.chat.completions.create({
      model: config.model,
      messages: formattedMessages
    });

    const text = response.choices[0]?.message?.content || 'No response';

    return res.json({ text, model: config.name });
  } catch (error) {
    console.error('[Chat] GPT error:', error);
    return res.status(502).json({
      error: 'OpenAI API error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Handler for Google Gemini
async function handleGemini(
  req: any,
  res: any,
  config: any,
  messages: any[],
  systemPrompt: string
) {
  try {
    // Build conversation history for Gemini
    const history = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    // Gemini uses a different API structure
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

    const body = {
      contents: [
        // System prompt as first user message
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...history
      ],
      generationConfig: {
        maxOutputTokens: 4096
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

    return res.json({ text, model: config.name });
  } catch (error) {
    console.error('[Chat] Gemini error:', error);
    return res.status(502).json({
      error: 'Gemini API error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Handler for Local/Ollama models
async function handleLocal(
  req: any,
  res: any,
  config: any,
  messages: any[],
  systemPrompt: string
) {
  try {
    // Build prompt for local models
    const prompt = messages.map(m => 
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    const fullPrompt = `${systemPrompt}\n\n${prompt}\n\nAssistant:`;

    const response = await fetch(`${config.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: fullPrompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.response || 'No response';

    return res.json({ text, model: config.model });
  } catch (error) {
    console.error('[Chat] Local model error:', error);
    return res.status(502).json({
      error: 'Local model error',
      message: 'Could not connect to Ollama. Is it running?'
    });
  }
}

export default router;
