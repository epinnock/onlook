import React from 'react';

// Minimal realistic user bundle for the MCI.3 size gate: a single
// text-rendering component that represents the smallest thing an
// Onlook user would ship. Kept separate from `minimal-app.tsx`
// (which exercises nested-JSX for drift tests) so the CI gate
// measures the floor of a real user bundle.
const Text = (props: { children: React.ReactNode }) => <span>{props.children}</span>;

export default function App() {
    return <Text>Hello, Onlook!</Text>;
}
