/**
 * Heuristic syllable splitter. Not a dictionary lookup: it uses a simple
 * "split a single consonant sitting between two vowels" rule, which is
 * good enough to chunk plenty of everyday words for easier reading.
 *
 * splitSyllables("feature") -> ["feat", "ur", "e"]
 * splitSyllables("the")     -> ["the"]  (too short to split)
 */
export function splitSyllables(rawToken) {
  const match = rawToken.match(/^([^a-zA-Z]*)([a-zA-Z']+)([^a-zA-Z]*)$/);
  if (!match) return [rawToken];

  const [, lead, core, trail] = match;
  if (core.length <= 3) return [rawToken];

  const lower = core.toLowerCase();
  const vowels = "aeiouy";
  const breakPoints = [];
  let prevWasVowel = false;

  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    const isVowel = vowels.includes(c);
    if (prevWasVowel && !isVowel) {
      const next = lower[i + 1];
      if (next && vowels.includes(next)) {
        breakPoints.push(i + 1);
      }
    }
    prevWasVowel = isVowel;
  }

  if (!breakPoints.length) return [rawToken];

  const parts = [];
  let start = 0;
  for (const bp of breakPoints) {
    parts.push(core.slice(start, bp));
    start = bp;
  }
  parts.push(core.slice(start));

  parts[0] = lead + parts[0];
  parts[parts.length - 1] = parts[parts.length - 1] + trail;
  return parts;
}

