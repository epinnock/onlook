const reactNativeShim = require('../core/react-native.js');

const MODULE_ID = 'react-native-reanimated';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('react-native-reanimated shim requires an object target');
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

function createSharedValue(initialValue) {
  return { value: initialValue };
}

function resolveStaticValue(updater) {
  return typeof updater === 'function' ? updater() : updater;
}

function createAnimatedComponent(Component, target) {
  const displayName =
    typeof Component === 'string'
      ? Component
      : Component?.displayName || Component?.name || 'AnimatedComponent';

  function AnimatedComponent(props) {
    const React = resolveReact(target);
    return React.createElement(Component, props, props?.children);
  }

  AnimatedComponent.displayName = `Animated(${displayName})`;
  return AnimatedComponent;
}

function callAnimationCallback(callback) {
  if (typeof callback === 'function') {
    callback(true);
  }
}

function withTiming(toValue, _config, callback) {
  callAnimationCallback(callback);
  return toValue;
}

function withSpring(toValue, _config, callback) {
  callAnimationCallback(callback);
  return toValue;
}

function withDelay(_delayMs, value) {
  return value;
}

function withRepeat(value) {
  return value;
}

function withSequence(...values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (typeof values[index] !== 'function') {
      return values[index];
    }
  }

  return undefined;
}

function withDecay(config) {
  return config?.velocity ?? 0;
}

function cancelAnimation() {}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolate(value, inputRange, outputRange, extrapolate = 'extend') {
  if (!Array.isArray(inputRange) || !Array.isArray(outputRange) || inputRange.length < 2 || outputRange.length < 2) {
    return value;
  }

  const inputStart = inputRange[0];
  const inputEnd = inputRange[inputRange.length - 1];
  const outputStart = outputRange[0];
  const outputEnd = outputRange[outputRange.length - 1];

  if (inputEnd === inputStart) {
    return outputStart;
  }

  let nextValue = value;

  if (extrapolate === 'clamp') {
    nextValue = clamp(value, inputStart, inputEnd);
  } else if (extrapolate === 'identity' && (value < inputStart || value > inputEnd)) {
    return value;
  }

  const progress = (nextValue - inputStart) / (inputEnd - inputStart);
  return outputStart + (outputEnd - outputStart) * progress;
}

function interpolateColor(value, inputRange, outputRange) {
  if (!Array.isArray(inputRange) || !Array.isArray(outputRange) || inputRange.length === 0 || outputRange.length === 0) {
    return value;
  }

  return value <= inputRange[0] ? outputRange[0] : outputRange[outputRange.length - 1];
}

function runOnJS(callback) {
  return (...args) => (typeof callback === 'function' ? callback(...args) : undefined);
}

function runOnUI(worklet) {
  return (...args) => (typeof worklet === 'function' ? worklet(...args) : undefined);
}

function useSharedValue(initialValue) {
  return createSharedValue(initialValue);
}

function useDerivedValue(updater) {
  return createSharedValue(resolveStaticValue(updater));
}

function useAnimatedStyle(updater) {
  return resolveStaticValue(updater) ?? {};
}

function useAnimatedProps(updater) {
  return resolveStaticValue(updater) ?? {};
}

function useAnimatedReaction(prepare, react) {
  if (typeof prepare === 'function' && typeof react === 'function') {
    react(prepare(), undefined);
  }
}

function useAnimatedScrollHandler(handlers) {
  if (typeof handlers === 'function') {
    return handlers;
  }

  return (event) => handlers?.onScroll?.(event);
}

function useAnimatedGestureHandler(handlers) {
  return handlers ?? {};
}

function useAnimatedRef() {
  return { current: null };
}

function measure() {
  return null;
}

function scrollTo() {}

function createLayoutAnimation(name) {
  const animation = {
    name,
    duration() {
      return animation;
    },
    delay() {
      return animation;
    },
    easing() {
      return animation;
    },
    springify() {
      return animation;
    },
    damping() {
      return animation;
    },
    mass() {
      return animation;
    },
    stiffness() {
      return animation;
    },
    withInitialValues() {
      return animation;
    },
    withCallback(callback) {
      callAnimationCallback(callback);
      return animation;
    },
  };

  return animation;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (
    !('Animated' in existingModule) ||
    existingModule.Animated == null ||
    existingModule.Animated === nextModule.Animated
  ) {
    existingModule.Animated = existingModule;
  }

  if (
    !('default' in existingModule) ||
    existingModule.default == null ||
    existingModule.default === nextModule.default
  ) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function createReactNativeReanimatedModule(target = globalThis) {
  const reactNativeModule = reactNativeShim.install(target);
  const fallbackView = reactNativeModule.View ?? 'View';
  const fallbackText = reactNativeModule.Text ?? fallbackView;
  const fallbackImage = reactNativeModule.Image ?? fallbackView;
  const fallbackScrollView = reactNativeModule.ScrollView ?? fallbackView;
  const fallbackFlatList = reactNativeModule.FlatList ?? fallbackView;

  const moduleExports = {
    View: createAnimatedComponent(fallbackView, target),
    Text: createAnimatedComponent(fallbackText, target),
    Image: createAnimatedComponent(fallbackImage, target),
    ScrollView: createAnimatedComponent(fallbackScrollView, target),
    FlatList: createAnimatedComponent(fallbackFlatList, target),
    createAnimatedComponent(component) {
      return createAnimatedComponent(component, target);
    },
    useSharedValue,
    useDerivedValue,
    useAnimatedStyle,
    useAnimatedProps,
    useAnimatedReaction,
    useAnimatedScrollHandler,
    useAnimatedGestureHandler,
    useAnimatedRef,
    withTiming,
    withSpring,
    withDelay,
    withRepeat,
    withSequence,
    withDecay,
    cancelAnimation,
    interpolate,
    interpolateColor,
    runOnJS,
    runOnUI,
    measure,
    scrollTo,
    Easing: {
      linear(value) {
        return value;
      },
      ease(value) {
        return value;
      },
      in(fn) {
        return fn;
      },
      out(fn) {
        return fn;
      },
      inOut(fn) {
        return fn;
      },
      bezier() {
        return (value) => value;
      },
    },
    Extrapolation: {
      EXTEND: 'extend',
      CLAMP: 'clamp',
      IDENTITY: 'identity',
    },
    FadeIn: createLayoutAnimation('FadeIn'),
    FadeOut: createLayoutAnimation('FadeOut'),
    Layout: createLayoutAnimation('Layout'),
  };

  moduleExports.Extrapolate = moduleExports.Extrapolation;
  moduleExports.Animated = moduleExports;
  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeReanimated(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const reanimatedModule = createReactNativeReanimatedModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, reanimatedModule);
  }

  registry[MODULE_ID] = reanimatedModule;
  return reanimatedModule;
}

module.exports = installReactNativeReanimated;
module.exports.install = installReactNativeReanimated;
module.exports.applyRuntimeShim = installReactNativeReanimated;
module.exports.createReactNativeReanimatedModule = createReactNativeReanimatedModule;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
