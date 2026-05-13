<template>
  <div class="model-settings-view">
    <div class="settings-header">
      <h1>Sub-Models</h1>
      <p class="subtitle">Configure sub-models for agent tool use</p>
    </div>

    <div class="settings-sections">
      <!-- Providers Section -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">🤖</span>
          <div class="section-title">
            <h2>LLM Providers</h2>
            <p class="section-description">Any OpenAI-compatible API endpoint. Used by agents via the <code>call_llm</code> MCP tool or API.</p>
          </div>
        </div>

        <div class="section-content">
          <div v-if="loadError" class="error-message">{{ loadError }}</div>

          <div class="providers-table" v-if="providers.length > 0">
            <div class="table-header">
              <span>Name</span>
              <span>Model</span>
              <span>Max Tokens</span>
              <span>Timeout (ms)</span>
              <span>API Key</span>
              <span>Actions</span>
            </div>

            <div v-for="(p, idx) in providers" :key="p.id" class="provider-row">
              <div v-if="editingIdx === idx" class="provider-edit-form">
                <div class="edit-grid">
                  <div class="form-group">
                    <label>ID</label>
                    <input v-model="editForm.id" type="text" class="form-input" placeholder="e.g. my-model" />
                  </div>
                  <div class="form-group">
                    <label>Name</label>
                    <input v-model="editForm.name" type="text" class="form-input" placeholder="Display name" />
                  </div>
                  <div class="form-group full-width">
                    <label>Base URL</label>
                    <input v-model="editForm.baseUrl" type="text" class="form-input" placeholder="https://api.example.com/v1" />
                  </div>
                  <div class="form-group">
                    <label>Model</label>
                    <input v-model="editForm.model" type="text" class="form-input" placeholder="model-name" />
                  </div>
                  <div class="form-group">
                    <label>Max Tokens</label>
                    <input v-model.number="editForm.maxTokens" type="number" class="form-input" min="1" />
                  </div>
                  <div class="form-group">
                    <label>Timeout (ms)</label>
                    <input v-model.number="editForm.timeoutMs" type="number" class="form-input" min="1000" />
                  </div>
                  <div class="form-group full-width">
                    <label>API Key</label>
                    <input v-model="editForm.apiKey" type="password" class="form-input" placeholder="sk-..." autocomplete="off" />
                  </div>
                </div>
                <div class="edit-actions">
                  <button class="btn-primary" @click="saveEdit(idx)">Save</button>
                  <button class="btn-secondary" @click="cancelEdit">Cancel</button>
                </div>
              </div>

              <template v-else>
                <span class="cell-name">
                  <span class="provider-id">{{ p.id }}</span>
                  <span class="provider-name">{{ p.name }}</span>
                </span>
                <span class="cell">{{ p.model }}</span>
                <span class="cell">{{ p.maxTokens.toLocaleString() }}</span>
                <span class="cell">{{ p.timeoutMs.toLocaleString() }}</span>
                <span class="cell">
                  <span v-if="p.apiKey" class="key-set">●●●●●●●●</span>
                  <span v-else class="key-missing">Not set</span>
                </span>
                <span class="cell-actions">
                  <button class="btn-small" @click="startEdit(idx)">Edit</button>
                  <button
                    class="btn-small btn-test"
                    :disabled="!p.apiKey || testingId === p.id"
                    @click="testProvider(p.id)"
                  >
                    {{ testingId === p.id ? 'Testing…' : 'Test' }}
                  </button>
                  <button class="btn-small btn-danger" @click="deleteProvider(idx)">Delete</button>
                </span>
              </template>
            </div>
          </div>

          <div v-if="testResult" class="test-result" :class="testResult.ok ? 'success' : 'error'">
            <strong>{{ testResult.ok ? '✓' : '✗' }} {{ testResult.providerId }}</strong>
            {{ testResult.ok ? testResult.response : testResult.error }}
          </div>

          <!-- Add Provider -->
          <div v-if="showAddForm" class="add-form">
            <h3>Add Provider</h3>
            <div class="edit-grid">
              <div class="form-group">
                <label>ID <span class="required">*</span></label>
                <input v-model="addForm.id" type="text" class="form-input" placeholder="e.g. ollama-local" />
              </div>
              <div class="form-group">
                <label>Name <span class="required">*</span></label>
                <input v-model="addForm.name" type="text" class="form-input" placeholder="Display name" />
              </div>
              <div class="form-group full-width">
                <label>Base URL <span class="required">*</span></label>
                <input v-model="addForm.baseUrl" type="text" class="form-input" placeholder="https://api.example.com/v1" />
              </div>
              <div class="form-group">
                <label>Model <span class="required">*</span></label>
                <input v-model="addForm.model" type="text" class="form-input" placeholder="model-name" />
              </div>
              <div class="form-group">
                <label>Max Tokens</label>
                <input v-model.number="addForm.maxTokens" type="number" class="form-input" min="1" />
              </div>
              <div class="form-group">
                <label>Timeout (ms)</label>
                <input v-model.number="addForm.timeoutMs" type="number" class="form-input" min="1000" />
              </div>
              <div class="form-group full-width">
                <label>API Key</label>
                <input v-model="addForm.apiKey" type="password" class="form-input" placeholder="sk-..." autocomplete="off" />
              </div>
            </div>
            <div v-if="addError" class="error-message">{{ addError }}</div>
            <div class="edit-actions">
              <button class="btn-primary" @click="saveAdd">Add Provider</button>
              <button class="btn-secondary" @click="showAddForm = false; addError = ''">Cancel</button>
            </div>
          </div>

          <button v-if="!showAddForm" class="btn-secondary add-provider-btn" @click="showAddForm = true">
            + Add Provider
          </button>

          <div v-if="saveMessage" class="save-message" :class="saveMessage.ok ? 'success' : 'error'">
            {{ saveMessage.text }}
          </div>
        </div>
      </section>

      <!-- Category Defaults Section -->
      <section class="settings-section">
        <div class="section-header">
          <span class="section-icon">🎯</span>
          <div class="section-title">
            <h2>Category Defaults</h2>
            <p class="section-description">Suggested provider injected into agent prompts. Agents can override with their own judgment.</p>
          </div>
        </div>

        <div class="section-content">
          <div class="defaults-grid">
            <div class="form-group">
              <label>Research tasks</label>
              <select v-model="modelDefaults.research" class="form-select" @change="saveDefaults">
                <option value="">— none —</option>
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }} — {{ p.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>Coding tasks</label>
              <select v-model="modelDefaults.coding" class="form-select" @change="saveDefaults">
                <option value="">— none —</option>
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }} — {{ p.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>Ingestion tasks</label>
              <select v-model="modelDefaults.ingestion" class="form-select" @change="saveDefaults">
                <option value="">— none —</option>
                <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }} — {{ p.name }}</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- How to use call_llm -->
      <div class="callllm-guide">
        <div class="guide-header">
          <span class="guide-icon">💡</span>
          <h3>How to use <code>call_llm</code></h3>
        </div>
        <ol class="guide-steps">
          <li>
            <strong>Add providers above.</strong> Paste in a base URL, API key, and model name for any OpenAI-compatible endpoint (Gemini, DeepSeek, Kimi, etc.) and set a category default.
          </li>
          <li>
            <strong>Ask Taskmaster to use it.</strong> When creating a project or planning tasks, tell Taskmaster which work to offload. For example: <em>"use call_llm for the research tasks"</em> or <em>"read this large file with the ingestion model."</em>
          </li>
          <li>
            <strong>Good candidates to offload:</strong> reading large codebases or databases, summarising long documents, bulk data ingestion, background research, and any task where a faster or cheaper model is sufficient.
          </li>
        </ol>
        <p class="guide-note">
          Taskmaster always orchestrates. <code>call_llm</code> delegates a subtask to the sub-model and returns the result. Taskmaster stays in control.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface LLMProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

interface ModelDefaults {
  research: string;
  coding: string;
  ingestion: string;
}

const API = 'http://localhost:3000/api';

const providers = ref<LLMProviderConfig[]>([]);
const modelDefaults = ref<ModelDefaults>({ research: '', coding: '', ingestion: '' });
const loadError = ref('');
const saveMessage = ref<{ ok: boolean; text: string } | null>(null);

const editingIdx = ref<number | null>(null);
const editForm = ref<LLMProviderConfig>({ id: '', name: '', baseUrl: '', apiKey: '', model: '', maxTokens: 16000, timeoutMs: 120000 });

const showAddForm = ref(false);
const addForm = ref<LLMProviderConfig>({ id: '', name: '', baseUrl: '', apiKey: '', model: '', maxTokens: 16000, timeoutMs: 120000 });
const addError = ref('');

const testingId = ref('');
const testResult = ref<{ ok: boolean; providerId: string; response?: string; error?: string } | null>(null);

onMounted(loadData);

async function loadData() {
  try {
    const res = await fetch(`${API}/settings`);
    const data = await res.json();
    providers.value = data.settings.providers ?? [];
    modelDefaults.value = data.settings.modelDefaults ?? { research: '', coding: '', ingestion: '' };
  } catch (e) {
    loadError.value = 'Failed to load settings';
  }
}

async function saveProviders() {
  try {
    const res = await fetch(`${API}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: providers.value }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message ?? 'Save failed');
    showSaveMessage(true, 'Saved');
  } catch (e) {
    showSaveMessage(false, e instanceof Error ? e.message : 'Save failed');
  }
}

async function saveDefaults() {
  try {
    await fetch(`${API}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelDefaults: modelDefaults.value }),
    });
  } catch {}
}

function showSaveMessage(ok: boolean, text: string) {
  saveMessage.value = { ok, text };
  setTimeout(() => { saveMessage.value = null; }, 3000);
}

function startEdit(idx: number) {
  editingIdx.value = idx;
  editForm.value = { ...providers.value[idx] };
}

function cancelEdit() {
  editingIdx.value = null;
}

function saveEdit(idx: number) {
  providers.value[idx] = { ...editForm.value };
  editingIdx.value = null;
  saveProviders();
}

function deleteProvider(idx: number) {
  providers.value.splice(idx, 1);
  saveProviders();
}

function saveAdd() {
  addError.value = '';
  if (!addForm.value.id.trim()) { addError.value = 'ID is required'; return; }
  if (!addForm.value.name.trim()) { addError.value = 'Name is required'; return; }
  if (!addForm.value.baseUrl.trim()) { addError.value = 'Base URL is required'; return; }
  if (!addForm.value.model.trim()) { addError.value = 'Model is required'; return; }
  if (providers.value.some(p => p.id === addForm.value.id)) {
    addError.value = `Provider ID "${addForm.value.id}" already exists`;
    return;
  }
  providers.value.push({ ...addForm.value });
  addForm.value = { id: '', name: '', baseUrl: '', apiKey: '', model: '', maxTokens: 16000, timeoutMs: 120000 };
  showAddForm.value = false;
  saveProviders();
}

async function testProvider(providerId: string) {
  testingId.value = providerId;
  testResult.value = null;
  try {
    const res = await fetch(`${API}/settings/test-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    });
    const data = await res.json();
    testResult.value = { ...data, providerId };
  } catch (e) {
    testResult.value = { ok: false, providerId, error: e instanceof Error ? e.message : 'Request failed' };
  } finally {
    testingId.value = '';
    setTimeout(() => { testResult.value = null; }, 6000);
  }
}
</script>

<style scoped>
.model-settings-view {
  padding: 24px;
  max-width: 960px;
}

.settings-header {
  margin-bottom: 32px;
}

.settings-header h1 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.subtitle {
  color: var(--text-secondary);
  margin: 0;
  font-size: 14px;
}

.settings-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-section {
  background: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--bg-highlight);
}

.section-icon {
  font-size: 20px;
  margin-top: 2px;
}

.section-title h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.section-description code {
  background: var(--bg-primary);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}

.section-content {
  padding: 20px 24px;
}

.providers-table {
  border: 1px solid var(--bg-highlight);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 16px;
}

.table-header {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr 1fr 1fr 1.5fr;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg-primary);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.provider-row {
  border-top: 1px solid var(--bg-highlight);
}

.provider-row:not(.editing) {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr 1fr 1fr 1.5fr;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-primary);
}

.cell-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.provider-id {
  font-weight: 600;
  font-family: monospace;
  font-size: 12px;
  color: var(--color-primary);
}

.provider-name {
  font-size: 11px;
  color: var(--text-secondary);
}

.cell {
  font-size: 12px;
  color: var(--text-secondary);
}

.key-set {
  color: #4ade80;
  font-size: 11px;
  letter-spacing: 2px;
}

.key-missing {
  color: #f87171;
  font-size: 11px;
}

.cell-actions {
  display: flex;
  gap: 6px;
}

.provider-edit-form, .add-form {
  padding: 16px;
}

.add-form h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.full-width {
  grid-column: 1 / -1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.required {
  color: #f87171;
}

.form-input, .form-select {
  background: var(--bg-primary);
  border: 1px solid var(--bg-highlight);
  border-radius: 4px;
  padding: 7px 10px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus, .form-select:focus {
  border-color: var(--color-primary);
}

.edit-actions {
  display: flex;
  gap: 8px;
}

.defaults-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.btn-primary {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-primary:hover { opacity: 0.85; }

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--bg-highlight);
  border-radius: 4px;
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-secondary:hover {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.btn-small {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--bg-highlight);
  border-radius: 3px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.btn-small:hover { border-color: var(--text-secondary); }
.btn-small:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-test { color: #38bdf8; border-color: #38bdf8; }
.btn-test:hover:not(:disabled) { background: rgba(56,189,248,0.1); }

.btn-danger { color: #f87171; border-color: #f87171; }
.btn-danger:hover { background: rgba(248,113,113,0.1); }

.add-provider-btn {
  margin-top: 4px;
}

.test-result, .save-message, .error-message {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 13px;
}

.test-result.success, .save-message.success {
  background: rgba(74,222,128,0.1);
  border: 1px solid #4ade80;
  color: #4ade80;
}

.test-result.error, .save-message.error, .error-message {
  background: rgba(248,113,113,0.1);
  border: 1px solid #f87171;
  color: #f87171;
}
/* call_llm guide */
.callllm-guide {
  background-color: var(--bg-surface);
  border: 1px solid var(--bg-highlight);
  border-left: 3px solid var(--color-primary);
  border-radius: 0.75rem;
  padding: 1.25rem 1.5rem;
  margin-top: 0.5rem;
}

.guide-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 0.875rem;
}

.guide-icon {
  font-size: 1.125rem;
  line-height: 1;
}

.guide-header h3 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.guide-header code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  color: var(--color-primary);
}

.guide-steps {
  margin: 0 0 0.875rem 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.guide-steps li {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.55;
}

.guide-steps li strong {
  color: var(--text-primary);
}

.guide-steps li em {
  color: var(--color-primary);
  font-style: normal;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
}

.guide-note {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--bg-highlight);
  line-height: 1.5;
}

.guide-note code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--color-primary);
}
</style>
