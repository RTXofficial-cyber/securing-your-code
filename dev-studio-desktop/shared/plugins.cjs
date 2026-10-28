const fs = require('fs');
const path = require('path');

const providers = require('./providers.cjs');
const agent = require('./agent.cjs');

/**
 * Official Dev Studio plugin system.
 *
 * A plugin is a folder containing:
 *   plugin.json   { id, name, version, entry, description?, type?, enabledByDefault? }
 *   <entry>       CommonJS module exporting any of:
 *                   provider : { id, name, vendor?, description?, keyEnv?, docs?, models[], chat(model, messages) }
 *                   tools    : [ { name, description?, run(action, ctx) } ]
 *
 * Plugin folders are read from (in order):
 *   <app>/plugins            — official plugins shipped with the .exe
 *   <userData>/plugins       — plugins the user installs
 *
 * A plugin that throws during load is marked status:"error" and isolated —
 * it can never take the app down. Enable/disable state persists to disk.
 */

const REQUIRED = ['id', 'name', 'version', 'entry'];

class PluginManager {
  constructor({ dirs = [], persistFile = null } = {}) {
    this.dirs = dirs;
    this.persistFile = persistFile;
    this.plugins = new Map();
    this.enabled = this._loadEnabled();
  }

  _loadEnabled() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistFile, 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  _saveEnabled() {
    if (!this.persistFile) return;
    try {
      fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
      fs.writeFileSync(this.persistFile, JSON.stringify(this.enabled, null, 2));
    } catch {}
  }

  /** Discover plugin folders. Safe to call repeatedly. */
  scan() {
    this.plugins.clear();
    for (let di = 0; di < this.dirs.length; di++) {
      const dir = this.dirs[di];
      const official = di === 0; // only the shipped folder is trusted by default
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const pdir = path.join(dir, e.name);
        const mfile = path.join(pdir, 'plugin.json');
        if (!fs.existsSync(mfile)) continue;

        let manifest = null;
        let error = null;
        try {
          manifest = JSON.parse(fs.readFileSync(mfile, 'utf8'));
        } catch (err) {
          error = 'plugin.json is not valid JSON: ' + err.message;
          manifest = { id: e.name, name: e.name, version: '0.0.0', entry: 'index.cjs' };
        }
        const missing = REQUIRED.filter((k) => !manifest[k]);
        if (missing.length) error = (error ? error + '; ' : '') + 'missing manifest fields: ' + missing.join(', ');
        if (!fs.existsSync(path.join(pdir, manifest.entry))) {
          error = (error ? error + '; ' : '') + `entry file not found: ${manifest.entry}`;
        }

        // Official plugins honour enabledByDefault (default on). User-installed
        // plugins default OFF — untrusted code must be explicitly enabled.
        const def = official ? manifest.enabledByDefault !== false : manifest.enabledByDefault === true;
        if (!(manifest.id in this.enabled)) this.enabled[manifest.id] = def;
        this.plugins.set(manifest.id, { manifest, dir: pdir, error, status: 'pending', provides: null, official });
      }
    }
    this._saveEnabled();
    return this.list();
  }

  /** (Re)load every plugin according to its enabled flag. */
  loadAll() {
    for (const p of this.plugins.values()) {
      this._unload(p);
      this._load(p);
    }
    return this.list();
  }

  _unload(p) {
    try {
      if (p.provides?.provider) providers.unregisterProvider(p.provides.provider.id);
      if (p.provides?.toolNames?.length) agent.unregisterToolsByPlugin(p.manifest.id);
    } catch {}
    p.provides = null;
    if (p.status !== 'error') p.status = 'disabled';
  }

  _load(p) {
    if (!this.enabled[p.manifest.id]) { p.status = 'disabled'; return; }
    if (p.error) { p.status = 'error'; return; }
    try {
      const entry = path.join(p.dir, p.manifest.entry);
      delete require.cache[require.resolve(entry)];
      const mod = require(entry);
      p.provides = {};
      if (mod.provider) p.provides.provider = providers.registerProvider(mod.provider, p.manifest.id);
      if (Array.isArray(mod.tools)) p.provides.toolNames = mod.tools.map((t) => agent.registerTool(t, p.manifest.id));
      p.status = 'loaded';
      p.error = null;
    } catch (err) {
      p.status = 'error';
      p.error = err.message;
    }
  }

  setEnabled(id, on) {
    const p = this.plugins.get(id);
    if (!p) return { ok: false, error: 'Unknown plugin: ' + id };
    this.enabled[id] = Boolean(on);
    this._saveEnabled();
    this._unload(p);
    this._load(p);
    return { ok: true, plugin: this._view(p) };
  }

  async test(id) {
    const p = this.plugins.get(id);
    if (!p) return { ok: false, error: 'Unknown plugin: ' + id };
    if (p.status === 'error') return { ok: false, error: p.error };
    if (p.status !== 'loaded') return { ok: false, error: 'Plugin is disabled — enable it first.' };
    if (p.provides?.provider) {
      try {
        const r = await providers.chat(p.provides.provider.id, null, [{ role: 'user', content: 'Reply with exactly one word: ok' }]);
        return { ok: true, kind: 'provider', sample: String(r).slice(0, 120) };
      } catch (e) {
        return { ok: false, kind: 'provider', error: e.message };
      }
    }
    if (p.provides?.toolNames?.length) return { ok: true, kind: 'tools', tools: p.provides.toolNames };
    return { ok: true, kind: 'none' };
  }

  list() {
    return [...this.plugins.values()].map((p) => this._view(p));
  }

  _view(p) {
    return {
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description || '',
      type: p.manifest.type || 'bundle',
      enabled: Boolean(this.enabled[p.manifest.id]),
      status: p.status,
      error: p.error || null,
      official: Boolean(p.official),
      provides: {
        provider: p.provides?.provider ? { id: p.provides.provider.id, name: p.provides.provider.name } : null,
        tools: p.provides?.toolNames || []
      },
      dir: p.dir
    };
  }
}

module.exports = { PluginManager, REQUIRED };
