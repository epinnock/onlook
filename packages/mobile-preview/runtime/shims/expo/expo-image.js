const reactNativeShim = require('../core/react-native.js');

const MODULE_ID = 'expo-image';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-image shim requires an object target');
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

function omitChildren(props) {
  const nextProps = {};

  if (!props || typeof props !== 'object') {
    return nextProps;
  }

  for (const [key, value] of Object.entries(props)) {
    if (key !== 'children') {
      nextProps[key] = value;
    }
  }

  return nextProps;
}

function buildImageBackgroundContainerProps(props) {
  const {
    style,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
    accessible,
    pointerEvents,
    alt,
  } = props || {};
  const nextProps = {};

  if (style) {
    nextProps.style = style;
  }

  if (testID != null) {
    nextProps.testID = testID;
  }

  if (nativeID != null) {
    nextProps.nativeID = nativeID;
  }

  if (accessibilityLabel != null) {
    nextProps.accessibilityLabel = accessibilityLabel;
  }

  if (accessibilityRole != null) {
    nextProps.accessibilityRole = accessibilityRole;
  }

  if (accessible != null) {
    nextProps.accessible = accessible;
  }

  if (pointerEvents != null) {
    nextProps.pointerEvents = pointerEvents;
  }

  if (alt != null) {
    nextProps.alt = alt;
  }

  return nextProps;
}

function createPreviewImageRef(source) {
  return {
    source,
    width: 0,
    height: 0,
    scale: 1,
    isAnimated: false,
    lockResourceAsync() {
      return Promise.resolve();
    },
    reloadAsync() {
      return Promise.resolve();
    },
    startAnimating() {
      return Promise.resolve();
    },
    stopAnimating() {
      return Promise.resolve();
    },
    unlockResourceAsync() {
      return Promise.resolve();
    },
  };
}

function createImageStatics() {
  return {
    clearDiskCache() {
      return Promise.resolve(false);
    },
    clearMemoryCache() {
      return Promise.resolve(false);
    },
    configureCache() {},
    generateBlurhashAsync() {
      return Promise.resolve(null);
    },
    generateThumbhashAsync() {
      return Promise.resolve('');
    },
    getCachePathAsync() {
      return Promise.resolve(null);
    },
    loadAsync(source) {
      return Promise.resolve(createPreviewImageRef(source));
    },
    prefetch() {
      return Promise.resolve(true);
    },
  };
}

function attachImageStatics(component, statics) {
  for (const [key, value] of Object.entries(statics)) {
    component[key] = value;
  }

  return component;
}

function createImageComponent(target, statics) {
  function Image(props) {
    const reactNativeModule = reactNativeShim.install(target);

    if (typeof reactNativeModule.Image === 'function') {
      return reactNativeModule.Image(omitChildren(props));
    }

    return resolveReact(target).createElement(
      reactNativeModule.Image ?? reactNativeModule.View ?? 'View',
      omitChildren(props),
    );
  }

  Image.displayName = 'Image';
  return attachImageStatics(Image, statics);
}

function createImageBackgroundComponent(Image, target) {
  function ImageBackground(props) {
    const React = resolveReact(target);
    const reactNativeModule = reactNativeShim.install(target);
    const {
      children,
      imageStyle,
      style,
      testID,
      nativeID,
      accessibilityLabel,
      accessibilityRole,
      accessible,
      pointerEvents,
      alt,
      ...imageProps
    } = props || {};
    const backgroundImage = Image({
      ...imageProps,
      style: imageStyle,
    });

    return React.createElement(
      reactNativeModule.View ?? 'View',
      buildImageBackgroundContainerProps({
        style,
        testID,
        nativeID,
        accessibilityLabel,
        accessibilityRole,
        accessible,
        pointerEvents,
        alt,
      }),
      backgroundImage,
      children ?? null,
    );
  }

  ImageBackground.displayName = 'ImageBackground';
  return ImageBackground;
}

function createUseImage() {
  return function useImage(source) {
    if (source == null) {
      return null;
    }

    return createPreviewImageRef(source);
  };
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

  if (
    existingModule.Image &&
    nextModule.Image &&
    (typeof existingModule.Image === 'function' || typeof existingModule.Image === 'object')
  ) {
    attachImageStatics(existingModule.Image, nextModule.Image);
  }

  existingModule.default = existingModule.Image ?? existingModule.default ?? nextModule.default;
  existingModule.__esModule = true;
  return existingModule;
}

function createExpoImageModule(target = globalThis) {
  const statics = createImageStatics();
  const Image = createImageComponent(target, statics);
  const moduleExports = {
    Image,
    ImageBackground: createImageBackgroundComponent(Image, target),
    useImage: createUseImage(),
    ...statics,
  };

  moduleExports.default = Image;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installExpoImageShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const expoImageModule = createExpoImageModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, expoImageModule);
  }

  registry[MODULE_ID] = expoImageModule;
  return expoImageModule;
}

module.exports = installExpoImageShim;
module.exports.install = installExpoImageShim;
module.exports.applyRuntimeShim = installExpoImageShim;
module.exports.createExpoImageModule = createExpoImageModule;
module.exports.createPreviewImageRef = createPreviewImageRef;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
