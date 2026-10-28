/**
 * Official plugin: Ollama — local models, zero keys, zero internet.
 * This is the recommended home for "your own AI": run any GGUF/model
 * locally with Ollama and it appears in Dev Studio's model picker.
 */
const BASE = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

module.exports = {
  provider: {
    id: 'ollama',
    name: 'Ollama',
    vendor: 'Local machine',
    description: 'Models served by Ollama on this computer. Private and offline.',
    keyEnv: null,
    docs: 'https://ollama.com',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1 (local)' },
      { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder (local)' },
      { id: 'deepseek-r1', name: 'DeepSeek R1 (local)' },
      { id: 'mistral', name: 'Mistral (local)' }
    ],
    async chat(model, messages) {
      const res = await fetch(BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'llama3.1', messages, stream: false })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ollama error ${res.status}: ${t.slice(0, 300)} (is Ollama running? try: ollama serve)`);
      }
      const d = await res.json();
      return d.message?.content || '(empty response)';
    }
  }
};
