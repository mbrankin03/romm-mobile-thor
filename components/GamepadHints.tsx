import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface GamepadHintItem {
    button: 'A' | 'B' | 'X' | 'Y' | 'L1' | 'R1' | 'L1/R1' | 'L2' | 'R2' | 'L2/R2' | 'START' | 'SELECT';
    label: string;
}

export interface GamepadHintsProps {
    hints?: GamepadHintItem[];
    selectText?: string;
    backText?: string;
}

const defaultHints: GamepadHintItem[] = [
    { button: 'A', label: 'Select' },
    { button: 'B', label: 'Back' },
];

export const GamepadHints: React.FC<GamepadHintsProps> = ({ hints, selectText, backText }) => {
    const computedHints: GamepadHintItem[] = hints || [
        { button: 'A', label: selectText || 'Select' },
        { button: 'B', label: backText || 'Back' },
    ];
    const getBadgeColor = (btn: string) => {
        switch (btn) {
            case 'A':
                return '#22c55e'; // Green
            case 'B':
                return '#ef4444'; // Red
            case 'X':
                return '#3b82f6'; // Blue
            case 'Y':
                return '#eab308'; // Yellow
            case 'L1':
            case 'R1':
            case 'L1/R1':
            case 'L2':
            case 'R2':
            case 'L2/R2':
                return '#a855f7'; // Purple
            default:
                return '#64748b';
        }
    };

    return (
        <View style={styles.container}>
            {computedHints.map((hint, idx) => (
                <View key={idx} style={styles.hintItem}>
                    <View style={[styles.badge, { backgroundColor: getBadgeColor(hint.button) }]}>
                        <Text style={styles.badgeText}>{hint.button}</Text>
                    </View>
                    <Text style={styles.labelText}>{hint.label}</Text>
                </View>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: '#111827',
        borderTopWidth: 1,
        borderTopColor: '#1f2937',
        gap: 16,
    },
    hintItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    badge: {
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    labelText: {
        color: '#9ca3af',
        fontSize: 12,
        fontWeight: '500',
    },
});
