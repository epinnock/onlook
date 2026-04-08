import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Unique marker grep'd by smoke.sh to prove the bundle came from THIS fixture.
// Bumping this string is a coordinated change with smoke.sh's grep target.
const FIXTURE_MARKER = 'TH1.3-minimal-expo-fixture-v1';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{FIXTURE_MARKER}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
