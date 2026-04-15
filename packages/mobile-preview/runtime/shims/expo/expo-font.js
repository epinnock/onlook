const MODULE_ID = 'expo-font';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const FONT_STATE_KEY = '__onlookExpoFontState';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-font shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function ensureFontState(target) {
  if (!target[FONT_STATE_KEY] || typeof target[FONT_STATE_KEY] !== 'object') {
    target[FONT_STATE_KEY] = {
      loadedFonts: new Set(),
    };
  }

  const state = target[FONT_STATE_KEY];

  if (!(state.loadedFonts instanceof Set)) {
    state.loadedFonts = new Set(Array.isArray(state.loadedFonts) ? state.loadedFonts : []);
  }

  return state;
}

function resolveFontFamilies(fontFamilyOrFontMap) {
  if (typeof fontFamilyOrFontMap === 'string') {
    return fontFamilyOrFontMap ? [fontFamilyOrFontMap] : [];
  }

  if (!fontFamilyOrFontMap || typeof fontFamilyOrFontMap !== 'object') {
    return [];
  }

  return Object.keys(fontFamilyOrFontMap);
}

function markFontsLoaded(target, fontFamilyOrFontMap) {
  const state = ensureFontState(target);

  for (const fontFamily of resolveFontFamilies(fontFamilyOrFontMap)) {
    state.loadedFonts.add(fontFamily);
  }

  return state;
}

function markFontsUnloaded(target, fontFamilyOrFontMap) {
  const state = ensureFontState(target);

  for (const fontFamily of resolveFontFamilies(fontFamilyOrFontMap)) {
    state.loadedFonts.delete(fontFamily);
  }

  return state;
}

function createFontDisplay() {
  return {
    AUTO: 'auto',
    SWAP: 'swap',
    BLOCK: 'block',
    FALLBACK: 'fallback',
    OPTIONAL: 'optional',
  };
}

function createExpoFontModule(target = globalThis) {
  function useFonts(fontMap) {
    markFontsLoaded(target, fontMap);
    return [true, null];
  }

  function getLoadedFonts() {
    return Array.from(ensureFontState(target).loadedFonts);
  }

  function isLoaded(fontFamily) {
    return ensureFontState(target).loadedFonts.has(fontFamily);
  }

  function isLoading() {
    return false;
  }

  function loadAsync(fontFamilyOrFontMap) {
    markFontsLoaded(target, fontFamilyOrFontMap);
    return Promise.resolve();
  }

  function unloadAsync(fontFamilyOrFontMap) {
    markFontsUnloaded(target, fontFamilyOrFontMap);
    return Promise.resolve();
  }

  function unloadAllAsync() {
    ensureFontState(target).loadedFonts.clear();
    return Promise.resolve();
  }

  function renderToImageAsync(glyphs) {
    return Promise.resolve({
      uri: `data:text/plain,${encodeURIComponent(String(glyphs ?? ''))}`,
      width: 0,
      height: 0,
      scale: 1,
    });
  }

  const moduleExports = {
    FontDisplay: createFontDisplay(),
    getLoadedFonts,
    isLoaded,
    isLoading,
    loadAsync,
    renderToImageAsync,
    unloadAllAsync,
    unloadAsync,
    useFonts,
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default') {
      continue;
    }

    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function installExpoFontShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  ensureFontState(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createExpoFontModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installExpoFontShim;
module.exports.install = installExpoFontShim;
module.exports.applyRuntimeShim = installExpoFontShim;
module.exports.createExpoFontModule = createExpoFontModule;
module.exports.ensureFontState = ensureFontState;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.markFontsLoaded = markFontsLoaded;
module.exports.markFontsUnloaded = markFontsUnloaded;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
