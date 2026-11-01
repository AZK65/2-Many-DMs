// Never ask a language model to rewrite an address. Keep the original bytes,
// including case, escaped characters, query strings and fragments.
const ADDRESS = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"`]+|mailto:[^\s<>"`]+|(?:[\p{L}\p{N}_%+.-]+@)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?::\d+)?(?:[/?#][^\s<>"`]*)?)/giu;

export function protectTranslationLinks(text: string) {
  let prefix = "OMNI_LINK_";
  while (text.includes(prefix)) prefix = `_${prefix}`;
  const links: string[] = [];
  const masked = text.replace(ADDRESS, (match: string) => {
    let link = match;
    // A balanced parenthesis can be part of a URL; Markdown's enclosing one is not.
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (link.endsWith(close) && link.split(close).length > link.split(open).length) link = link.slice(0, -1);
    }
    const token = `${prefix}${links.length}_END`;
    links.push(link);
    return token + match.slice(link.length);
  });
  const withoutLinks = masked.replace(new RegExp(`${prefix}\\d+_END`, "g"), "");
  return {
    masked, withoutLinks, hasLinks: links.length > 0, addresses: [...links],
    restore(translated: string): string {
      let restored = translated;
      for (let index = 0; index < links.length; index++) {
        const token = `${prefix}${index}_END`;
        if (restored.split(token).length !== 2) throw new Error("Translation could not preserve your links. Nothing was sent. Try again or turn translation off.");
        restored = restored.replace(token, () => links[index]);
      }
      // Reject fabricated addresses, changed placeholders and lost links.
      const actual = protectTranslationLinks(restored);
      // Exact multisets, not substring checks: appending a translated /path,
      // query or domain suffix to a placeholder must also fail.
      if (restored.includes(prefix) ||
          JSON.stringify([...actual.addresses].sort()) !== JSON.stringify([...links].sort())) {
        throw new Error("Translation changed an address. Nothing was sent. Try again or turn translation off.");
      }
      return restored;
    },
  };
}
