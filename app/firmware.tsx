import { Ionicons } from '@expo/vector-icons';
import { moveFile } from '@joplin/react-native-saf-x';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { GamepadFocusable } from '@/components/GamepadFocusable';
import { GamepadHints } from '@/components/GamepadHints';
import { useGamepadNavigation } from '@/hooks/useGamepadNavigation';
import { useToast } from '../contexts/ToastContext';
import { useStorageAccessFramework } from '../hooks/useStorageAccessFramework';
import { useTranslation } from '../hooks/useTranslation';
import { apiClient, Firmware } from '../services/api';

export default function FirmwareScreen() {
    const { t } = useTranslation();
    const { platformId } = useLocalSearchParams();
    const { showSuccessToast, showErrorToast } = useToast();
    const { requestDirectoryPermissions } = useStorageAccessFramework();
    const [firmwareList, setFirmwareList] = useState<Firmware[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [downloadingId, setDownloadingId] = useState<number | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    useGamepadNavigation();

    useEffect(() => {
        loadFirmware();
    }, [platformId]);

    const loadFirmware = async () => {
        try {
            setIsLoading(true);
            const id = platformId ? Number(platformId) : undefined;
            const data = await apiClient.getFirmwareList(id);
            setFirmwareList(data);
        } catch (error) {
            console.error('Error loading firmware:', error);
            showErrorToast(t('errorLoadingFirmware') || 'Error loading firmware', t('error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = async (firmware: Firmware) => {
        try {
            let destinationFolderUri: string | null = null;

            if (Platform.OS === 'android') {
                try {
                    destinationFolderUri = await requestDirectoryPermissions();
                } catch (e) {
                    // User cancelled or error
                    return;
                }

                if (!destinationFolderUri) return;
            }

            setDownloadingId(firmware.id);
            setDownloadProgress(0);

            const downloadUrl = await apiClient.obtainFirmwareDownloadLink(firmware);

            // Download to cache directory first
            const fileUri = `${FileSystem.cacheDirectory}${firmware.file_name}`;

            let result;
            try {
                const downloadResumable = FileSystem.createDownloadResumable(
                    downloadUrl,
                    fileUri,
                    {
                        headers: apiClient.getAuthHeaders(),
                    },
                    (downloadProgress) => {
                        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                        setDownloadProgress(progress);
                    }
                );
                result = await downloadResumable.downloadAsync();
            } catch (error) {
                console.log('Resumable download creation failed, falling back to simple download', error);
                // Fallback to simple download
                result = await FileSystem.downloadAsync(
                    downloadUrl,
                    fileUri,
                    {
                        headers: apiClient.getAuthHeaders(),
                    }
                );
            }

            if (result && result.uri) {
                if (Platform.OS === 'android' && destinationFolderUri) {
                    // Move to selected folder
                    console.log('Source URI:', result.uri);
                    console.log('Destination Folder URI:', destinationFolderUri);

                    // Encode the filename to ensure valid URI
                    const encodedFileName = encodeURIComponent(firmware.file_name);
                    const destinationUri = `${destinationFolderUri}/${encodedFileName}`;
                    console.log('Destination URI:', destinationUri);

                    try {
                        await moveFile(result.uri, destinationUri, { replaceIfDestinationExists: true });
                    } catch (e) {
                        console.warn('Error moving file (ignoring):', e);
                    }
                    showSuccessToast(t('downloadComplete') || 'Download complete', t('success'));
                } else {
                    // iOS or fallback: Share
                    if (await FileSystem.getInfoAsync(result.uri).then(info => info.exists)) {
                        await Share.share({
                            url: result.uri,
                            title: firmware.file_name,
                        });
                        showSuccessToast(t('downloadComplete') || 'Download complete', t('success'));
                    }
                }
            }
        } catch (error) {
            console.error('Error downloading firmware:', error);
            showErrorToast(t('downloadFailed') || 'Download failed', t('error'));
        } finally {
            setDownloadingId(null);
            setDownloadProgress(0);
        }
    };

    const renderItem = ({ item }: { item: Firmware }) => (
        <View style={styles.itemContainer}>
            <View style={styles.itemInfo}>
                <Ionicons name="hardware-chip-outline" size={24} color="#fff" style={styles.itemIcon} />
                <View>
                    <Text style={styles.itemName}>{item.file_name}</Text>
                    <Text style={styles.itemSize}>{(item.file_size_bytes / 1024 / 1024).toFixed(2)} MB</Text>
                </View>
            </View>

            <GamepadFocusable
                style={[styles.downloadButton, downloadingId === item.id && styles.disabledButton]}
                onPress={() => handleDownload(item)}
                disabled={downloadingId !== null}
            >
                {downloadingId === item.id ? (
                    <Text style={styles.progressText}>{Math.round(downloadProgress * 100)}%</Text>
                ) : (
                    <Ionicons name="download-outline" size={20} color="#fff" />
                )}
            </GamepadFocusable>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <GamepadFocusable
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </GamepadFocusable>
                <Text style={styles.headerTitle}>{t('firmware') || 'Firmware'}</Text>
            </View>

            {isLoading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#4CAF50" />
                </View>
            ) : (
                <FlatList
                    data={firmwareList}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.id.toString()}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>{t('noFirmwareFound') || 'No firmware found'}</Text>
                        </View>
                    }
                />
            )}
            <GamepadHints selectText="Download Firmware" backText="Back" />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#121212',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 20,
        backgroundColor: '#1E1E1E',
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    backButton: {
        marginRight: 15,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        padding: 20,
    },
    itemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#1E1E1E',
        padding: 15,
        borderRadius: 10,
        marginBottom: 10,
    },
    itemInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    itemIcon: {
        marginRight: 15,
    },
    itemName: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    itemSize: {
        color: '#aaa',
        fontSize: 12,
    },
    downloadButton: {
        backgroundColor: '#4CAF50',
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 10,
    },
    disabledButton: {
        backgroundColor: '#333',
    },
    progressText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        color: '#aaa',
        fontSize: 16,
    },
});
