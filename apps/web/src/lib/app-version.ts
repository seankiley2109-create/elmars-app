import pkg from '../../package.json';
import { isTauri } from './platform';

/** The app's version: from the Mac app itself when running in it, otherwise from package.json. */
export async function appVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      // fall through to the bundled number
    }
  }
  return pkg.version;
}
