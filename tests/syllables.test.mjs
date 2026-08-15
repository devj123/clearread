// Unit tests for the syllable heuristic. Run with: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { splitSyllables } from "../js/syllables.js";

test("short words are left alone", () => {
  assert.deepEqual(splitSyllables("the"), ["the"]);
  assert.deepEqual(splitSyllables("cat"), ["cat"]);
  assert.deepEqual(splitSyllables("a"), ["a"]);
});

test("splits common multi-syllable words at consonant-cluster boundaries", () => {
  assert.deepEqual(splitSyllables("wonderful"), ["won", "der", "ful"]);
  assert.deepEqual(splitSyllables("hackathon"), ["hac", "kat", "hon"]);
  assert.deepEqual(splitSyllables("computer"), ["com", "pu", "ter"]);
});

test("a single consonant between two vowels joins the following syllable", () => {
  assert.deepEqual(splitSyllables("open"), ["o", "pen"]);
});

test("preserves leading and trailing punctuation", () => {
  assert.deepEqual(splitSyllables("wonderful,"), ["won", "der", "ful,"]);
  assert.deepEqual(splitSyllables("(wonderful)"), ["(won", "der", "ful)"]);
});

test("preserves original casing", () => {
  assert.deepEqual(splitSyllables("Wonderful"), ["Won", "der", "ful"]);
});

test("words with no vowel-consonant-vowel pattern are returned whole", () => {
  assert.deepEqual(splitSyllables("rhythm"), ["rhythm"]);
});

test("is honest about its limits: irregular spellings are not always right", () => {
  // "chocolate" is really cho-co-late (3 syllables in speech) but the VC|CV
  // heuristic has no notion of a silent trailing e, so it does not merge
  // the last two syllables the way a dictionary-backed splitter would.
  // This test documents the known limitation rather than hiding it.
  const result = splitSyllables("chocolate");
  assert.equal(result.join(""), "chocolate");
  assert.ok(result.length >= 3);
});
