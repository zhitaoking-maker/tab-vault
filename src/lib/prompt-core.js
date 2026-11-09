const PROMPT_PAYLOAD_VERSION = 1;
const DEFAULT_IMPORT_MODE = 'merge';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTags(tags, category) {
  const normalizedTags = Array.isArray(tags)
    ? tags.filter(isNonEmptyString).map((tag) => tag.trim())
    : [];
  const uniqueTags = [...new Set(normalizedTags)];

  if (uniqueTags.length > 0) return uniqueTags;
  return isNonEmptyString(category) ? [category.trim()] : [];
}

function normalizePromptFields({ title, tags, category, content }) {
  if (![title, content].every(isNonEmptyString)) return null;
  const normalizedTags = normalizeTags(tags, category);
  return {
    title: title.trim(),
    tags: normalizedTags,
    category: normalizedTags[0] ?? 'general',
    content: content.trim(),
  };
}

function normalizeStoredPrompt(prompt) {
  const fields = normalizePromptFields(prompt);
  return fields ? { ...prompt, ...fields } : null;
}

function makePromptId() {
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPrompt(value) {
  return value
    && typeof value === 'object'
    && isNonEmptyString(value.id)
    && normalizeStoredPrompt(value)
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
    tags: changes?.tags ?? (changes?.category === undefined ? current.tags : undefined),
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

export function getAllTags(prompts) {
  const counts = new Map();
  prompts.forEach((prompt) => {
    const normalized = normalizeStoredPrompt(prompt);
    normalized?.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  });
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count);
}

export function filterPrompts(prompts, { tag = 'all', category = 'all', query = '' } = {}) {
  const selectedTag = typeof tag === 'string' ? tag.trim() : 'all';
  const selectedCategory = typeof category === 'string' ? category.trim() : 'all';
  const normalizedQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  return prompts.filter((prompt) => {
    const normalized = normalizeStoredPrompt(prompt);
    if (!normalized) return false;
    const tagMatches = !selectedTag || selectedTag === 'all' || normalized.tags.includes(selectedTag);
    const categoryMatches = !selectedCategory || selectedCategory === 'all' || normalized.category === selectedCategory;
    const textMatches = !normalizedQuery
      || normalized.title.toLocaleLowerCase().includes(normalizedQuery)
      || normalized.content.toLocaleLowerCase().includes(normalizedQuery);
    return tagMatches && categoryMatches && textMatches;
  });
}

export function exportPromptsPayload(prompts) {
  return JSON.stringify({
    version: PROMPT_PAYLOAD_VERSION,
    prompts: prompts.map((prompt) => normalizeStoredPrompt(prompt) ?? prompt),
  });
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

  const normalizedCurrentPrompts = currentPrompts.map((prompt) => normalizeStoredPrompt(prompt) ?? prompt);
  const importedPrompts = payload.prompts.map(normalizeStoredPrompt);
  const existingIds = new Set(normalizedCurrentPrompts.map((prompt) => prompt.id));
  return {
    ok: true,
    prompts: [...normalizedCurrentPrompts, ...importedPrompts.filter((prompt) => !existingIds.has(prompt.id))],
  };
}

function parseVariable(match) {
  const separatorIndex = match.indexOf(':');
  const name = (separatorIndex < 0 ? match : match.slice(0, separatorIndex)).trim();
  const defaultValue = (separatorIndex < 0 ? '' : match.slice(separatorIndex + 1)).trim();
  return { name, defaultValue };
}

export function extractVariables(content) {
  if (typeof content !== 'string') return [];
  const variables = [];
  const names = new Set();
  for (const match of content.matchAll(/{{([^{}]*)}}/g)) {
    const variable = parseVariable(match[1]);
    if (variable.name && !names.has(variable.name)) {
      names.add(variable.name);
      variables.push(variable);
    }
  }
  return variables;
}

export function renderTemplate(content, values = {}) {
  if (typeof content !== 'string') return '';
  const resolvedValues = values && typeof values === 'object' ? values : {};
  return content.replace(/{{([^{}]*)}}/g, (token, expression) => {
    const { name, defaultValue } = parseVariable(expression);
    if (!name) return token;
    const value = resolvedValues[name];
    return value === undefined ? defaultValue : String(value);
  });
}
