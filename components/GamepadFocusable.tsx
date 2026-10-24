import { hapticService } from '../services/hapticService';
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    PressableProps,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from 'react-native';
import { soundService } from '../services/soundService';

export interface GamepadFocusableProps extends Omit<PressableProps, 'style' | 'children'> {
    style?: StyleProp<ViewStyle> | ((state: { focused: boolean; pressed: boolean }) => StyleProp<ViewStyle>);
    focusStyle?: StyleProp<ViewStyle>;
    focusScale?: number;
    glowColor?: string;
    hasTVPreferredFocus?: boolean;
    autoScroll?: boolean;
    children?: React.ReactNode | ((state: { focused: boolean; pressed: boolean }) => React.ReactNode);
}

export const GamepadFocusable = forwardRef<View, GamepadFocusableProps>(
    (
        {
            style,
            focusStyle,
            focusScale = 1.03,
            glowColor = '#00E5FF',
            hasTVPreferredFocus = false,
            autoScroll = true,
            onFocus,
            onBlur,
            children,
            ...rest
        },
        ref
    ) => {
        const [isFocused, setIsFocused] = useState(false);
        const [isPressed, setIsPressed] = useState(false);
        const innerRef = useRef<View>(null);

        useImperativeHandle(ref, () => innerRef.current as View);

        const handleFocus = (event: any) => {
            setIsFocused(true);
            if (Platform.OS === 'android') {
                hapticService.tick();
                soundService.playFocus();
            }
            if (autoScroll && innerRef.current && Platform.OS === 'android') {
                try {
                    // Trigger scroll responder into view if inside ScrollView
                    (innerRef.current as any)?.requestChildRectangleOnScreen?.();
                } catch {
                    // Ignore layout measurement errors
                }
            }
            onFocus?.(event);
        };

        const handleBlur = (event: any) => {
            setIsFocused(false);
            onBlur?.(event);
        };

        const handlePress = (event: any) => {
            hapticService.press();
            soundService.playSelect();
            rest.onPress?.(event);
        };

        const resolveStyle = (): StyleProp<ViewStyle> => {
            let baseStyle: StyleProp<ViewStyle>;
            if (typeof style === 'function') {
                baseStyle = style({ focused: isFocused, pressed: isPressed });
            } else {
                baseStyle = style;
            }

            return [
                baseStyle,
                isFocused && focusStyle,
            ];
        };

        const flattened = StyleSheet.flatten(typeof style === 'function' ? style({ focused: isFocused, pressed: isPressed }) : style);
        const resolvedBorderRadius = (flattened && flattened.borderRadius) !== undefined ? flattened.borderRadius : 12;

        return (
            <Pressable
                ref={innerRef}
                focusable={true}
                hasTVPreferredFocus={hasTVPreferredFocus}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onPress={handlePress}
                onPressIn={() => setIsPressed(true)}
                onPressOut={() => setIsPressed(false)}
                style={resolveStyle()}
                {...rest}
            >
                {typeof children === 'function'
                    ? children({ focused: isFocused, pressed: isPressed })
                    : children}
                {isFocused && (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.focusOverlay,
                            {
                                borderColor: glowColor,
                                borderRadius: resolvedBorderRadius,
                            },
                        ]}
                    />
                )}
            </Pressable>
        );
    }
);

GamepadFocusable.displayName = 'GamepadFocusable';

const styles = StyleSheet.create({
    focusOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderWidth: 3,
        zIndex: 999,
    },
});
