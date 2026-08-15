// Unit tests for the syllable heuristic. Run with: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { splitSyllables } from "../js/syllables.js";

test("short words are left alone", () => {
  assert.deepEqual(splitSyllables("the"), ["the"]);
  assert.deepEqual(splitSyllables("cat"), ["cat"]);
  assert.deepEqual(splitSyllables("a"), ["a"]);
});

test("splits common multi-syllable words at VC|CV boundaries", () => {
  assert.deepEqual(splitSyllables("wonderful"), ["won", "der", "ful"]);
  assert.deepEqual(splitSyllables("hackathon"), ["hac", "ka", "thon"]);
  assert.deepEqual(splitSyllables("computer"), ["com", "pu", "ter"]);
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
  const result = splitSyllables("chocolate");
  assert.equal(result.join(""), "chocolate");
  assert.ok(result.length >= 3);
});
