import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import TaskDetail from './TaskDetail';

/**
 * TaskDetail rides a global `?task=` param instead of per-page state, so a task is openable
 * from anywhere — a row, the palette, an activity line, a calendar chip — with zero per-page
 * wiring. Mounted once in App; other params are preserved on open and close.
 */
export default function TaskDetailHost() {
  const [params, setParams] = useSearchParams();
  const id = params.get('task');
  if (!id) return null;
  return (
    <TaskDetail
      id={id}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete('task');
        setParams(next, { replace: true });
      }}
    />
  );
}

/** Open a task's detail from anywhere, keeping the page's own params intact. */
export function useOpenTask(): (id: string) => void {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set('task', id);
      setParams(next);
    },
    [params, setParams],
  );
}
