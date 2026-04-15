export const STYLE_HELPERS_GLOBAL_KEY = '__onlookStyleHelpers';

const STYLE_HELPER_BOOTSTRAP = `const __STYLE_HELPERS_GLOBAL_KEY = ${JSON.stringify(STYLE_HELPERS_GLOBAL_KEY)};
const __COLOR_PROPS = new Set([
  'color', 'backgroundColor', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'borderStartColor', 'borderEndColor', 'borderBlockColor', 'borderInlineColor',
  'shadowColor', 'tintColor', 'overlayColor',
  'textDecorationColor', 'textShadowColor',
  'placeholderTextColor', 'underlineColorAndroid',
]);
const __clampColorChannel = (value) => Math.max(0, Math.min(255, value));
const __cssColorToArgb = (value) => {
  if (typeof value === 'number') return value | 0;
  if (typeof value !== 'string') return value;
  const s = value.trim().toLowerCase();
  if (s === 'transparent') return 0;
  if (s === 'black') return 0xFF000000 | 0;
  if (s === 'white') return 0xFFFFFFFF | 0;
  if (s[0] === '#') {
    const hex = s.slice(1);
    const parse = (h) => parseInt(h, 16);
    if (hex.length === 3) {
      const r = parse(hex[0] + hex[0]);
      const g = parse(hex[1] + hex[1]);
      const b = parse(hex[2] + hex[2]);
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }
    if (hex.length === 6) {
      const r = parse(hex.slice(0, 2));
      const g = parse(hex.slice(2, 4));
      const b = parse(hex.slice(4, 6));
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }
    if (hex.length === 8) {
      const r = parse(hex.slice(0, 2));
      const g = parse(hex.slice(2, 4));
      const b = parse(hex.slice(4, 6));
      const a = parse(hex.slice(6, 8));
      return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }
  }
  const rgba = s.match(/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*(\\d*\\.?\\d+)\\s*)?\\)$/);
  if (rgba) {
    const r = __clampColorChannel(parseInt(rgba[1], 10));
    const g = __clampColorChannel(parseInt(rgba[2], 10));
    const b = __clampColorChannel(parseInt(rgba[3], 10));
    const a = rgba[4] != null ? __clampColorChannel(Math.round(parseFloat(rgba[4]) * 255)) : 0xFF;
    return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
  }
  return value;
};
const __convertStyleColors = (style) => {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  let changed = false;
  const out = {};
  for (const key in style) {
    const value = style[key];
    if (__COLOR_PROPS.has(key)) {
      const convertedValue = __cssColorToArgb(value);
      if (convertedValue !== value) changed = true;
      out[key] = convertedValue;
      continue;
    }
    out[key] = value;
  }
  return changed ? out : style;
};
const __flattenStyle = (style) => {
  if (Array.isArray(style)) {
    return style.reduce((acc, item) => {
      if (item && typeof item === 'object') {
        Object.assign(acc, __flattenStyle(item));
      }
      return acc;
    }, {});
  }
  return __convertStyleColors(style && typeof style === 'object' ? style : {});
};
const __createStyleSheet = (styles) => {
  if (!styles || typeof styles !== 'object') return {};
  const out = {};
  for (const key in styles) {
    out[key] = __convertStyleColors(styles[key]);
  }
  return out;
};
const __composeStyles = (a, b) => Object.assign({}, __flattenStyle(a), __flattenStyle(b));
const __createOnlookStyleHelpers = () => ({
  composeStyles: __composeStyles,
  convertStyleColors: __convertStyleColors,
  createStyleSheet: __createStyleSheet,
  cssColorToArgb: __cssColorToArgb,
  flattenStyle: __flattenStyle,
});
const __installOnlookStyleHelpers = (target) => {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return __createOnlookStyleHelpers();
  }
  if (target[__STYLE_HELPERS_GLOBAL_KEY]) {
    return target[__STYLE_HELPERS_GLOBAL_KEY];
  }
  const helpers = __createOnlookStyleHelpers();
  target[__STYLE_HELPERS_GLOBAL_KEY] = helpers;
  return helpers;
};
const __styleHelpers = globalThis[__STYLE_HELPERS_GLOBAL_KEY] ?? __installOnlookStyleHelpers(globalThis);`;

export function wrapEvalBundle(
    entryPath: string,
    orderedModules: string[],
    moduleMap: Record<string, string>,
): string {
    const modules = orderedModules
        .map(
            (filePath) =>
                `${JSON.stringify(filePath)}: function(require, module, exports) {\n${moduleMap[filePath]}\n}`,
        )
        .join(',\n');

    return `(() => {
const React = globalThis.React;
if (!React || typeof globalThis.renderApp !== 'function') {
  throw new Error('Onlook mobile preview runtime is not ready.');
}
let __appRegistered = false;
const __modules = {
${modules}
};
const __cache = {};
${STYLE_HELPER_BOOTSTRAP}
// Fabric only natively knows a few element types ('View', 'RCTText',
// 'RCTRawText'). Higher-level RN components like ScrollView / SafeAreaView /
// TouchableOpacity need to be React components that render down to one of
// the known native types — otherwise the reconciler creates a node with
// type 'ScrollView' / 'TouchableOpacity' / etc. and Fabric silently drops
// the entire subtree, leaving a white screen.
const __PASSTHROUGH_VIEW = (props) => {
  const { children, onPress, onPressIn, onPressOut, onLongPress, activeOpacity, underlayColor, ...rest } = props || {};
  return React.createElement(globalThis.View, rest, children);
};
const __reactNative = {
  View: globalThis.View,
  Text: globalThis.TextC,
  TextInput: __PASSTHROUGH_VIEW,
  Image: __PASSTHROUGH_VIEW,
  ScrollView: __PASSTHROUGH_VIEW,
  SafeAreaView: __PASSTHROUGH_VIEW,
  Pressable: __PASSTHROUGH_VIEW,
  TouchableOpacity: __PASSTHROUGH_VIEW,
  TouchableHighlight: __PASSTHROUGH_VIEW,
  TouchableWithoutFeedback: __PASSTHROUGH_VIEW,
  StatusBar: () => null,
  RawText: globalThis.RawText,
  Fragment: React.Fragment,
  StyleSheet: {
    create(styles) {
      return __styleHelpers.createStyleSheet(styles);
    },
    compose(a, b) {
      return __styleHelpers.composeStyles(a, b);
    },
    flatten(style) {
      return __styleHelpers.flattenStyle(style);
    },
  },
  Platform: {
    OS: 'ios',
    select(options) {
      return options && (options.ios ?? options.native ?? options.default);
    },
  },
  Dimensions: {
    get() {
      return { width: 390, height: 844, scale: 3, fontScale: 1 };
    },
  },
  Alert: {
    alert() {},
  },
  AppRegistry: {
    registerComponent(appKey, componentProvider) {
      if (appKey === 'main' && !__appRegistered) {
        __appRegistered = true;
        try {
          const Comp = componentProvider();
          if (Comp) {
            globalThis.renderApp(React.createElement(Comp, null));
          }
        } catch (err) {
          throw err;
        }
      }
    },
    runApplication() {
      // No-op: registerComponent already triggered the mount above.
    },
  },
};
__reactNative.default = __reactNative;
__reactNative.__esModule = true;
const __safeAreaContext = {
  SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  SafeAreaView: __reactNative.SafeAreaView,
  useSafeAreaInsets() {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  },
};
__safeAreaContext.default = __safeAreaContext;
__safeAreaContext.__esModule = true;
const __expoStatusBar = {
  StatusBar() { return null; },
};
__expoStatusBar.default = __expoStatusBar.StatusBar;
__expoStatusBar.__esModule = true;
const __expoRouter = {
  Link: ({ children }) => React.createElement(globalThis.TextC, null, children),
  Redirect: () => null,
  Slot: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  Stack: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  Tabs: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  useRouter() {
    return { push() {}, replace() {}, back() {} };
  },
  useLocalSearchParams() {
    return {};
  },
};
__expoRouter.default = __expoRouter;
__expoRouter.__esModule = true;
function __require(specifier) {
  if (specifier === 'react') {
    return React;
  }
  if (specifier === 'react-native') {
    return __reactNative;
  }
  if (specifier === 'react-native-safe-area-context') {
    return __safeAreaContext;
  }
  if (specifier === 'expo-status-bar') {
    return __expoStatusBar;
  }
  if (specifier === 'expo-router') {
    return __expoRouter;
  }
  if (specifier === 'onlook-preload-script.js') {
    return {};
  }
  if (__cache[specifier]) {
    return __cache[specifier].exports;
  }
  const factory = __modules[specifier];
  if (!factory) {
    throw new Error('Module not found: ' + specifier);
  }
  const module = { exports: {} };
  __cache[specifier] = module;
  factory(__require, module, module.exports);
  return module.exports;
}
const __entryModule = __require(${JSON.stringify(entryPath)});
if (!__appRegistered) {
  const __root = __entryModule && __entryModule.__esModule ? __entryModule.default : (__entryModule.default ?? __entryModule);
  if (!__root || typeof __root !== 'function') {
    throw new Error('Entry module "${entryPath}" did not call AppRegistry.registerComponent and did not export a component.');
  }
  globalThis.renderApp(React.createElement(__root, null));
}
})();`;
}
