const reactNativeShim = require('./react-native.js');

const SHIM_ID = 'onlook-section-list';
const {
  MODULE_ID: REACT_NATIVE_MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  ensureRuntimeShimRegistry,
} = reactNativeShim;

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

function resolveRendererElement(React, renderer, info, key) {
  if (typeof renderer !== 'function') {
    return null;
  }

  const element = renderer(info);
  if (!React.isValidElement(element)) {
    return element;
  }

  return key == null ? element : React.cloneElement(element, { key });
}

function resolveComponentElement(React, component, props, key) {
  if (component == null) {
    return null;
  }

  if (React.isValidElement(component)) {
    return key == null ? component : React.cloneElement(component, { key });
  }

  if (typeof component === 'function' || typeof component === 'string') {
    return React.createElement(component, key == null ? props : { ...props, key });
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

function defaultKeyExtractor(item, index) {
  if (item && typeof item === 'object') {
    if (typeof item.key === 'string' || typeof item.key === 'number') {
      return String(item.key);
    }

    if (typeof item.id === 'string' || typeof item.id === 'number') {
      return String(item.id);
    }
  }

  return String(index);
}

function createSectionListComponent(target, reactNativeModule) {
  function SectionList(props = {}) {
    const React = resolveReact(target);
    const {
      ItemSeparatorComponent,
      ListEmptyComponent,
      ListFooterComponent,
      ListHeaderComponent,
      SectionSeparatorComponent,
      keyExtractor = defaultKeyExtractor,
      renderItem,
      renderSectionFooter,
      renderSectionHeader,
      sections = [],
      stickySectionHeadersEnabled,
      ...scrollViewProps
    } = props;

    const children = [];

    const pushChild = (child) => {
      if (child == null) {
        return;
      }

      if (Array.isArray(child)) {
        child.forEach(pushChild);
        return;
      }

      children.push(child);
    };

    pushChild(
      resolveComponentElement(
        React,
        ListHeaderComponent,
        { sections },
        'list-header',
      ),
    );

    if (!Array.isArray(sections) || sections.length === 0) {
      pushChild(
        resolveComponentElement(
          React,
          ListEmptyComponent,
          { sections: [] },
          'list-empty',
        ),
      );
    } else {
      sections.forEach((section, sectionIndex) => {
        const sectionKey =
          typeof section?.key === 'string' || typeof section?.key === 'number'
            ? String(section.key)
            : String(sectionIndex);
        const data = Array.isArray(section?.data) ? section.data : [];

        pushChild(
          resolveRendererElement(
            React,
            renderSectionHeader,
            { section },
            `section-header-${sectionKey}`,
          ),
        );

        data.forEach((item, itemIndex) => {
          const itemKey = keyExtractor(item, itemIndex);
          pushChild(
            resolveRendererElement(
              React,
              renderItem,
              {
                item,
                index: itemIndex,
                section,
                separators: createSeparators(),
              },
              `item-${sectionKey}-${itemKey}`,
            ),
          );

          if (itemIndex < data.length - 1) {
            pushChild(
              resolveComponentElement(
                React,
                ItemSeparatorComponent,
                {
                  leadingItem: item,
                  section,
                  trailingItem: data[itemIndex + 1],
                },
                `item-separator-${sectionKey}-${itemKey}`,
              ),
            );
          }
        });

        pushChild(
          resolveRendererElement(
            React,
            renderSectionFooter,
            { section },
            `section-footer-${sectionKey}`,
          ),
        );

        if (sectionIndex < sections.length - 1) {
          pushChild(
            resolveComponentElement(
              React,
              SectionSeparatorComponent,
              {
                leadingSection: section,
                trailingSection: sections[sectionIndex + 1],
              },
              `section-separator-${sectionKey}`,
            ),
          );
        }
      });
    }

    pushChild(
      resolveComponentElement(
        React,
        ListFooterComponent,
        { sections },
        'list-footer',
      ),
    );

    return React.createElement(
      reactNativeModule.ScrollView,
      {
        ...scrollViewProps,
        stickySectionHeadersEnabled,
      },
      children,
    );
  }

  SectionList.displayName = 'SectionList';
  return SectionList;
}

function installSectionList(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const reactNativeModule = reactNativeShim.install(target);

  if (!reactNativeModule.SectionList) {
    reactNativeModule.SectionList = createSectionListComponent(target, reactNativeModule);
  }

  reactNativeModule.default = reactNativeModule.default ?? reactNativeModule;
  reactNativeModule.__esModule = true;
  registry[REACT_NATIVE_MODULE_ID] = reactNativeModule;

  return reactNativeModule.SectionList;
}

const sectionListShim = {
  id: SHIM_ID,
  install: installSectionList,
  applyRuntimeShim: installSectionList,
  createSectionListComponent,
  installSectionList,
  REACT_NATIVE_MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  SHIM_ID,
};

sectionListShim.default = sectionListShim;
sectionListShim.__esModule = true;

module.exports = sectionListShim;
