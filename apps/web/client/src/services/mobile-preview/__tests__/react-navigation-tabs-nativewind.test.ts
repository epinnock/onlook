import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNavigationBottomTabs = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-navigation-tabs-nativewind.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } =
    installReactNavigationBottomTabs;

function createTarget() {
    return {
        React,
        View: 'View',
    };
}

describe('react-navigation bottom-tabs shim', () => {
    test('installs preview-safe bottom-tabs exports into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installReactNavigationBottomTabs(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(Object.keys(moduleExports)).toEqual(
            expect.arrayContaining([
                'createBottomTabNavigator',
                'BottomTabBar',
                'BottomTabView',
                'BottomTabBarHeightContext',
                'useBottomTabBarHeight',
            ]),
        );
        expect(moduleExports.useBottomTabBarHeight()).toBe(0);
    });

    test('renders the first tab screen component through the preview View host', () => {
        const target = createTarget();
        const moduleExports = installReactNavigationBottomTabs(target);
        const Tab = moduleExports.createBottomTabNavigator();

        function HomeScreen(props: {
            route: { name: string; params: { source: string } };
            navigation: { isFocused: () => boolean; jumpTo: () => void };
        }) {
            return React.createElement('ScreenContent', {
                routeName: props.route.name,
                source: props.route.params.source,
                focused: props.navigation.isFocused(),
                hasJumpTo: typeof props.navigation.jumpTo === 'function',
            });
        }

        const navigator = Tab.Navigator({
            testID: 'tabs-root',
            children: [
                React.createElement(Tab.Screen, {
                    key: 'home',
                    name: 'Home',
                    initialParams: { source: 'component' },
                    component: HomeScreen,
                }),
                React.createElement(Tab.Screen, {
                    key: 'settings',
                    name: 'Settings',
                    children: 'Settings child',
                }),
            ],
        });

        expect(navigator.type).toBe('View');
        expect(navigator.props.testID).toBe('tabs-root');
        expect(navigator.props.children.type).toBe(HomeScreen);
        const renderedScreen = navigator.props.children.type(
            navigator.props.children.props,
        );

        expect(renderedScreen.type).toBe('ScreenContent');
        expect(renderedScreen.props).toEqual({
            routeName: 'Home',
            source: 'component',
            focused: true,
            hasJumpTo: true,
        });
    });

    test('merges navigator and screen Nativewind-compatible props onto the wrapper view', () => {
        const target = createTarget();
        const moduleExports = installReactNavigationBottomTabs(target);
        const Tab = moduleExports.createBottomTabNavigator();

        const navigator = Tab.Navigator({
            className: 'flex-1 bg-black',
            style: { flex: 1 },
            screenOptions: {
                sceneContainerClassName: 'px-4',
                sceneContainerStyle: { paddingTop: 8 },
            },
            children: React.createElement(Tab.Screen, {
                name: 'Feed',
                options: ({ route }: { route: { name: string } }) => ({
                    className: `route-${route.name.toLowerCase()}`,
                    sceneStyle: { opacity: 0.9 },
                    contentClassName: 'pb-6',
                }),
                children: React.createElement('FeedScreen', { id: 'feed' }),
            }),
        });

        expect(navigator.type).toBe('View');
        expect(navigator.props.className).toBe(
            'flex-1 bg-black route-feed px-4 pb-6',
        );
        expect(navigator.props.style).toEqual([
            { flex: 1 },
            { opacity: 0.9 },
            { paddingTop: 8 },
        ]);
        expect(navigator.props.children.type).toBe('FeedScreen');
    });

    test('keeps helper exports lightweight and merges into an existing registry entry', () => {
        const existingToken = Symbol('Existing');
        const target = {
            ...createTarget(),
            __onlookShims: {
                '@react-navigation/bottom-tabs': {
                    Existing: existingToken,
                },
            },
        };

        const moduleExports = installReactNavigationBottomTabs(target);
        const helper = moduleExports.BottomTabView({
            className: 'rounded-xl',
            style: { opacity: 0.75 },
            children: 'Child',
        });

        expect(moduleExports).toBe(
            target.__onlookShims['@react-navigation/bottom-tabs'],
        );
        expect(moduleExports.Existing).toBe(existingToken);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(helper.type).toBe('View');
        expect(helper.props.className).toBe('rounded-xl');
        expect(helper.props.style).toEqual({ opacity: 0.75 });
        expect(helper.props.children).toBe('Child');
        expect(moduleExports.BottomTabBarHeightContext._currentValue).toBe(0);
    });
});
