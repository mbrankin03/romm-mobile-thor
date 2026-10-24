import { useEffect, useRef } from 'react';
import { BackHandler, DeviceEventEmitter, Platform, ToastAndroid } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { soundService } from '../services/soundService';
import { hapticService } from '../services/hapticService';

interface UseGamepadNavigationOptions {
    onBack?: () => boolean; // return true if handled
    canGoBack?: boolean;
    onButtonB?: () => boolean; // return true if handled
    onButtonX?: () => boolean; // return true if handled
    onButtonY?: () => boolean; // return true if handled
    onButtonL1?: () => boolean; // return true if handled
    onButtonR1?: () => boolean; // return true if handled
    onButtonL2?: () => boolean; // return true if handled
    onButtonR2?: () => boolean; // return true if handled
}

let lastRootBackTime = 0;

export function useGamepadNavigation(options?: UseGamepadNavigationOptions) {
    const router = useRouter();
    const pathname = usePathname();
    const isFocused = useIsFocused();
    const lastBackTimeRef = useRef<number>(0);

    const triggerBack = () => {
        const now = Date.now();
        if (now - lastBackTimeRef.current < 180) {
            return true; // Ignore debounced duplicate back event
        }
        lastBackTimeRef.current = now;
        hapticService.press();
        soundService.playBack();

        if (options?.onButtonB) {
            const handled = options.onButtonB();
            if (handled) return true;
        }

        if (options?.onBack) {
            const handled = options.onBack();
            if (handled) return true;
        }

        if (pathname === '/' || pathname === '') {
            if (now - lastRootBackTime < 2000) {
                BackHandler.exitApp();
                return true;
            }
            lastRootBackTime = now;
            if (Platform.OS === 'android') {
                ToastAndroid.show('Press B again to exit', ToastAndroid.SHORT);
            }
            return true;
        }

        if (options?.canGoBack !== false) {
            if (router.canGoBack()) {
                router.back();
                return true;
            } else {
                router.replace('/');
                return true;
            }
        }

        return false;
    };

    useEffect(() => {
        if (!isFocused) return;

        const onHardwareBack = () => {
            return triggerBack();
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
        return () => subscription.remove();
    }, [isFocused, options?.onBack, options?.onButtonB, options?.canGoBack, router]);

    useEffect(() => {
        if (!isFocused) return;

        const keySubscription = DeviceEventEmitter.addListener('onGamepadKeyDown', (event: { keyCode: number }) => {
            if (event.keyCode === 97) { // KEYCODE_BUTTON_B
                triggerBack();
            } else if (event.keyCode === 99) { // KEYCODE_BUTTON_X
                hapticService.press();
                if (options?.onButtonX) {
                    const handled = options.onButtonX();
                    if (handled) return;
                }
                // Default global behavior for X: navigate to /downloads if not already there
                if (pathname !== '/downloads') {
                    router.push('/downloads');
                }
            } else if (event.keyCode === 100) { // KEYCODE_BUTTON_Y
                hapticService.press();
                if (options?.onButtonY) {
                    const handled = options.onButtonY();
                    if (handled) return;
                }
                // Default global behavior for Y: navigate to search
                if (pathname !== '/search') {
                    router.push('/search');
                }
            } else if (event.keyCode === 102) { // KEYCODE_BUTTON_L1
                hapticService.tick();
                soundService.playTab();
                if (options?.onButtonL1) {
                    options.onButtonL1();
                }
            } else if (event.keyCode === 103) { // KEYCODE_BUTTON_R1
                hapticService.tick();
                soundService.playTab();
                if (options?.onButtonR1) {
                    options.onButtonR1();
                }
            } else if (event.keyCode === 104) { // KEYCODE_BUTTON_L2
                hapticService.tick();
                if (options?.onButtonL2) {
                    options.onButtonL2();
                }
            } else if (event.keyCode === 105) { // KEYCODE_BUTTON_R2
                hapticService.tick();
                if (options?.onButtonR2) {
                    options.onButtonR2();
                }
            }
        });

        return () => keySubscription.remove();
    }, [isFocused, options?.onButtonB, options?.onBack, options?.canGoBack, options?.onButtonX, options?.onButtonY, options?.onButtonL1, options?.onButtonR1, options?.onButtonL2, options?.onButtonR2, pathname, router]);
}

