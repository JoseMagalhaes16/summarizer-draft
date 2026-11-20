import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ResultSection } from '../../api/types';
import { SectionEditor } from './SectionEditor';

function Harness({ initial, spy }: { initial: ResultSection; spy: (s: ResultSection) => void }) {
  const [s, setS] = useState(initial);
  return <SectionEditor section={s} onChange={(n) => { setS(n); spy(n); }} />;
}
const base: ResultSection = { section_id: 'p', title: 'Plan', format: 'bullets', content: '', items: ['a'], fields: [], not_discussed: false, used_defaults: false };

describe('SectionEditor', () => {
  it('adds and removes bullet items', async () => {
    const spy = vi.fn();
    render(<Harness initial={base} spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Plan item 1' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('clears not_discussed once content is typed', async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...base, format: 'paragraph', items: [], not_discussed: true }} spy={spy} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Plan' }), 'x');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'x', not_discussed: false }));
  });

  it('edits key_value fields', async () => {
    const spy = vi.fn();
    render(<Harness initial={{ ...base, format: 'key_value', items: [], fields: [{ key: 'weight', label: 'Weight', value: '' }] }} spy={spy} />);
    await userEvent.type(screen.getByLabelText('Weight'), '9');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ fields: [{ key: 'weight', label: 'Weight', value: '9' }] }));
  });
});
