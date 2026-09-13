/**
 * Node ESM resolve hook: strips the cache-busting `?v=...` query from relative
 * imports so the browser-oriented specifiers also work in headless tests.
 */
export async function resolve(specifier, context, nextResolve) {
  const q = specifier.indexOf('?');
  if (q !== -1 && specifier.slice(q).startsWith('?v=')) {
    const path = specifier.slice(0, q);
    if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) {
      return nextResolve(path, context);
    }
  }
  return nextResolve(specifier, context);
}
