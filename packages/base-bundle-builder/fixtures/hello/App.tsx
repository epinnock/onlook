import { StyleSheet, Text, View } from 'react-native';

export const HELLO_FIXTURE_TEXT = 'Hello, Onlook!';

export default function App() {
    return (
        <View style={styles.container}>
            <Text testID="hello-fixture-text" style={styles.title}>
                {HELLO_FIXTURE_TEXT}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#101014',
    },
    title: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: '600',
    },
});
