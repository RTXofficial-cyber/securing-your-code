/**
 * Official plugin: OpenRouter — a single key that unlocks many hosted models.
 * Demonstrates a keyed provider plugin (keyEnv is read from the same
 * Settings / dev-studio.env mechanism as the built-in connectors).
 */
const { friendlyProviderError } = require('../../shared/providers.cjs');

module.exports = {
  provider: {
    id: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    description: 'Hundreds of hosted models behind one key.',
    keyEnv: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    models: [
      { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra (frontier)' },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' }
    ],
    async chat(model, messages) {
      const key = process.env.OPENROUTER_API_KEY;
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'X-Title': 'Dev Studio'
        },
        body: JSON.stringify({ model: model || 'anthropic/claude-sonnet-4.5', messages })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(friendlyProviderError(res.status, text));
      const d = JSON.parse(text);
      return d.choices?.[0]?.message?.content ?? '(empty response)';
    }
  }
};
