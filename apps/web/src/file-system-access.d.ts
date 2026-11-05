/**
 * File System Access API bits that TypeScript 5.6's lib.dom does not declare yet.
 *
 * Only the surface HQ actually uses. `queryPermission`/`requestPermission` are declared locally in
 * lib/vault-handle.ts instead, because they are feature-detected there rather than assumed.
 */

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
