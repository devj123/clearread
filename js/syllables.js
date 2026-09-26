/**
 * Heuristic syllable splitter.
 *
 * This is NOT a dictionary-backed syllabifier: English spelling is too
 * irregular for a short heuristic to get every word right (see the
 * "chocolate" case in tests/syllables.test.mjs, where a real dictionary
 * would merge the last two syllables because of the silent trailing e).
 * The goal here is chunking long words for easier reading, not
 * phonetic accuracy, so a simple, explainable rule is good enough:
 *
 *   1. Find each maximal run of vowels (aeiouy); that's a syllable
 *      nucleus. A word with 0 or 1 nucleus can't be split further.
 *   2. Look at the consonants sitting between two consecutive nuclei:
 *        - 1 consonant  -> it joins the FOLLOWING syllable  ("o-pen")
 *        - 2+ consonants -> split after the first one        ("win-dow")
 *        - 0 consonants (adjacent vowels) -> split between the nuclei
 *   That's the standard "single consonant is an onset, consonant
 *   clusters split down the middle" rule taught in most phonics
 *   curricula. It does not know about consonant blends that should stay
 *   together (e.g. "str", "bl"); a real fix would be a syllable
 *   dictionary such as CMUdict, noted as future work in README.md.
 *
 * splitSyllables("wonderful") -> ["won", "der", "ful"]
 * splitSyllables("open")      -> ["o", "pen"]
 * splitSyllables("the")       -> ["the"]           (only one nucleus)
 * splitSyllables("cat,")      -> ["cat,"]           (punctuation preserved)
 */
export function splitSyllables(rawToken) {
  const match = rawToken.match(/^([^a-zA-Z]*)([a-zA-Z']+)([^a-zA-Z]*)$/);
  if (!match) return [rawToken];

  const [, lead, core, trail] = match;
  const lower = core.toLowerCase();
  const vowels = "aeiouy";

  const nuclei = [];
  let i = 0;
  while (i < lower.length) {
    if (vowels.includes(lower[i])) {
      let j = i + 1;
      while (j < lower.length && vowels.includes(lower[j])) j++;
      nuclei.push([i, j]);
      i = j;
    } else {
      i++;
    }
  }

  if (nuclei.length <= 1) return [rawToken];

  const breakPoints = [];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const gapStart = nuclei[k][1];
    const gapEnd = nuclei[k + 1][0];
    const clusterLen = gapEnd - gapStart;
    if (clusterLen <= 0) breakPoints.push(gapEnd);
    else if (clusterLen === 1) breakPoints.push(gapStart);
    else breakPoints.push(gapStart + 1);
  }

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
