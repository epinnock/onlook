const MODULE_ID = 'expo-file-system';
const LEGACY_MODULE_ID = 'expo-file-system/legacy';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const FILE_SYSTEM_STATE_KEY = '__onlookExpoFileSystemState';
const BUNDLE_DIRECTORY = 'file:///onlook/bundle/';
const CACHE_DIRECTORY = 'file:///onlook/cache/';
const DOCUMENT_DIRECTORY = 'file:///onlook/document/';
const DEFAULT_FILE_CONTENT = '';
const DEFAULT_DISK_CAPACITY = 1024 * 1024 * 1024;
const DEFAULT_FREE_DISK_SPACE = 512 * 1024 * 1024;

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-file-system shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function normalizeUri(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('expo-file-system shim requires a non-empty uri');
  }

  return value.replaceAll('\\', '/');
}

function normalizeFileUri(value) {
  const normalizedValue = normalizeUri(value);

  if (normalizedValue === '/') {
    return normalizedValue;
  }

  return normalizedValue.endsWith('/') ? normalizedValue.slice(0, -1) : normalizedValue;
}

function normalizeDirectoryUri(value) {
  const normalizedValue = normalizeUri(value);
  return normalizedValue.endsWith('/') ? normalizedValue : `${normalizedValue}/`;
}

function getParentDirectoryUri(value) {
  const normalizedValue = normalizeFileUri(value);
  const lastSlashIndex = normalizedValue.lastIndexOf('/');

  if (lastSlashIndex < 0) {
    return null;
  }

  const parentDirectoryUri = normalizedValue.slice(0, lastSlashIndex + 1);

  if (!parentDirectoryUri || parentDirectoryUri === value) {
    return null;
  }

  return parentDirectoryUri;
}

function getBasename(value) {
  const normalizedValue =
    typeof value === 'string' && value.endsWith('/') ? value.slice(0, -1) : value;
  const lastSlashIndex = normalizedValue.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedValue.slice(lastSlashIndex + 1) : normalizedValue;
}

function joinUri(baseUri, segment) {
  const normalizedBaseUri = normalizeDirectoryUri(baseUri);
  const normalizedSegment = String(segment ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  return `${normalizedBaseUri}${normalizedSegment}`;
}

function ensureFileSystemState(target) {
  if (!target[FILE_SYSTEM_STATE_KEY] || typeof target[FILE_SYSTEM_STATE_KEY] !== 'object') {
    target[FILE_SYSTEM_STATE_KEY] = {
      entries: new Map(),
    };
  }

  const state = target[FILE_SYSTEM_STATE_KEY];

  if (!(state.entries instanceof Map)) {
    state.entries = new Map(
      Array.isArray(state.entries)
        ? state.entries
        : Object.entries(state.entries || {}),
    );
  }

  ensureDirectoryEntry(state, BUNDLE_DIRECTORY);
  ensureDirectoryEntry(state, CACHE_DIRECTORY);
  ensureDirectoryEntry(state, DOCUMENT_DIRECTORY);

  return state;
}

function getEntry(state, value) {
  const normalizedFileUri = normalizeFileUri(value);
  const normalizedDirectoryUri = normalizeDirectoryUri(value);

  return (
    state.entries.get(normalizedFileUri) ??
    state.entries.get(normalizedDirectoryUri) ??
    null
  );
}

function ensureDirectoryEntry(state, value) {
  const directoryUri = normalizeDirectoryUri(value);
  const existingEntry = state.entries.get(directoryUri);

  if (existingEntry && existingEntry.kind === 'directory') {
    return existingEntry;
  }

  const entry = {
    kind: 'directory',
    modifiedAt: Date.now(),
    size: 0,
    uri: directoryUri,
  };

  state.entries.set(directoryUri, entry);
  return entry;
}

function ensureAncestorDirectories(state, value) {
  const directories = [];
  let currentDirectoryUri = getParentDirectoryUri(value);

  while (currentDirectoryUri) {
    directories.push(currentDirectoryUri);
    const nextDirectoryUri = getParentDirectoryUri(currentDirectoryUri);

    if (!nextDirectoryUri || nextDirectoryUri === currentDirectoryUri) {
      break;
    }

    currentDirectoryUri = nextDirectoryUri;
  }

  directories.reverse();

  for (const directoryUri of directories) {
    ensureDirectoryEntry(state, directoryUri);
  }
}

function writeFileEntry(state, value, contents) {
  const fileUri = normalizeFileUri(value);
  const nextContents = String(contents ?? '');

  ensureAncestorDirectories(state, fileUri);

  const entry = {
    content: nextContents,
    kind: 'file',
    modifiedAt: Date.now(),
    size: nextContents.length,
    uri: fileUri,
  };

  state.entries.set(fileUri, entry);
  return entry;
}

function deleteEntry(state, value) {
  const entry = getEntry(state, value);

  if (!entry) {
    return false;
  }

  state.entries.delete(entry.uri);

  if (entry.kind === 'directory') {
    for (const entryUri of Array.from(state.entries.keys())) {
      if (entryUri.startsWith(entry.uri)) {
        state.entries.delete(entryUri);
      }
    }
  }

  return true;
}

function cloneDirectoryTree(state, fromDirectoryUri, toDirectoryUri) {
  const sourceDirectoryUri = normalizeDirectoryUri(fromDirectoryUri);
  const targetDirectoryUri = normalizeDirectoryUri(toDirectoryUri);

  ensureDirectoryEntry(state, targetDirectoryUri);

  for (const entry of Array.from(state.entries.values())) {
    if (entry.uri === sourceDirectoryUri || !entry.uri.startsWith(sourceDirectoryUri)) {
      continue;
    }

    const suffix = entry.uri.slice(sourceDirectoryUri.length);
    const nextUri = `${targetDirectoryUri}${suffix}`;

    if (entry.kind === 'directory') {
      ensureDirectoryEntry(state, nextUri);
      continue;
    }

    writeFileEntry(state, nextUri, entry.content);
  }

  return getEntry(state, targetDirectoryUri);
}

function copyEntry(state, fromUri, toUri) {
  const sourceEntry = getEntry(state, fromUri);

  if (!sourceEntry) {
    return null;
  }

  if (sourceEntry.kind === 'directory') {
    return cloneDirectoryTree(state, sourceEntry.uri, toUri);
  }

  return writeFileEntry(state, toUri, sourceEntry.content);
}

function moveEntry(state, fromUri, toUri) {
  const copiedEntry = copyEntry(state, fromUri, toUri);

  if (copiedEntry) {
    deleteEntry(state, fromUri);
  }

  return copiedEntry;
}

function createFileInfo(value, entry) {
  return {
    exists: entry != null,
    isDirectory: entry?.kind === 'directory',
    md5: null,
    modificationTime: entry?.modifiedAt ?? null,
    size: entry?.size ?? 0,
    uri: entry?.uri ?? normalizeUri(value),
  };
}

function listDirectoryEntries(state, value) {
  const directoryUri = normalizeDirectoryUri(value);
  const names = new Set();

  for (const entry of state.entries.values()) {
    if (entry.uri === directoryUri || !entry.uri.startsWith(directoryUri)) {
      continue;
    }

    const remainder = entry.uri.slice(directoryUri.length);

    if (!remainder) {
      continue;
    }

    names.add(remainder.split('/')[0]);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function resolveJoinedUri(parts, options = {}) {
  const values = parts.flatMap((part) => {
    if (part == null) {
      return [];
    }

    if (typeof part === 'object' && typeof part.uri === 'string') {
      return [part.uri];
    }

    return [String(part)];
  });

  if (values.length === 0) {
    return options.directory ? DOCUMENT_DIRECTORY : joinUri(DOCUMENT_DIRECTORY, 'file');
  }

  let resolvedUri = values[0];

  for (let index = 1; index < values.length; index += 1) {
    const nextValue = values[index];

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(nextValue)) {
      resolvedUri = nextValue;
      continue;
    }

    resolvedUri = joinUri(resolvedUri, nextValue);
  }

  return options.directory
    ? normalizeDirectoryUri(resolvedUri)
    : normalizeFileUri(resolvedUri);
}

function isDirectoryDestination(destination) {
  if (destination && typeof destination === 'object' && destination.constructor?.name === 'Directory') {
    return true;
  }

  return typeof destination === 'string' && destination.endsWith('/');
}

function resolveRelocationUri(sourceUri, destination, options = {}) {
  const destinationUri =
    destination && typeof destination === 'object' && typeof destination.uri === 'string'
      ? destination.uri
      : String(destination ?? '');

  if (!destinationUri) {
    throw new TypeError('expo-file-system shim requires a destination uri');
  }

  const shouldAppendBasename =
    options.directory === true || isDirectoryDestination(destination);

  if (!shouldAppendBasename) {
    return options.directory ? normalizeDirectoryUri(destinationUri) : normalizeFileUri(destinationUri);
  }

  return options.directory
    ? normalizeDirectoryUri(joinUri(destinationUri, getBasename(sourceUri)))
    : normalizeFileUri(joinUri(destinationUri, getBasename(sourceUri)));
}

function createDownloadResult(fileUri) {
  return {
    headers: {},
    md5: null,
    status: 200,
    uri: normalizeFileUri(fileUri),
  };
}

function createUploadResult(fileUri) {
  return {
    body: null,
    headers: {},
    status: 200,
    uri: normalizeFileUri(fileUri),
  };
}

function createStorageAccessFramework() {
  return {
    async createFileAsync(directoryUri, fileName) {
      const fileUri = joinUri(directoryUri, fileName);
      return normalizeFileUri(fileUri);
    },
    async deleteFileAsync() {
      return undefined;
    },
    async getUriForDirectoryInRoot(directoryName) {
      return joinUri(DOCUMENT_DIRECTORY, directoryName);
    },
    async makeDirectoryAsync(parentUri, directoryName) {
      return normalizeDirectoryUri(joinUri(parentUri, directoryName));
    },
    async readDirectoryAsync() {
      return [];
    },
    requestDirectoryPermissionsAsync() {
      return Promise.resolve({
        directoryUri: DOCUMENT_DIRECTORY,
        granted: true,
      });
    },
  };
}

function createSharedFileSystemExports(target = globalThis) {
  function readAsStringAsync(fileUri) {
    const state = ensureFileSystemState(target);
    const entry = getEntry(state, fileUri);

    if (!entry || entry.kind !== 'file') {
      return Promise.resolve(DEFAULT_FILE_CONTENT);
    }

    return Promise.resolve(entry.content);
  }

  function writeAsStringAsync(fileUri, contents) {
    const state = ensureFileSystemState(target);
    writeFileEntry(state, fileUri, contents);
    return Promise.resolve(undefined);
  }

  function deleteAsync(fileUri) {
    const state = ensureFileSystemState(target);
    deleteEntry(state, fileUri);
    return Promise.resolve(undefined);
  }

  function downloadAsync(uri, fileUri) {
    const state = ensureFileSystemState(target);
    writeFileEntry(state, fileUri, DEFAULT_FILE_CONTENT);
    return Promise.resolve(createDownloadResult(fileUri, uri));
  }

  function getInfoAsync(fileUri) {
    const state = ensureFileSystemState(target);
    return Promise.resolve(createFileInfo(fileUri, getEntry(state, fileUri)));
  }

  function makeDirectoryAsync(fileUri) {
    const state = ensureFileSystemState(target);
    ensureAncestorDirectories(state, fileUri);
    ensureDirectoryEntry(state, fileUri);
    return Promise.resolve(undefined);
  }

  function moveAsync(options) {
    const state = ensureFileSystemState(target);
    moveEntry(state, options?.from, options?.to);
    return Promise.resolve(undefined);
  }

  function copyAsync(options) {
    const state = ensureFileSystemState(target);
    copyEntry(state, options?.from, options?.to);
    return Promise.resolve(undefined);
  }

  function readDirectoryAsync(fileUri) {
    const state = ensureFileSystemState(target);
    return Promise.resolve(listDirectoryEntries(state, fileUri));
  }

  function getContentUriAsync(fileUri) {
    return Promise.resolve(normalizeFileUri(fileUri));
  }

  function getFreeDiskStorageAsync() {
    return Promise.resolve(DEFAULT_FREE_DISK_SPACE);
  }

  function getTotalDiskCapacityAsync() {
    return Promise.resolve(DEFAULT_DISK_CAPACITY);
  }

  function createDownloadResumable(uri, fileUri, _options, callback, resumeData = null) {
    return {
      async downloadAsync() {
        const result = await downloadAsync(uri, fileUri);

        if (typeof callback === 'function') {
          callback({
            totalBytesExpectedToWrite: 0,
            totalBytesWritten: 0,
          });
        }

        return result;
      },
      async pauseAsync() {
        return {
          fileUri,
          options: {},
          resumeData,
          url: uri,
        };
      },
      async resumeAsync() {
        return downloadAsync(uri, fileUri);
      },
      savable() {
        return {
          fileUri,
          options: {},
          resumeData,
          url: uri,
        };
      },
    };
  }

  function createUploadTask(url, fileUri, _options, callback) {
    return {
      async uploadAsync() {
        if (typeof callback === 'function') {
          callback({
            totalBytesExpectedToSend: 0,
            totalBytesSent: 0,
          });
        }

        return createUploadResult(fileUri, url);
      },
    };
  }

  function uploadAsync(url, fileUri, options, callback) {
    return createUploadTask(url, fileUri, options, callback).uploadAsync();
  }

  return {
    EncodingType: {
      Base64: 'base64',
      UTF8: 'utf8',
    },
    FileSystemSessionType: {
      BACKGROUND: 0,
      FOREGROUND: 1,
    },
    StorageAccessFramework: createStorageAccessFramework(),
    bundleDirectory: BUNDLE_DIRECTORY,
    cacheDirectory: CACHE_DIRECTORY,
    copyAsync,
    createDownloadResumable,
    createUploadTask,
    deleteAsync,
    documentDirectory: DOCUMENT_DIRECTORY,
    downloadAsync,
    getContentUriAsync,
    getFreeDiskStorageAsync,
    getInfoAsync,
    getTotalDiskCapacityAsync,
    makeDirectoryAsync,
    moveAsync,
    readAsStringAsync,
    readDirectoryAsync,
    uploadAsync,
    writeAsStringAsync,
  };
}

function createExpoFileSystemModule(target = globalThis) {
  const sharedExports = createSharedFileSystemExports(target);

  class File {
    constructor(...parts) {
      this.uri = resolveJoinedUri(parts);
    }

    get exists() {
      return getEntry(ensureFileSystemState(target), this.uri)?.kind === 'file';
    }

    get name() {
      return getBasename(this.uri);
    }

    get size() {
      return getEntry(ensureFileSystemState(target), this.uri)?.size ?? 0;
    }

    copy(destination) {
      const nextUri = resolveRelocationUri(this.uri, destination);
      copyEntry(ensureFileSystemState(target), this.uri, nextUri);
      return new File(nextUri);
    }

    create() {
      writeFileEntry(ensureFileSystemState(target), this.uri, DEFAULT_FILE_CONTENT);
      return this;
    }

    delete() {
      deleteEntry(ensureFileSystemState(target), this.uri);
    }

    move(destination) {
      const nextUri = resolveRelocationUri(this.uri, destination);
      moveEntry(ensureFileSystemState(target), this.uri, nextUri);
      this.uri = nextUri;
      return this;
    }

    text() {
      return sharedExports.readAsStringAsync(this.uri);
    }

    textSync() {
      const entry = getEntry(ensureFileSystemState(target), this.uri);
      return entry?.kind === 'file' ? entry.content : DEFAULT_FILE_CONTENT;
    }

    write(contents) {
      writeFileEntry(ensureFileSystemState(target), this.uri, contents);
      return this;
    }

    static async downloadFileAsync(url, destination) {
      const destinationDirectoryUri = isDirectoryDestination(destination)
        ? destination.uri ?? destination
        : destination;
      const nextUri = resolveRelocationUri(
        getBasename(url) ? `file:///${getBasename(url)}` : 'file:///download',
        destinationDirectoryUri,
      );

      await sharedExports.downloadAsync(url, nextUri);

      return new File(nextUri);
    }
  }

  class Directory {
    constructor(...parts) {
      this.uri = resolveJoinedUri(parts, { directory: true });
    }

    get exists() {
      return getEntry(ensureFileSystemState(target), this.uri)?.kind === 'directory';
    }

    get name() {
      return getBasename(this.uri);
    }

    copy(destination) {
      const nextUri = resolveRelocationUri(this.uri, destination, { directory: true });
      copyEntry(ensureFileSystemState(target), this.uri, nextUri);
      return new Directory(nextUri);
    }

    create() {
      const state = ensureFileSystemState(target);
      ensureAncestorDirectories(state, this.uri);
      ensureDirectoryEntry(state, this.uri);
      return this;
    }

    createDirectory(name) {
      return new Directory(this.uri, name);
    }

    delete() {
      deleteEntry(ensureFileSystemState(target), this.uri);
    }

    list() {
      const state = ensureFileSystemState(target);
      return listDirectoryEntries(state, this.uri).map((name) => {
        const childFileUri = joinUri(this.uri, name);
        const childDirectoryUri = normalizeDirectoryUri(childFileUri);
        const entry =
          state.entries.get(normalizeFileUri(childFileUri)) ??
          state.entries.get(childDirectoryUri);

        return entry?.kind === 'directory'
          ? new Directory(childDirectoryUri)
          : new File(childFileUri);
      });
    }

    move(destination) {
      const nextUri = resolveRelocationUri(this.uri, destination, { directory: true });
      moveEntry(ensureFileSystemState(target), this.uri, nextUri);
      this.uri = nextUri;
      return this;
    }
  }

  const moduleExports = {
    ...sharedExports,
    Directory,
    File,
    Paths: {
      bundle: BUNDLE_DIRECTORY,
      cache: CACHE_DIRECTORY,
      document: DOCUMENT_DIRECTORY,
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function createExpoFileSystemLegacyModule(target = globalThis) {
  const moduleExports = createSharedFileSystemExports(target);

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  if (
    !('default' in existingModule) ||
    existingModule.default == null ||
    existingModule.default === nextModule.default
  ) {
    existingModule.default = existingModule;
  }

  existingModule.__esModule = true;
  return existingModule;
}

function installRuntimeModule(registry, moduleId, nextModule) {
  const existingModule = registry[moduleId];

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function installExpoFileSystemShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  ensureFileSystemState(target);

  const fileSystemModule = installRuntimeModule(
    registry,
    MODULE_ID,
    createExpoFileSystemModule(target),
  );
  const legacyFileSystemModule = installRuntimeModule(
    registry,
    LEGACY_MODULE_ID,
    createExpoFileSystemLegacyModule(target),
  );

  return {
    legacy: legacyFileSystemModule,
    module: fileSystemModule,
  };
}

module.exports = installExpoFileSystemShim;
module.exports.install = installExpoFileSystemShim;
module.exports.applyRuntimeShim = installExpoFileSystemShim;
module.exports.createExpoFileSystemLegacyModule = createExpoFileSystemLegacyModule;
module.exports.createExpoFileSystemModule = createExpoFileSystemModule;
module.exports.ensureFileSystemState = ensureFileSystemState;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.LEGACY_MODULE_ID = LEGACY_MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.FILE_SYSTEM_STATE_KEY = FILE_SYSTEM_STATE_KEY;
