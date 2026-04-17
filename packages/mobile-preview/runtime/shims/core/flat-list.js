const reactNativeShim = require('./react-native.js');

const SHIM_ID = 'onlook-flat-list';
const REACT_NATIVE_MODULE_ID = 'react-native';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

function ensureRuntimeShimRegistry(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('flat-list shim requires an object target');
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

function resolveScrollView(target) {
  const reactNativeModule = reactNativeShim.install(target);
  return reactNativeModule.ScrollView ?? reactNativeModule.View ?? 'View';
}

function resolveKey(item, index, keyExtractor) {
  if (typeof keyExtractor === 'function') {
    return String(keyExtractor(item, index));
  }

  if (item && typeof item === 'object' && item.key != null) {
    return String(item.key);
  }

  if (item && typeof item === 'object' && item.id != null) {
    return String(item.id);
  }

  return String(index);
}

function normalizeComponentElement(Component, props, fallbackKey, React) {
  if (Component == null) {
    return null;
  }

  if (React.isValidElement(Component)) {
    return fallbackKey == null ? Component : React.cloneElement(Component, { key: fallbackKey });
  }

  if (typeof Component === 'function') {
    return React.createElement(Component, fallbackKey == null ? props : { ...props, key: fallbackKey });
  }

  return null;
}

function createSeparators() {
  return {
    highlight() {},
    unhighlight() {},
    updateProps() {},
  };
}

function createFlatListComponent(target = globalThis) {
  function FlatList(props) {
    const React = resolveReact(target);
    const ScrollView = resolveScrollView(target);
    const {
      CellRendererComponent,
      ItemSeparatorComponent,
      ListEmptyComponent,
      ListFooterComponent,
      ListHeaderComponent,
      data,
      horizontal,
      keyExtractor,
      renderItem,
      ...restProps
    } = props || {};

    const items = Array.isArray(data) ? data : [];
    const children = [];

    const header = normalizeComponentElement(ListHeaderComponent, {}, 'flat-list-header', React);
    if (header) {
      children.push(header);
    }

    if (items.length === 0) {
      const empty = normalizeComponentElement(ListEmptyComponent, {}, 'flat-list-empty', React);
      if (empty) {
        children.push(empty);
      }
    } else if (typeof renderItem === 'function') {
      items.forEach((item, index) => {
        const key = resolveKey(item, index, keyExtractor);
        const renderedItem = renderItem({
          index,
          item,
          separators: createSeparators(),
        });

        if (renderedItem != null) {
          const cellProps = {
            children: renderedItem,
            horizontal: !!horizontal,
            index,
            item,
            key,
          };

          children.push(
            typeof CellRendererComponent === 'function'
              ? React.createElement(CellRendererComponent, cellProps)
              : React.createElement(React.Fragment, { key }, renderedItem),
          );
        }

        if (index < items.length - 1) {
          const separator = normalizeComponentElement(
            ItemSeparatorComponent,
            {},
            `flat-list-separator-${key}`,
            React,
          );
          if (separator) {
            children.push(separator);
          }
        }
      });
    }

    const footer = normalizeComponentElement(ListFooterComponent, {}, 'flat-list-footer', React);
    if (footer) {
      children.push(footer);
    }

    return React.createElement(
      ScrollView,
      {
        ...restProps,
        horizontal,
      },
      ...children,
    );
  }

  FlatList.displayName = 'FlatList';
  return FlatList;
}

function mergeIntoReactNativeModule(target, FlatList) {
  const registry = ensureRuntimeShimRegistry(target);
  const reactNativeModule = reactNativeShim.install(target);

  reactNativeModule.FlatList = reactNativeModule.FlatList ?? FlatList;
  reactNativeModule.default = reactNativeModule.default ?? reactNativeModule;
  reactNativeModule.__esModule = true;
  registry[REACT_NATIVE_MODULE_ID] = reactNativeModule;

  return reactNativeModule;
}

function installFlatListShim(target = globalThis) {
  const FlatList = createFlatListComponent(target);
  const reactNativeModule = mergeIntoReactNativeModule(target, FlatList);

  return {
    FlatList: reactNativeModule.FlatList,
  };
}

const flatListShim = {
  id: SHIM_ID,
  install: installFlatListShim,
  applyRuntimeShim: installFlatListShim,
  createFlatListComponent,
  ensureRuntimeShimRegistry,
  mergeIntoReactNativeModule,
  REACT_NATIVE_MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  SHIM_ID,
};

flatListShim.default = flatListShim;
flatListShim.__esModule = true;

module.exports = flatListShim;
