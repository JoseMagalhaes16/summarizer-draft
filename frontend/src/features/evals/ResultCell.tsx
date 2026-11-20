import { Icon } from '../../components/Icon';
import { cellKind, pct } from './metrics';

/** Pass / partial / fail / n.a. cell: icon + text, never colour alone. */
export function ResultCell({ value }: { value: number | null | undefined }) {
  const k = cellKind(value);
  if (k === 'pass')
    return (
      <span className="rc rc-pass">
        <Icon name="check" size={14} /> Pass
      </span>
    );
  if (k === 'fail')
    return (
      <span className="rc rc-fail">
        <Icon name="x" size={14} /> Fail
      </span>
    );
  if (k === 'partial')
    return (
      <span className="rc rc-partial">
        <Icon name="half" size={14} /> Partial {pct(value as number)}
      </span>
    );
  return (
    <span className="rc rc-na" title="Not applicable to this case">
      <Icon name="minus" size={14} /> n.a.
    </span>
  );
}
