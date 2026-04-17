const MODULE_ID = 'react-navigation-stack'
const NAVIGATION_NATIVE_MODULE_ID = '@react-navigation/native'
const NAVIGATION_STACK_MODULE_ID = '@react-navigation/stack'
const MODULE_IDS = [NAVIGATION_NATIVE_MODULE_ID, NAVIGATION_STACK_MODULE_ID]
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims'

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('react-navigation stack shim requires an object target')
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

function resolveTextType(target) {
  return target && target.TextC ? target.TextC : 'Text'
}

function createNavigationRoute(name, params, index) {
  return {
    key: `${name}-${index}`,
    name,
    params: params && typeof params === 'object' ? { ...params } : params ?? {},
  }
}

function normalizeChildren(children) {
  return Array.isArray(children) ? children : children == null ? [] : [children]
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

function createNavigationButton(target) {
  function NavigationButton(props) {
    const React = resolveReact(target)
    const {
      accessibilityLabel,
      onPress,
      testID,
      title,
    } = props || {}

    return React.createElement(
      resolveViewType(target),
      {
        accessibilityLabel,
        accessibilityRole: 'button',
        onPress,
        testID,
      },
      React.createElement(resolveTextType(target), null, title ?? ''),
    )
  }

  NavigationButton.displayName = 'NavigationButton'
  return NavigationButton
}

function createNavigationModules(target = globalThis) {
  const React = resolveReact(target)
  const NavigationContext = React.createContext(null)
  const RouteContext = React.createContext(null)

  function useNavigation() {
    return React.useContext(NavigationContext) ?? createFallbackNavigation()
  }

  function useRoute() {
    return React.useContext(RouteContext) ?? createNavigationRoute('unknown', {}, 0)
  }

  function NavigationContainer(props) {
    return React.createElement(React.Fragment, null, props?.children ?? null)
  }

  NavigationContainer.displayName = 'NavigationContainer'

  function createStackNavigator() {
    function Screen() {
      return null
    }

    Screen.displayName = 'StackScreen'
    Screen.__onlookNavigationStackScreen = true

    function Navigator(props) {
      const screenElements = React.Children.toArray(props?.children).filter(
        child =>
          React.isValidElement(child) &&
          child.type &&
          child.type.__onlookNavigationStackScreen === true,
      )

      const screensByName = new Map(
        screenElements.map(screenElement => [screenElement.props.name, screenElement.props]),
      )
      const initialScreenProps =
        screensByName.get(props?.initialRouteName) ??
        screenElements[0]?.props ??
        null

      if (!initialScreenProps) {
        return null
      }

      const initialRoute = createNavigationRoute(
        initialScreenProps.name,
        initialScreenProps.initialParams,
        0,
      )
      const [routes, setRoutes] = React.useState([initialRoute])
      const activeRoute = routes[routes.length - 1] ?? initialRoute
      const activeScreenProps =
        screensByName.get(activeRoute.name) ?? initialScreenProps

      const navigation = React.useMemo(() => ({
        canGoBack() {
          return routes.length > 1
        },
        goBack() {
          setRoutes(currentRoutes =>
            currentRoutes.length > 1 ? currentRoutes.slice(0, -1) : currentRoutes,
          )
        },
        navigate(name, params) {
          if (!screensByName.has(name)) {
            return
          }

          setRoutes(currentRoutes => [
            ...currentRoutes,
            createNavigationRoute(name, params, currentRoutes.length),
          ])
        },
        push(name, params) {
          if (!screensByName.has(name)) {
            return
          }

          setRoutes(currentRoutes => [
            ...currentRoutes,
            createNavigationRoute(name, params, currentRoutes.length),
          ])
        },
        replace(name, params) {
          if (!screensByName.has(name)) {
            return
          }

          setRoutes(currentRoutes => {
            const nextRoutes =
              currentRoutes.length > 0 ? currentRoutes.slice(0, -1) : []
            nextRoutes.push(createNavigationRoute(name, params, nextRoutes.length))
            return nextRoutes
          })
        },
        reset(state) {
          const nextRoutes = Array.isArray(state?.routes)
            ? state.routes.map((route, index) =>
                createNavigationRoute(route?.name ?? activeRoute.name, route?.params, index),
              )
            : [initialRoute]

          setRoutes(nextRoutes.length > 0 ? nextRoutes : [initialRoute])
        },
      }), [activeRoute.name, initialRoute, routes.length, screensByName])

      const ScreenComponent =
        typeof activeScreenProps.component === 'function'
          ? activeScreenProps.component
          : () => null

      return React.createElement(
        NavigationContext.Provider,
        { value: navigation },
        React.createElement(
          RouteContext.Provider,
          { value: activeRoute },
          React.createElement(ScreenComponent, {
            navigation,
            route: activeRoute,
          }),
        ),
      )
    }

    Navigator.displayName = 'StackNavigator'

    return {
      Navigator,
      Screen,
    }
  }

  function createNavigationContainerRef() {
    return {
      current: null,
      getCurrentRoute() {
        return null
      },
      isReady() {
        return true
      },
      navigate() {},
      goBack() {},
      reset() {},
    }
  }

  const CommonActions = {
    navigate(name, params) {
      return { type: 'NAVIGATE', payload: { name, params } }
    },
    reset(state) {
      return { type: 'RESET', payload: state }
    },
  }

  const StackActions = {
    push(name, params) {
      return { type: 'PUSH', payload: { name, params } }
    },
    replace(name, params) {
      return { type: 'REPLACE', payload: { name, params } }
    },
  }

  const nativeModule = {
    Button: createNavigationButton(target),
    CommonActions,
    NavigationContainer,
    createNavigationContainerRef,
    useNavigation,
    useRoute,
  }

  nativeModule.default = nativeModule
  nativeModule.__esModule = true

  const stackModule = {
    CardStyleInterpolators: {},
    HeaderStyleInterpolators: {},
    TransitionPresets: {},
    createStackNavigator,
  }

  stackModule.default = stackModule
  stackModule.__esModule = true

  return {
    nativeModule,
    stackModule,
  }
}

function createFallbackNavigation() {
  return {
    canGoBack() {
      return false
    },
    goBack() {},
    navigate() {},
    push() {},
    replace() {},
    reset() {},
  }
}

function installReactNavigationStack(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target)
  const { nativeModule, stackModule } = createNavigationModules(target)

  const installedNativeModule =
    registry[NAVIGATION_NATIVE_MODULE_ID] && typeof registry[NAVIGATION_NATIVE_MODULE_ID] === 'object'
      ? mergeRuntimeModule(registry[NAVIGATION_NATIVE_MODULE_ID], nativeModule)
      : (registry[NAVIGATION_NATIVE_MODULE_ID] = nativeModule)

  const installedStackModule =
    registry[NAVIGATION_STACK_MODULE_ID] && typeof registry[NAVIGATION_STACK_MODULE_ID] === 'object'
      ? mergeRuntimeModule(registry[NAVIGATION_STACK_MODULE_ID], stackModule)
      : (registry[NAVIGATION_STACK_MODULE_ID] = stackModule)

  return {
    [NAVIGATION_NATIVE_MODULE_ID]: installedNativeModule,
    [NAVIGATION_STACK_MODULE_ID]: installedStackModule,
  }
}

module.exports = installReactNavigationStack
module.exports.install = installReactNavigationStack
module.exports.applyRuntimeShim = installReactNavigationStack
module.exports.createNavigationModules = createNavigationModules
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry
module.exports.mergeRuntimeModule = mergeRuntimeModule
module.exports.MODULE_ID = MODULE_ID
module.exports.MODULE_IDS = MODULE_IDS
module.exports.NAVIGATION_NATIVE_MODULE_ID = NAVIGATION_NATIVE_MODULE_ID
module.exports.NAVIGATION_STACK_MODULE_ID = NAVIGATION_STACK_MODULE_ID
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY
