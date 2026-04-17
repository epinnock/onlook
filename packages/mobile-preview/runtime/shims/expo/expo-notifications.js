const MODULE_ID = 'expo-notifications'
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims'
const NOTIFICATIONS_STATE_KEY = '__onlookExpoNotifications'
const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT'

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo-notifications shim requires an object target')
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {}
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY]
}

function normalizeMap(value) {
  if (value instanceof Map) {
    return value
  }

  if (Array.isArray(value)) {
    return new Map(value)
  }

  if (value && typeof value === 'object') {
    return new Map(Object.entries(value))
  }

  return new Map()
}

function normalizeSet(value) {
  if (value instanceof Set) {
    return value
  }

  if (Array.isArray(value)) {
    return new Set(value)
  }

  return new Set()
}

function ensureNotificationsState(target) {
  if (!target[NOTIFICATIONS_STATE_KEY] || typeof target[NOTIFICATIONS_STATE_KEY] !== 'object') {
    target[NOTIFICATIONS_STATE_KEY] = {}
  }

  const state = target[NOTIFICATIONS_STATE_KEY]

  state.badgeCount =
    typeof state.badgeCount === 'number' && Number.isFinite(state.badgeCount)
      ? Math.max(0, Math.trunc(state.badgeCount))
      : 0
  state.channels = normalizeMap(state.channels)
  state.droppedListeners = normalizeSet(state.droppedListeners)
  state.lastNotificationResponse =
    state.lastNotificationResponse && typeof state.lastNotificationResponse === 'object'
      ? state.lastNotificationResponse
      : null
  state.nextNotificationId =
    typeof state.nextNotificationId === 'number' && Number.isFinite(state.nextNotificationId)
      ? Math.max(0, Math.trunc(state.nextNotificationId))
      : 0
  state.notificationHandler =
    state.notificationHandler && typeof state.notificationHandler === 'object'
      ? state.notificationHandler
      : null
  state.presentedNotifications = normalizeMap(state.presentedNotifications)
  state.pushTokenListeners = normalizeSet(state.pushTokenListeners)
  state.receivedListeners = normalizeSet(state.receivedListeners)
  state.responseListeners = normalizeSet(state.responseListeners)
  state.scheduledNotifications = normalizeMap(state.scheduledNotifications)
  state.tasks = normalizeSet(state.tasks)

  return state
}

function createPermissionResponse() {
  return {
    canAskAgain: true,
    expires: 'never',
    granted: true,
    status: 'granted',
  }
}

function createSubscription(bucket, listener, label) {
  if (typeof listener !== 'function') {
    throw new TypeError(`expo-notifications shim requires a function ${label}`)
  }

  bucket.add(listener)

  let removed = false

  return {
    remove() {
      if (removed) {
        return
      }

      removed = true
      bucket.delete(listener)
    },
  }
}

function emitListeners(bucket, payload) {
  for (const listener of Array.from(bucket)) {
    listener(payload)
  }
}

function cloneContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return {}
  }

  return { ...content }
}

function createNotificationId(state, preferredId) {
  if (typeof preferredId === 'string' && preferredId.length > 0) {
    return preferredId
  }

  state.nextNotificationId += 1
  return `onlook-notification-${state.nextNotificationId}`
}

function normalizeNotificationRequest(state, input) {
  const candidate = input && typeof input === 'object' ? input : {}
  const identifier = createNotificationId(state, candidate.identifier)

  if ('content' in candidate && candidate.content && typeof candidate.content === 'object') {
    return {
      content: cloneContent(candidate.content),
      identifier,
      trigger: 'trigger' in candidate ? candidate.trigger ?? null : null,
    }
  }

  return {
    content: cloneContent(candidate),
    identifier,
    trigger: null,
  }
}

function createNotification(state, input) {
  return {
    date: new Date(),
    request: normalizeNotificationRequest(state, input),
  }
}

async function invokeNotificationHandler(state, notification) {
  const handler = state.notificationHandler

  if (!handler || typeof handler.handleNotification !== 'function') {
    return null
  }

  try {
    const behavior = await handler.handleNotification(notification)

    if (typeof handler.handleSuccess === 'function') {
      handler.handleSuccess(notification.request.identifier)
    }

    return behavior
  } catch (error) {
    if (typeof handler.handleError === 'function') {
      handler.handleError(error)
    }

    return null
  }
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default') {
      continue
    }

    if (!(key in existingModule)) {
      existingModule[key] = value
    }
  }

  existingModule.default = existingModule.default ?? existingModule
  existingModule.__esModule = true
  return existingModule
}

function createExpoNotificationsModule(target = globalThis) {
  const state = ensureNotificationsState(target)

  const moduleExports = {
    DEFAULT_ACTION_IDENTIFIER,
    addNotificationReceivedListener(listener) {
      return createSubscription(state.receivedListeners, listener, 'listener')
    },
    addNotificationResponseReceivedListener(listener) {
      return createSubscription(state.responseListeners, listener, 'listener')
    },
    addNotificationsDroppedListener(listener) {
      return createSubscription(state.droppedListeners, listener, 'listener')
    },
    addPushTokenListener(listener) {
      return createSubscription(state.pushTokenListeners, listener, 'listener')
    },
    async cancelAllScheduledNotificationsAsync() {
      state.scheduledNotifications.clear()
    },
    async cancelScheduledNotificationAsync(identifier) {
      state.scheduledNotifications.delete(String(identifier))
    },
    clearLastNotificationResponse() {
      state.lastNotificationResponse = null
    },
    async clearLastNotificationResponseAsync() {
      state.lastNotificationResponse = null
    },
    async deleteNotificationChannelAsync(channelId) {
      return state.channels.delete(String(channelId))
    },
    async dismissAllNotificationsAsync() {
      state.presentedNotifications.clear()
      state.lastNotificationResponse = null
    },
    async dismissNotificationAsync(identifier) {
      const notificationId = String(identifier)
      state.presentedNotifications.delete(notificationId)

      if (
        state.lastNotificationResponse?.notification?.request?.identifier ===
        notificationId
      ) {
        state.lastNotificationResponse = null
      }
    },
    async getAllScheduledNotificationsAsync() {
      return Array.from(state.scheduledNotifications.values()).map((request) => ({
        ...request,
        content: cloneContent(request.content),
      }))
    },
    async getBadgeCountAsync() {
      return state.badgeCount
    },
    async getDevicePushTokenAsync() {
      const token = {
        data: 'onlook-device-push-token',
        type: 'ios',
      }

      emitListeners(state.pushTokenListeners, token)
      return token
    },
    async getExpoPushTokenAsync(options) {
      const projectId =
        options &&
        typeof options === 'object' &&
        typeof options.projectId === 'string' &&
        options.projectId.length > 0
          ? options.projectId
          : 'preview'
      const token = {
        data: `ExponentPushToken[${projectId}]`,
        type: 'expo',
      }

      emitListeners(state.pushTokenListeners, token)
      return token
    },
    async getLastNotificationResponseAsync() {
      return state.lastNotificationResponse
    },
    getLastNotificationResponse() {
      return state.lastNotificationResponse
    },
    async getNextTriggerDateAsync(trigger) {
      if (!trigger || typeof trigger !== 'object') {
        return null
      }

      if (typeof trigger.seconds === 'number' && Number.isFinite(trigger.seconds)) {
        return Date.now() + Math.max(0, trigger.seconds) * 1000
      }

      return null
    },
    async getNotificationChannelAsync(channelId) {
      return state.channels.get(String(channelId)) ?? null
    },
    async getNotificationChannelsAsync() {
      return Array.from(state.channels.values())
    },
    async getPermissionsAsync() {
      return createPermissionResponse()
    },
    async getPresentedNotificationsAsync() {
      return Array.from(state.presentedNotifications.values())
    },
    async presentNotificationAsync(content) {
      const notification = createNotification(state, content)
      const behavior = await invokeNotificationHandler(state, notification)

      if (
        behavior &&
        typeof behavior === 'object' &&
        behavior.shouldSetBadge &&
        typeof notification.request.content.badge === 'number'
      ) {
        state.badgeCount = Math.max(0, Math.trunc(notification.request.content.badge))
      }

      state.presentedNotifications.set(notification.request.identifier, notification)
      emitListeners(state.receivedListeners, notification)
      return notification.request.identifier
    },
    async registerTaskAsync(taskName) {
      state.tasks.add(String(taskName))
    },
    removeNotificationSubscription(subscription) {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove()
      }
    },
    removePushTokenSubscription(subscription) {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove()
      }
    },
    async requestPermissionsAsync() {
      return createPermissionResponse()
    },
    async scheduleNotificationAsync(request) {
      const notification = createNotification(state, request)
      state.scheduledNotifications.set(notification.request.identifier, notification.request)
      return notification.request.identifier
    },
    async setBadgeCountAsync(count) {
      const numericCount = Number(count)
      state.badgeCount = Number.isFinite(numericCount)
        ? Math.max(0, Math.trunc(numericCount))
        : 0
      return true
    },
    async setNotificationChannelAsync(channelId, channel) {
      const nextChannel = {
        ...(channel && typeof channel === 'object' ? channel : {}),
        id: String(channelId),
      }

      state.channels.set(nextChannel.id, nextChannel)
      return nextChannel
    },
    setNotificationHandler(handler) {
      state.notificationHandler = handler && typeof handler === 'object' ? handler : null
    },
    async unregisterForNotificationsAsync() {},
    async unregisterTaskAsync(taskName) {
      state.tasks.delete(String(taskName))
    },
    useLastNotificationResponse() {
      return state.lastNotificationResponse
    },
  }

  moduleExports.default = moduleExports
  moduleExports.__esModule = true

  return moduleExports
}

function installExpoNotificationsShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target)
  const existingModule = registry[MODULE_ID]
  const nextModule = createExpoNotificationsModule(target)

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule)
  }

  registry[MODULE_ID] = nextModule
  return nextModule
}

module.exports = installExpoNotificationsShim
module.exports.install = installExpoNotificationsShim
module.exports.applyRuntimeShim = installExpoNotificationsShim
module.exports.createExpoNotificationsModule = createExpoNotificationsModule
module.exports.ensureNotificationsState = ensureNotificationsState
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry
module.exports.mergeRuntimeModule = mergeRuntimeModule
module.exports.DEFAULT_ACTION_IDENTIFIER = DEFAULT_ACTION_IDENTIFIER
module.exports.MODULE_ID = MODULE_ID
module.exports.NOTIFICATIONS_STATE_KEY = NOTIFICATIONS_STATE_KEY
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY
