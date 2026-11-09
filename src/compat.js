// Built-ins that Safari added after 15.4 (the oldest the macOS app supports) and that libraries call
// without checking. In Mermaid, a diagram with a link calls URL.canParse (Safari 17), and use case
// diagrams call Object.groupBy (Safari 17.4) when their parser starts. Imported first by app.js.
// (esbuild lowers newer syntax for the build target, but doesn't add missing built-ins.)
if (!Object.groupBy) {
  Object.groupBy = (items, keyOf) => {
    const groups = Object.create(null);
    let i = 0;
    for (const item of items) (groups[keyOf(item, i++)] ||= []).push(item);
    return groups;
  };
}
if (!URL.canParse) {
  URL.canParse = (url, base) => {
    try { new URL(url, base); return true; } catch { return false; }
  };
}
