import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

class HapticService {
    private enabled: boolean = true;

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    // Subtle micro-tick on navigation, focus change, tab switch, page scroll
    async tick() {
        if (!this.enabled) return;
        try {
            await Haptics.selectionAsync();
        } catch {
            try {
                if (Platform.OS === 'android') {
                    Vibration.vibrate(10);
                }
            } catch {}
        }
    }

    // Noticeable tap on button press (e.g. Button A, Button Y)
    async press() {
        if (!this.enabled) return;
        try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
            try {
                if (Platform.OS === 'android') {
                    Vibration.vibrate(20);
                }
            } catch {}
        }
    }

    // Stronger impact for destructive or heavy actions
    async heavy() {
        if (!this.enabled) return;
        try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {
            try {
                if (Platform.OS === 'android') {
                    Vibration.vibrate(35);
                }
            } catch {}
        }
    }

    // Double pulse / success notification (downloads queued / completed)
    async success() {
        if (!this.enabled) return;
        try {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
            try {
                if (Platform.OS === 'android') {
                    Vibration.vibrate([0, 25, 40, 25]);
                }
            } catch {}
        }
    }

    // Warning notification (insufficient storage)
    async warning() {
        if (!this.enabled) return;
        try {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } catch {
            try {
                if (Platform.OS === 'android') {
                    Vibration.vibrate([0, 40, 30, 40]);
                }
            } catch {}
        }
    }
}

export const hapticService = new HapticService();
