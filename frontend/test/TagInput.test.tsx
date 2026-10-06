// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TagInput } from '../src/components/TagInput';

function Harness({ initial = [], max = 3 }: { initial?: string[]; max?: number }) {
  const [v, setV] = useState<string[]>(initial);
  return <TagInput label="Skills" value={v} onChange={setV} max={max} placeholder="Add" hint="hint" />;
}

afterEach(cleanup);

describe('TagInput', () => {
  it('adds a tag on Enter and on comma, and clears the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Skills');
    await user.type(input, 'Python{Enter}');
    await user.type(input, 'SQL,');
    expect(screen.getByText('Python')).toBeTruthy();
    expect(screen.getByText('SQL')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('ignores case-insensitive duplicates', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Python']} />);
    await user.type(screen.getByLabelText('Skills'), 'python{Enter}');
    expect(screen.getAllByRole('listitem').filter((li) => /python/i.test(li.textContent ?? ''))).toHaveLength(1);
  });

  it('refuses tags beyond the maximum and flags the input invalid', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['a1', 'b2', 'c3']} max={3} />);
    const input = screen.getByLabelText('Skills');
    await user.type(input, 'extra{Enter}');
    expect(screen.queryByText('extra')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('removes the last tag on Backspace in an empty input', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Python', 'SQL']} />);
    await user.click(screen.getByLabelText('Skills'));
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('SQL')).toBeNull();
    expect(screen.getByText('Python')).toBeTruthy();
  });
});
