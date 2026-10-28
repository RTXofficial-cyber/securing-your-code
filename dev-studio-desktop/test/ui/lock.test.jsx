import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/api.js', () => {
  let pin = null;
  const api = {
    lockState: async () => ({ ok: true, set: pin !== null, autoLockMinutes: 0 }),
    lockSet: async (p) => {
      if (String(p || '').length < 4) return { ok: false, error: 'PIN must be at least 4 characters' };
      pin = String(p);
      return { ok: true };
    },
    lockVerify: async (p) => ({ ok: String(p) === pin }),
    lockNote: async () => ({ ok: true })
  };
  return { api, isDesktop: false };
});

import LockScreen from '../../src/components/LockScreen.jsx';

describe('LockScreen', () => {
  it('offers to create a PIN on first run', async () => {
    render(<LockScreen onUnlocked={() => {}} />);
    expect(await screen.findByPlaceholderText('PIN')).toBeTruthy();
    expect(screen.getByPlaceholderText('Confirm PIN')).toBeTruthy();
    expect(screen.getByText(/Set PIN & enter/i)).toBeTruthy();
  });

  it('rejects mismatched confirmation', async () => {
    render(<LockScreen onUnlocked={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '1234' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm PIN'), { target: { value: '9999' } });
    fireEvent.click(screen.getByText(/Set PIN & enter/i));
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
  });

  it('rejects short PINs', async () => {
    render(<LockScreen onUnlocked={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm PIN'), { target: { value: '12' } });
    fireEvent.click(screen.getByText(/Set PIN & enter/i));
    expect(await screen.findByText(/at least 4 characters/i)).toBeTruthy();
  });

  it('unlocks with a valid PIN', async () => {
    const onUnlocked = vi.fn();
    render(<LockScreen onUnlocked={onUnlocked} />);
    fireEvent.change(await screen.findByPlaceholderText('PIN'), { target: { value: '4242' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm PIN'), { target: { value: '4242' } });
    fireEvent.click(screen.getByText(/Set PIN & enter/i));
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
  });
});
