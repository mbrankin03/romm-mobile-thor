import { NativeModules, Platform, PermissionsAndroid } from 'react-native';

const { DownloadNotification } = NativeModules;

export class NotificationService {
    private static instance: NotificationService;
    private permissionRequested: boolean = false;

    public static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    async initialize(): Promise<void> {
        await this.requestPermission();
    }

    async requestPermission(): Promise<boolean> {
        if (this.permissionRequested) return true;
        if (Platform.OS === 'android' && Platform.Version >= 33) {
            try {
                this.permissionRequested = true;
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
                    {
                        title: 'Download Notifications',
                        message: 'RomM Mobile uses notifications to show download progress in your status bar.',
                        buttonPositive: 'Allow',
                    }
                );
                return granted === PermissionsAndroid.RESULTS.GRANTED;
            } catch (err) {
                console.warn('Failed to request notification permission:', err);
                return false;
            }
        }
        return true;
    }

    getNotificationId(downloadId: string): number {
        let hash = 0;
        for (let i = 0; i < downloadId.length; i++) {
            hash = (hash << 5) - hash + downloadId.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) % 100000 + 1000;
    }

    showProgress(
        notificationId: number,
        title: string,
        message: string,
        progress: number,
        max: number = 100,
        indeterminate: boolean = false
    ): void {
        if (Platform.OS === 'android' && DownloadNotification) {
            DownloadNotification.showProgress(
                notificationId,
                title,
                message,
                progress,
                max,
                indeterminate
            );
        }
    }

    showCompleted(notificationId: number, title: string, message: string): void {
        if (Platform.OS === 'android' && DownloadNotification) {
            DownloadNotification.showCompleted(notificationId, title, message);
        }
    }

    showFailed(notificationId: number, title: string, message: string): void {
        if (Platform.OS === 'android' && DownloadNotification) {
            DownloadNotification.showFailed(notificationId, title, message);
        }
    }

    cancel(notificationId: number): void {
        if (Platform.OS === 'android' && DownloadNotification) {
            DownloadNotification.cancel(notificationId);
        }
    }

    cancelAll(): void {
        if (Platform.OS === 'android' && DownloadNotification) {
            DownloadNotification.cancelAll();
        }
    }

    // Backward-compatibility helpers for downloadService
    async showDownloadStartedNotification(romName: string): Promise<void> {
        this.showProgress(1, `Downloading ${romName}`, 'Starting download...', 0, 100, true);
    }

    async showDownloadCompleteNotification(romName: string): Promise<void> {
        this.showCompleted(1, 'Download Complete', `${romName} has been downloaded`);
    }

    async showDownloadFailedNotification(romName: string, error: string): Promise<void> {
        this.showFailed(1, 'Download Failed', `${romName}: ${error}`);
    }

    async getBatteryStatus(): Promise<{ level: number; isCharging: boolean } | null> {
        if (Platform.OS === 'android' && DownloadNotification && DownloadNotification.getBatteryStatus) {
            try {
                return await DownloadNotification.getBatteryStatus();
            } catch {
                return null;
            }
        }
        return null;
    }

    async hasManageStoragePermission(): Promise<boolean> {
        if (Platform.OS === 'android' && DownloadNotification?.hasManageStoragePermission) {
            try {
                return await DownloadNotification.hasManageStoragePermission();
            } catch {
                return false;
            }
        }
        return true;
    }

    async openManageStorageSettings(): Promise<boolean> {
        if (Platform.OS === 'android' && DownloadNotification?.openManageStorageSettings) {
            try {
                return await DownloadNotification.openManageStorageSettings();
            } catch {
                return false;
            }
        }
        return false;
    }
}

export const notificationService = NotificationService.getInstance();
