export const SCHEMA_VERSION = 1;

export const DEFAULT_LIBRARY = {
  version: SCHEMA_VERSION,
  enabled: true,
  disabledDomains: [],
  global: [],
  domains: {},
  whitelist: [],
};

export function parseLibrary(raw) {
  if (!raw) return clone(DEFAULT_LIBRARY);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  if (!parsed || parsed.version !== SCHEMA_VERSION) {
    return clone(DEFAULT_LIBRARY);
  }
  return { ...clone(DEFAULT_LIBRARY), ...parsed };
}

export function loadLibrary(getValue) {
  let raw;
  try {
    raw = getValue("popupZapper.library");
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  return parseLibrary(raw);
}

export async function loadLibraryAsync(getValueAsync) {
  let raw;
  try {
    raw = await getValueAsync("popupZapper.library");
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  return parseLibrary(raw);
}

export function saveLibrary(setValue, library) {
  setValue("popupZapper.library", JSON.stringify(library));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}