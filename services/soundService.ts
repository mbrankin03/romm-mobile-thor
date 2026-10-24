import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

const { DownloadNotification } = NativeModules;

class SoundService {
    private enabled: boolean = true;
    private initialized: boolean = false;

    constructor() {
        this.loadSettings();
    }

    async loadSettings() {
        try {
            const saved = await AsyncStorage.getItem('soundEffectsEnabled');
            if (saved !== null) {
                this.enabled = JSON.parse(saved);
            }
            this.initialized = true;
        } catch {
            this.enabled = true;
        }
    }

    async setEnabled(val: boolean) {
        this.enabled = val;
        await AsyncStorage.setItem('soundEffectsEnabled', JSON.stringify(val));
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    playFocus() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('focus');
        } catch {}
    }

    playSelect() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('select');
        } catch {}
    }

    playBack() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('back');
        } catch {}
    }

    playTab() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('tab');
        } catch {}
    }

    playComplete() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('complete');
        } catch {}
    }

    playDelete() {
        if (!this.enabled || Platform.OS !== 'android') return;
        try {
            DownloadNotification?.playSoundEffect('delete');
        } catch {}
    }
}

export const soundService = new SoundService();
