import { render, screen, within } from '@testing-library/react';
import type { ResultSection } from '../../api/types';
import { SectionBody } from './SectionView';

function rs(p: Partial<ResultSection>): ResultSection {
  return { section_id: 's', title: 'S', format: 'paragraph', content: '', items: [], fields: [], not_discussed: false, used_defaults: false, ...p };
}

describe('SectionBody', () => {
  it('renders paragraph text', () => {
    render(<SectionBody section={rs({ content: 'Owner reports itchy ears.' })} />);
    expect(screen.getByText('Owner reports itchy ears.')).toBeInTheDocument();
  });

  it('renders bullets as a list', () => {
    render(<SectionBody section={rs({ format: 'bullets', items: ['Clean ears', 'Recheck in 14 days'] })} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Clean ears', 'Recheck in 14 days']);
  });

  it('renders key_value as a definition list with a muted "not stated" for empty values', () => {
    const { container } = render(
      <SectionBody
        section={rs({
          format: 'key_value',
          fields: [
            { key: 'weight', label: 'Weight', value: '32 kg' },
            { key: 'temp', label: 'Temperature', value: '' },
          ],
        })}
      />,
    );
    const terms = [...container.querySelectorAll('dt')].map((e) => e.textContent);
    const defs = [...container.querySelectorAll('dd')].map((e) => e.textContent);
    expect(terms).toEqual(['Weight', 'Temperature']);
    expect(defs).toEqual(['32 kg', 'not stated']);
    expect(screen.getByText('not stated')).toHaveClass('not-stated');
  });

  it.each([['paragraph'], ['bullets'], ['key_value']] as const)('never shows a format badge (%s)', (format) => {
    const { container } = render(<SectionBody section={rs({ format, content: 'x', items: ['x'], fields: [{ key: 'k', label: 'K', value: 'v' }] })} />);
    expect(container.querySelector('.badge')).toBeNull();
    expect(container).not.toHaveTextContent(/paragraph|bullets|key.?value/i);
  });

  it('shows "Not discussed." for state_not_discussed sections', () => {
    render(<SectionBody section={rs({ not_discussed: true })} behavior="state_not_discussed" />);
    expect(screen.getByText('Not discussed.')).toBeInTheDocument();
  });

  it('explains hidden sections for omit behaviour', () => {
    render(<SectionBody section={rs({ not_discussed: true })} behavior="omit" />);
    expect(screen.getByText(/left out when you copy the note/i)).toBeInTheDocument();
  });
});
