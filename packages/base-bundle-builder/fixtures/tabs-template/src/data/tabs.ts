export interface FixtureMetric {
  id: string;
  label: string;
  value: string;
  body: string;
}

export const HOME_METRICS: FixtureMetric[] = [
  {
    id: 'routing',
    label: 'Routes',
    value: '3 tabs',
    body: 'Local Pressable tabs switch between Home, Explore, and Settings screens.',
  },
  {
    id: 'imports',
    label: 'Imports',
    value: '8 files',
    body: 'Local components, shared data, and theme imports exercise multi-file graph walking.',
  },
];

export const EXPLORE_ITEMS: FixtureMetric[] = [
  {
    id: 'metro',
    label: 'Metro',
    value: 'SDK 54',
    body: 'The app uses an Expo config and a native AppRegistry entry for Metro tests.',
  },
  {
    id: 'state',
    label: 'State',
    value: 'useState',
    body: 'The tab bar stays interactive without depending on navigation libraries.',
  },
  {
    id: 'safe-area',
    label: 'Safe Area',
    value: 'Provider',
    body: 'The root and tab bar use react-native-safe-area-context for native insets.',
  },
];
