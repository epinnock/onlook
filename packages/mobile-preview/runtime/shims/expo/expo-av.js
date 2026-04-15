const MODULE_ID = 'expo-av';
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';
const AV_STATE_KEY = '__onlookExpoAvState';

const ResizeMode = Object.freeze({
  CONTAIN: 'contain',
  COVER: 'cover',
  STRETCH: 'stretch',
});

const InterruptionModeIOS = Object.freeze({
  MixWithOthers: 0,
  DoNotMix: 1,
  DuckOthers: 2,
});

const InterruptionModeAndroid = Object.freeze({
  DoNotMix: 1,
  DuckOthers: 2,
});

const RecordingOptionsPresets = Object.freeze({
  HIGH_QUALITY: Object.freeze({
    isMeteringEnabled: true,
    android: Object.freeze({
      extension: '.m4a',
      audioEncoder: 'aac',
      outputFormat: 'mpeg4',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    }),
    ios: Object.freeze({
      extension: '.m4a',
      audioQuality: 'max',
      outputFormat: 'mpeg4aac',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    }),
    web: Object.freeze({
      mimeType: 'audio/webm',
      bitsPerSecond: 128000,
    }),
  }),
  LOW_QUALITY: Object.freeze({
    isMeteringEnabled: true,
    android: Object.freeze({
      extension: '.3gp',
      audioEncoder: 'amr_nb',
      outputFormat: 'three_gpp',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    }),
    ios: Object.freeze({
      extension: '.caf',
      audioQuality: 'min',
      outputFormat: 'lpcm',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    }),
    web: Object.freeze({
      mimeType: 'audio/webm',
      bitsPerSecond: 64000,
    }),
  }),
});

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-av shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function ensureExpoAvState(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-av shim requires an object target');
  }

  if (!target[AV_STATE_KEY] || typeof target[AV_STATE_KEY] !== 'object') {
    target[AV_STATE_KEY] = {};
  }

  const state = target[AV_STATE_KEY];

  state.audioMode =
    state.audioMode && typeof state.audioMode === 'object' && !Array.isArray(state.audioMode)
      ? state.audioMode
      : {};
  state.enabled = state.enabled !== false;
  state.nextRecordingId =
    typeof state.nextRecordingId === 'number' && Number.isFinite(state.nextRecordingId)
      ? Math.max(0, Math.trunc(state.nextRecordingId))
      : 0;

  return state;
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

function resolveViewType(target) {
  return target && target.View ? target.View : 'View';
}

function buildVideoProps(props) {
  const {
    accessibilityLabel,
    accessibilityRole,
    nativeID,
    pointerEvents,
    style,
    testID,
  } = props || {};
  const nextProps = {};

  if (style) {
    nextProps.style = style;
  }

  if (testID != null) {
    nextProps.testID = testID;
  }

  if (nativeID != null) {
    nextProps.nativeID = nativeID;
  }

  if (accessibilityLabel != null) {
    nextProps.accessibilityLabel = accessibilityLabel;
  }

  if (accessibilityRole != null) {
    nextProps.accessibilityRole = accessibilityRole;
  }

  if (pointerEvents != null) {
    nextProps.pointerEvents = pointerEvents;
  }

  return nextProps;
}

function createPermissionResponse() {
  return {
    canAskAgain: true,
    expires: 'never',
    granted: true,
    status: 'granted',
  };
}

function resolveSourceUri(source) {
  if (typeof source === 'string') {
    return source;
  }

  if (source && typeof source === 'object' && typeof source.uri === 'string') {
    return source.uri;
  }

  return null;
}

function createPlaybackStatus(overrides = {}) {
  return {
    didJustFinish: false,
    durationMillis: 0,
    isBuffering: false,
    isLoaded: false,
    isLooping: false,
    isMuted: false,
    isPlaying: false,
    pitchCorrectionQuality: null,
    positionMillis: 0,
    progressUpdateIntervalMillis: 500,
    rate: 1,
    shouldCorrectPitch: false,
    shouldPlay: false,
    uri: null,
    volume: 1,
    ...overrides,
  };
}

function normalizePlaybackStatus(currentStatus, patch = {}) {
  const nextStatus = createPlaybackStatus({
    ...currentStatus,
    ...patch,
  });

  if (patch.shouldPlay === true) {
    nextStatus.isPlaying = true;
  }

  if (patch.shouldPlay === false) {
    nextStatus.isPlaying = false;
  }

  if (patch.isPlaying === true) {
    nextStatus.shouldPlay = true;
  }

  if (patch.isPlaying === false) {
    nextStatus.shouldPlay = false;
  }

  return nextStatus;
}

function clonePlaybackStatus(status) {
  return { ...status };
}

function createRecordingStatus(overrides = {}) {
  return {
    canRecord: true,
    durationMillis: 0,
    isDoneRecording: false,
    isRecording: false,
    mediaServicesDidReset: false,
    progressUpdateIntervalMillis: 500,
    uri: null,
    ...overrides,
  };
}

function cloneRecordingStatus(status) {
  return { ...status };
}

function createSoundClass() {
  return class Sound {
    constructor() {
      this._source = null;
      this._status = createPlaybackStatus();
      this._onPlaybackStatusUpdate = null;
    }

    _emitStatus(status) {
      if (typeof this._onPlaybackStatusUpdate === 'function') {
        this._onPlaybackStatusUpdate(status);
      }
    }

    _setStatus(patch) {
      this._status = normalizePlaybackStatus(this._status, patch);
      const status = clonePlaybackStatus(this._status);
      this._emitStatus(status);
      return status;
    }

    async loadAsync(source, initialStatus = {}) {
      this._source = source ?? null;

      return this._setStatus({
        ...initialStatus,
        isLoaded: true,
        uri: resolveSourceUri(source),
      });
    }

    async unloadAsync() {
      this._source = null;
      return this._setStatus(createPlaybackStatus());
    }

    async playAsync() {
      return this._setStatus({
        didJustFinish: false,
        isPlaying: true,
        shouldPlay: true,
      });
    }

    async pauseAsync() {
      return this._setStatus({
        isPlaying: false,
        shouldPlay: false,
      });
    }

    async stopAsync() {
      return this._setStatus({
        didJustFinish: false,
        isPlaying: false,
        positionMillis: 0,
        shouldPlay: false,
      });
    }

    async replayAsync(status = {}) {
      return this._setStatus({
        ...status,
        didJustFinish: false,
        isPlaying: true,
        positionMillis: 0,
        shouldPlay: true,
      });
    }

    async playFromPositionAsync(positionMillis, status = {}) {
      return this._setStatus({
        ...status,
        didJustFinish: false,
        isPlaying: true,
        positionMillis: Number.isFinite(positionMillis) ? Math.max(0, positionMillis) : 0,
        shouldPlay: true,
      });
    }

    async setPositionAsync(positionMillis) {
      return this._setStatus({
        positionMillis: Number.isFinite(positionMillis) ? Math.max(0, positionMillis) : 0,
      });
    }

    async setRateAsync(rate, shouldCorrectPitch = false, pitchCorrectionQuality = null) {
      return this._setStatus({
        pitchCorrectionQuality,
        rate: Number.isFinite(rate) ? rate : 1,
        shouldCorrectPitch: shouldCorrectPitch === true,
      });
    }

    async setVolumeAsync(volume, audioPan) {
      return this._setStatus({
        audioPan,
        volume: Number.isFinite(volume) ? volume : 1,
      });
    }

    async setIsMutedAsync(isMuted) {
      return this._setStatus({
        isMuted: isMuted === true,
      });
    }

    async setIsLoopingAsync(isLooping) {
      return this._setStatus({
        isLooping: isLooping === true,
      });
    }

    async setProgressUpdateIntervalAsync(progressUpdateIntervalMillis) {
      return this._setStatus({
        progressUpdateIntervalMillis:
          Number.isFinite(progressUpdateIntervalMillis) && progressUpdateIntervalMillis > 0
            ? progressUpdateIntervalMillis
            : this._status.progressUpdateIntervalMillis,
      });
    }

    async setStatusAsync(status) {
      return this._setStatus(status && typeof status === 'object' ? status : {});
    }

    async getStatusAsync() {
      return clonePlaybackStatus(this._status);
    }

    setOnPlaybackStatusUpdate(listener) {
      this._onPlaybackStatusUpdate = typeof listener === 'function' ? listener : null;
    }

    getURI() {
      return resolveSourceUri(this._source);
    }

    static async createAsync(
      source,
      initialStatus = {},
      onPlaybackStatusUpdate,
    ) {
      const sound = new Sound();

      if (typeof onPlaybackStatusUpdate === 'function') {
        sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
      }

      const status = await sound.loadAsync(source, initialStatus);
      return { sound, status };
    }
  };
}

function createRecordingClass(target, Sound) {
  return class Recording {
    constructor() {
      this._uri = null;
      this._status = createRecordingStatus();
      this._onRecordingStatusUpdate = null;
      this._options = null;
    }

    _emitStatus(status) {
      if (typeof this._onRecordingStatusUpdate === 'function') {
        this._onRecordingStatusUpdate(status);
      }
    }

    _setStatus(patch) {
      this._status = createRecordingStatus({
        ...this._status,
        ...patch,
        uri: this._uri,
      });
      const status = cloneRecordingStatus(this._status);
      this._emitStatus(status);
      return status;
    }

    async prepareToRecordAsync(options = {}) {
      this._options = options;
      return this._setStatus({
        canRecord: true,
        durationMillis: 0,
        isDoneRecording: false,
        isRecording: false,
      });
    }

    async startAsync() {
      return this._setStatus({
        canRecord: true,
        isDoneRecording: false,
        isRecording: true,
      });
    }

    async stopAndUnloadAsync() {
      const state = ensureExpoAvState(target);

      if (!this._uri) {
        state.nextRecordingId += 1;
        this._uri = `file:///onlook-recording-${state.nextRecordingId}.m4a`;
      }

      return this._setStatus({
        canRecord: false,
        isDoneRecording: true,
        isRecording: false,
      });
    }

    async getStatusAsync() {
      return cloneRecordingStatus(this._status);
    }

    setOnRecordingStatusUpdate(listener) {
      this._onRecordingStatusUpdate =
        typeof listener === 'function' ? listener : null;
    }

    setProgressUpdateInterval(progressUpdateIntervalMillis) {
      this._status.progressUpdateIntervalMillis =
        Number.isFinite(progressUpdateIntervalMillis) && progressUpdateIntervalMillis > 0
          ? progressUpdateIntervalMillis
          : this._status.progressUpdateIntervalMillis;
    }

    getURI() {
      return this._uri;
    }

    async createNewLoadedSoundAsync(initialStatus = {}, onPlaybackStatusUpdate) {
      const sound = new Sound();

      if (typeof onPlaybackStatusUpdate === 'function') {
        sound.setOnPlaybackStatusUpdate(onPlaybackStatusUpdate);
      }

      const status = await sound.loadAsync(
        this._uri ? { uri: this._uri } : null,
        initialStatus,
      );

      return { sound, status };
    }

    static async createAsync(
      options = {},
      onRecordingStatusUpdate,
      progressUpdateIntervalMillis,
    ) {
      const recording = new Recording();

      if (typeof onRecordingStatusUpdate === 'function') {
        recording.setOnRecordingStatusUpdate(onRecordingStatusUpdate);
      }

      if (progressUpdateIntervalMillis != null) {
        recording.setProgressUpdateInterval(progressUpdateIntervalMillis);
      }

      const status = await recording.prepareToRecordAsync(options);
      return { recording, status };
    }
  };
}

function createVideoComponent(target) {
  function Video(props) {
    const React = resolveReact(target);

    return React.createElement(
      resolveViewType(target),
      buildVideoProps(props),
      props?.children ?? null,
    );
  }

  Video.displayName = 'ExpoVideo';
  return Video;
}

function createExpoAvModule(target = globalThis) {
  const Sound = createSoundClass();
  const Recording = createRecordingClass(target, Sound);
  const Video = createVideoComponent(target);
  const state = ensureExpoAvState(target);

  const Audio = {
    InterruptionModeAndroid,
    InterruptionModeIOS,
    Recording,
    RecordingOptionsPresets,
    Sound,
    async getPermissionsAsync() {
      return createPermissionResponse();
    },
    async requestPermissionsAsync() {
      return createPermissionResponse();
    },
    async getRecordingPermissionsAsync() {
      return createPermissionResponse();
    },
    async requestRecordingPermissionsAsync() {
      return createPermissionResponse();
    },
    async setAudioModeAsync(partialMode) {
      state.audioMode = {
        ...state.audioMode,
        ...(partialMode && typeof partialMode === 'object' ? partialMode : {}),
      };
    },
    async setIsEnabledAsync(value) {
      state.enabled = value !== false;
    },
  };

  const moduleExports = {
    Audio,
    InterruptionModeAndroid,
    InterruptionModeIOS,
    ResizeMode,
    Video,
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default' || key === '__esModule') {
      continue;
    }

    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function installExpoAvShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  ensureExpoAvState(target);
  const existingModule = registry[MODULE_ID];
  const nextModule = createExpoAvModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[MODULE_ID] = nextModule;
  return nextModule;
}

module.exports = installExpoAvShim;
module.exports.install = installExpoAvShim;
module.exports.applyRuntimeShim = installExpoAvShim;
module.exports.createExpoAvModule = createExpoAvModule;
module.exports.createPermissionResponse = createPermissionResponse;
module.exports.createRecordingClass = createRecordingClass;
module.exports.createSoundClass = createSoundClass;
module.exports.ensureExpoAvState = ensureExpoAvState;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.AV_STATE_KEY = AV_STATE_KEY;
module.exports.InterruptionModeAndroid = InterruptionModeAndroid;
module.exports.InterruptionModeIOS = InterruptionModeIOS;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RecordingOptionsPresets = RecordingOptionsPresets;
module.exports.ResizeMode = ResizeMode;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
