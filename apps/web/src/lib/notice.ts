import { create } from 'zustand';

/** How long a notice stays up. Long enough to read a title and reach for its action. */
export const NOTICE_MS = 12000;

export interface Notice {
  id: string;
  text: string;
  /** One follow-up: a button that goes to `to` in the app. */
  action?: { label: string; to: string };
}

interface NoticeState {
  notices: Notice[];
  show: (n: Omit<Notice, 'id'>) => string;
  dismiss: (id: string) => void;
}

/**
 * App-wide plain notices (not undo toasts): something happened that he should know about, with at
 * most one way to act on it. Lives outside any screen so a notice raised as a screen goes away (a
 * note switched away from) still shows.
 */
export const useNotices = create<NoticeState>((set, get) => ({
  notices: [],
  show: (n) => {
    const id = crypto.randomUUID();
    set((s) => ({ notices: [...s.notices.slice(-2), { ...n, id }] }));
    setTimeout(() => get().dismiss(id), NOTICE_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),
}));

export const showNotice = (n: Omit<Notice, 'id'>): string => useNotices.getState().show(n);
