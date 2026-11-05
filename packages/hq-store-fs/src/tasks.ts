import { dayOfIso, dayToIso, isDone, oneLine, TASK_STATUS_LABEL } from '@hq/core';
import type { Task, TaskStatus } from '@hq/core/types';

/**
 * Obsidian Tasks-compatible checklist lines, one file per month.
 *
 *   - [ ] Book the plumber ⏫ ➕ 2026-07-02 📅 2026-07-18 ⭐ 📝[[notes/tsk_a91]] ^tsk_a91 →prj_kitchen
 *
 * Every scalar field of `Task` is carried on the line: title, status (the `##` heading), priority,
 * createdAt, startDate (🛫), scheduledDate (⏳), dueDate, completedAt, focus, id, projectId. `notes`
 * is the exception — its body lives in
 * `tasks/notes/<id>.md` (see the tasks codec), and the `📝[[notes/<id>]]` token here is only a
 * decorative link to it.
 */

const STATUS_ORDER: readonly TaskStatus[] = ['backlog', 'ready', 'in_progress', 'waiting', 'done'];

const STATUS_BY_LABEL = new Map<string, TaskStatus>(
  STATUS_ORDER.map((s) => [TASK_STATUS_LABEL[s], s]),
);

/**
 * Tokens are printed in this order and stripped in reverse. `➕ <created>` is mandatory on every
 * line, which is what makes the parser safe: it always sits between the title and every optional
 * token, so a title that itself ends in `^abc` or `→foo` can never be mistaken for one.
 */
const STRIP: readonly { re: RegExp; key: string }[] = [
  { re: /\s→(\S+)$/u, key: 'projectId' },
  { re: /\s\^(\S+)$/u, key: 'id' },
  // `📝[[notes/<id>]]` is decoration (a clickable Obsidian link to the sidecar note); the note body
  // itself is the source of truth, in tasks/notes/<id>.md. Stripped and discarded, never a field —
  // like links.yaml's derived `label`. Sits just before ^id, so it strips right after ^id.
  { re: /\s📝\[\[notes\/\S+\]\]$/u, key: 'notesLink' },
  { re: /\s⭐$/u, key: 'focus' },
  { re: /\s✅ (\d{4}-\d{2}-\d{2})$/u, key: 'completedAt' },
  { re: /\s📅 (\d{4}-\d{2}-\d{2})$/u, key: 'dueDate' },
  // Work-window tokens, printed 🛫 then ⏳ (after ➕ created, before 📅 due). Stripped in reverse —
  // ⏳ first, then 🛫 — so the mandatory `➕ created` anchor is still the last date token peeled.
  { re: /\s⏳ (\d{4}-\d{2}-\d{2})$/u, key: 'scheduledDate' },
  { re: /\s🛫 (\d{4}-\d{2}-\d{2})$/u, key: 'startDate' },
  { re: /\s➕ (\d{4}-\d{2}-\d{2})$/u, key: 'createdAt' },
  { re: /\s(⏫|🔽)$/u, key: 'priority' },
];

/**
 * The form a task takes after a trip through the vault: its title is one line (a pasted multi-line
 * title becomes one line with spaces). Applied by the codec's `sort`, so `canonical` and the round
 * trip agree and printing never has to refuse a task.
 */
export function normalizeTask(t: Task): Task {
  const title = oneLine(t.title);
  return title === t.title ? t : { ...t, title };
}

export function printTaskLine(t: Task): string {
  let line = `- [${isDone(t) ? 'x' : ' '}] ${oneLine(t.title)}`;
  if (t.priority === 'high') line += ' ⏫';
  if (t.priority === 'low') line += ' 🔽';
  line += ` ➕ ${dayOfIso(t.createdAt)}`;
  if (t.startDate) line += ` 🛫 ${t.startDate}`;
  if (t.scheduledDate) line += ` ⏳ ${t.scheduledDate}`;
  if (t.dueDate) line += ` 📅 ${t.dueDate}`;
  if (t.completedAt) line += ` ✅ ${dayOfIso(t.completedAt)}`;
  if (t.focus) line += ' ⭐';
  if (t.notes !== undefined) line += ` 📝[[notes/${t.id}]]`;
  line += ` ^${t.id}`;
  if (t.projectId) line += ` →${t.projectId}`;
  return line;
}

/** Returns null for a line that isn't a checklist item (prose, blank lines, stray text). */
export function parseTaskLine(line: string, status: TaskStatus): Task | null {
  const m = /^\s*- \[[ xX]\] (.*)$/u.exec(line);
  if (!m) return null;

  let rest = m[1].trimEnd();
  const found: Record<string, string> = {};
  for (const { re, key } of STRIP) {
    const hit = re.exec(rest);
    if (!hit) continue;
    found[key] = hit[1] ?? '';
    rest = rest.slice(0, hit.index);
  }

  const title = rest.trim();
  const createdDay = found.createdAt;
  if (!found.id || !createdDay) return null; // not a line we wrote; leave it alone

  return {
    id: found.id,
    title,
    status,
    priority: found.priority === '⏫' ? 'high' : found.priority === '🔽' ? 'low' : 'medium',
    focus: 'focus' in found,
    createdAt: dayToIso(createdDay),
    ...(found.startDate ? { startDate: found.startDate } : {}),
    ...(found.scheduledDate ? { scheduledDate: found.scheduledDate } : {}),
    ...(found.dueDate ? { dueDate: found.dueDate } : {}),
    ...(found.completedAt ? { completedAt: dayToIso(found.completedAt) } : {}),
    ...(found.projectId ? { projectId: found.projectId } : {}),
  };
}

/** `tasks/2026-07.md` — grouped by the local month of `createdAt`. */
export function taskMonth(t: Task): string {
  return dayOfIso(t.createdAt).slice(0, 7);
}

export function printTaskFile(tasks: readonly Task[]): string {
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const t of tasks) {
    const list = byStatus.get(t.status);
    if (list) list.push(t);
    else byStatus.set(t.status, [t]);
  }

  const sections: string[] = [];
  for (const status of STATUS_ORDER) {
    const list = byStatus.get(status);
    if (!list?.length) continue; // an empty section is noise, not information
    const lines = [...list]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(printTaskLine);
    sections.push(`## ${TASK_STATUS_LABEL[status]}\n\n${lines.join('\n')}\n`);
  }
  return sections.join('\n');
}

export function parseTaskFile(text: string): Task[] {
  const out: Task[] = [];
  let status: TaskStatus | null = null;

  for (const line of text.split('\n')) {
    const heading = /^##\s+(.*?)\s*$/u.exec(line);
    if (heading) {
      status = STATUS_BY_LABEL.get(heading[1]) ?? null;
      continue;
    }
    if (!status) continue;
    const task = parseTaskLine(line, status);
    if (task) out.push(task);
  }
  return out;
}
