const vectorIconsBaseShim = require('./vector-icons-base.js');

const {
  createIconSet,
  ensureRuntimeShimRegistry,
  mergeRuntimeModule,
} = vectorIconsBaseShim;

const MODULE_IDS = Object.freeze({
  EvilIcons: '@expo/vector-icons/EvilIcons',
  Foundation: '@expo/vector-icons/Foundation',
  MaterialCommunityIcons: '@expo/vector-icons/MaterialCommunityIcons',
  Octicons: '@expo/vector-icons/Octicons',
  SimpleLineIcons: '@expo/vector-icons/SimpleLineIcons',
  Zocial: '@expo/vector-icons/Zocial',
});

const FAMILY_CONFIG = Object.freeze({
  [MODULE_IDS.EvilIcons]: {
    fontName: 'EvilIcons',
    expoAssetId: 'evilicons.ttf',
    glyphMap: {
      close: 0xf106,
      user: 0xf2c0,
    },
    fallbackGlyphMap: {
      close: '✕',
      user: '👤',
    },
  },
  [MODULE_IDS.Foundation]: {
    fontName: 'Foundation',
    expoAssetId: 'foundation.ttf',
    glyphMap: {
      home: 0xf16b,
      heart: 0xf159,
    },
    fallbackGlyphMap: {
      home: '⌂',
      heart: '♥',
    },
  },
  [MODULE_IDS.MaterialCommunityIcons]: {
    fontName: 'Material Community Icons',
    expoAssetId: 'material-community-icons.ttf',
    glyphMap: {
      account: 0xf004,
      alarm: 0xf002,
    },
    fallbackGlyphMap: {
      account: '👤',
      alarm: '⏰',
    },
  },
  [MODULE_IDS.Octicons]: {
    fontName: 'Octicons',
    expoAssetId: 'octicons.ttf',
    glyphMap: {
      bell: 0xf0de,
      markGithub: 0xf00a,
    },
    fallbackGlyphMap: {
      bell: '🔔',
      markGithub: '🐙',
    },
  },
  [MODULE_IDS.SimpleLineIcons]: {
    fontName: 'Simple Line Icons',
    expoAssetId: 'simple-line-icons.ttf',
    glyphMap: {
      settings: 0xe09a,
      user: 0xe005,
    },
    fallbackGlyphMap: {
      settings: '⚙',
      user: '👤',
    },
  },
  [MODULE_IDS.Zocial]: {
    fontName: 'zocial',
    expoAssetId: 'zocial.ttf',
    glyphMap: {
      email: 0xf003,
      github: 0xf300,
    },
    fallbackGlyphMap: {
      email: '✉',
      github: '🐙',
    },
  },
});

function createVectorIconsBatchBModules(target = globalThis) {
  return Object.fromEntries(
    Object.entries(FAMILY_CONFIG).map(([moduleId, family]) => [
      moduleId,
      createIconSet(
        family.glyphMap,
        family.fontName,
        family.expoAssetId,
        null,
        {
          fallbackGlyphMap: family.fallbackGlyphMap,
          target,
        },
      ),
    ]),
  );
}

function installModule(registry, moduleId, nextModule) {
  const existingModule = registry[moduleId];

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function installVectorIconsBatchB(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const nextModules = createVectorIconsBatchBModules(target);

  return Object.fromEntries(
    Object.entries(nextModules).map(([moduleId, moduleExports]) => [
      moduleId,
      installModule(registry, moduleId, moduleExports),
    ]),
  );
}

module.exports = installVectorIconsBatchB;
module.exports.install = installVectorIconsBatchB;
module.exports.applyRuntimeShim = installVectorIconsBatchB;
module.exports.createVectorIconsBatchBModules = createVectorIconsBatchBModules;
module.exports.MODULE_IDS = MODULE_IDS;
