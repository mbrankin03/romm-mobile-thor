import { Ionicons } from '@expo/vector-icons';
import * as SAF from '@joplin/react-native-saf-x';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    Platform as RNPlatform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { DynamicConsoleBackdrop } from '../../components/DynamicConsoleBackdrop';
import { GamepadFocusable } from '../../components/GamepadFocusable';
import { GamepadHints } from '../../components/GamepadHints';
import { useGamepadNavigation } from '../../hooks/useGamepadNavigation';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useDownload } from '../../contexts/DownloadContext';
import { useToast } from '../../contexts/ToastContext';
import { usePlatformFolders } from '../../hooks/usePlatformFolders';
import { useRomDownload } from '../../hooks/useRomDownload';
import { useRomFileSystem, matchesRomFile } from '../../hooks/useRomFileSystem';
import { useTranslation } from '../../hooks/useTranslation';
import { apiClient, Platform, Rom, RomFile, RAGameRomAchievement } from '../../services/api';
import { useFavorites } from '../../services/favoritesService';
import { formatBytes, validateDiskSpace, verifyRomIntegrity, resolveAndroidPath } from '../../services/storageService';
import RNFS from 'react-native-fs';
import { soundService } from '@/services/soundService';
import { hapticService } from '@/services/hapticService';

const getAchievementBadgeUrl = (ach: RAGameRomAchievement): string | undefined => {
    if (ach.badge_url && ach.badge_url.startsWith('http')) {
        return ach.badge_url;
    }
    if (ach.badge_path) {
        return `${apiClient.baseUrl}${ach.badge_path.startsWith('/') ? '' : '/'}${ach.badge_path}`;
    }
    if (ach.badge_url) {
        return `${apiClient.baseUrl}${ach.badge_url.startsWith('/') ? '' : '/'}${ach.badge_url}`;
    }
    if (ach.badge_id) {
        return `https://media.retroachievements.org/Badge/${ach.badge_id}.png`;
    }
    return undefined;
};

export default function GameDetailsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    const { showSuccessToast, showErrorToast, showInfoToast } = useToast();
    const [rom, setRom] = useState<Rom | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [existingFilePath, setExistingFilePath] = useState<string | null>(null);
    const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
    const [showVersionSelector, setShowVersionSelector] = useState<boolean>(false);
    const [showAchievementsModal, setShowAchievementsModal] = useState<boolean>(false);

    const { downloadRom, isDownloading } = useRomDownload();
    const { completedDownloads, activeDownloads, addRomToQueue } = useDownload();
    const { searchPlatformFolder, requestPlatformFolder, getAllPlatformFolders } = usePlatformFolders();
    const { isRomDownloaded, isCheckingRom, refreshRomCheck, resetRomsCheck } = useRomFileSystem();
    const { isFavorite, toggleFavorite } = useFavorites();

    const processedDownloadsRef = useRef<Set<string>>(new Set());

    const isRomFav = rom ? isFavorite(rom.id) : false;

    const getSelectedFile = (): RomFile | undefined => {
        if (!rom || !rom.files || rom.files.length === 0) return undefined;
        return rom.files[selectedFileIndex] || rom.files[0];
    };

    const getCurrentDownload = () => {
        if (!rom) return null;
        const selected = getSelectedFile();
        if (!selected) return null;
        return activeDownloads.find(download =>
            (selected.id && download.romFile.id === selected.id) ||
            download.romFile.file_name === selected.file_name ||
            download.romFile.rom_id === selected.rom_id
        ) || null;
    };

    const currentDownload = getCurrentDownload();
    const downloadProgress = (currentDownload?.progress || 0) / 100;

    const totalFiles = rom?.files?.length || 0;
    const isMultiFile = totalFiles > 1;
    const downloadedFiles = (rom?.files || []).filter(f => isRomDownloaded(f));
    const downloadedCount = downloadedFiles.length;
    const allFilesDownloaded = isMultiFile && downloadedCount === totalFiles;
    const pendingFiles = (rom?.files || []).filter(f => !isRomDownloaded(f) && !isDownloading(f));
    const downloadingFiles = (rom?.files || []).filter(f => isDownloading(f));
    const isDownloadingAny = downloadingFiles.length > 0;
    const pendingBytes = pendingFiles.reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);
    const totalFilesBytes = (rom?.files || []).reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);

    const achievements = rom?.merged_ra_metadata?.achievements || [];
    const totalRAPoints = achievements.reduce((sum, a) => sum + (a.points || 0), 0);

    useEffect(() => {
        if (id) {
            processedDownloadsRef.current.clear();
            loadRomDetails();
        }
    }, [id]);

    // Check all files for this ROM whenever ROM is loaded or changes
    useEffect(() => {
        if (rom && rom.files && rom.files.length > 0) {
            const checkAllRomFiles = async () => {
                const folders = await getAllPlatformFolders({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                const platformFolder = folders.length > 0 ? folders[0] : await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                if (!platformFolder && folders.length === 0) {
                    await requestPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                }
                const targetFolders = folders.length > 0 ? folders : (platformFolder ? [platformFolder] : []);
                if (targetFolders.length > 0) {
                    for (const file of rom.files) {
                        await refreshRomCheck(file, targetFolders);
                    }
                }
                await updateExistingFilePath(rom);
            };
            checkAllRomFiles();
        }
    }, [rom?.id, selectedFileIndex]);

    // Listen for completed downloads to refresh ROM check
    useEffect(() => {
        if (rom && completedDownloads.length > 0) {
            const newCompletedDownloads = completedDownloads.filter(
                download => (
                    (rom.id && download.rom?.id === rom.id) ||
                    (rom.files || []).some(f => (f.id && download.romFile.id === f.id) || download.romFile.file_name === f.file_name)
                ) && !processedDownloadsRef.current.has(download.id)
            );

            if (newCompletedDownloads.length > 0) {
                newCompletedDownloads.forEach(download => {
                    processedDownloadsRef.current.add(download.id);
                });

                const refreshAndUpdate = async () => {
                    const folders = await getAllPlatformFolders({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                    const platformFolder = folders.length > 0 ? folders[0] : await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                    const targetFolders = folders.length > 0 ? folders : (platformFolder ? [platformFolder] : []);
                    if (targetFolders.length > 0 && rom.files) {
                        for (const file of rom.files) {
                            await refreshRomCheck(file, targetFolders);
                        }
                    }
                    await updateExistingFilePath(rom);
                };
                refreshAndUpdate();
            }
        }
    }, [completedDownloads.length, rom?.id]);

    useEffect(() => {
        if (rom) {
            updateExistingFilePath(rom);
        }
    }, [selectedFileIndex, rom]);

    const loadRomDetails = async () => {
        try {
            setLoading(true);
            setError(null);
            const romData = await apiClient.getRomById(parseInt(id), true);
            setRom(romData);
            await updateExistingFilePath(romData);
        } catch (err) {
            console.error('Error loading ROM details:', err);
            setError(t('errorLoadingGameDetails'));
        } finally {
            setLoading(false);
        }
    };

    const updateExistingFilePath = async (romData: Rom) => {
        try {
            const selectedFile = getSelectedFile();
            if (!selectedFile) {
                setExistingFilePath(null);
                return;
            }

            const folders = await getAllPlatformFolders({ name: romData.platform_name, slug: romData.platform_slug } as Platform);
            if (folders.length === 0) {
                const single = await searchPlatformFolder({ name: romData.platform_name, slug: romData.platform_slug } as Platform);
                if (single) folders.push(single);
            }

            if (folders.length === 0) {
                setExistingFilePath(null);
                return;
            }

            for (const folder of folders) {
                let files: { name: string; size?: number }[] = [];
                try {
                    if (RNPlatform.OS === 'android') {
                        const directPath = resolveAndroidPath(folder.folderUri);
                        if (directPath && (await RNFS.exists(directPath))) {
                            const dirItems = await RNFS.readDir(directPath);
                            files = dirItems.map(item => ({ name: item.name, size: item.size || 1 }));
                        } else {
                            const safFiles = await SAF.listFiles(folder.folderUri);
                            files = safFiles.map(file => ({ name: file.name, size: (file as any).size ?? 1 }));
                        }
                    } else {
                        const names = await FileSystem.readDirectoryAsync(folder.folderUri);
                        files = names.map(name => ({ name, size: 1 }));
                    }
                } catch {
                    continue;
                }

                const matchingFile = files.find(file => {
                    if (file.size !== undefined && file.size === 0) return false;
                    return matchesRomFile(file.name, selectedFile.file_name || '');
                });

                if (matchingFile) {
                    setExistingFilePath(folder.folderUri + '/' + matchingFile.name);
                    return;
                }
            }

            setExistingFilePath(null);
        } catch (err) {
            console.error('Error updating existing file path:', err);
            setExistingFilePath(null);
        }
    };

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    useGamepadNavigation({
        onButtonY: () => {
            if (rom) {
                toggleFavorite(rom.id);
                hapticService.press();
                soundService.playFocus();
                return true;
            }
            return false;
        },
        onBack: () => {
            if (showVersionSelector) {
                setShowVersionSelector(false);
                return true;
            }
            if (showAchievementsModal) {
                setShowAchievementsModal(false);
                return true;
            }
            handleBack();
            return true;
        }
    });

    const formatFileSize = (bytes: number): string => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleDownload = async () => {
        if (!rom) return;
        const selected = getSelectedFile();
        if (!selected) return;

        if (selected.file_size_bytes) {
            const check = await validateDiskSpace(selected.file_size_bytes);
            if (!check.canDownload) {
                hapticService.warning();
                Alert.alert('Insufficient Storage', check.warningMessage);
                return;
            }
        }

        try {
            hapticService.success();
            await downloadRom(rom, selected, { name: rom.platform_name, slug: rom.platform_slug } as Platform);
        } catch (error: any) {
            console.error('Download error:', error);

            if (error.type === 'already_downloaded') {
                showInfoToast(error.message, t('fileAlreadyDownloaded'));
            } else {
                const errorMessage = error instanceof Error ? error.message : t('errorDuringDownload');
                showErrorToast(errorMessage, t('downloadError'));
            }
        }
    };

    // Download ALL files for a multi-disc game (all CHDs, M3U, etc.)
    const handleDownloadAllFiles = async () => {
        if (!rom || !rom.files || rom.files.length === 0) return;

        let platformFolder = await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
        if (!platformFolder) {
            await requestPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
            platformFolder = await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
            if (!platformFolder) return;
        }

        const filesToDownload = rom.files.filter(f => !isRomDownloaded(f) && !isDownloading(f));

        if (filesToDownload.length === 0) {
            showInfoToast('All files are already downloaded', t('info'));
            return;
        }

        const totalBatchBytes = filesToDownload.reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);
        const check = await validateDiskSpace(totalBatchBytes);
        if (!check.canDownload) {
            hapticService.warning();
            Alert.alert('Insufficient Storage', check.warningMessage);
            return;
        }

        try {
            for (const file of filesToDownload) {
                addRomToQueue(rom, file, platformFolder);
            }
            hapticService.success();
            showSuccessToast(
                `Added ${filesToDownload.length} files (${formatBytes(totalBatchBytes)}) to download queue`,
                'Downloads Started'
            );
        } catch (err) {
            console.error('Error queuing all files:', err);
            showErrorToast('Failed to queue files', t('error'));
        }
    };

    const handleDeleteFile = async (romData: Rom) => {
        const selectedFile = getSelectedFile();
        if (!selectedFile) {
            showErrorToast(t('noFileToDelete'), t('error'));
            return;
        }
        const fileNameWithoutExtension = selectedFile.file_name.replace(/\.[^/.]+$/, '');
        Alert.alert(
            t('confirmDeletion'),
            t('confirmDeleteFile', { fileName: fileNameWithoutExtension }),
            [
                {
                    text: t('cancel'),
                    style: 'cancel',
                },
                {
                    text: t('delete'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            if (existingFilePath) {
                                if (RNPlatform.OS === 'android') {
                                    await SAF.unlink(existingFilePath);
                                } else {
                                    await FileSystem.deleteAsync(existingFilePath);
                                }
                            } else {
                                const folders = await getAllPlatformFolders({ name: romData.platform_name, slug: romData.platform_slug } as Platform);
                                for (const folder of folders) {
                                    let fileList: string[] = [];
                                    if (RNPlatform.OS === 'android') {
                                        fileList = (await SAF.listFiles(folder.folderUri)).map(f => f.name);
                                    } else {
                                        fileList = await FileSystem.readDirectoryAsync(folder.folderUri);
                                    }
                                    const match = fileList.find(f => matchesRomFile(f, selectedFile.file_name || ''));
                                    if (match) {
                                        const uri = folder.folderUri + '/' + match;
                                        if (RNPlatform.OS === 'android') {
                                            await SAF.unlink(uri);
                                        } else {
                                            await FileSystem.deleteAsync(uri);
                                        }
                                        break;
                                    }
                                }
                            }

                            setExistingFilePath(null);
                            resetRomsCheck([getSelectedFile()!]);
                            showSuccessToast(t('fileDeletedSuccessfully'), t('fileDeleted'));
                        } catch (error) {
                            console.error('Error deleting file:', error);
                            const errorMessage = error instanceof Error ? error.message : t('errorDeletingFile');
                            showErrorToast(t('cannotDeleteFile', { error: errorMessage }), t('error'));
                        }
                    },
                },
            ]
        );
    };

    const handleDeleteAllFiles = async () => {
        if (!rom || !rom.files || rom.files.length === 0) return;

        Alert.alert(
            t('confirmDeletion'),
            `Delete all ${rom.files.length} files for ${rom.name || rom.fs_name}?`,
            [
                { text: t('cancel'), style: 'cancel' },
                {
                    text: t('delete'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const folders = await getAllPlatformFolders({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                            for (const romFile of rom.files) {
                                for (const folder of folders) {
                                    let fileList: string[] = [];
                                    try {
                                        if (RNPlatform.OS === 'android') {
                                            fileList = (await SAF.listFiles(folder.folderUri)).map(f => f.name);
                                        } else {
                                            fileList = await FileSystem.readDirectoryAsync(folder.folderUri);
                                        }
                                    } catch {
                                        continue;
                                    }
                                    const match = fileList.find(f => matchesRomFile(f, romFile.file_name || ''));
                                    if (match) {
                                        const uri = folder.folderUri + '/' + match;
                                        if (RNPlatform.OS === 'android') {
                                            await SAF.unlink(uri);
                                        } else {
                                            await FileSystem.deleteAsync(uri);
                                        }
                                    }
                                }
                            }
                            setExistingFilePath(null);
                            resetRomsCheck(rom.files);
                            showSuccessToast('All game files deleted successfully', t('fileDeleted'));
                        } catch (err) {
                            console.error('Error deleting all files:', err);
                            showErrorToast('Error deleting files', t('error'));
                        }
                    }
                }
            ]
        );
    };

    const [isVerifyingChecksum, setIsVerifyingChecksum] = useState(false);

    const verifyRomFile = async (romData: Rom) => {
        const selectedFile = getSelectedFile();
        if (!selectedFile) return;

        let targetPath = existingFilePath;
        if (!targetPath) {
            const folders = await getAllPlatformFolders({ name: romData.platform_name, slug: romData.platform_slug } as Platform);
            for (const folder of folders) {
                try {
                    const list = (await SAF.listFiles(folder.folderUri)).map(f => f.name);
                    const match = list.find(name => matchesRomFile(name, selectedFile.file_name || ''));
                    if (match) {
                        targetPath = folder.folderUri + '/' + match;
                        break;
                    }
                } catch {}
            }
        }

        if (!targetPath) {
            showErrorToast('Local ROM file not found', 'Verification Failed');
            return;
        }

        setIsVerifyingChecksum(true);
        hapticService.press();
        soundService.playFocus();

        try {
            const result = await verifyRomIntegrity(targetPath, selectedFile);
            if (result.status === 'verified') {
                soundService.playComplete();
                hapticService.success();
                Alert.alert(
                    '✓ ROM Integrity Verified',
                    `Authentic dump confirmed matching RomM database!\n\nAlgorithm: ${result.algorithm?.toUpperCase()}\nHash: ${result.computedHash}\nFile Size: ${formatBytes(result.fileSizeBytes || 0)}`,
                    [{ text: 'OK' }]
                );
            } else if (result.status === 'mismatch') {
                soundService.playDelete();
                hapticService.warning();
                Alert.alert(
                    '⚠️ Checksum Mismatch',
                    `The local file does not match the server hash. It may be modified or corrupted.\n\nExpected: ${result.expectedHash}\nComputed: ${result.computedHash}\n\nWould you like to delete and re-download this ROM?`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Re-download',
                            style: 'destructive',
                            onPress: () => {
                                handleDeleteFile(romData);
                                handleDownload();
                            }
                        }
                    ]
                );
            } else if (result.status === 'no_server_hash') {
                soundService.playComplete();
                hapticService.success();
                Alert.alert(
                    'Size Verified',
                    `${result.message}\n\nLocal file size: ${formatBytes(result.fileSizeBytes || 0)}`,
                    [{ text: 'OK' }]
                );
            } else {
                showErrorToast(result.message, 'Integrity Check Failed');
            }
        } catch (err: any) {
            showErrorToast(err?.message || 'Error computing hash', 'Verification Error');
        } finally {
            setIsVerifyingChecksum(false);
            await updateExistingFilePath(romData);
        }
    };

    const renderActionSection = () => {
        const currentFile = getSelectedFile();
        const isCurrentDownloaded = currentFile ? isRomDownloaded(currentFile) : false;
        const isCurrentChecking = currentFile ? isCheckingRom(currentFile) : false;
        const isCurrentDownloading = currentFile ? isDownloading(currentFile) : false;

        if (isCurrentChecking) {
            return (
                <View style={styles.checkingContainer}>
                    <ActivityIndicator size="small" color="#00E5FF" />
                    <Text style={styles.checkingText}>{t('checkingExistingFiles')}</Text>
                </View>
            );
        }

        // Multi-disc / multi-file game UI
        if (isMultiFile) {
            if (allFilesDownloaded) {
                return (
                    <View style={styles.alreadyDownloadedContainer}>
                        <View style={styles.alreadyDownloadedHeader}>
                            <Ionicons name="checkmark-circle" size={18} color="#34C759" />
                            <Text style={styles.alreadyDownloadedTitle}>{`All ${totalFiles} files downloaded`}</Text>
                        </View>
                        <View style={styles.alreadyDownloadedActions}>
                            <GamepadFocusable
                                style={[styles.smallActionBtn, styles.redownloadBtn]}
                                glowColor="#38BDF8"
                                onPress={handleDownloadAllFiles}
                                disabled={isDownloadingAny}
                            >
                                <Ionicons name="download-outline" size={15} color="#fff" />
                                <Text style={styles.smallActionText}>Redownload All</Text>
                            </GamepadFocusable>
                            <GamepadFocusable
                                style={[styles.smallActionBtn, styles.deleteBtn]}
                                glowColor="#EF4444"
                                onPress={handleDeleteAllFiles}
                            >
                                <Ionicons name="trash-outline" size={15} color="#fff" />
                                <Text style={styles.smallActionText}>Delete All</Text>
                            </GamepadFocusable>
                        </View>
                    </View>
                );
            }

            // Not all files downloaded: Show prominent Download All Discs button + selected disc sub-option
            return (
                <View style={styles.multiFileActionContainer}>
                    <GamepadFocusable
                        hasTVPreferredFocus={true}
                        glowColor="#00E5FF"
                        style={[
                            styles.downloadButton,
                            styles.downloadAllButton,
                            isDownloadingAny && styles.downloadingButton
                        ]}
                        onPress={handleDownloadAllFiles}
                        disabled={isDownloadingAny}
                    >
                        {isDownloadingAny ? (
                            <View style={styles.downloadingContent}>
                                <ActivityIndicator size="small" color="#fff" />
                                <Text style={styles.downloadButtonText}>
                                    {`Downloading (${downloadingFiles.length} in queue)...`}
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.downloadContent}>
                                <Ionicons name="layers-outline" size={20} color="#fff" />
                                <Text style={styles.downloadButtonText}>
                                    {downloadedCount > 0
                                        ? `Download Remaining (${pendingFiles.length}/${totalFiles}${pendingBytes > 0 ? ` • ${formatBytes(pendingBytes)}` : ''})`
                                        : `Download All Files (${totalFiles}${totalFilesBytes > 0 ? ` • ${formatBytes(totalFilesBytes)}` : ''})`}
                                </Text>
                            </View>
                        )}
                    </GamepadFocusable>

                    {/* Single disc option for the currently selected file */}
                    <View style={styles.singleDiscRow}>
                        {isCurrentDownloaded ? (
                            <View style={styles.singleDiscDownloaded}>
                                <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                                <Text style={styles.singleDiscDownloadedText} numberOfLines={1}>
                                    {`${currentFile?.file_name?.split('.').pop()?.toUpperCase() || 'File'} downloaded`}
                                </Text>
                            </View>
                        ) : (
                            <GamepadFocusable
                                style={[styles.secondaryDownloadButton, isCurrentDownloading && styles.downloadingButton]}
                                glowColor="#A78BFA"
                                onPress={handleDownload}
                                disabled={isCurrentDownloading}
                            >
                                {isCurrentDownloading ? (
                                    <View style={styles.downloadContent}>
                                        <ActivityIndicator size="small" color="#fff" />
                                        <Text style={styles.secondaryButtonText}>
                                            {currentDownload ? `${Math.round(downloadProgress * 100)}%` : 'Queued'}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.downloadContent}>
                                        <Ionicons name="download-outline" size={14} color="#A78BFA" />
                                        <Text style={styles.secondaryButtonText} numberOfLines={1}>
                                            {`Download Selected (${selectedFileIndex + 1}/${totalFiles}${currentFile?.file_size_bytes ? ` • ${formatBytes(currentFile.file_size_bytes)}` : ''})`}
                                        </Text>
                                    </View>
                                )}
                            </GamepadFocusable>
                        )}
                    </View>
                </View>
            );
        }

        // Single-file game: Standard layout
        if (isCurrentDownloaded) {
            return (
                <View style={styles.alreadyDownloadedContainer}>
                    <View style={styles.alreadyDownloadedHeader}>
                        <Ionicons name="checkmark-circle" size={18} color="#34C759" />
                        <Text style={styles.alreadyDownloadedTitle}>{t('fileAlreadyDownloaded')}</Text>
                    </View>
                    <View style={styles.alreadyDownloadedActions}>
                        <GamepadFocusable
                            style={[styles.smallActionBtn, styles.redownloadBtn]}
                            glowColor="#38BDF8"
                            onPress={handleDownload}
                            disabled={isCurrentDownloading}
                        >
                            <Ionicons name="download-outline" size={16} color="#fff" />
                            <Text style={styles.smallActionText}>{t('redownload')}</Text>
                        </GamepadFocusable>
                        <GamepadFocusable
                            style={[styles.smallActionBtn, styles.verifyBtn]}
                            glowColor="#22C55E"
                            onPress={() => rom && verifyRomFile(rom)}
                            disabled={isVerifyingChecksum}
                        >
                            {isVerifyingChecksum ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
                                    <Text style={styles.smallActionText}>Verify</Text>
                                </>
                            )}
                        </GamepadFocusable>
                        <GamepadFocusable
                            style={[styles.smallActionBtn, styles.deleteBtn]}
                            glowColor="#EF4444"
                            onPress={() => rom && handleDeleteFile(rom)}
                        >
                            <Ionicons name="trash-outline" size={16} color="#fff" />
                            <Text style={styles.smallActionText}>{t('delete')}</Text>
                        </GamepadFocusable>
                    </View>
                </View>
            );
        }

        return (
            <GamepadFocusable
                hasTVPreferredFocus={true}
                glowColor="#00E5FF"
                style={[
                    styles.downloadButton,
                    isCurrentDownloading && styles.downloadingButton
                ]}
                onPress={handleDownload}
                disabled={isCurrentDownloading}
            >
                {isCurrentDownloading && (
                    <View style={[styles.progressBackground, StyleSheet.absoluteFill]}>
                        <View
                            style={[
                                styles.progressFill,
                                { width: `${downloadProgress * 100}%` }
                            ]}
                        />
                    </View>
                )}

                {isCurrentDownloading ? (
                    <View style={styles.downloadingContent}>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={styles.downloadButtonText}>
                            {currentDownload ?
                                `${t('downloading')} ${Math.round(downloadProgress * 100)}%` :
                                t('addedToQueue')
                            }
                        </Text>
                    </View>
                ) : (
                    <View style={styles.downloadContent}>
                        <Ionicons name="download-outline" size={20} color="#fff" />
                        <Text style={styles.downloadButtonText}>
                            {currentFile?.file_size_bytes
                                ? `${t('downloadRom')} (${formatBytes(currentFile.file_size_bytes)})`
                                : t('downloadRom')}
                        </Text>
                    </View>
                )}
            </GamepadFocusable>
        );
    };

    const renderRetroAchievementsSection = () => {
        if (!achievements || achievements.length === 0) return null;

        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>RetroAchievements</Text>
                <GamepadFocusable
                    style={styles.raBannerButton}
                    glowColor="#FFD700"
                    focusScale={1.02}
                    onPress={() => {
                        hapticService.press();
                        setShowAchievementsModal(true);
                    }}
                >
                    <View style={styles.raBannerLeft}>
                        <View style={styles.raBannerIconWrap}>
                            <Ionicons name="trophy" size={24} color="#FFD700" />
                        </View>
                        <View style={styles.raBannerInfo}>
                            <Text style={styles.raBannerTitle}>View Achievements</Text>
                            <Text style={styles.raBannerSubtitle}>
                                {`${achievements.length} Achievements • ${totalRAPoints.toLocaleString()} Points`}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.raBannerRight}>
                        <Text style={styles.raBannerActionText}>Inspect</Text>
                        <Ionicons name="chevron-forward" size={18} color="#FFD700" />
                    </View>
                </GamepadFocusable>
            </View>
        );
    };

    if (loading) {
        return (
            <ProtectedRoute>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={styles.loadingText}>{t('loading')}</Text>
                </View>
            </ProtectedRoute>
        );
    }

    if (error || !rom) {
        return (
            <ProtectedRoute>
                <View style={styles.centered}>
                    <Ionicons name="alert-circle-outline" size={64} color="#ef4444" />
                    <Text style={styles.errorText}>
                        {error || t('gameNotFound')}
                    </Text>
                    <TouchableOpacity style={styles.backButton} onPress={handleBack}>
                        <Text style={styles.backButtonText}>{t('goBack')}</Text>
                    </TouchableOpacity>
                </View>
            </ProtectedRoute>
        );
    }

    return (
        <ProtectedRoute>
            <View style={styles.container}>
                <DynamicConsoleBackdrop
                    imageUrl={rom.url_cover}
                    platformSlug={rom.platform_slug}
                />
                <View style={styles.header}>
                    <GamepadFocusable style={styles.backBtn} onPress={handleBack}>
                        <Ionicons name="arrow-back" size={24} color="#fff" />
                    </GamepadFocusable>
                    <Text style={styles.title} numberOfLines={1}>
                        {rom.name || rom.fs_name}
                    </Text>
                    <GamepadFocusable
                        style={styles.favoriteBtn}
                        glowColor="#FFD700"
                        onPress={() => {
                            if (rom) {
                                toggleFavorite(rom.id);
                                soundService.playFocus();
                            }
                        }}
                    >
                        <Ionicons
                            name={isRomFav ? "star" : "star-outline"}
                            size={22}
                            color={isRomFav ? "#FFD700" : "#fff"}
                        />
                    </GamepadFocusable>
                </View>

                {isLandscape ? (
                    <View style={styles.landscapeRow}>
                        {/* Left column: Cover Image + Action Buttons (Always in view without scrolling!) */}
                        <View style={styles.landscapeLeftCol}>
                            {rom.url_cover ? (
                                <Image
                                    source={{ uri: rom.url_cover }}
                                    style={styles.landscapeCover}
                                    resizeMode="contain"
                                />
                            ) : (
                                <View style={[styles.landscapeCover, styles.coverPlaceholder]}>
                                    <Ionicons name="game-controller-outline" size={56} color="#555" />
                                </View>
                            )}
                            <View style={styles.landscapeActionWrap}>
                                {renderActionSection()}
                            </View>
                        </View>

                        {/* Right column: Title, Metadata, Version Selector, Summary */}
                        <ScrollView
                            style={styles.landscapeRightCol}
                            contentContainerStyle={styles.landscapeRightContent}
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={styles.gameTitleLandscape}>{rom.name || rom.fs_name}</Text>

                            <View style={styles.badgeRow}>
                                <View style={styles.badge}>
                                    <Ionicons name="game-controller" size={14} color="#00E5FF" style={{ marginRight: 6 }} />
                                    <Text style={styles.badgeText}>{rom.platform_name}</Text>
                                </View>
                                {getSelectedFile()?.file_size_bytes ? (
                                    <View style={styles.badge}>
                                        <Ionicons name="file-tray-full" size={14} color="#A78BFA" style={{ marginRight: 6 }} />
                                        <Text style={styles.badgeText}>
                                            {isMultiFile
                                                ? `${formatFileSize(getSelectedFile()!.file_size_bytes)} (${selectedFileIndex + 1}/${totalFiles})`
                                                : formatFileSize(getSelectedFile()!.file_size_bytes)
                                            }
                                        </Text>
                                    </View>
                                ) : null}
                                {isMultiFile && (
                                    <View style={[styles.badge, allFilesDownloaded ? styles.badgeSuccess : null]}>
                                        <Ionicons
                                            name={allFilesDownloaded ? "checkmark-circle" : "layers"}
                                            size={14}
                                            color={allFilesDownloaded ? "#34C759" : "#38BDF8"}
                                            style={{ marginRight: 6 }}
                                        />
                                        <Text style={[styles.badgeText, allFilesDownloaded ? { color: '#34C759' } : null]}>
                                            {`${downloadedCount}/${totalFiles} Discs`}
                                        </Text>
                                    </View>
                                )}
                                {achievements.length > 0 && (
                                    <TouchableOpacity
                                        activeOpacity={0.7}
                                        style={[styles.badge, styles.badgeRA]}
                                        onPress={() => {
                                            hapticService.press();
                                            setShowAchievementsModal(true);
                                        }}
                                    >
                                        <Ionicons name="trophy" size={14} color="#FFD700" style={{ marginRight: 6 }} />
                                        <Text style={[styles.badgeText, { color: '#FFD700', fontWeight: 'bold' }]}>
                                            {`${achievements.length} Achievements (${totalRAPoints.toLocaleString()} pts)`}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Version Selector */}
                            {rom.files && rom.files.length > 1 && (
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>{t('selectVersion')}</Text>
                                    <GamepadFocusable
                                        style={styles.versionSelector}
                                        onPress={() => setShowVersionSelector(true)}
                                    >
                                        <View style={styles.versionInfo}>
                                            <Text style={styles.versionText} numberOfLines={1}>
                                                {getSelectedFile()?.file_name || `${t('version')} ${selectedFileIndex + 1}`}
                                            </Text>
                                            <Text style={styles.versionSize}>
                                                {formatFileSize(getSelectedFile()?.file_size_bytes || 0)}
                                            </Text>
                                            <Text style={styles.versionCount}>
                                                {selectedFileIndex + 1} / {rom.files.length}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-down" size={20} color="#ccc" />
                                    </GamepadFocusable>
                                </View>
                            )}

                            {renderRetroAchievementsSection()}

                            {rom.summary && (
                                <View style={styles.section}>
                                    <Text style={styles.sectionTitle}>{t('description')}</Text>
                                    <Text style={styles.summaryText}>{rom.summary}</Text>
                                </View>
                            )}
                        </ScrollView>
                    </View>
                ) : (
                    /* Portrait layout */
                    <ScrollView style={styles.portraitScroll} contentContainerStyle={styles.portraitContent}>
                        {rom.url_cover && (
                            <Image
                                source={{ uri: rom.url_cover }}
                                style={styles.portraitCover}
                                resizeMode="contain"
                            />
                        )}

                        <Text style={styles.gameTitlePortrait}>{rom.name || rom.fs_name}</Text>

                        <View style={styles.badgeRow}>
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>{rom.platform_name}</Text>
                            </View>
                            {getSelectedFile()?.file_size_bytes ? (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{formatFileSize(getSelectedFile()!.file_size_bytes)}</Text>
                                </View>
                            ) : null}
                            {isMultiFile && (
                                <View style={[styles.badge, allFilesDownloaded ? styles.badgeSuccess : null]}>
                                    <Text style={[styles.badgeText, allFilesDownloaded ? { color: '#34C759' } : null]}>
                                        {`${downloadedCount}/${totalFiles} Discs`}
                                    </Text>
                                </View>
                            )}
                            {achievements.length > 0 && (
                                <TouchableOpacity
                                    activeOpacity={0.7}
                                    style={[styles.badge, styles.badgeRA]}
                                    onPress={() => {
                                        hapticService.press();
                                        setShowAchievementsModal(true);
                                    }}
                                >
                                    <Ionicons name="trophy" size={14} color="#FFD700" style={{ marginRight: 6 }} />
                                    <Text style={[styles.badgeText, { color: '#FFD700', fontWeight: 'bold' }]}>
                                        {`${achievements.length} Achievements (${totalRAPoints.toLocaleString()} pts)`}
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Action placed right here so no scrolling needed */}
                        <View style={styles.portraitActionWrap}>
                            {renderActionSection()}
                        </View>

                        {/* Version Selector */}
                        {rom.files && rom.files.length > 1 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t('selectVersion')}</Text>
                                <GamepadFocusable
                                    style={styles.versionSelector}
                                    onPress={() => setShowVersionSelector(true)}
                                >
                                    <View style={styles.versionInfo}>
                                        <Text style={styles.versionText} numberOfLines={1}>
                                            {getSelectedFile()?.file_name || `${t('version')} ${selectedFileIndex + 1}`}
                                        </Text>
                                        <Text style={styles.versionSize}>
                                            {formatFileSize(getSelectedFile()?.file_size_bytes || 0)}
                                        </Text>
                                        <Text style={styles.versionCount}>
                                            {selectedFileIndex + 1} / {rom.files.length}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-down" size={20} color="#ccc" />
                                </GamepadFocusable>
                            </View>
                        )}

                        {renderRetroAchievementsSection()}

                        {rom.summary && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>{t('description')}</Text>
                                <Text style={styles.summaryText}>{rom.summary}</Text>
                            </View>
                        )}
                    </ScrollView>
                )}
            </View>

            {/* Version Selector Modal with Disc Download Badges */}
            <Modal
                visible={showVersionSelector}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowVersionSelector(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>{t('selectVersion')}</Text>
                            <TouchableOpacity
                                onPress={() => setShowVersionSelector(false)}
                                style={styles.closeButton}
                            >
                                <Ionicons name="close" size={24} color="#fff" />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={rom?.files || []}
                            keyExtractor={(_, index) => index.toString()}
                            renderItem={({ item, index }) => {
                                const correspondingFile = rom?.files[index];
                                const isItemDownloaded = correspondingFile ? isRomDownloaded(correspondingFile) : false;
                                return (
                                    <TouchableOpacity
                                        style={[
                                            styles.versionItem,
                                            selectedFileIndex === index && styles.versionItemSelected
                                        ]}
                                        onPress={() => {
                                            setSelectedFileIndex(index);
                                            setShowVersionSelector(false);
                                        }}
                                    >
                                        <View style={styles.versionItemContent}>
                                            <View style={styles.versionHeaderRow}>
                                                <Text style={[
                                                    styles.versionItemTitle,
                                                    selectedFileIndex === index && styles.versionItemTitleSelected
                                                ]}>
                                                    {item.file_name.replace(/\.[^/.]+$/, '') || `${t('version')} ${index + 1}`}
                                                </Text>
                                                {isItemDownloaded && (
                                                    <View style={styles.downloadedMiniBadge}>
                                                        <Ionicons name="checkmark-circle" size={14} color="#34C759" />
                                                        <Text style={styles.downloadedMiniText}>Downloaded</Text>
                                                    </View>
                                                )}
                                            </View>
                                            <Text style={[
                                                styles.versionItemSubtitle,
                                                selectedFileIndex === index && styles.versionItemSubtitleSelected
                                            ]}>
                                                {correspondingFile?.file_name.split('.').pop()}
                                            </Text>
                                            <Text style={[
                                                styles.versionItemSize,
                                                selectedFileIndex === index && styles.versionItemSizeSelected
                                            ]}>
                                                {formatFileSize(correspondingFile?.file_size_bytes || 0)}
                                            </Text>
                                        </View>
                                        {selectedFileIndex === index && (
                                            <Ionicons name="radio-button-on" size={20} color="#5f43b2" />
                                        )}
                                    </TouchableOpacity>
                                );
                            }}
                        />
                    </View>
                </View>
            </Modal>

            {/* RetroAchievements Modal */}
            <Modal
                visible={showAchievementsModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowAchievementsModal(false)}
            >
                <View style={styles.raModalOverlay}>
                    <View style={styles.raModalContent}>
                        <View style={styles.modalHeader}>
                            <View style={styles.raModalHeaderTitleWrap}>
                                <Ionicons name="trophy" size={22} color="#FFD700" />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.modalTitle}>RetroAchievements</Text>
                                    <Text style={styles.raModalSubtitle}>
                                        {`${achievements.length} Achievements • ${totalRAPoints.toLocaleString()} Points`}
                                    </Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    hapticService.press();
                                    setShowAchievementsModal(false);
                                }}
                                style={styles.closeButton}
                            >
                                <Ionicons name="close" size={24} color="#fff" />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={achievements}
                            keyExtractor={(item) => (item.ra_id || item.badge_id || item.title).toString()}
                            showsVerticalScrollIndicator={true}
                            contentContainerStyle={styles.raModalListContent}
                            renderItem={({ item: ach }) => {
                                const badgeUri = getAchievementBadgeUrl(ach);
                                return (
                                    <GamepadFocusable
                                        style={styles.raModalCard}
                                        glowColor="#FFD700"
                                        focusScale={1.02}
                                        onPress={() => {
                                            hapticService.press();
                                            Alert.alert(
                                                ach.title,
                                                `${ach.description}\n\n🏆 ${ach.points} Points${ach.num_awarded ? `\n👥 Unlocked by ${ach.num_awarded.toLocaleString()} players` : ''}`
                                            );
                                        }}
                                    >
                                        {badgeUri ? (
                                            <Image
                                                source={{ uri: badgeUri }}
                                                style={styles.raModalBadgeImg}
                                            />
                                        ) : (
                                            <View style={[styles.raModalBadgeImg, styles.raBadgePlaceholder]}>
                                                <Ionicons name="trophy-outline" size={24} color="#FFD700" />
                                            </View>
                                        )}
                                        <View style={styles.raModalCardInfo}>
                                            <View style={styles.raModalCardHeader}>
                                                <Text style={styles.raModalCardTitle} numberOfLines={1}>
                                                    {ach.title}
                                                </Text>
                                                <View style={styles.raPointsPill}>
                                                    <Text style={styles.raPointsText}>{ach.points} pts</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.raModalCardDesc}>
                                                {ach.description}
                                            </Text>
                                            {ach.num_awarded ? (
                                                <Text style={styles.raModalCardMeta}>
                                                    👥 {ach.num_awarded.toLocaleString()} players unlocked
                                                </Text>
                                            ) : null}
                                        </View>
                                    </GamepadFocusable>
                                );
                            }}
                        />
                    </View>
                </View>
            </Modal>
            <GamepadHints hints={[
                { button: 'A', label: 'Download / Action' },
                { button: 'Y', label: isRomFav ? 'Favorited' : 'Favorite' },
                { button: 'B', label: 'Back' },
            ]} />
        </ProtectedRoute>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0c',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0a0a0c',
        padding: 20,
    },
    loadingText: {
        color: '#fff',
        fontSize: 16,
        marginTop: 10,
    },
    errorText: {
        color: '#ef4444',
        fontSize: 16,
        textAlign: 'center',
        marginTop: 16,
        marginBottom: 20,
    },
    backButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    backButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    },
    backBtn: {
        marginRight: 12,
        padding: 8,
        borderRadius: 8,
    },
    favoriteBtn: {
        marginLeft: 12,
        padding: 8,
        borderRadius: 8,
    },
    title: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
    },
    // Landscape Layout (Optimized for Thor 1920x1080)
    landscapeRow: {
        flex: 1,
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 8,
        gap: 24,
    },
    landscapeLeftCol: {
        width: 320,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    landscapeCover: {
        width: '100%',
        height: 240,
        borderRadius: 14,
        backgroundColor: '#1c1f2e',
        borderWidth: 1,
        borderColor: '#2d3248',
    },
    coverPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    landscapeActionWrap: {
        width: '100%',
        marginTop: 14,
    },
    landscapeRightCol: {
        flex: 1,
    },
    landscapeRightContent: {
        paddingRight: 12,
        paddingBottom: 32,
    },
    gameTitleLandscape: {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
        letterSpacing: 0.3,
    },
    // Portrait Layout
    portraitScroll: {
        flex: 1,
    },
    portraitContent: {
        padding: 20,
        paddingBottom: 40,
    },
    portraitCover: {
        width: '100%',
        height: 280,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    gameTitlePortrait: {
        color: '#fff',
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    portraitActionWrap: {
        width: '100%',
        marginVertical: 14,
    },
    // Common Components
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    badgeSuccess: {
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    badgeText: {
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: '500',
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        color: '#94a3b8',
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 8,
    },
    summaryText: {
        color: '#cbd5e1',
        fontSize: 14,
        lineHeight: 22,
    },
    // Multi-File Container
    multiFileActionContainer: {
        width: '100%',
        gap: 8,
    },
    downloadAllButton: {
        backgroundColor: '#5f43b2',
    },
    singleDiscRow: {
        width: '100%',
    },
    secondaryDownloadButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
    },
    secondaryButtonText: {
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: '600',
    },
    singleDiscDownloaded: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 8,
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    singleDiscDownloadedText: {
        color: '#34c759',
        fontSize: 12,
        fontWeight: '600',
    },
    // Download Buttons
    downloadButton: {
        backgroundColor: '#5f43b2',
        borderRadius: 10,
        paddingVertical: 13,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
    },
    downloadingButton: {
        backgroundColor: '#475569',
    },
    downloadContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    downloadingContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 1,
    },
    downloadButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    progressFill: {
        height: '100%',
        backgroundColor: 'rgba(95, 67, 178, 0.85)',
        borderRadius: 10,
    },
    progressBackground: {
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 10,
        overflow: 'hidden',
    },
    checkingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 10,
        gap: 8,
    },
    checkingText: {
        color: '#00E5FF',
        fontSize: 14,
        fontWeight: '500',
    },
    alreadyDownloadedContainer: {
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderRadius: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: 'rgba(34, 197, 94, 0.4)',
        width: '100%',
    },
    alreadyDownloadedHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
        gap: 6,
    },
    alreadyDownloadedTitle: {
        color: '#22c55e',
        fontSize: 13,
        fontWeight: 'bold',
    },
    alreadyDownloadedActions: {
        flexDirection: 'row',
        gap: 6,
    },
    smallActionBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    smallActionText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    redownloadBtn: {
        backgroundColor: '#d97706',
    },
    verifyBtn: {
        backgroundColor: '#2563eb',
    },
    deleteBtn: {
        backgroundColor: '#dc2626',
    },
    // Version Selector
    versionSelector: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 10,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    versionInfo: {
        flex: 1,
        marginRight: 8,
    },
    versionText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 2,
    },
    versionSize: {
        color: '#94a3b8',
        fontSize: 12,
    },
    versionCount: {
        color: '#64748b',
        fontSize: 11,
        marginTop: 2,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#111827',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '75%',
        paddingTop: 16,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    modalTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    closeButton: {
        padding: 4,
    },
    versionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 14,
        marginHorizontal: 16,
        marginVertical: 6,
        borderRadius: 10,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    versionItemSelected: {
        backgroundColor: 'rgba(95, 67, 178, 0.3)',
        borderWidth: 1,
        borderColor: '#5f43b2',
    },
    versionItemContent: {
        flex: 1,
    },
    versionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
        paddingRight: 8,
    },
    versionItemTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    versionItemTitleSelected: {
        color: '#a78bfa',
    },
    downloadedMiniBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    downloadedMiniText: {
        color: '#34c759',
        fontSize: 10,
        fontWeight: '600',
    },
    versionItemSubtitle: {
        color: '#94a3b8',
        fontSize: 12,
        marginBottom: 2,
    },
    versionItemSubtitleSelected: {
        color: '#fff',
    },
    versionItemSize: {
        color: '#64748b',
        fontSize: 12,
    },
    versionItemSizeSelected: {
        color: '#cbd5e1',
    },
    badgeRA: {
        backgroundColor: 'rgba(255, 215, 0, 0.15)',
        borderColor: 'rgba(255, 215, 0, 0.4)',
        borderWidth: 1,
    },
    raBannerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255, 215, 0, 0.08)',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.25)',
    },
    raBannerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    raBannerIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: 'rgba(255, 215, 0, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.3)',
    },
    raBannerInfo: {
        flex: 1,
    },
    raBannerTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: 'bold',
        marginBottom: 2,
    },
    raBannerSubtitle: {
        color: '#FFD700',
        fontSize: 12,
        fontWeight: '600',
    },
    raBannerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 8,
    },
    raBannerActionText: {
        color: '#FFD700',
        fontSize: 13,
        fontWeight: 'bold',
    },
    // RA Modal Styles
    raModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    raModalContent: {
        backgroundColor: '#111827',
        borderRadius: 20,
        maxHeight: '88%',
        width: '100%',
        maxWidth: 750,
        paddingTop: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.3)',
        overflow: 'hidden',
    },
    raModalHeaderTitleWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    raModalSubtitle: {
        color: '#FFD700',
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
    },
    raModalListContent: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    raModalCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        gap: 12,
    },
    raModalBadgeImg: {
        width: 48,
        height: 48,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
    },
    raBadgePlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    raModalCardInfo: {
        flex: 1,
    },
    raModalCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
        gap: 8,
    },
    raModalCardTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
        flex: 1,
    },
    raModalCardDesc: {
        color: '#cbd5e1',
        fontSize: 12,
        lineHeight: 16,
        marginBottom: 4,
    },
    raModalCardMeta: {
        color: '#94a3b8',
        fontSize: 11,
        marginTop: 2,
    },
    raPointsPill: {
        backgroundColor: 'rgba(255, 215, 0, 0.15)',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.3)',
    },
    raPointsText: {
        color: '#FFD700',
        fontSize: 11,
        fontWeight: 'bold',
    },
});