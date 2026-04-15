const hostComponents = [];

const BUILTIN_COMPONENT_DEFINITIONS = [
  { id: 'View', nativeType: 'View' },
  { id: 'Text', nativeType: 'RCTText' },
  { id: 'RCTText', nativeType: 'RCTText' },
  { id: 'RawText', nativeType: 'RCTRawText' },
  { id: 'RCTRawText', nativeType: 'RCTRawText' },
];

function unwrapDefaultExport(moduleExports) {
  if (
    moduleExports &&
    typeof moduleExports === 'object' &&
    'default' in moduleExports &&
    moduleExports.default
  ) {
    return moduleExports.default;
  }

  return moduleExports;
}

function toKebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveHostComponentId(moduleExports, candidate, fallbackId) {
  if (candidate && typeof candidate === 'object' && typeof candidate.id === 'string') {
    return candidate.id;
  }

  if (typeof moduleExports === 'function' && moduleExports.name) {
    return moduleExports.name;
  }

  if (candidate && typeof candidate === 'function' && candidate.name) {
    return candidate.name;
  }

  return fallbackId;
}

function normalizeResolvedComponent(type, props, resolved, componentId) {
  if (!resolved || typeof resolved !== 'object') {
    throw new TypeError(`Host component "${componentId}" did not return a component mapping`);
  }

  return {
    type: typeof resolved.type === 'string' ? resolved.type : type,
    props: resolved.props ?? props,
    componentId,
  };
}

function normalizeHostComponent(moduleExports, fallbackId) {
  const candidate = unwrapDefaultExport(moduleExports);
  const id = resolveHostComponentId(moduleExports, candidate, fallbackId);

  if (typeof candidate === 'function') {
    return {
      id,
      resolve(type, props, context) {
        return normalizeResolvedComponent(type, props, candidate(type, props, context), id);
      },
    };
  }

  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`Host component "${fallbackId}" does not export a mapping`);
  }

  if (typeof candidate.resolve === 'function') {
    return {
      id,
      shouldHandle:
        typeof candidate.shouldHandle === 'function'
          ? candidate.shouldHandle.bind(candidate)
          : undefined,
      resolve(type, props, context) {
        return normalizeResolvedComponent(type, props, candidate.resolve(type, props, context), id);
      },
    };
  }

  const nativeType =
    typeof candidate.nativeType === 'string'
      ? candidate.nativeType
      : typeof candidate.type === 'string'
        ? candidate.type
        : null;

  if (!nativeType) {
    throw new TypeError(`Host component "${fallbackId}" must export resolve() or nativeType`);
  }

  return {
    id,
    shouldHandle:
      typeof candidate.shouldHandle === 'function' ? candidate.shouldHandle.bind(candidate) : undefined,
    resolve(type, props, context) {
      const nextProps =
        typeof candidate.mapProps === 'function' ? candidate.mapProps(props, context) : props;

      return normalizeResolvedComponent(
        type,
        props,
        {
          type: nativeType,
          props: nextProps,
        },
        id,
      );
    },
  };
}

function ensureBuiltinHostComponentsRegistered() {
  for (const definition of BUILTIN_COMPONENT_DEFINITIONS) {
    registerHostComponent(definition, definition.id);
  }
}

function normalizeDiscoveredComponentId(path) {
  const match = path.match(/\.\/(.+)\.js$/);

  if (!match) {
    return null;
  }

  if (match[1] === 'index') {
    return null;
  }

  return match[1];
}

export function getHostComponentCandidateIds(type, props) {
  const candidates = [type];

  if (type === 'TextInput') {
    candidates.push(props && props.multiline ? 'text-input-multiline' : 'text-input-singleline');
  }

  if (type === 'Modal') {
    candidates.push('modal-surface');
  }

  candidates.push(toKebabCase(type));
  return unique(candidates);
}

export function registerHostComponent(moduleExports, fallbackId) {
  const component = normalizeHostComponent(moduleExports, fallbackId);
  const existingComponent = hostComponents.find(entry => entry.id === component.id);

  if (existingComponent) {
    return existingComponent;
  }

  hostComponents.push(component);
  return component;
}

export function primeAutoDiscoveredHostComponents(
  discoveredModules = globalThis.__ONLOOK_HOST_COMPONENT_MODULES__ ?? {},
) {
  ensureBuiltinHostComponentsRegistered();

  for (const [path, moduleExports] of Object.entries(discoveredModules).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const fallbackId = normalizeDiscoveredComponentId(path);

    if (!fallbackId) {
      continue;
    }

    registerHostComponent(moduleExports, fallbackId);
  }

  return getRegisteredHostComponentIds();
}

export function resolveHostComponent(type, props, options = {}) {
  primeAutoDiscoveredHostComponents(options.discoveredModules);

  for (const componentId of getHostComponentCandidateIds(type, props)) {
    const component = hostComponents.find(entry => entry.id === componentId);

    if (component) {
      return component.resolve(type, props, { componentId, sourceType: type });
    }
  }

  for (const component of hostComponents) {
    if (typeof component.shouldHandle === 'function' && component.shouldHandle(type, props)) {
      return component.resolve(type, props, { componentId: component.id, sourceType: type });
    }
  }

  return { type, props, componentId: null };
}

export function getRegisteredHostComponentIds() {
  return hostComponents.map(component => component.id);
}

export function resetHostComponentRegistry() {
  hostComponents.length = 0;
}
