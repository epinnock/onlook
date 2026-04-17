const MODULE_ID = 'media-capture'
const CAMERA_MODULE_ID = 'expo-camera'
const IMAGE_PICKER_MODULE_ID = 'expo-image-picker'
const MODULE_IDS = [CAMERA_MODULE_ID, IMAGE_PICKER_MODULE_ID]
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims'

const PERMISSION_STATUS = Object.freeze({
  DENIED: 'denied',
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
})

const CAMERA_TYPE = Object.freeze({
  back: 'back',
  front: 'front',
})

const FLASH_MODE = Object.freeze({
  auto: 'auto',
  off: 'off',
  on: 'on',
  torch: 'torch',
})

const MEDIA_TYPE = Object.freeze({
  images: 'images',
  livePhotos: 'livePhotos',
  videos: 'videos',
})

const MEDIA_TYPE_OPTIONS = Object.freeze({
  All: 'all',
  Images: 'images',
  Videos: 'videos',
})

const UI_IMAGE_PICKER_PRESENTATION_STYLE = Object.freeze({
  AUTOMATIC: 'automatic',
  CURRENT_CONTEXT: 'currentContext',
  FORM_SHEET: 'formSheet',
  FULL_SCREEN: 'fullScreen',
  OVER_CURRENT_CONTEXT: 'overCurrentContext',
  OVER_FULL_SCREEN: 'overFullScreen',
  PAGE_SHEET: 'pageSheet',
  POPOVER: 'popover',
})

const CAMERA_VIEW_STRIPPED_PROPS = new Set([
  'active',
  'animateShutter',
  'autofocus',
  'barcodeScannerSettings',
  'enableTorch',
  'facing',
  'flash',
  'mirror',
  'mode',
  'mute',
  'onAvailableLensesChanged',
  'onBarcodeScanned',
  'onCameraReady',
  'onMountError',
  'onPictureSaved',
  'pictureSize',
  'poster',
  'ratio',
  'responsiveOrientationWhenOrientationLocked',
  'selectedLens',
  'videoBitrate',
  'videoQuality',
  'zoom',
])

const GRANTED_PERMISSION_RESPONSE = Object.freeze({
  canAskAgain: true,
  expires: 'never',
  granted: true,
  status: PERMISSION_STATUS.GRANTED,
})

const MEDIA_LIBRARY_PERMISSION_RESPONSE = Object.freeze({
  ...GRANTED_PERMISSION_RESPONSE,
  accessPrivileges: 'all',
})

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo media-capture shim requires an object target')
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {}
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY]
}

function resolveReact(target) {
  const candidate = target && target.React

  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default
  }

  if (candidate) {
    return candidate
  }

  return require('react')
}

function resolveViewType(target) {
  return target && target.View ? target.View : 'View'
}

function createPermissionResponse(permissionResponse) {
  return { ...permissionResponse }
}

function createPermissionHook(permissionResponse) {
  async function getPermissionAsync() {
    return createPermissionResponse(permissionResponse)
  }

  async function requestPermissionAsync() {
    return createPermissionResponse(permissionResponse)
  }

  function usePermissions() {
    return [
      createPermissionResponse(permissionResponse),
      requestPermissionAsync,
      getPermissionAsync,
    ]
  }

  return {
    getPermissionAsync,
    requestPermissionAsync,
    usePermissions,
  }
}

function buildPassThroughProps(props, strippedProps) {
  const nextProps = {}

  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || strippedProps.has(key) || value === undefined) {
      continue
    }

    nextProps[key] = value
  }

  return nextProps
}

function createCanceledImagePickerResult() {
  return {
    assets: null,
    canceled: true,
    cancelled: true,
  }
}

function createCameraView(target) {
  function CameraView(props) {
    const React = resolveReact(target)

    return React.createElement(
      resolveViewType(target),
      buildPassThroughProps(props, CAMERA_VIEW_STRIPPED_PROPS),
      props?.children ?? null,
    )
  }

  CameraView.displayName = 'CameraView'
  return CameraView
}

function mergeRuntimeModule(existingModule, nextModule, defaultResolver) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default') {
      continue
    }

    if (!(key in existingModule)) {
      existingModule[key] = value
    }
  }

  existingModule.default = defaultResolver(existingModule, nextModule)
  existingModule.__esModule = true
  return existingModule
}

function mergeExpoCameraModule(existingModule, nextModule) {
  const hadCamera = 'Camera' in existingModule
  const hadCameraView = 'CameraView' in existingModule
  const mergedModule = mergeRuntimeModule(
    existingModule,
    nextModule,
    currentModule =>
      currentModule.default ?? currentModule.CameraView ?? currentModule.Camera ?? currentModule,
  )

  if (!hadCamera && mergedModule.CameraView) {
    mergedModule.Camera = mergedModule.CameraView
  }

  if (!hadCameraView && mergedModule.Camera) {
    mergedModule.CameraView = mergedModule.Camera
  }

  mergedModule.default =
    mergedModule.default ?? mergedModule.CameraView ?? mergedModule.Camera ?? mergedModule

  return mergedModule
}

function createExpoCameraModule(target = globalThis) {
  const cameraPermissions = createPermissionHook(GRANTED_PERMISSION_RESPONSE)
  const microphonePermissions = createPermissionHook(GRANTED_PERMISSION_RESPONSE)
  const CameraView = createCameraView(target)

  const moduleExports = {
    Camera: CameraView,
    CameraType: CAMERA_TYPE,
    CameraView,
    FlashMode: FLASH_MODE,
    PermissionStatus: PERMISSION_STATUS,
    getCameraPermissionsAsync: cameraPermissions.getPermissionAsync,
    getMicrophonePermissionsAsync: microphonePermissions.getPermissionAsync,
    isAvailableAsync: async () => true,
    requestCameraPermissionsAsync: cameraPermissions.requestPermissionAsync,
    requestMicrophonePermissionsAsync: microphonePermissions.requestPermissionAsync,
    scanFromURLAsync: async () => [],
    useCameraPermissions: cameraPermissions.usePermissions,
    useMicrophonePermissions: microphonePermissions.usePermissions,
  }

  moduleExports.default = moduleExports
  moduleExports.__esModule = true

  return moduleExports
}

function createExpoImagePickerModule() {
  const cameraPermissions = createPermissionHook(GRANTED_PERMISSION_RESPONSE)
  const mediaLibraryPermissions = createPermissionHook(MEDIA_LIBRARY_PERMISSION_RESPONSE)

  const moduleExports = {
    CameraType: CAMERA_TYPE,
    MediaType: MEDIA_TYPE,
    MediaTypeOptions: MEDIA_TYPE_OPTIONS,
    UIImagePickerPresentationStyle: UI_IMAGE_PICKER_PRESENTATION_STYLE,
    getCameraPermissionsAsync: cameraPermissions.getPermissionAsync,
    getMediaLibraryPermissionsAsync: mediaLibraryPermissions.getPermissionAsync,
    getPendingResultAsync: async () => [],
    launchCameraAsync: async () => createCanceledImagePickerResult(),
    launchImageLibraryAsync: async () => createCanceledImagePickerResult(),
    requestCameraPermissionsAsync: cameraPermissions.requestPermissionAsync,
    requestMediaLibraryPermissionsAsync: mediaLibraryPermissions.requestPermissionAsync,
    useCameraPermissions: cameraPermissions.usePermissions,
    useMediaLibraryPermissions: mediaLibraryPermissions.usePermissions,
  }

  moduleExports.default = moduleExports
  moduleExports.__esModule = true

  return moduleExports
}

function installRuntimeModule(target, moduleId, createModule, mergeModule) {
  const registry = ensureRuntimeShimRegistry(target)
  const existingModule = registry[moduleId]
  const nextModule = createModule()

  if (existingModule && typeof existingModule === 'object') {
    return mergeModule(existingModule, nextModule)
  }

  registry[moduleId] = nextModule
  return nextModule
}

function installExpoMediaCaptureShim(target = globalThis) {
  const cameraModule = installRuntimeModule(
    target,
    CAMERA_MODULE_ID,
    () => createExpoCameraModule(target),
    mergeExpoCameraModule,
  )
  const imagePickerModule = installRuntimeModule(
    target,
    IMAGE_PICKER_MODULE_ID,
    createExpoImagePickerModule,
    (existingModule, nextModule) =>
      mergeRuntimeModule(
        existingModule,
        nextModule,
        currentModule => currentModule.default ?? currentModule,
      ),
  )

  return {
    [CAMERA_MODULE_ID]: cameraModule,
    [IMAGE_PICKER_MODULE_ID]: imagePickerModule,
  }
}

module.exports = installExpoMediaCaptureShim
module.exports.install = installExpoMediaCaptureShim
module.exports.applyRuntimeShim = installExpoMediaCaptureShim
module.exports.createExpoCameraModule = createExpoCameraModule
module.exports.createExpoImagePickerModule = createExpoImagePickerModule
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry
module.exports.mergeRuntimeModule = mergeRuntimeModule
module.exports.mergeExpoCameraModule = mergeExpoCameraModule
module.exports.MODULE_ID = MODULE_ID
module.exports.CAMERA_MODULE_ID = CAMERA_MODULE_ID
module.exports.IMAGE_PICKER_MODULE_ID = IMAGE_PICKER_MODULE_ID
module.exports.MODULE_IDS = MODULE_IDS
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY
module.exports.PERMISSION_STATUS = PERMISSION_STATUS
module.exports.CAMERA_TYPE = CAMERA_TYPE
module.exports.FLASH_MODE = FLASH_MODE
module.exports.MEDIA_TYPE = MEDIA_TYPE
module.exports.MEDIA_TYPE_OPTIONS = MEDIA_TYPE_OPTIONS
module.exports.UI_IMAGE_PICKER_PRESENTATION_STYLE = UI_IMAGE_PICKER_PRESENTATION_STYLE
