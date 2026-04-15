import { installStyleHelpers } from '../../shims/core/style.js';

const styleResolvers = [];
const BUILTIN_STYLE_RESOLVERS = [
  {
    id: 'flatten',
    order: -1000,
    resolve(style, context) {
      const flattenedStyle = context.styleHelpers.flattenStyle(style);
      return flattenedStyle && typeof flattenedStyle === 'object' ? { ...flattenedStyle } : {};
    },
  },
];

let nextRegistrationOrder = 0;

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

function normalizeStyleResolverId(moduleExports, candidate, fallbackId) {
  if (candidate && typeof candidate === 'object' && typeof candidate.id === 'string') {
    return candidate.id;
  }

  if (typeof moduleExports === 'function' && moduleExports.name) {
    return moduleExports.name;
  }

  if (candidate && typeof candidate === 'function' && candidate.name && candidate.name !== 'default') {
    return candidate.name;
  }

  return fallbackId;
}

function normalizeDiscoveredStyleResolverId(path) {
  const match = path.match(/\.\/(.+)\.js$/);

  if (!match) {
    return null;
  }

  if (match[1] === 'index') {
    return null;
  }

  return match[1];
}

function normalizeStyleResolver(moduleExports, fallbackId) {
  const candidate = unwrapDefaultExport(moduleExports);
  const id = normalizeStyleResolverId(moduleExports, candidate, fallbackId);

  if (typeof candidate === 'function') {
    return {
      id,
      order: 0,
      resolve(style, context) {
        return candidate(style, context);
      },
    };
  }

  if (!candidate || typeof candidate !== 'object' || typeof candidate.resolve !== 'function') {
    throw new TypeError(`Style resolver "${fallbackId}" must export resolve()`);
  }

  return {
    id,
    order: typeof candidate.order === 'number' ? candidate.order : 0,
    resolve(style, context) {
      return candidate.resolve(style, context);
    },
  };
}

function sortStyleResolvers() {
  styleResolvers.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.registrationOrder - right.registrationOrder;
  });
}

function getStyleHelpers(options = {}) {
  if (options.styleHelpers) {
    return options.styleHelpers;
  }

  return installStyleHelpers(options.target ?? globalThis);
}

function ensureBuiltinStyleResolversRegistered() {
  for (const resolver of BUILTIN_STYLE_RESOLVERS) {
    registerStyleResolver(resolver, resolver.id);
  }
}

export function registerStyleResolver(moduleExports, fallbackId) {
  const resolver = normalizeStyleResolver(moduleExports, fallbackId);
  const existingResolver = styleResolvers.find(entry => entry.id === resolver.id);

  if (existingResolver) {
    return existingResolver;
  }

  styleResolvers.push({
    ...resolver,
    registrationOrder: nextRegistrationOrder++,
  });
  sortStyleResolvers();
  return styleResolvers.find(entry => entry.id === resolver.id);
}

export function primeAutoDiscoveredStyleResolvers(
  discoveredModules = globalThis.__ONLOOK_HOST_STYLE_RESOLVER_MODULES__ ?? {},
) {
  ensureBuiltinStyleResolversRegistered();

  for (const [path, moduleExports] of Object.entries(discoveredModules).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const fallbackId = normalizeDiscoveredStyleResolverId(path);

    if (!fallbackId) {
      continue;
    }

    registerStyleResolver(moduleExports, fallbackId);
  }

  return getRegisteredStyleResolverIds();
}

export function resolveHostStyle(style, options = {}) {
  const styleHelpers = getStyleHelpers(options);
  primeAutoDiscoveredStyleResolvers(options.discoveredModules);

  let resolvedStyle = style;
  const context = {
    ...options,
    sourceStyle: style,
    styleHelpers,
  };

  for (const resolver of styleResolvers) {
    const nextStyle = resolver.resolve(resolvedStyle, {
      ...context,
      resolverId: resolver.id,
    });

    if (nextStyle !== undefined) {
      resolvedStyle = nextStyle;
    }
  }

  return resolvedStyle && typeof resolvedStyle === 'object' ? { ...resolvedStyle } : {};
}

export function getRegisteredStyleResolverIds() {
  return styleResolvers.map(resolver => resolver.id);
}

export function resetStyleResolverRegistry() {
  styleResolvers.length = 0;
  nextRegistrationOrder = 0;
}
