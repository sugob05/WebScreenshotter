/** Apply the saved preference before the stylesheet is painted.
 * The legacy storage prefix is intentional: renaming the product must not
 * discard settings or drafts from an existing installation.
 */
(() => {
  const storageKey = 'screenshotter.theme.v1';
  let theme = 'light';
  try {
    const savedTheme = localStorage.getItem(storageKey);
    if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme;
  } catch {
    /* Private browsing may deny storage; the light theme still works. */
  }
  document.documentElement.dataset.theme = theme;
})();
