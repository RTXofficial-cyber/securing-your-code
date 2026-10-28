const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * App lock + audit log.
 *
 * The PIN is never stored: only a per-install random salt and a scrypt hash.
 * Verification uses timingSafeEqual. The state file is written 0600 so other
 * users on the machine cannot read it.
 *
 * The audit log records every security-relevant event (lock/unlock, key
 * changes, plugin enable/disable, workspace changes, agent runs) so the user
 * can see exactly what the app has done.
 */

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

class LockManager {
  constructor(file) {
    this.file = file;
    this.auditFile = file + '.audit.log';
    this.data = this._load();
  }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return d && typeof d === 'object' ? d : { autoLockMinutes: 0 };
    } catch {
      return { autoLockMinutes: 0 };
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
    } catch {}
  }

  isSet() {
    return Boolean(this.data.salt && this.data.hash);
  }

  setPin(pin) {
    const p = String(pin || '');
    if (p.length < 4) throw new Error('PIN must be at least 4 characters');
    if (p.length > 128) throw new Error('PIN too long');
    const salt = newSalt();
    this.data.salt = salt;
    this.data.hash = hashPin(p, salt);
    this._save();
    this.audit('pin.set');
  }

  verify(pin) {
    if (!this.isSet()) return true;
    try {
      const got = Buffer.from(hashPin(pin, this.data.salt), 'hex');
      const want = Buffer.from(this.data.hash, 'hex');
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    } catch {
      return false;
    }
  }

  changePin(oldPin, newPin) {
    if (this.isSet() && !this.verify(oldPin)) {
      this.audit('pin.change.denied');
      throw new Error('Current PIN is incorrect');
    }
    this.setPin(newPin);
    this.audit('pin.change');
  }

  clearPin() {
    delete this.data.salt;
    delete this.data.hash;
    this._save();
    this.audit('pin.clear');
  }

  setAutoLock(minutes) {
    this.data.autoLockMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
    this._save();
    this.audit('autolock.set', { minutes: this.data.autoLockMinutes });
  }

  getAutoLock() {
    return this.data.autoLockMinutes || 0;
  }

  noteUnlock() { this.audit('unlock'); }
  noteDenied() { this.audit('unlock.denied'); }
  noteLock() { this.audit('lock'); }

  /* ---------------- audit ---------------- */

  audit(event, detail) {
    try {
      fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
      fs.appendFileSync(this.auditFile, JSON.stringify({ ts: new Date().toISOString(), event, detail: detail ?? null }) + '\n', { mode: 0o600 });
    } catch {}
  }

  readAudit(limit = 200) {
    try {
      const lines = fs.readFileSync(this.auditFile, 'utf8').trim().split('\n').filter(Boolean);
      return lines
        .slice(-limit)
        .reverse()
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  clearAudit() {
    try { fs.writeFileSync(this.auditFile, ''); } catch {}
  }
}

module.exports = { LockManager };
