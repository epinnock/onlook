const runtimeShims = [];
const runtimeShimCollections = [];

function normalizeRuntimeShimPath(path) {
  return typeof path === 'string' ? path.replaceAll('\\', '/') : '';
}

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

function resolveRuntimeShimInstaller(candidate) {
  if (typeof candidate === 'function') {
    return candidate;
  }

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  if (typeof candidate.applyRuntimeShim === 'function') {
    return candidate.applyRuntimeShim.bind(candidate);
  }

  if (typeof candidate.install === 'function') {
    return candidate.install.bind(candidate);
  }

  return null;
}

function normalizeRuntimeShimCollection(moduleExports, fallbackId) {
  const candidate = unwrapDefaultExport(moduleExports);
  const collection = candidate?.runtimeShimCollection;

  if (!collection || typeof collection !== 'object') {
    return null;
  }

  if (typeof collection.resolveId !== 'function') {
    throw new TypeError(
      `Runtime shim collection "${fallbackId}" must define a resolveId(path) function`,
    );
  }

  const normalizedFallbackId = normalizeRuntimeShimPath(fallbackId);
  const prefix =
    typeof collection.prefix === 'string' && collection.prefix.length > 0
      ? normalizeRuntimeShimPath(collection.prefix)
      : null;

  if (!prefix && typeof collection.matches !== 'function') {
    throw new TypeError(
      `Runtime shim collection "${fallbackId}" must define a prefix or matches(path)`,
    );
  }

  return {
    fallbackId: normalizedFallbackId,
    id:
      typeof collection.id === 'string' && collection.id.length > 0
        ? collection.id
        : normalizedFallbackId,
    matches(path) {
      const normalizedPath = normalizeRuntimeShimPath(path);

      if (typeof collection.matches === 'function') {
        return collection.matches(normalizedPath);
      }

      return normalizedPath.startsWith(prefix) && normalizedPath !== normalizedFallbackId;
    },
    resolveId(path) {
      const resolvedId = collection.resolveId(normalizeRuntimeShimPath(path));

      if (typeof resolvedId !== 'string' || resolvedId.length === 0) {
        throw new TypeError(
          `Runtime shim collection "${fallbackId}" must resolve to a non-empty string id`,
        );
      }

      return resolvedId;
    },
  };
}

function findRuntimeShimCollection(fallbackId) {
  return runtimeShimCollections.find(collection => collection.matches(fallbackId)) ?? null;
}

function resolveRuntimeShimId(moduleExports, candidate, fallbackId) {
  if (candidate && typeof candidate === 'object' && typeof candidate.id === 'string') {
    return candidate.id;
  }

  const runtimeShimCollection = findRuntimeShimCollection(fallbackId);

  if (runtimeShimCollection) {
    return runtimeShimCollection.resolveId(fallbackId);
  }

  if (typeof moduleExports === 'function' && moduleExports.name) {
    return moduleExports.name;
  }

  if (candidate && typeof candidate === 'function' && candidate.name) {
    return candidate.name;
  }

  return fallbackId;
}

function normalizeRuntimeShim(moduleExports, fallbackId) {
  const candidate = unwrapDefaultExport(moduleExports);
  const install = resolveRuntimeShimInstaller(candidate);

  if (!install) {
    throw new TypeError(`Runtime shim "${fallbackId}" does not export an installer`);
  }

  return {
    fallbackId: normalizeRuntimeShimPath(fallbackId),
    id: resolveRuntimeShimId(moduleExports, candidate, fallbackId),
    install,
  };
}

function registerRuntimeShim(moduleExports, fallbackId) {
  const runtimeShimCollection = normalizeRuntimeShimCollection(moduleExports, fallbackId);

  if (runtimeShimCollection) {
    const existingCollection = runtimeShimCollections.find(
      entry => entry.fallbackId === runtimeShimCollection.fallbackId,
    );

    if (existingCollection) {
      return existingCollection;
    }

    runtimeShimCollections.push(runtimeShimCollection);
    return runtimeShimCollection;
  }

  const shim = normalizeRuntimeShim(moduleExports, fallbackId);
  const existingShim = runtimeShims.find(
    entry => entry.id === shim.id || entry.fallbackId === shim.fallbackId,
  );

  if (existingShim) {
    return existingShim;
  }

  runtimeShims.push(shim);
  return shim;
}

function applyRuntimeShims(target) {
  for (const shim of runtimeShims) {
    shim.install(target);
  }

  return target;
}

function getRegisteredRuntimeShimIds() {
  return runtimeShims.map(shim => shim.id);
}

function resetRuntimeShimRegistry() {
  runtimeShims.length = 0;
  runtimeShimCollections.length = 0;
}

module.exports = {
  applyRuntimeShims,
  getRegisteredRuntimeShimIds,
  registerRuntimeShim,
  resetRuntimeShimRegistry,
};
