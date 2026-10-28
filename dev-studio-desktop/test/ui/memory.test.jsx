import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MemoryPanel from '../../src/components/Memory.jsx';

describe('MemoryPanel', () => {
  it('shows the project memory UI with stats', async () => {
    render(<MemoryPanel workspace="/tmp/demo" onClose={() => {}} />);
    expect(screen.getByText('Project memory')).toBeTruthy();
    expect(screen.getByText(/Persistent context for the AI/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/decisions/)).toBeTruthy());
    expect(screen.getByText('What the AI actually receives')).toBeTruthy();
  });

  it('adds a task and a decision, and cycles task status', async () => {
    render(<MemoryPanel workspace="/tmp/demo" onClose={() => {}} />);

    const taskInput = screen.getByPlaceholderText(/Add a task/);
    fireEvent.change(taskInput, { target: { value: 'Add rate limiting' } });
    fireEvent.click(screen.getByText('＋ add'));
    await waitFor(() => expect(screen.getByText('Add rate limiting')).toBeTruthy());

    const titleInput = screen.getByPlaceholderText(/Decision —/);
    fireEvent.change(titleInput, { target: { value: 'Use PostgreSQL' } });
    fireEvent.click(screen.getByText('＋ record decision'));
    await waitFor(() => expect(screen.getByText('Use PostgreSQL')).toBeTruthy());

    // cycle a task todo -> doing
    const todos = screen.getAllByText('todo');
    fireEvent.click(todos[0]);
    await waitFor(() => expect(screen.getAllByText('doing').length).toBeGreaterThan(0));
  });

  it('closes when the backdrop is clicked', () => {
    let closed = false;
    const { container } = render(<MemoryPanel workspace="/tmp/demo" onClose={() => { closed = true; }} />);
    fireEvent.click(container.querySelector('.backdrop'));
    expect(closed).toBe(true);
  });
});
