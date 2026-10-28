/**
 * AI provider connectors.
 *
 * Each provider is a plain object: { id, name, keyEnv, models, chat(model, messages) }.
 * Keys are held ONLY in the main process (memory + optional .env file) and are
 * never exposed to the renderer.
 *
 * To plug in YOUR OWN model: add an entry below with a `chat` function that
 * calls your endpoint and returns a string. Everything else — agent actions,
 * file writing, terminal — works with it automatically.
 */
const fs = require('fs');
const path = require('path');

// ---------- key store ----------
const runtimeKeys = new Map();

function loadKeysFromEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) runtimeKeys.set(k, v);
    }
  } catch {}
}

function getKey(envName) {
  if (!envName) return null;
  return runtimeKeys.get(envName) || process.env[envName] || null;
}

function setKey(envName, value) {
  if (!envName) return false;
  if (value) runtimeKeys.set(envName, String(value).trim());
  else runtimeKeys.delete(envName);
  return true;
}

// ---------- helpers ----------
async function postJSON(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Provider returned non-JSON response');
  }
}

function textOf(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  return { sys, turns };
}

// ---------- OpenAI-compatible connector factory ----------
function openaiCompatible({ id, name, description, keyEnv, baseUrl, models, defaultModel, docs }) {
  return {
    id, name, description, keyEnv, models, docs,
    async chat(model, messages) {
      const data = await postJSON(
        baseUrl,
        { Authorization: `Bearer ${getKey(keyEnv)}` },
        { model: model || defaultModel, messages }
      );
      return data.choices?.[0]?.message?.content ?? '(empty response)';
    }
  };
}

// ---------- Anthropic ----------
const anthropic = {
  id: 'anthropic',
  name: 'Claude',
  vendor: 'Anthropic',
  description: 'Claude models via the Anthropic Messages API.',
  keyEnv: 'ANTHROPIC_API_KEY',
  docs: 'https://console.anthropic.com/settings/keys',
  models: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
  ],
  async chat(model, messages) {
    const { sys, turns } = textOf(messages);
    const data = await postJSON(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': getKey('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      {
        model: model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(sys ? { system: sys } : {}),
        messages: turns.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      }
    );
    return (data.content || []).map((c) => c.text || '').join('') || '(empty response)';
  }
};

// ---------- Gemini ----------
const gemini = {
  id: 'gemini',
  name: 'Gemini',
  vendor: 'Google',
  description: 'Gemini models via the Generative Language API.',
  keyEnv: 'GEMINI_API_KEY',
  docs: 'https://aistudio.google.com/app/apikey',
  models: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
  ],
  async chat(model, messages) {
    const { sys, turns } = textOf(messages);
    const m = model || 'gemini-2.5-flash';
    const data = await postJSON(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(getKey('GEMINI_API_KEY') || '')}`,
      {},
      {
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        contents: turns.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }]
        }))
      }
    );
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text || '').join('') || '(empty response)';
  }
};

// ---------- built-in engine (works with no key) ----------
const builtin = require('./builtin.cjs');

// ---------- registry ----------
const PROVIDERS = [
  builtin,
  anthropic,
  openaiCompatible({
    id: 'openai', name: 'ChatGPT', vendor: 'OpenAI',
    description: 'GPT models via the OpenAI Chat Completions API.',
    keyEnv: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1/chat/completions',
    docs: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o4-mini', name: 'o4-mini (reasoning)' }
    ]
  }),
  openaiCompatible({
    id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity',
    description: 'Search-augmented Sonar models.',
    keyEnv: 'PERPLEXITY_API_KEY', baseUrl: 'https://api.perplexity.ai/chat/completions',
    docs: 'https://www.perplexity.ai/settings/api',
    defaultModel: 'sonar',
    models: [
      { id: 'sonar', name: 'Sonar' },
      { id: 'sonar-pro', name: 'Sonar Pro' },
      { id: 'sonar-reasoning', name: 'Sonar Reasoning' }
    ]
  }),
  gemini,
  openaiCompatible({
    id: 'groq', name: 'Groq', vendor: 'Groq',
    description: 'Very fast Llama inference.',
    keyEnv: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    docs: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' }
    ]
  })
];

function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    vendor: p.vendor || p.name,
    description: p.description,
    keyEnv: p.keyEnv,
    docs: p.docs || null,
    models: p.models,
    ready: p.keyEnv ? Boolean(getKey(p.keyEnv)) : true,
    plugin: Boolean(p.pluginId)
  }));
}

/**
 * Plugin API — lets a plugin register a new AI provider at runtime.
 * Re-registering the same id replaces it (hot reload).
 */
function registerProvider(provider, pluginId) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.chat !== 'function') {
    throw new Error('provider plugin must export { id, chat(model, messages) }');
  }
  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    throw new Error(`provider plugin "${provider.id}" must export a non-empty models array`);
  }
  const wrapped = { ...provider, pluginId: pluginId || provider.id };
  const i = PROVIDERS.findIndex((p) => p.id === wrapped.id);
  if (i >= 0) PROVIDERS[i] = wrapped;
  else PROVIDERS.push(wrapped);
  return wrapped;
}

function unregisterProvider(id) {
  const i = PROVIDERS.findIndex((p) => p.id === id);
  if (i >= 0) { PROVIDERS.splice(i, 1); return true; }
  return false;
}

function hasProvider(id) {
  return PROVIDERS.some((p) => p.id === id);
}

async function chat(providerId, model, messages) {
  const p = PROVIDERS.find((x) => x.id === providerId) || PROVIDERS[0];
  if (p.keyEnv && !getKey(p.keyEnv)) {
    const err = new Error(
      `${p.name} is not connected yet. Add your ${p.keyEnv} in Settings (or in dev-studio.env next to the app) and try again.`
    );
    err.code = 'NO_KEY';
    throw err;
  }
  return p.chat(model, messages);
}

module.exports = {
  PROVIDERS, listProviders, chat, getKey, setKey, loadKeysFromEnvFile,
  registerProvider, unregisterProvider, hasProvider, envFilePath: path
};
