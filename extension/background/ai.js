// The ONLY file in this extension that sends anything outside the
// browser. Every function here is called strictly on user action (clicking
// "Chunk this," opening the working-memory sidebar in enhanced mode, or
// asking for a summary) -- never automatically, never in the background,
// and never unless aiConfig.enabled is true with a key the user typed in
// themselves on the options page. See PRIVACY.md for the full accounting
// of what gets sent and when.
//
// Both providers are asked to return strict JSON so the caller doesn't
// have to scrape prose. If a model ignores that and wraps its answer in
// prose anyway, extractJson() below salvages the first {...} or [...]
// block rather than failing outright, since smaller/cheaper models are
// more likely to do this and this feature should degrade gracefully, not
// throw an error at a distracted user mid-assignment.

import { getLocal } from "./storage.js";

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

class AIDisabledError extends Error {
  constructor(message) {
    super(message);
    this.name = "AIDisabledError";
  }
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callOpenAI({ apiKey, model, system, user }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return extractJson(content);
}

async function callAnthropic({ apiKey, model, system, user }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.anthropic,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: `${user}\n\nRespond with ONLY valid JSON, no prose before or after.` }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data.content?.[0]?.text ?? "";
  return extractJson(content);
}

async function callAI({ system, user }) {
  const { aiConfig } = await getLocal(["aiConfig"]);
  if (!aiConfig.enabled || !aiConfig.apiKey) {
    throw new AIDisabledError("AI features are off. Turn them on and add an API key in Options first.");
  }
  const fn = aiConfig.provider === "anthropic" ? callAnthropic : callOpenAI;
  return fn({ apiKey: aiConfig.apiKey, model: aiConfig.model, system, user });
}

export async function chunkTask(instructionsText) {
  const result = await callAI({
    system:
      "You break assignments and instructions into concrete, ordered, physically-startable steps for a student " +
      "with ADHD who is stuck on where to begin. Each step must be something they could start doing in the next " +
      "five minutes, not a restatement of the goal. Return JSON: " +
      '{"title": string, "steps": [string, ...]}. 4 to 8 steps. No step should itself need to be broken down further.',
    user: `Break this into concrete steps:\n\n${instructionsText}`,
  });
  if (!result || !Array.isArray(result.steps)) {
    throw new Error("Could not parse a step list from the model's response.");
  }
  return { title: result.title || "Task", steps: result.steps };
}

export async function summarizeLevels(pageText) {
  const result = await callAI({
    system:
      "Summarize the given text at three levels of depth for a reader who may be losing focus. Return JSON: " +
      '{"tenSecond": string, "oneMinute": string}. tenSecond is one sentence, the single most important point. ' +
      "oneMinute is a short paragraph, 3-5 sentences, covering the main line of argument or narrative. " +
      "Do not invent details not present in the text.",
    user: pageText.slice(0, 12000),
  });
  if (!result || !result.tenSecond) throw new Error("Could not generate a summary from the model's response.");
  return result;
}

export async function recapSince(pageTextSlice) {
  const result = await callAI({
    system:
      "The reader stopped paying close attention partway through this text and just resumed. Summarize ONLY " +
      'what happens in the given slice, as a short catch-up, 2-4 sentences. Return JSON: {"recap": string}.',
    user: pageTextSlice.slice(0, 8000),
  });
  if (!result || !result.recap) throw new Error("Could not generate a recap from the model's response.");
  return result.recap;
}

export async function extractWorkingMemory(pageTextSoFar) {
  const result = await callAI({
    system:
      "Extract a lightweight reading-context snapshot from the given text, as it would look partway through " +
      "reading it. Return JSON: " +
      '{"mainIdea": string, "terms": [string, ...], "numbers": [string, ...], "recap": string}. ' +
      "mainIdea is one sentence. terms is up to 6 key people, names, or defined terms introduced so far, plain " +
      "strings. numbers is up to 5 important quantities/dates/figures, each as a short labeled string like " +
      '"1969: moon landing". recap is 1-2 sentences on what happened in roughly the last few paragraphs.',
    user: pageTextSoFar.slice(0, 10000),
  });
  if (!result) throw new Error("Could not extract working memory from the model's response.");
  return {
    mainIdea: result.mainIdea || "",
    terms: Array.isArray(result.terms) ? result.terms : [],
    numbers: Array.isArray(result.numbers) ? result.numbers : [],
    recap: result.recap || "",
  };
}

export { AIDisabledError };
