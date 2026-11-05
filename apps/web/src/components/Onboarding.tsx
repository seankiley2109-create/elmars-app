import { useState } from 'react';
import { motion } from 'framer-motion';
import { Orbit, Sparkles, FileText } from 'lucide-react';
import { useHQ } from '../store';
import { inputCls } from './ui';

/**
 * First launch: his name, then a choice between bringing his Evernote notes across or starting
 * with nothing. `onImport` is the Evernote import (wired in a later task); until something supplies
 * it, the button is not shown, so the screen never offers what it cannot do.
 */
export default function Onboarding({ onImport }: { onImport?: (name: string) => void }) {
  const completeOnboarding = useHQ((s) => s.completeOnboarding);
  const [name, setName] = useState('');

  const startEmpty = () => {
    completeOnboarding(name.trim() || 'there');
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="glow mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Orbit size={28} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
          <p className="mt-2 text-sm text-muted">
            Your projects, tasks, notes and calendar in one place. Everything stays on this Mac.
          </p>
        </div>

        <label className="label mb-2 block" htmlFor="ob-name">
          What should we call you?
        </label>
        <input
          id="ob-name"
          className={inputCls}
          placeholder="Your first name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div className="mt-6 grid gap-3">
          {onImport && (
            <button
              onClick={() => onImport(name.trim() || 'there')}
              className="glow flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 text-left transition-colors hover:bg-accent/15"
            >
              <Sparkles size={20} className="shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-semibold">Bring your Evernote notes</span>
                <span className="block text-xs text-muted">
                  Import your notes and carry on from there.
                </span>
              </span>
            </button>
          )}
          <button
            onClick={startEmpty}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-left transition-colors hover:border-accent/40"
          >
            <FileText size={20} className="shrink-0 text-muted" />
            <span>
              <span className="block text-sm font-semibold">Start empty</span>
              <span className="block text-xs text-muted">Nothing in it yet. Add your own projects and notes.</span>
            </span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
