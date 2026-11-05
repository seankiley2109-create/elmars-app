/**
 * Filenames are a convenience; the frontmatter `id` is the identity. Nothing is ever read back out
 * of a path — renaming a file in the vault must not change the data it holds.
 */

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining marks left by NFKD, so "café" -> "cafe" not "caf-e"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'untitled' : s;
}

/** Slugify each segment of a `Note.folder` like `Home/Recipes`, dropping empties. */
export function slugifyPath(folder: string): string {
  return folder
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '')
    .map(slugify)
    .join('/');
}

/**
 * Assign a unique path to each item. Two projects both named "Reporting" would otherwise collide and
 * one would silently overwrite the other.
 *
 * Iteration is in `id` order so the mapping is deterministic: the same document must always produce
 * the same paths, or the content-diffing writer rewrites the whole vault on every save.
 */
export function allocatePaths<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  pathOf: (item: T, slug: string) => string,
  nameOf: (item: T) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();

  for (const item of [...items].sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))) {
    const base = slugify(nameOf(item));
    let path = pathOf(item, base);
    if (used.has(path)) path = pathOf(item, `${base}--${slugify(idOf(item))}`);
    // ids are unique, so the suffixed candidate cannot collide again
    used.add(path);
    out.set(idOf(item), path);
  }
  return out;
}
