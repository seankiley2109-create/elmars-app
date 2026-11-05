import { isTauri } from './platform';

/*
 * Opening a web or mail link outside the app: the Mac's default browser or mail app in the Mac app, a
 * new tab in a browser. Only http, https and mailto are ever opened (the Mac app's permission allows no
 * more); any other scheme in a note (evernote:, message:, a stray javascript:) is left alone.
 */

/** Opens a URL outside the app. Tests pass a fake. */
export type UrlOpener = (url: string) => Promise<void>;

/** True for the links this app opens: http, https and mailto. */
export function isOpenableUrl(href: string | null | undefined): href is string {
  return typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href.trim());
}

/** True on a Mac, where ⌘ is the "open" modifier; elsewhere it is Ctrl. */
const onMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** ⌘-click on a Mac, Ctrl-click elsewhere: the click that follows a link inside the note editor. */
export function isOpenLinkClick(e: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return onMac() ? e.metaKey : e.ctrlKey;
}

/** Loaded once, on first use, and shared: two quick clicks wait on the same load. */
let openerPlugin: Promise<typeof import('@tauri-apps/plugin-opener')> | null = null;

const defaultOpener: UrlOpener = async (url) => {
  if (isTauri()) {
    const { openUrl } = await (openerPlugin ??= import('@tauri-apps/plugin-opener'));
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

/** Open `href` if it is a web or mail link. Resolves true when it was handed over. Never throws. */
export async function openExternalUrl(href: string | null | undefined, opener: UrlOpener = defaultOpener): Promise<boolean> {
  if (!isOpenableUrl(href)) return false;
  try {
    await opener(href.trim());
    return true;
  } catch {
    return false;
  }
}
