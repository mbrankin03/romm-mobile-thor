import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';

/**
 * Hook to calculate dynamic columns based on screen dimensions and orientation
 * Automatically adjusts the number of columns and card width based on:
 * - Device type (phone vs tablet)
 * - Screen orientation (portrait vs landscape)
 * - Available screen width
 */
export const useDynamicColumns = () => {
    const [screenData, setScreenData] = useState(Dimensions.get('window'));
    const [orientation, setOrientation] = useState<ScreenOrientation.Orientation>(
        ScreenOrientation.Orientation.PORTRAIT_UP
    );

    useEffect(() => {
        const subscription = Dimensions.addEventListener('change', ({ window }) => {
            setScreenData(window);
        });

        const getOrientation = async () => {
            const currentOrientation = await ScreenOrientation.getOrientationAsync();
            setOrientation(currentOrientation);
        };

        getOrientation();

        const orientationSubscription = ScreenOrientation.addOrientationChangeListener(
            (event) => {
                setOrientation(event.orientationInfo.orientation);
            }
        );

        return () => {
            subscription?.remove();
            ScreenOrientation.removeOrientationChangeListener(orientationSubscription);
        };
    }, []);

    const calculateColumns = () => {
        const { width, height } = screenData;
        const isLandscape = orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
            orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
        // Landscape on handhelds like Ayn Thor: width is ~833dp (1920px physical @ 369dpi)
        const isHandheldLandscape = isLandscape || width > height;

        if (isHandheldLandscape) {
            // Handheld landscape: 5 clean columns for game cards
            const columns = width >= 800 ? 5 : 4;
            const horizontalPadding = 32; // 16px each side
            const cardMargin = 12;
            const availableWidth = width - horizontalPadding;
            const cardWidth = Math.floor((availableWidth - (cardMargin * (columns - 1))) / columns);
            return { columns, cardWidth, isLandscape: true };
        }

        // Portrait fallback
        const columns = 2;
        const horizontalPadding = 24;
        const cardMargin = 12;
        const availableWidth = width - horizontalPadding;
        const cardWidth = Math.floor((availableWidth - (cardMargin * (columns - 1))) / columns);

        return { columns, cardWidth, isLandscape: false };
    };

    return calculateColumns();
};
