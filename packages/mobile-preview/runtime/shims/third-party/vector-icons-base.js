const expoFontShim = require('../expo/expo-font.js');

const MODULE_ID = 'vector-icons-base';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const DEFAULT_ICON_SIZE = 12;
const DEFAULT_ICON_COLOR = 'black';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('vector-icons base shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function resolveReact(target) {
  const candidate = target && target.React;

  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default;
  }

  if (candidate) {
    return candidate;
  }

  return require('react');
}

function resolveTextType(target) {
  return target && target.TextC ? target.TextC : 'Text';
}

function resolveViewType(target) {
  return target && target.View ? target.View : 'View';
}

function normalizeGlyphValue(glyph) {
  if (typeof glyph === 'number') {
    return String.fromCodePoint(glyph);
  }

  if (typeof glyph === 'string' && glyph.length > 0) {
    return glyph;
  }

  return '?';
}

function resolveFallbackGlyph(name, glyphMap, options = {}) {
  if (options.fallbackGlyphMap && name in options.fallbackGlyphMap) {
    return normalizeGlyphValue(options.fallbackGlyphMap[name]);
  }

  const glyph = glyphMap[name];
  if (typeof glyph === 'string' && glyph.length > 0 && !/[\uE000-\uF8FF]/.test(glyph)) {
    return glyph;
  }

  return options.fallbackGlyph ?? '?';
}

function normalizeImageSource(renderResult, size) {
  if (typeof renderResult === 'string') {
    return {
      uri: renderResult,
      width: size,
      height: size,
      scale: 1,
    };
  }

  return {
    scale: 1,
    ...(renderResult || {}),
  };
}

function createIconButtonComponent(Icon, target) {
  function IconButton(props) {
    const React = resolveReact(target);
    const {
      children,
      iconStyle,
      style,
      name,
      size,
      color,
      ...restProps
    } = props || {};

    return React.createElement(
      resolveViewType(target),
      { style, ...restProps },
      React.createElement(Icon, {
        name,
        size,
        color,
        style: iconStyle,
      }),
      children,
    );
  }

  IconButton.displayName = `${Icon.displayName || 'Icon'}.Button`;
  return IconButton;
}

function createIconSet(glyphMap, fontName, expoAssetId, fontStyle, options = {}) {
  const target = options.target ?? globalThis;
  const React = resolveReact(target);
  const expoFontModule = expoFontShim.install(target);
  const font = fontName ? { [fontName]: expoAssetId } : {};

  function resolveGlyph(name) {
    return normalizeGlyphValue(glyphMap?.[name]);
  }

  function isFontLoaded() {
    return fontName ? expoFontModule.isLoaded(fontName) : true;
  }

  function getRenderedGlyph(name) {
    return isFontLoaded()
      ? resolveGlyph(name)
      : resolveFallbackGlyph(name, glyphMap || {}, options);
  }

  function Icon(props) {
    const {
      name,
      size = DEFAULT_ICON_SIZE,
      color = DEFAULT_ICON_COLOR,
      style,
      children,
      ...restProps
    } = props || {};

    const nextStyle = [
      {
        color,
        fontSize: size,
      },
      style,
      isFontLoaded()
        ? {
            fontFamily: fontName,
            fontStyle: 'normal',
            fontWeight: 'normal',
          }
        : null,
      fontStyle || null,
    ].filter(Boolean);

    return React.createElement(
      resolveTextType(target),
      {
        selectable: false,
        ...restProps,
        style: nextStyle,
      },
      ...(children == null
        ? [getRenderedGlyph(name)]
        : [getRenderedGlyph(name), children]),
    );
  }

  Icon.displayName = fontName ? `${fontName}Icon` : 'VectorIcon';
  Icon.defaultProps = {
    allowFontScaling: false,
    size: DEFAULT_ICON_SIZE,
  };
  Icon.Button = createIconButtonComponent(Icon, target);
  Icon.glyphMap = glyphMap;
  Icon.font = font;
  Icon.getRawGlyphMap = () => glyphMap;
  Icon.getFontFamily = () => fontName;
  Icon.hasIcon = (name) => Object.prototype.hasOwnProperty.call(glyphMap || {}, name);
  Icon.loadFont = () => expoFontModule.loadAsync(font);
  Icon.getImageSource = async (
    name,
    size = DEFAULT_ICON_SIZE,
    color = DEFAULT_ICON_COLOR,
  ) => {
    if (typeof expoFontModule.renderToImageAsync !== 'function') {
      return null;
    }

    if (fontName) {
      await Icon.loadFont();
    }

    const result = await expoFontModule.renderToImageAsync(getRenderedGlyph(name), {
      color,
      fontFamily: fontName,
      size,
    });

    return normalizeImageSource(result, size);
  };

  return Icon;
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

function createVectorIconsBaseModule() {
  const moduleExports = {
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_SIZE,
    createIconButtonComponent,
    createIconSet,
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installVectorIconsBase(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createVectorIconsBaseModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installVectorIconsBase;
module.exports.install = installVectorIconsBase;
module.exports.applyRuntimeShim = installVectorIconsBase;
module.exports.createIconButtonComponent = createIconButtonComponent;
module.exports.createIconSet = createIconSet;
module.exports.createVectorIconsBaseModule = createVectorIconsBaseModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.DEFAULT_ICON_COLOR = DEFAULT_ICON_COLOR;
module.exports.DEFAULT_ICON_SIZE = DEFAULT_ICON_SIZE;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
