const vectorIconsBaseShim = require('./vector-icons-base.js');

const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const MODULE_IDS = Object.freeze({
  antDesign: '@expo/vector-icons/AntDesign',
  entypo: '@expo/vector-icons/Entypo',
  feather: '@expo/vector-icons/Feather',
  fontAwesome: '@expo/vector-icons/FontAwesome',
  ionicons: '@expo/vector-icons/Ionicons',
  materialIcons: '@expo/vector-icons/MaterialIcons',
});

const FAMILY_DEFINITIONS = Object.freeze({
  [MODULE_IDS.antDesign]: {
    assetId: '@expo/vector-icons/Fonts/AntDesign.ttf',
    fontName: 'anticon',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/AntDesign.json'),
  },
  [MODULE_IDS.entypo]: {
    assetId: '@expo/vector-icons/Fonts/Entypo.ttf',
    fontName: 'entypo',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Entypo.json'),
  },
  [MODULE_IDS.feather]: {
    assetId: '@expo/vector-icons/Fonts/Feather.ttf',
    fontName: 'feather',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json'),
  },
  [MODULE_IDS.fontAwesome]: {
    assetId: '@expo/vector-icons/Fonts/FontAwesome.ttf',
    fontName: 'FontAwesome',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/FontAwesome.json'),
  },
  [MODULE_IDS.ionicons]: {
    assetId: '@expo/vector-icons/Fonts/Ionicons.ttf',
    fontName: 'ionicons',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'),
  },
  [MODULE_IDS.materialIcons]: {
    assetId: '@expo/vector-icons/Fonts/MaterialIcons.ttf',
    fontName: 'material',
    glyphMap: require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json'),
  },
});

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('vector-icons batch A shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function installVectorIconsBatchA(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const baseModule = vectorIconsBaseShim.install(target);
  const installedModules = {};

  for (const [moduleId, definition] of Object.entries(FAMILY_DEFINITIONS)) {
    if (registry[moduleId] && typeof registry[moduleId] === 'object') {
      installedModules[moduleId] = registry[moduleId];
      continue;
    }

    const familyModule = baseModule.createIconSet(
      definition.glyphMap,
      definition.fontName,
      definition.assetId,
      null,
      {
        target,
      },
    );

    familyModule.default = familyModule;
    familyModule.__esModule = true;

    registry[moduleId] = familyModule;
    installedModules[moduleId] = familyModule;
  }

  return installedModules;
}

module.exports = installVectorIconsBatchA;
module.exports.install = installVectorIconsBatchA;
module.exports.applyRuntimeShim = installVectorIconsBatchA;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.FAMILY_DEFINITIONS = FAMILY_DEFINITIONS;
module.exports.MODULE_IDS = MODULE_IDS;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
