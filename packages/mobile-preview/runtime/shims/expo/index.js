const EXPO_SHIM_PREFIX = './shims/expo/';
const RUNTIME_SHIM_EXTENSION_PATTERN = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;

function normalizeRuntimeShimPath(path) {
  return typeof path === 'string' ? path.replaceAll('\\', '/') : '';
}

function resolveExpoShimId(path) {
  const normalizedPath = normalizeRuntimeShimPath(path);

  if (!normalizedPath.startsWith(EXPO_SHIM_PREFIX)) {
    throw new TypeError(`Expo shim path "${path}" must start with "${EXPO_SHIM_PREFIX}"`);
  }

  const relativePath = normalizedPath.slice(EXPO_SHIM_PREFIX.length);
  const shimId = relativePath.replace(RUNTIME_SHIM_EXTENSION_PATTERN, '');

  if (!shimId || shimId === 'index') {
    throw new TypeError(`Expo shim path "${path}" does not resolve to a shim id`);
  }

  return shimId;
}

module.exports = {
  runtimeShimCollection: {
    id: 'expo',
    prefix: EXPO_SHIM_PREFIX,
    resolveId: resolveExpoShimId,
  },
};
