const PROMPT_PAYLOAD_VERSION = 1;
const DEFAULT_IMPORT_MODE = 'merge';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizePromptFields({ title, category, content }) {
  if (![title, category, content].every(isNonEmptyString)) return null;
  return {
    title: title.trim(),
    category: category.trim(),
    content: content.trim(),
  };
}

function makePromptId() {
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPrompt(value) {
  return value
    && typeof value === 'object'
    && isNonEmptyString(value.id)
    && normalizePromptFields(value)
    && isNonEmptyString(value.createdAt)
    && isNonEmptyString(value.updatedAt);
}

export function createPrompt(prompts, fields) {
  const normalizedFields = normalizePromptFields(fields ?? {});
  if (!normalizedFields) return prompts;
  const now = new Date().toISOString();
  return [{
    id: makePromptId(),
    ...normalizedFields,
    createdAt: now,
    updatedAt: now,
  }, ...prompts];
}

export function updatePrompt(prompts, id, changes) {
  const index = prompts.findIndex((prompt) => prompt.id === id);
  if (index < 0) return prompts;
  const current = prompts[index];
  const nextFields = normalizePromptFields({
    title: changes?.title ?? current.title,
    category: changes?.category ?? current.category,
    content: changes?.content ?? current.content,
  });
  if (!nextFields) return prompts;
  const updated = [...prompts];
  updated[index] = {
    ...current,
    ...nextFields,
    updatedAt: new Date().toISOString(),
  };
  return updated;
}

export function deletePrompt(prompts, id) {
  return prompts.filter((prompt) => prompt.id !== id);
}

export function filterPrompts(prompts, { category = 'all', query = '' } = {}) {
  const selectedCategory = typeof category === 'string' ? category.trim() : 'all';
  const normalizedQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  return prompts.filter((prompt) => {
    const categoryMatches = !selectedCategory || selectedCategory === 'all' || prompt.category === selectedCategory;
    const textMatches = !normalizedQuery
      || prompt.title.toLocaleLowerCase().includes(normalizedQuery)
      || prompt.content.toLocaleLowerCase().includes(normalizedQuery);
    return categoryMatches && textMatches;
  });
}

export function exportPromptsPayload(prompts) {
  return JSON.stringify({ version: PROMPT_PAYLOAD_VERSION, prompts });
}

export function importPromptsPayload(currentPrompts, jsonString, { mode = DEFAULT_IMPORT_MODE } = {}) {
  let payload;
  try {
    payload = JSON.parse(jsonString);
  } catch {
    return { ok: false, reason: 'invalid-json', prompts: currentPrompts };
  }
  if (!payload || typeof payload !== 'object' || payload.version !== PROMPT_PAYLOAD_VERSION || !Array.isArray(payload.prompts)) {
    return { ok: false, reason: 'invalid-payload', prompts: currentPrompts };
  }
  if (!payload.prompts.every(isPrompt)) {
    return { ok: false, reason: 'invalid-prompt', prompts: currentPrompts };
  }
  if (mode !== 'merge') {
    return { ok: false, reason: 'invalid-mode', prompts: currentPrompts };
  }

  const existingIds = new Set(currentPrompts.map((prompt) => prompt.id));
  return {
    ok: true,
    prompts: [...currentPrompts, ...payload.prompts.filter((prompt) => !existingIds.has(prompt.id))],
  };
}
