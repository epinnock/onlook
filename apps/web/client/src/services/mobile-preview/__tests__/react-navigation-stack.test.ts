import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const installReactNavigationStack = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-navigation-stack.js')

const {
    MODULE_IDS,
    NAVIGATION_NATIVE_MODULE_ID,
    NAVIGATION_STACK_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installReactNavigationStack

function createTarget() {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    }
}

describe('react-navigation stack shim', () => {
    test('installs @react-navigation/native and @react-navigation/stack into __onlookShims', () => {
        const target = createTarget()

        const installedModules = installReactNavigationStack(target)
        const nativeModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][NAVIGATION_NATIVE_MODULE_ID]
        const stackModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][NAVIGATION_STACK_MODULE_ID]

        expect(MODULE_IDS).toEqual([
            '@react-navigation/native',
            '@react-navigation/stack',
        ])
        expect(installedModules[NAVIGATION_NATIVE_MODULE_ID]).toBe(nativeModule)
        expect(installedModules[NAVIGATION_STACK_MODULE_ID]).toBe(stackModule)
        expect(nativeModule.default).toBe(nativeModule)
        expect(stackModule.default).toBe(stackModule)
        expect(nativeModule.__esModule).toBe(true)
        expect(stackModule.__esModule).toBe(true)
        expect(nativeModule.NavigationContainer.displayName).toBe(
            'NavigationContainer',
        )
        expect(typeof stackModule.createStackNavigator).toBe('function')
    })

    test('renders the initial stack screen and wires navigation hooks through the container', () => {
        const target = createTarget()
        const installedModules = installReactNavigationStack(target)
        const nativeModule = installedModules[NAVIGATION_NATIVE_MODULE_ID]
        const stackModule = installedModules[NAVIGATION_STACK_MODULE_ID]
        const captured: {
            navigation?: Record<string, unknown>
            route?: Record<string, unknown>
            hookNavigation?: Record<string, unknown>
            hookRoute?: Record<string, unknown>
        } = {}

        const Stack = stackModule.createStackNavigator()

        function HomeScreen(props: Record<string, unknown>) {
            captured.navigation = props.navigation as Record<string, unknown>
            captured.route = props.route as Record<string, unknown>
            captured.hookNavigation = nativeModule.useNavigation()
            captured.hookRoute = nativeModule.useRoute()

            return React.createElement(
                target.TextC,
                null,
                `Home:${String((props.route as { name: string }).name)}`,
            )
        }

        function DetailsScreen() {
            return React.createElement(target.TextC, null, 'Details')
        }

        const html = renderToStaticMarkup(
            React.createElement(
                nativeModule.NavigationContainer,
                null,
                React.createElement(
                    Stack.Navigator,
                    { initialRouteName: 'Home' },
                    React.createElement(Stack.Screen, {
                        name: 'Home',
                        component: HomeScreen,
                    }),
                    React.createElement(Stack.Screen, {
                        name: 'Details',
                        component: DetailsScreen,
                    }),
                ),
            ),
        )

        expect(html).toContain('Home:Home')
        expect(html).not.toContain('Details')
        expect(captured.route).toEqual({
            key: 'Home-0',
            name: 'Home',
            params: {},
        })
        expect(captured.hookRoute).toEqual(captured.route)
        expect(captured.hookNavigation).toBe(captured.navigation)
        expect(typeof captured.navigation?.navigate).toBe('function')
        expect(typeof captured.navigation?.push).toBe('function')
        expect(typeof captured.navigation?.replace).toBe('function')
        expect(typeof captured.navigation?.goBack).toBe('function')
        expect(captured.navigation?.canGoBack()).toBe(false)
    })

    test('renders a preview-safe navigation Button and merges with existing registry entries', () => {
        const existingToken = Symbol('existing')
        const target = {
            ...createTarget(),
            __onlookShims: {
                [NAVIGATION_NATIVE_MODULE_ID]: {
                    Existing: existingToken,
                },
            },
        }

        const installedModules = installReactNavigationStack(target)
        const nativeModule = installedModules[NAVIGATION_NATIVE_MODULE_ID]
        const buttonElement = nativeModule.Button({
            onPress() {},
            testID: 'nav-button',
            title: 'Go details',
        })

        expect(nativeModule).toBe(target.__onlookShims[NAVIGATION_NATIVE_MODULE_ID])
        expect(nativeModule.Existing).toBe(existingToken)
        expect(buttonElement.type).toBe('View')
        expect(buttonElement.props.accessibilityRole).toBe('button')
        expect(buttonElement.props.testID).toBe('nav-button')
        expect(typeof buttonElement.props.onPress).toBe('function')
        expect(buttonElement.props.children.type).toBe('Text')
        expect(buttonElement.props.children.props.children).toBe('Go details')
        expect(target.__onlookShims[NAVIGATION_STACK_MODULE_ID]).toBe(
            installedModules[NAVIGATION_STACK_MODULE_ID],
        )
    })
})
