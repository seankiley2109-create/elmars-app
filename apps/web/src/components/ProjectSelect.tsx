import { useMemo } from 'react';
import { useHQ } from '../store';
import { childProjects, isTopLevel } from '../selectors';
import { selectCls } from './ui';

/**
 * Pick a project from the whole hierarchy — folders first, their subprojects (at any depth,
 * indented one level deeper each time) nested under them.
 */
export default function ProjectSelect({
  value,
  onChange,
  label,
  noneLabel = 'No project',
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label: string;
  noneLabel?: string;
}) {
  const projects = useHQ((s) => s.projects);

  const options = useMemo(() => {
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const out: { id: string; label: string }[] = [];
    // walks the whole tree, indenting each option by its actual depth — no cap on how deep it goes
    const walk = (kids: { id: string; name: string }[], depth: number) => {
      for (const p of kids.sort(byName)) {
        out.push({ id: p.id, label: `${'    '.repeat(depth)}${p.name}` });
        walk(childProjects({ projects }, p.id), depth + 1);
      }
    };
    walk(
      projects.filter((p) => !p.archived && isTopLevel({ projects }, p)),
      0,
    );
    return out;
  }, [projects]);

  return (
    <select
      className={selectCls}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label={label}
    >
      <option value="">{noneLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
