import * as FileSystem from 'expo-file-system/legacy';
import { openDocumentTree, mkdir, createFile, moveFile, unlink, stat, listFiles, exists } from "@joplin/react-native-saf-x";
import { unzip, subscribe } from 'react-native-zip-archive';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';
import RNFS from 'react-native-fs';
import { PlatformFolder } from '../hooks/usePlatformFolders';
import { useRomFileSystem } from '../hooks/useRomFileSystem';
import { apiClient, Rom, RomFile } from '../services/api';
import { notificationService } from '../services/notificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { soundService } from '../services/soundService';
import { hapticService } from '../services/hapticService';

const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + (sizes[i] || 'B');
};

// Convert SAF URI (e.g. content://.../tree/primary:ROMs/gba or content://.../tree/primary%3AROMs/gba) to direct filesystem path if on primary storage
const resolveAndroidPath = (uri: string): string | null => {
    try {
        let decoded = decodeURIComponent(uri);
        // Sometimes it may be doubly encoded
        if (decoded.includes('%3A') || decoded.includes('%2F')) {
            decoded = decodeURIComponent(decoded);
        }
        const match = decoded.match(/tree\/(?:primary:|[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}:)(.*?)$/);
        if (match) {
            const rel = match[1].replace(/^\/+/, '');
            return `/sdcard/${rel}`;
        }
        if (decoded.startsWith('/sdcard/') || decoded.startsWith('/storage/emulated/0/')) {
            return decoded;
        }
    } catch {}
    return null;
};

// Define the types here to avoid import issues
export enum DownloadStatus {
    PENDING = 'pending',
    DOWNLOADING = 'downloading',
    PAUSED = 'paused',
    EXTRACTING = 'extracting',
    MOVING = 'moving',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
}

export interface DownloadItem {
    id: string;
    rom: Rom;
    romName: string;
    romFile: RomFile;
    platformFolder: PlatformFolder;
    status: DownloadStatus;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
    speed: number; // bytes per second
    remainingTime: number; // seconds
    error?: string;
    startTime?: Date;
    endTime?: Date;
    downloadResumable?: FileSystem.DownloadResumable;
    retryCount?: number;
}

interface DownloadContextType {
    downloads: DownloadItem[];
    activeDownloads: DownloadItem[];
    completedDownloads: DownloadItem[];
    failedDownloads: DownloadItem[];
    isRomDownloading: (romFile?: RomFile) => boolean;
    getDownloadById: (id: string) => DownloadItem | undefined;
    addRomToQueue: (rom: Rom, romFile: RomFile, platformFolder: PlatformFolder) => string;
    removeFromQueue: (downloadId: string) => void;
    retryDownload: (downloadId: string) => void;
    retryAllFailed: () => void;
    clearCompleted: () => void;
    clearFailed: () => void;
    pauseDownload: (downloadId: string) => void;
    resumeDownload: (downloadId: string) => void;
    cancelDownload: (downloadId: string) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const useDownload = () => {
    const context = useContext(DownloadContext);
    if (context === undefined) {
        throw new Error('useDownload must be used within a DownloadProvider');
    }
    return context;
};

interface DownloadProviderProps {
    children: ReactNode;
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({ children }) => {
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);
    const [downloadQueue, setDownloadQueue] = useState<string[]>([]);
    const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());
    const { refreshRomCheck } = useRomFileSystem();

    useEffect(() => {
        notificationService.initialize().catch(() => {});
    }, []);

    const getConcurrentDownloadsLimit = async (): Promise<number> => {
        try {
            const value = await AsyncStorage.getItem('concurrentDownloads');
            if (value !== null) {
                const numValue = parseInt(value, 10);
                return (numValue >= 1 && numValue <= 5) ? numValue : 2;
            }
            return 2; // Default
        } catch (error) {
            return 2; // Fallback
        }
    };

    // Process download queue
    useEffect(() => {
        const processQueue = async () => {
            console.log('Processing download queue:', downloadQueue);
            const maxConcurrentDownloads = await getConcurrentDownloadsLimit();
            if (downloadQueue.length > 0 && activeDownloads.size < maxConcurrentDownloads) {
                const downloadId = downloadQueue[0];
                const download = downloads.find(d => d.id === downloadId);

                if (download && download.status === DownloadStatus.PENDING) {
                    try {
                        const battery = await notificationService.getBatteryStatus();
                        if (battery && battery.level > 0 && battery.level <= 15 && !battery.isCharging) {
                            console.warn(`Battery level is low (${battery.level}%). Pausing download ${download.romName}`);
                            notificationService.showProgress(
                                notificationService.getNotificationId(downloadId),
                                `Paused: ${download.romName}`,
                                `Low battery (${battery.level}%). Connect charger to resume.`,
                                0,
                                100,
                                false
                            );
                            updateDownload(downloadId, {
                                status: DownloadStatus.PAUSED,
                                error: `Paused: Low battery (${battery.level}%). Connect charger to resume.`,
                            });
                            return;
                        }
                    } catch {}

                    setDownloadQueue(prev => prev.slice(1));
                    setActiveDownloads(prev => new Set([...prev, downloadId]));
                    await startDownload(downloadId);
                }
            }
        };

        processQueue();
    }, [downloadQueue, activeDownloads, downloads.length]);

    const generateDownloadId = (): string => {
        return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    const updateDownload = (downloadId: string, updates: Partial<DownloadItem>): void => {
        setDownloads(prev =>
            prev.map(d => d.id === downloadId ? { ...d, ...updates } : d)
        );
    };

    const startDownload = async (downloadId: string): Promise<void> => {
        const download = downloads.find(d => d.id === downloadId);
        if (!download) return;

        const notifId = notificationService.getNotificationId(downloadId);

        try {
            updateDownload(downloadId, {
                status: DownloadStatus.DOWNLOADING,
                startTime: new Date(),
            });

            // Show starting notification
            notificationService.showProgress(
                notifId,
                download.romName,
                `${download.romFile.file_name} • Starting download...`,
                0,
                100,
                true
            );

            // Get the download URL from the API
            const downloadUrl = await apiClient.obtainDownloadLink(download.romFile);
            const tempFilePath = FileSystem.cacheDirectory + download.romFile.file_name;
            console.log(`Starting download for ROM: ${download.romName}, File path: ${tempFilePath}`);
            // Initialize speed tracking
            let lastProgressTime = Date.now();
            let lastDownloadedBytes = 0;
            let speedHistory: number[] = [];
            let currentSpeed = 0; // Keep track of current speed
            let currentRemainingTime = 0; // Keep track of current remaining time
            let lastNotifTime = Date.now();
            let lastNotifProgress = -1;
            const maxSpeedHistoryLength = 5; // Keep last 5 speed measurements for smoothing
            const minTimeForSpeedCalculation = 1.5; // Minimum time in seconds for speed calculation

            // Create download resumable
            const downloadResumable = FileSystem.createDownloadResumable(
                downloadUrl,
                tempFilePath,
                {
                    headers: apiClient.getAuthHeaders(),
                },
                (downloadProgress) => {
                    const currentTime = Date.now();
                    const timeElapsed = (currentTime - lastProgressTime) / 1000; // seconds
                    const bytesDownloaded = downloadProgress.totalBytesWritten - lastDownloadedBytes;

                    const progress = Math.round(
                        (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
                    );

                    if (timeElapsed >= minTimeForSpeedCalculation && bytesDownloaded > 0) {
                        const instantSpeed = bytesDownloaded / timeElapsed; // bytes per second

                        // Add to speed history for smoothing
                        speedHistory.push(instantSpeed);
                        if (speedHistory.length > maxSpeedHistoryLength) {
                            speedHistory = speedHistory.slice(-maxSpeedHistoryLength);
                        }

                        // Calculate average speed for smoother display
                        currentSpeed = speedHistory.reduce((sum, s) => sum + s, instantSpeed) / speedHistory.length;

                        const remainingBytes = downloadProgress.totalBytesExpectedToWrite - downloadProgress.totalBytesWritten;
                        currentRemainingTime = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;

                        // Update tracking variables for next calculation
                        lastProgressTime = currentTime;
                        lastDownloadedBytes = downloadProgress.totalBytesWritten;

                        updateDownload(downloadId, {
                            progress,
                            downloadedBytes: downloadProgress.totalBytesWritten,
                            totalBytes: downloadProgress.totalBytesExpectedToWrite,
                            speed: currentSpeed, // Use the last calculated speed
                            remainingTime: currentRemainingTime, // Use the last calculated remaining time
                        });
                    }

                    // Update notification periodically (throttle to at most once per 800ms or on significant progress changes)
                    if (
                        currentTime - lastNotifTime >= 800 ||
                        (progress >= lastNotifProgress + 3 && currentTime - lastNotifTime >= 400)
                    ) {
                        lastNotifTime = currentTime;
                        lastNotifProgress = progress;
                        const writtenStr = formatBytes(downloadProgress.totalBytesWritten);
                        const totalStr = formatBytes(downloadProgress.totalBytesExpectedToWrite);
                        const speedStr = currentSpeed > 0 ? ` • ${formatBytes(currentSpeed)}/s` : '';
                        notificationService.showProgress(
                            notifId,
                            download.romName,
                            `${progress}% • ${writtenStr} / ${totalStr}${speedStr}`,
                            progress,
                            100,
                            false
                        );
                    }
                }
            );

            updateDownload(downloadId, {
                downloadResumable,
            });

            const res = await downloadResumable.downloadAsync();

            if (res) {
                if (res.status === 200) {
                    await completeDownload(downloadId, tempFilePath, download);
                } else {
                    throw new Error(`Download failed with status ${res?.status || 'unknown'}`);
                }
            }
        } catch (error) {
            console.error('Download error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            const currentRetries = download.retryCount || 0;
            if (currentRetries < 3) {
                console.log(`Auto-retrying download for ${download.romName} (attempt ${currentRetries + 1}/3)...`);
                notificationService.showProgress(
                    notifId,
                    `Reconnecting: ${download.romName}`,
                    `Network interrupted. Retrying (${currentRetries + 1}/3)...`,
                    download.progress || 0,
                    100,
                    true
                );
                updateDownload(downloadId, {
                    status: DownloadStatus.PENDING,
                    retryCount: currentRetries + 1,
                    error: `Reconnecting (attempt ${currentRetries + 1}/3)...`,
                });
                setTimeout(() => {
                    setDownloadQueue(prev => [downloadId, ...prev.filter(id => id !== downloadId)]);
                }, 3500);
                return;
            }

            notificationService.showFailed(
                notifId,
                'Download Failed',
                `${download.romName}: ${errorMessage}`
            );
            updateDownload(downloadId, {
                status: DownloadStatus.FAILED,
                error: errorMessage,
                endTime: new Date(),
            });
        } finally {
            setActiveDownloads(prev => {
                const newSet = new Set(prev);
                newSet.delete(downloadId);
                return newSet;
            });
        }
    };

    // Keep screen awake during active downloads to prevent Android deep sleep socket drops
    useEffect(() => {
        if (activeDownloads.size > 0) {
            activateKeepAwakeAsync('romm-downloads').catch(() => {});
        } else {
            deactivateKeepAwake('romm-downloads');
        }
    }, [activeDownloads.size]);

    const completeDownload = async (downloadId: string, tempFilePath: string, download: DownloadItem): Promise<void> => {
        const notifId = notificationService.getNotificationId(downloadId);
        try {
            const isZip = download.romFile.file_name.toLowerCase().endsWith('.zip');
            const value = await AsyncStorage.getItem('unzipFilesOnDownload');
            const shouldUnzipFiles = value !== null ? JSON.parse(value) : true;

            let normalizedTargetFolderUri = download.platformFolder.folderUri;
            // Ensure encoded format matches Android's persisted SAF URI (tree/primary%3AROMs)
            if (normalizedTargetFolderUri.includes('/tree/primary:')) {
                normalizedTargetFolderUri = normalizedTargetFolderUri.replace('/tree/primary:', '/tree/primary%3A');
            }
            const targetFolderUri = normalizedTargetFolderUri.endsWith('/')
                ? normalizedTargetFolderUri
                : `${normalizedTargetFolderUri}/`;

            if (isZip && shouldUnzipFiles) {
                updateDownload(downloadId, {
                    status: DownloadStatus.EXTRACTING,
                    progress: 0,
                });
                notificationService.showProgress(
                    notifId,
                    `Extracting ${download.romName}`,
                    `Extracting ${download.romFile.file_name}...`,
                    0,
                    100,
                    true
                );

                const unzipBaseName = download.romFile.file_name.replace(/\.zip$/i, '');
                const unzipPath = `${FileSystem.documentDirectory}${unzipBaseName}`;

                const zipProgressSubscription = subscribe(({ progress }) => {
                    const prog = Math.min(100, Math.round(progress * 100));
                    updateDownload(downloadId, {
                        status: DownloadStatus.EXTRACTING,
                        progress: prog,
                    });
                    notificationService.showProgress(
                        notifId,
                        `Extracting ${download.romName}`,
                        `Extracting archive: ${prog}%`,
                        prog,
                        100,
                        false
                    );
                });

                try {
                    await unzip(tempFilePath, unzipPath);
                } finally {
                    zipProgressSubscription.remove();
                }

                updateDownload(downloadId, {
                    status: DownloadStatus.MOVING,
                    progress: 75,
                });
                notificationService.showProgress(
                    notifId,
                    `Saving ${download.romName}`,
                    `Moving to ${download.platformFolder.folderName || download.platformFolder.platformName}...`,
                    95,
                    100,
                    true
                );

                const directTargetDir = Platform.OS === 'android' ? resolveAndroidPath(targetFolderUri) : null;

                if (Platform.OS === 'android') {
                    const files = await ReactNativeBlobUtil.fs.ls(unzipPath);
                    for (const file of files) {
                        const sourcePath = `${unzipPath}/${file}`;
                        if (directTargetDir) {
                            const targetDirClean = directTargetDir.replace(/\/+$/, '');
                            try {
                                if (!(await RNFS.exists(targetDirClean))) {
                                    await RNFS.mkdir(targetDirClean);
                                }
                            } catch {}
                            const destFilePath = `${targetDirClean}/${file}`;
                            console.log(`Direct moving extracted file from ${sourcePath} to ${destFilePath}`);
                            try {
                                if (await RNFS.exists(destFilePath)) {
                                    await RNFS.unlink(destFilePath);
                                }
                            } catch {}
                            await RNFS.copyFile(sourcePath, destFilePath);
                        } else {
                            const destinationPath = `${targetFolderUri}${file}`;
                            console.log(`SAF moving file from ${sourcePath} to ${destinationPath}`);
                            await moveFile(sourcePath, destinationPath, { replaceIfDestinationExists: true });
                        }
                    }
                    try {
                        await ReactNativeBlobUtil.fs.unlink(unzipPath);
                        await unlink(tempFilePath);
                    } catch {}
                } else {
                    const files = await FileSystem.readDirectoryAsync(unzipPath);
                    for (const file of files) {
                        const sourcePath = `${unzipPath}/${file}`;
                        const destinationPath = `${targetFolderUri}${file}`;
                        await FileSystem.moveAsync({ from: sourcePath, to: destinationPath });
                    }
                    await FileSystem.deleteAsync(tempFilePath, { idempotent: true });
                    await FileSystem.deleteAsync(unzipPath, { idempotent: true });
                }
            } else {
                updateDownload(downloadId, {
                    status: DownloadStatus.MOVING,
                    progress: 50,
                });
                notificationService.showProgress(
                    notifId,
                    `Saving ${download.romName}`,
                    `Moving to ${download.platformFolder.folderName || download.platformFolder.platformName}...`,
                    95,
                    100,
                    true
                );

                const directTargetDir = Platform.OS === 'android' ? resolveAndroidPath(targetFolderUri) : null;

                if (Platform.OS === 'android') {
                    const cleanTemp = tempFilePath.replace(/^file:\/\//, '');
                    if (directTargetDir) {
                        const targetDirClean = directTargetDir.replace(/\/+$/, '');
                        try {
                            if (!(await RNFS.exists(targetDirClean))) {
                                await RNFS.mkdir(targetDirClean);
                            }
                        } catch {}
                        const destFilePath = `${targetDirClean}/${download.romFile.file_name}`;
                        console.log(`Direct moving file from ${cleanTemp} to ${destFilePath}`);
                        try {
                            if (await RNFS.exists(destFilePath)) {
                                await RNFS.unlink(destFilePath);
                            }
                        } catch {}
                        await RNFS.copyFile(cleanTemp, destFilePath);
                        try {
                            await RNFS.unlink(cleanTemp);
                        } catch {}
                    } else {
                        const destinationPath = `${targetFolderUri}${download.romFile.file_name}`;
                        await moveFile(tempFilePath, destinationPath, { replaceIfDestinationExists: true });
                    }
                } else {
                    const destinationPath = `${targetFolderUri}${download.romFile.file_name}`;
                    await FileSystem.moveAsync({
                        from: tempFilePath,
                        to: destinationPath,
                    });
                }
            }

            updateDownload(downloadId, {
                status: DownloadStatus.COMPLETED,
                progress: 100,
                endTime: new Date(),
            });

            try {
                soundService.playComplete();
                hapticService.success();
            } catch {}

            notificationService.showCompleted(
                notifId,
                'Download Complete',
                `${download.romName} (${download.romFile.file_name})`
            );

            // Update the ROM file system cache to mark the ROM as downloaded
            try {
                await refreshRomCheck(download.romFile, download.platformFolder);
                console.log(`ROM ${download.romName} marked as downloaded in filesystem cache`);
            } catch (error) {
                console.error('Error updating ROM filesystem cache:', error);
            }
        } catch (error) {
            console.error('Error completing download:', error);
            const errorMessage = `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`;
            notificationService.showFailed(
                notifId,
                'Download Failed',
                `${download.romName}: ${errorMessage}`
            );
            updateDownload(downloadId, {
                status: DownloadStatus.FAILED,
                error: errorMessage,
                endTime: new Date(),
            });
        }
    };

    const activeDownloadsList = downloads.filter(d =>
        d.status === DownloadStatus.DOWNLOADING ||
        d.status === DownloadStatus.PENDING ||
        d.status === DownloadStatus.EXTRACTING ||
        d.status === DownloadStatus.MOVING
    );

    const completedDownloads = downloads.filter(d =>
        d.status === DownloadStatus.COMPLETED
    );

    const failedDownloads = downloads.filter(d =>
        d.status === DownloadStatus.FAILED ||
        d.status === DownloadStatus.CANCELLED
    );

    const isRomDownloading = (romFile?: RomFile): boolean => {
        if (!romFile) return false;
        return downloads.some(d => {
            const matchesFile = (romFile.id && d.romFile?.id === romFile.id) ||
                (d.romFile?.file_name && d.romFile.file_name === romFile.file_name) ||
                (!romFile.id && !d.romFile?.id && d.romFile?.rom_id === romFile.rom_id);
            return matchesFile && (d.status === DownloadStatus.DOWNLOADING || d.status === DownloadStatus.PENDING);
        });
    };

    const getDownloadById = (id: string): DownloadItem | undefined => {
        return downloads.find(d => d.id === id);
    };

    const extractRomName = (romFile: RomFile): string => {
        const fileName = romFile.file_name || '';
        const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, ''); // Remove file extension
        const nameWithoutTags = nameWithoutExtension.replace(/(\[.*?\]|\(.*?\))/g, '').trim(); // Remove tags in square brackets or parentheses
        return nameWithoutTags;
    };

    const addRomToQueue = (rom: Rom, romFile: RomFile, platformFolder: PlatformFolder): string => {
        notificationService.requestPermission().catch(() => {});

        // Check if this specific ROM file is already in queue or downloading
        const existingDownload = downloads.find(d => {
            const matchesFile = (romFile.id && d.romFile?.id === romFile.id) ||
                (d.romFile?.file_name && d.romFile.file_name === romFile.file_name) ||
                (!romFile.id && !d.romFile?.id && d.romFile?.rom_id === romFile.rom_id);
            return matchesFile && (
                d.status === DownloadStatus.PENDING ||
                d.status === DownloadStatus.DOWNLOADING ||
                d.status === DownloadStatus.PAUSED
            );
        });

        if (existingDownload) {
            return existingDownload.id;
        }

        const downloadId = generateDownloadId();
        const newDownload: DownloadItem = {
            id: downloadId,
            rom: rom,
            romName: extractRomName(romFile),
            romFile,
            platformFolder,
            status: DownloadStatus.PENDING,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: romFile.file_size_bytes,
            speed: 0,
            remainingTime: 0,
        };

        setDownloads(prev => [...prev, newDownload]);
        setDownloadQueue(prev => [...prev, downloadId]);

        return downloadId;
    };

    const removeFromQueue = (downloadId: string): void => {
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
            notificationService.cancel(notificationService.getNotificationId(downloadId));

            // Cancel if actively downloading
            if (download.status === DownloadStatus.DOWNLOADING) {
                cancelDownload(downloadId);
            }

            // Remove from queue
            setDownloadQueue(prev => prev.filter(id => id !== downloadId));

            // Remove from downloads
            setDownloads(prev => prev.filter(d => d.id !== downloadId));
        }
    };

    const retryDownload = (downloadId: string): void => {
        const download = downloads.find(d => d.id === downloadId);
        if (download && (download.status === DownloadStatus.FAILED || download.status === DownloadStatus.CANCELLED)) {
            updateDownload(downloadId, {
                status: DownloadStatus.PENDING,
                progress: 0,
                downloadedBytes: 0,
                error: undefined,
                startTime: undefined,
                endTime: undefined,
            });

            setDownloadQueue(prev => [downloadId, ...prev]); // Add to front of queue
        }
    };

    const clearCompleted = (): void => {
        downloads.forEach(d => {
            if (d.status === DownloadStatus.COMPLETED) {
                notificationService.cancel(notificationService.getNotificationId(d.id));
            }
        });
        setDownloads(prev => prev.filter(d => d.status !== DownloadStatus.COMPLETED));
    };

    const clearFailed = (): void => {
        downloads.forEach(d => {
            if (d.status === DownloadStatus.FAILED || d.status === DownloadStatus.CANCELLED) {
                notificationService.cancel(notificationService.getNotificationId(d.id));
            }
        });
        setDownloads(prev => prev.filter(d =>
            d.status !== DownloadStatus.FAILED &&
            d.status !== DownloadStatus.CANCELLED
        ));
    };

    const pauseDownload = async (downloadId: string): Promise<void> => {
        const download = downloads.find(d => d.id === downloadId);
        if (download && download.status === DownloadStatus.DOWNLOADING) {
            notificationService.cancel(notificationService.getNotificationId(downloadId));

            if (download.downloadResumable) {
                await download.downloadResumable.pauseAsync();
            }

            updateDownload(downloadId, {
                status: DownloadStatus.PAUSED,
            });
        }
    };

    const resumeDownload = async (downloadId: string): Promise<void> => {
        const download = downloads.find(d => d.id === downloadId);
        if (download && download.status === DownloadStatus.PAUSED) {

            updateDownload(downloadId, {
                status: DownloadStatus.DOWNLOADING,
            });

            if (download.downloadResumable) {
                await download.downloadResumable.resumeAsync().then(async (result) => {
                    if (result) {
                        if (result.status === 200 || result.status === 206) {
                            await completeDownload(downloadId, FileSystem.cacheDirectory + download.romFile.file_name, download);
                        } else {
                            console.log(`Download failed with status ${result?.status || 'unknown'}`);
                        }
                    }
                });
            }
        }
    };

    const cancelDownload = (downloadId: string): void => {
        const download = downloads.find(d => d.id === downloadId);
        if (download) {
            notificationService.cancel(notificationService.getNotificationId(downloadId));

            if (download.downloadResumable && download.status === DownloadStatus.DOWNLOADING) {
                download.downloadResumable.pauseAsync();
            }

            // Clean up temp file if exists
            if (download.downloadResumable?.fileUri) {
                FileSystem.deleteAsync(FileSystem.cacheDirectory + download.romFile.file_name, { idempotent: true });
            }

            updateDownload(downloadId, {
                status: DownloadStatus.CANCELLED,
                endTime: new Date(),
            });

            setActiveDownloads(prev => {
                const newSet = new Set(prev);
                newSet.delete(downloadId);
                return newSet;
            });

            // Remove from queue if pending
            setDownloadQueue(prev => prev.filter(id => id !== downloadId));
        }
    };

    const retryAllFailed = (): void => {
        const failed = downloads.filter(d => d.status === DownloadStatus.FAILED || d.status === DownloadStatus.CANCELLED);
        failed.forEach(d => retryDownload(d.id));
    };

    return (
        <DownloadContext.Provider
            value={{
                downloads,
                activeDownloads: activeDownloadsList,
                completedDownloads,
                failedDownloads,
                isRomDownloading,
                getDownloadById,
                addRomToQueue,
                removeFromQueue,
                retryDownload,
                retryAllFailed,
                clearCompleted,
                clearFailed,
                pauseDownload,
                resumeDownload,
                cancelDownload,
            }}
        >
            {children}
        </DownloadContext.Provider>
    );
};
