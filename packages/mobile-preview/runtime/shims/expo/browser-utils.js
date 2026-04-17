const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const MODULE_IDS = Object.freeze({
  clipboard: 'expo-clipboard',
  haptics: 'expo-haptics',
  webBrowser: 'expo-web-browser',
});
const NATIVE_MODULE_NAMES = Object.freeze({
  clipboard: ['ExpoClipboard', 'ExponentClipboard'],
  haptics: ['ExpoHaptics', 'ExponentHaptics'],
  webBrowser: ['ExpoWebBrowser', 'ExponentWebBrowser'],
});
const CONTENT_TYPE = Object.freeze({
  HTML: 'html',
  IMAGE: 'image',
  PLAIN_TEXT: 'plain-text',
  URL: 'url',
});
const IMPACT_FEEDBACK_STYLE = Object.freeze({
  Heavy: 'Heavy',
  Light: 'Light',
  Medium: 'Medium',
  Rigid: 'Rigid',
  Soft: 'Soft',
});
const NOTIFICATION_FEEDBACK_TYPE = Object.freeze({
  Error: 'Error',
  Success: 'Success',
  Warning: 'Warning',
});
const ANDROID_HAPTICS = Object.freeze({
  Confirm: 'confirm',
  Context_Click: 'context-click',
  Drag_Start: 'drag-start',
  Gesture_End: 'gesture-end',
  Gesture_Start: 'gesture-start',
  Keyboard_Press: 'keyboard-press',
  Keyboard_Release: 'keyboard-release',
  Keyboard_Tap: 'keyboard-tap',
  Long_Press: 'long-press',
  Reject: 'reject',
  Segment_Frequent_Tick: 'segment-frequent-tick',
  Segment_Tick: 'segment-tick',
  Text_Handle_Move: 'text-handle-move',
  Toggle_Off: 'toggle-off',
  Toggle_On: 'toggle-on',
  Virtual_Key: 'virtual-key',
  Virtual_Key_Release: 'virtual-key-release',
});
const WEB_BROWSER_RESULT_TYPE = Object.freeze({
  CANCEL: 'cancel',
  DISMISS: 'dismiss',
  LOCKED: 'locked',
  OPENED: 'opened',
});
const WEB_BROWSER_PRESENTATION_STYLE = Object.freeze({
  AUTOMATIC: 'automatic',
  CURRENT_CONTEXT: 'currentContext',
  FORM_SHEET: 'formSheet',
  FULL_SCREEN: 'fullScreen',
  OVER_CURRENT_CONTEXT: 'overCurrentContext',
  OVER_FULL_SCREEN: 'overFullScreen',
  PAGE_SHEET: 'pageSheet',
  POPOVER: 'popover',
});

function ensureRuntimeShimRegistry(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('expo browser utils shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function resolveModuleFromSource(source, name) {
  if (!source) {
    return null;
  }

  try {
    if (typeof source === 'function') {
      return source(name) ?? null;
    }

    if (typeof source === 'object') {
      return source[name] ?? null;
    }
  } catch (_) {
    return null;
  }

  return null;
}

function resolveNativeModule(target, moduleNames) {
  for (const moduleName of moduleNames) {
    const module =
      resolveModuleFromSource(target?.NativeModules, moduleName) ??
      resolveModuleFromSource(target?.nativeModuleProxy, moduleName) ??
      resolveModuleFromSource(target?.__turboModuleProxy, moduleName) ??
      (target?.TurboModuleRegistry && typeof target.TurboModuleRegistry.get === 'function'
        ? resolveModuleFromSource(target.TurboModuleRegistry.get.bind(target.TurboModuleRegistry), moduleName)
        : null);

    if (module) {
      return module;
    }
  }

  return null;
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

  if (!('default' in existingModule) || existingModule.default == null) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function installRuntimeModule(target, moduleId, nextModule) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[moduleId];

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function resolveNativeMethod(nativeModule, methodName) {
  return nativeModule && typeof nativeModule[methodName] === 'function'
    ? nativeModule[methodName].bind(nativeModule)
    : null;
}

function normalizeClipboardValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  return String(value);
}

function createClipboardModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_NAMES.clipboard);
  const state = {
    listeners: new Set(),
    value: '',
  };

  function notifyListeners() {
    for (const listener of state.listeners) {
      try {
        listener({ contentTypes: [CONTENT_TYPE.PLAIN_TEXT] });
      } catch (_) {
        // Listener errors should not break the preview runtime.
      }
    }
  }

  function setLocalValue(nextValue) {
    state.value = normalizeClipboardValue(nextValue);
    notifyListeners();
    return true;
  }

  function getLocalValue() {
    return state.value;
  }

  const moduleExports = {
    ContentType: CONTENT_TYPE,
    ClipboardPasteButton() {
      return null;
    },
    addClipboardListener(listener) {
      const nativeMethod = resolveNativeMethod(nativeModule, 'addClipboardListener');

      if (nativeMethod) {
        return nativeMethod(listener);
      }

      if (typeof listener === 'function') {
        state.listeners.add(listener);
      }

      return {
        remove() {
          state.listeners.delete(listener);
        },
      };
    },
    getImageAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'getImageAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod());
      }

      return Promise.resolve(null);
    },
    getString() {
      const syncGetter = resolveNativeMethod(nativeModule, 'getString');

      if (syncGetter) {
        return normalizeClipboardValue(syncGetter());
      }

      return getLocalValue();
    },
    getStringAsync() {
      const asyncGetter = resolveNativeMethod(nativeModule, 'getStringAsync');
      const syncGetter = resolveNativeMethod(nativeModule, 'getString');

      if (asyncGetter) {
        return Promise.resolve(asyncGetter()).then(normalizeClipboardValue);
      }

      if (syncGetter) {
        return Promise.resolve(normalizeClipboardValue(syncGetter()));
      }

      return Promise.resolve(getLocalValue());
    },
    getUrlAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'getUrlAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod()).then(normalizeClipboardValue);
      }

      return Promise.resolve(getLocalValue());
    },
    hasImageAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'hasImageAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod());
      }

      return Promise.resolve(false);
    },
    hasStringAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'hasStringAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod());
      }

      return Promise.resolve(getLocalValue().length > 0);
    },
    hasUrlAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'hasUrlAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod());
      }

      return Promise.resolve(getLocalValue().length > 0);
    },
    isPasteButtonAvailable: false,
    removeClipboardListener(listener) {
      const nativeMethod = resolveNativeMethod(nativeModule, 'removeClipboardListener');

      if (nativeMethod) {
        return nativeMethod(listener);
      }

      state.listeners.delete(listener);
      return undefined;
    },
    setImageAsync() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'setImageAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod.apply(nativeModule, arguments));
      }

      return Promise.resolve(false);
    },
    setString(value) {
      const nativeMethod = resolveNativeMethod(nativeModule, 'setString');

      if (nativeMethod) {
        return nativeMethod(value);
      }

      return setLocalValue(value);
    },
    setStringAsync(value) {
      const asyncSetter = resolveNativeMethod(nativeModule, 'setStringAsync');
      const syncSetter = resolveNativeMethod(nativeModule, 'setString');

      if (asyncSetter) {
        return Promise.resolve(asyncSetter(value));
      }

      if (syncSetter) {
        return Promise.resolve(syncSetter(value));
      }

      return Promise.resolve(setLocalValue(value));
    },
    setUrlAsync(value) {
      const nativeMethod = resolveNativeMethod(nativeModule, 'setUrlAsync');

      if (nativeMethod) {
        return Promise.resolve(nativeMethod(value));
      }

      return Promise.resolve(setLocalValue(value));
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createHapticsModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_NAMES.haptics);

  function callHaptics(methodName, args) {
    const nativeMethod = resolveNativeMethod(nativeModule, methodName);

    if (nativeMethod) {
      return Promise.resolve(nativeMethod(...args));
    }

    return Promise.resolve(undefined);
  }

  const moduleExports = {
    AndroidHaptics: ANDROID_HAPTICS,
    ImpactFeedbackStyle: IMPACT_FEEDBACK_STYLE,
    NotificationFeedbackType: NOTIFICATION_FEEDBACK_TYPE,
    impactAsync(style) {
      return callHaptics('impactAsync', [style]);
    },
    notificationAsync(type) {
      return callHaptics('notificationAsync', [type]);
    },
    performAndroidHapticsAsync(type) {
      return callHaptics('performAndroidHapticsAsync', [type]);
    },
    selectionAsync() {
      return callHaptics('selectionAsync', []);
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createWebBrowserModule(target = globalThis) {
  const nativeModule = resolveNativeModule(target, NATIVE_MODULE_NAMES.webBrowser);

  function callWebBrowser(methodName, args, fallbackValue) {
    const nativeMethod = resolveNativeMethod(nativeModule, methodName);

    if (nativeMethod) {
      return Promise.resolve(nativeMethod(...args));
    }

    return Promise.resolve(
      typeof fallbackValue === 'function' ? fallbackValue(...args) : fallbackValue,
    );
  }

  const moduleExports = {
    WebBrowserPresentationStyle: WEB_BROWSER_PRESENTATION_STYLE,
    WebBrowserResultType: WEB_BROWSER_RESULT_TYPE,
    coolDownAsync() {
      return callWebBrowser('coolDownAsync', [], undefined);
    },
    dismissAuthSession() {
      return callWebBrowser('dismissAuthSession', [], {
        type: WEB_BROWSER_RESULT_TYPE.DISMISS,
      });
    },
    dismissBrowser() {
      return callWebBrowser('dismissBrowser', [], {
        type: WEB_BROWSER_RESULT_TYPE.DISMISS,
      });
    },
    getCustomTabsSupportingBrowsersAsync() {
      return callWebBrowser('getCustomTabsSupportingBrowsersAsync', [], {
        browserPackages: [],
        defaultBrowserPackage: null,
        preferredBrowserPackage: null,
        servicePackages: [],
      });
    },
    mayInitWithUrlAsync(url) {
      return callWebBrowser('mayInitWithUrlAsync', [url], undefined);
    },
    maybeCompleteAuthSession() {
      const nativeMethod = resolveNativeMethod(nativeModule, 'maybeCompleteAuthSession');

      if (nativeMethod) {
        return nativeMethod();
      }

      return {
        message: 'Auth session completion is not available in mobile preview.',
        type: 'failed',
      };
    },
    openAuthSessionAsync(url, redirectUrl, options) {
      return callWebBrowser('openAuthSessionAsync', [url, redirectUrl, options], {
        type: WEB_BROWSER_RESULT_TYPE.CANCEL,
      });
    },
    openBrowserAsync(url, options) {
      return callWebBrowser('openBrowserAsync', [url, options], {
        type: WEB_BROWSER_RESULT_TYPE.OPENED,
      });
    },
    warmUpAsync() {
      return callWebBrowser('warmUpAsync', [], undefined);
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installExpoBrowserUtilsShim(target = globalThis) {
  return {
    [MODULE_IDS.clipboard]: installRuntimeModule(
      target,
      MODULE_IDS.clipboard,
      createClipboardModule(target),
    ),
    [MODULE_IDS.haptics]: installRuntimeModule(
      target,
      MODULE_IDS.haptics,
      createHapticsModule(target),
    ),
    [MODULE_IDS.webBrowser]: installRuntimeModule(
      target,
      MODULE_IDS.webBrowser,
      createWebBrowserModule(target),
    ),
  };
}

const browserUtilsShim = {
  AndroidHaptics: ANDROID_HAPTICS,
  ContentType: CONTENT_TYPE,
  ImpactFeedbackStyle: IMPACT_FEEDBACK_STYLE,
  MODULE_IDS,
  NATIVE_MODULE_NAMES,
  NotificationFeedbackType: NOTIFICATION_FEEDBACK_TYPE,
  RUNTIME_SHIM_REGISTRY_KEY,
  WebBrowserPresentationStyle: WEB_BROWSER_PRESENTATION_STYLE,
  WebBrowserResultType: WEB_BROWSER_RESULT_TYPE,
  applyRuntimeShim: installExpoBrowserUtilsShim,
  createClipboardModule,
  createHapticsModule,
  createWebBrowserModule,
  ensureRuntimeShimRegistry,
  install: installExpoBrowserUtilsShim,
  mergeRuntimeModule,
  resolveModuleFromSource,
  resolveNativeModule,
};

browserUtilsShim.default = browserUtilsShim;
browserUtilsShim.__esModule = true;

module.exports = browserUtilsShim;
