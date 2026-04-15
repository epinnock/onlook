const runtimeShims = [];

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

function resolveRuntimeShimId(moduleExports, candidate, fallbackId) {
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

function normalizeRuntimeShim(moduleExports, fallbackId) {
  const candidate = unwrapDefaultExport(moduleExports);
  const install = resolveRuntimeShimInstaller(candidate);

  if (!install) {
    throw new TypeError(`Runtime shim "${fallbackId}" does not export an installer`);
  }

  return {
    id: resolveRuntimeShimId(moduleExports, candidate, fallbackId),
    install,
  };
}

function registerRuntimeShim(moduleExports, fallbackId) {
  const shim = normalizeRuntimeShim(moduleExports, fallbackId);
  const existingShim = runtimeShims.find(entry => entry.id === shim.id);

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
}

module.exports = {
  applyRuntimeShims,
  getRegisteredRuntimeShimIds,
  registerRuntimeShim,
  resetRuntimeShimRegistry,
};
