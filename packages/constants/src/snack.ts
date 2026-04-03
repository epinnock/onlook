export const SNACK_DEFAULT_SDK_VERSION = '52.0.0';
export const SNACK_WEB_PLAYER_BASE_URL = 'https://snack.expo.dev/embedded';
export const SNACK_DOMAIN = 'snack.expo.dev';

export const SNACK_BLANK_TEMPLATE = {
    name: 'Blank Expo Project',
    files: {
        'App.tsx': {
            type: 'CODE' as const,
            contents: `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Hello from Scry IDE!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});`,
        },
    },
    dependencies: {
        'expo': { version: '~52.0.0' },
        'expo-status-bar': { version: '~3.0.0' },
        'react-native': { version: '0.76.0' },
    },
} as const;

export function getSnackWebPreviewUrl(snackId: string): string {
    return `${SNACK_WEB_PLAYER_BASE_URL}/@snack/${snackId}?preview=true&platform=web`;
}
