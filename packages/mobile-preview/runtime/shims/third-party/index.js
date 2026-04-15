const THIRD_PARTY_SHIM_PREFIX = './shims/third-party/';
const RUNTIME_SHIM_EXTENSION_PATTERN = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;

function normalizeRuntimeShimPath(path) {
  return typeof path === 'string' ? path.replaceAll('\\', '/') : '';
}

function resolveThirdPartyShimId(path) {
  const normalizedPath = normalizeRuntimeShimPath(path);

  if (!normalizedPath.startsWith(THIRD_PARTY_SHIM_PREFIX)) {
    throw new TypeError(
      `Third-party shim path "${path}" must start with "${THIRD_PARTY_SHIM_PREFIX}"`,
    );
  }

  const relativePath = normalizedPath.slice(THIRD_PARTY_SHIM_PREFIX.length);
  const shimId = relativePath.replace(RUNTIME_SHIM_EXTENSION_PATTERN, '');

  if (!shimId || shimId === 'index') {
    throw new TypeError(`Third-party shim path "${path}" does not resolve to a shim id`);
  }

  return shimId;
}

module.exports = {
  runtimeShimCollection: {
    id: 'third-party',
    prefix: THIRD_PARTY_SHIM_PREFIX,
    resolveId: resolveThirdPartyShimId,
  },
};
