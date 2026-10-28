import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const ensembleMock = vi.fn(async () => ({
  ok: true,
  steps: [
    { role: 'research', label: 'Researcher', icon: '⌕', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 5, output: 'facts' },
    { role: 'plan', label: 'Architect', icon: '⌗', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 5, output: 'plan' },
    { role: 'code', label: 'Coder', icon: '⌨', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 5, output: 'code' },
    { role: 'review', label: 'Reviewer', icon: '✓', providerId: 'builtin', providerName: 'Dev Studio AI', ok: true, latencyMs: 5, output: 'APPROVED' }
  ],
  actionResults: [{ type: 'write_file', path: 'index.html', ok: true, bytes: 10 }],
  summary: 'Team finished.'
}));

vi.mock('../../src/lib/api.js', () => ({
  isDesktop: false,
  api: {
    providers: async () => [],
    roles: async () => ({
      ok: true,
      roles: [
        { id: 'research', label: 'Researcher', preferred: 'perplexity', icon: '⌕' },
        { id: 'plan', label: 'Architect', preferred: 'anthropic', icon: '⌗' },
        { id: 'code', label: 'Coder', preferred: 'openai', icon: '⌨' },
        { id: 'review', label: 'Reviewer', preferred: 'anthropic', icon: '✓' }
      ]
    }),
    ensemble: (...a) => ensembleMock(...a),
    chat: async () => ({ ok: true, reply: 'solo reply', actionResults: [] }),
    onTerminal: () => () => {}
  }
}));

import ChatPane from '../../src/components/Chat.jsx';

const providers = [
  { id: 'builtin', name: 'Dev Studio AI', vendor: 'Built-in', ready: true, keyEnv: null, models: [{ id: 'studio-agent-2', name: 'Studio Agent v2' }] }
];

describe('ChatPane', () => {
  it('shows solo controls by default', async () => {
    render(<ChatPane providers={providers} />);
    expect(screen.getByText('Solo')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText(/Agent Mode/)).toBeTruthy();
  });

  it('team mode exposes the four role pickers', async () => {
    render(<ChatPane providers={providers} />);
    fireEvent.click(screen.getByText('Team'));
    await waitFor(() => expect(screen.getAllByDisplayValue(/^auto \(/)).length === 4);
    const labels = [...document.querySelectorAll('.team-role-label')].map((n) => n.textContent);
    expect(labels.join(' ')).toMatch(/Researcher/);
    expect(labels.join(' ')).toMatch(/Architect/);
    expect(labels.join(' ')).toMatch(/Coder/);
    expect(labels.join(' ')).toMatch(/Reviewer/);
  });

  it('runs the ensemble pipeline and renders the trace', async () => {
    render(<ChatPane providers={providers} onAgentActed={() => {}} onFileCreated={() => {}} />);
    fireEvent.click(screen.getByText('Team'));
    const box = screen.getByPlaceholderText(/Ask the whole team/);
    fireEvent.change(box, { target: { value: 'build me a website' } });
    fireEvent.click(screen.getByTitle('Send (Enter)'));
    expect(await screen.findByText('AI team run')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('group').length >= 4 || document.querySelectorAll('.pstep').length === 4));
    expect(document.querySelectorAll('.pstep').length).toBe(4);
    expect(ensembleMock).toHaveBeenCalled();
    expect(screen.getByText(/wrote index\.html/)).toBeTruthy();
  });
});
