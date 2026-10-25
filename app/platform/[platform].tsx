import { DownloadStatusBar } from '@/components/DownloadStatusBar';
import { DynamicConsoleBackdrop, updateBackdrop } from '@/components/DynamicConsoleBackdrop';
import { GamepadFocusable } from '@/components/GamepadFocusable';
import { GamepadHints } from '@/components/GamepadHints';
import { useGamepadNavigation } from '@/hooks/useGamepadNavigation';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Platform,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useDownload } from '../../contexts/DownloadContext';
import { useToast } from '../../contexts/ToastContext';
import { useDynamicColumns } from '../../hooks/useDynamicColumns';
import { usePlatformFolders } from '../../hooks/usePlatformFolders';
import { useRomFileSystem } from '../../hooks/useRomFileSystem';
import { usePlatform, usePlatforms, useRoms } from '../../hooks/useRoms';
import { useTranslation } from '../../hooks/useTranslation';
import { Rom } from '../../services/api';
import { useFavorites } from '@/services/favoritesService';
import { formatBytes, validateDiskSpace } from '@/services/storageService';
import { soundService } from '@/services/soundService';

export type SortOption = 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc';
export type FilterMode = 'all' | 'downloaded' | 'favorites';

export default function PlatformScreen() {
    const { platform } = useLocalSearchParams();
    const navigation = useNavigation();
    const { t } = useTranslation();
    const { roms, loading: romsLoading, loadingMore, hasMore, total, error: romsError, fetchRomsByPlatform, loadMoreRoms } = useRoms();
    const { platform: currentPlatform, loading: platformLoading, error: platformError, fetchPlatform } = usePlatform();
    const { addRomToQueue, isRomDownloading, completedDownloads } = useDownload();
    const { platformFolders, requestPlatformFolder, searchPlatformFolder, getAllPlatformFolders, hasPlatformFolder } = usePlatformFolders();
    const { isRomDownloaded, isCheckingRom, refreshRomCheck, checkMultipleRoms } = useRomFileSystem();
    const { showSuccessToast, showErrorToast, showInfoToast } = useToast();
    const insets = useSafeAreaInsets();
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const [folderSelectionShown, setFolderSelectionShown] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [sortBy, setSortBy] = useState<SortOption>('name_asc');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const { isFavorite } = useFavorites();

    const flatListRef = React.useRef<FlatList>(null);
    const scrollOffsetRef = React.useRef<number>(0);
    const layoutHeightRef = React.useRef<number>(600);

    const { platforms } = usePlatforms(false);
    const validPlatforms = useMemo(() => platforms.filter(p => p.rom_count > 0), [platforms]);

    const cyclePlatform = (direction: 'next' | 'prev') => {
        if (validPlatforms.length === 0) return;
        const currentIdx = validPlatforms.findIndex(p => p.id === platformId);
        if (currentIdx === -1) return;
        const nextIdx = direction === 'next'
            ? (currentIdx + 1) % validPlatforms.length
            : (currentIdx - 1 + validPlatforms.length) % validPlatforms.length;
        router.replace(`/platform/${validPlatforms[nextIdx].id}`);
    };

    const cycleSort = useCallback(() => {
        setSortBy(current => {
            switch (current) {
                case 'name_asc': return 'name_desc';
                case 'name_desc': return 'size_desc';
                case 'size_desc': return 'size_asc';
                case 'size_asc': return 'name_asc';
                default: return 'name_asc';
            }
        });
    }, []);

    const cycleFilter = useCallback(() => {
        setFilterMode(current => {
            if (current === 'all') return 'downloaded';
            if (current === 'downloaded') return 'favorites';
            return 'all';
        });
    }, []);

    const getSortLabel = (sort: SortOption) => {
        switch (sort) {
            case 'name_asc': return 'A → Z';
            case 'name_desc': return 'Z → A';
            case 'size_desc': return 'Size (Largest)';
            case 'size_asc': return 'Size (Smallest)';
        }
    };

    const handlePageDown = useCallback(() => {
        const jump = Math.max(300, layoutHeightRef.current * 0.8);
        scrollOffsetRef.current += jump;
        flatListRef.current?.scrollToOffset({
            offset: scrollOffsetRef.current,
            animated: true,
        });
        soundService.playFocus();
        return true;
    }, []);

    const handlePageUp = useCallback(() => {
        const jump = Math.max(300, layoutHeightRef.current * 0.8);
        scrollOffsetRef.current = Math.max(0, scrollOffsetRef.current - jump);
        flatListRef.current?.scrollToOffset({
            offset: scrollOffsetRef.current,
            animated: true,
        });
        soundService.playFocus();
        return true;
    }, []);

    useGamepadNavigation({
        onButtonX: () => {
            cycleFilter();
            return true;
        },
        onButtonY: () => {
            cycleSort();
            return true;
        },
        onButtonL1: () => {
            cyclePlatform('prev');
            return true;
        },
        onButtonR1: () => {
            cyclePlatform('next');
            return true;
        },
        onButtonL2: () => {
            handlePageUp();
            return true;
        },
        onButtonR2: () => {
            handlePageDown();
            return true;
        },
    });

    // Dynamic columns based on screen orientation and device size
    const { columns, cardWidth, isLandscape } = useDynamicColumns();

    const cardHeight = Math.floor(cardWidth * 1.4);
    const itemHeight = cardHeight + 24;
    const getItemLayout = useCallback((_: any, index: number) => ({
        length: itemHeight,
        offset: itemHeight * Math.floor(index / columns),
        index,
    }), [itemHeight, columns]);

    const platformId = Number(platform);

    const selectedPlatform = currentPlatform?.name;

    useEffect(() => {
        navigation.setOptions({
            title: selectedPlatform,
        });
    }, [navigation, selectedPlatform]);

    // Fetch platform data when platform ID is available
    useEffect(() => {
        if (platformId && !isNaN(platformId)) {
            fetchPlatform(platformId);
        }
    }, [platformId, fetchPlatform]);

    // Fetch ROMs when platform data is loaded
    useEffect(() => {
        fetchRomsByPlatform(platformId);

    }, [platformId]);

    // Monitor completed downloads to refresh ROM status
    useEffect(() => {
        Promise.all(completedDownloads.map(downloadedItem => refreshRomCheck(downloadedItem.romFile, downloadedItem.platformFolder)));
    }, [completedDownloads.length, roms.length, currentPlatform]);

    // Check if platform folder is configured and request if not (only after ROMs are loaded)
    useEffect(() => {
        if (currentPlatform && roms.length > 0 && !folderSelectionShown) {
            const checkFolder = async () => {
                const platformFolder = await searchPlatformFolder(currentPlatform);
                if (!platformFolder) {
                    setFolderSelectionShown(true);
                    console.log('Platform folder not found, requesting folder selection');
                    await requestPlatformFolder(currentPlatform);
                }
            };
            checkFolder();
        }
    }, [roms.length, currentPlatform, hasPlatformFolder]);

    useEffect(() => {
        if (!currentPlatform || roms.length === 0) return;
        const checkRoms = async () => {
            const folders = await getAllPlatformFolders(currentPlatform);
            const platformFolder = folders.length > 0 ? folders[0] : await searchPlatformFolder(currentPlatform);
            if (!platformFolder && folders.length === 0) return;
            const allFiles = roms.flatMap(rom => rom.files || []);
            if (allFiles.length > 0) {
                await checkMultipleRoms(allFiles, folders.length > 0 ? folders : [platformFolder!]);
            }
        };
        checkRoms();
    }, [roms, currentPlatform, getAllPlatformFolders, searchPlatformFolder, checkMultipleRoms]);

    const onRefresh = async () => {
        setRefreshing(true);
        try {
            // Refresh both platform and ROMs data
            if (platformId && !isNaN(platformId)) {
                await fetchPlatform(platformId);
                await fetchRomsByPlatform(platformId);
                console.log('Refreshing ROMs and platform data');

                // Force a complete refresh of ROM checks
                setTimeout(async () => {
                    if (currentPlatform && roms.length > 0) {
                        console.log('Force refreshing all ROM checks');
                        await Promise.all(roms.map(async rom => {
                            if (!rom.files || rom.files.length === 0) return;
                            const platformFolder = platformFolders.find(folder => folder.platformSlug === rom.platform_slug);
                            if (!platformFolder) return;
                            await Promise.all(rom.files.map(file => refreshRomCheck(file, platformFolder)));
                        }));
                    }
                }, 500); // Small delay to ensure data is updated
            }
        } catch (error) {
            console.error('Error refreshing data:', error);
            showErrorToast(
                t('errorRefreshingData'),
                t('error')
            );
        } finally {
            setRefreshing(false);
        }
    };

    const handleDownloadAll = async () => {
        if (!currentPlatform || roms.length === 0) {
            showErrorToast(t('noRomsAvailable'), t('error'));
            return;
        }

        // Get the platform folder
        const platformFolder = await searchPlatformFolder(currentPlatform);
        if (!platformFolder) {
            await requestPlatformFolder(currentPlatform);
            return;
        }

        // Filter out ROMs that are already being downloaded or already exist on filesystem
        const romsToDownload = roms.filter(rom => {
            const firstFile = rom.files?.[0];
            if (!firstFile) return false;
            return !isRomDownloading(firstFile) && !isRomDownloaded(firstFile);
        });

        if (romsToDownload.length === 0) {
            showInfoToast(t('allRomsDownloaded'), t('info'));
            return;
        }

        const totalBatchBytes = romsToDownload.reduce((sum, r) => {
            return sum + (r.fs_size_bytes || r.files?.[0]?.file_size_bytes || 0);
        }, 0);

        const check = await validateDiskSpace(totalBatchBytes);
        if (!check.canDownload) {
            Alert.alert('Insufficient Storage', check.warningMessage);
            return;
        }

        Alert.alert(
            t('confirmDownload'),
            `Download ${romsToDownload.length} games (${formatBytes(totalBatchBytes)}) for ${currentPlatform.name}?\n\nAvailable device storage: ${formatBytes(check.freeBytes)}`,
            [
                { text: t('cancel'), style: 'cancel' },
                {
                    text: t('downloadAll'),
                    onPress: async () => {
                        setIsDownloadingAll(true);
                        try {
                            // Add all ROMs to download queue
                            romsToDownload.forEach(rom => {
                                addRomToQueue(rom, rom.files[0], platformFolder);
                            });

                            showSuccessToast(
                                t('romsAddedToQueue', { count: romsToDownload.length.toString() }),
                                t('downloadAllStarted')
                            );
                        } catch (error) {
                            console.error('Error adding ROMs to queue:', error);
                            showErrorToast(t('errorAddingToQueue'), t('error'));
                        } finally {
                            setIsDownloadingAll(false);
                        }
                    }
                }
            ]
        );
    };

    // Show error if API call fails
    useEffect(() => {
        const error = romsError || platformError;
        if (error) {
            showErrorToast(
                t('unableToLoadPlatformData'),
                t('error')
            );
        }
    }, [romsError, platformError, showErrorToast, t]);

    const handleCardPress = useCallback((id: number) => {
        router.push(`/game/${id}`);
    }, []);

    const handleDownload = useCallback(async (rom: Rom) => {
        if (!currentPlatform) return;

        // Get the platform folder
        const platformFolder = await searchPlatformFolder(currentPlatform);
        if (!platformFolder) {
            await requestPlatformFolder(currentPlatform);
            return;
        }

        addRomToQueue(rom, rom.files[0], platformFolder);
    }, [currentPlatform, searchPlatformFolder, requestPlatformFolder, addRomToQueue]);

    const renderGameItem = useCallback(({ item, index }: { item: Rom & { isEmpty?: boolean }; index: number }) => {
        const files = item.files || [];
        const downloadedCount = files.filter(f => isRomDownloaded(f)).length;
        const isDownloaded = downloadedCount > 0;
        const isDownloading = files.some(f => isRomDownloading(f));
        const isChecking = files.some(f => isCheckingRom(f));

        return (
            <GameCardItem
                rom={item}
                index={index}
                cardWidth={cardWidth}
                isDownloaded={isDownloaded}
                isDownloading={isDownloading}
                isChecking={isChecking}
                isFavorite={isFavorite(item.id)}
                downloadedCount={downloadedCount}
                totalVersions={files.length}
                onDownload={handleDownload}
                onPress={handleCardPress}
                onFocus={() => updateBackdrop({ imageUrl: item.url_cover, platformSlug: currentPlatform?.slug })}
            />
        );
    }, [cardWidth, isRomDownloaded, isRomDownloading, isCheckingRom, isFavorite, handleDownload, handleCardPress, currentPlatform?.slug]);

    const isAnyFileDownloaded = useCallback((rom: Rom) => {
        return (rom.files || []).some(f => isRomDownloaded(f));
    }, [isRomDownloaded]);

    const downloadedCount = useMemo(() => {
        return roms.filter(isAnyFileDownloaded).length;
    }, [roms, isAnyFileDownloaded]);

    const favoritesCount = useMemo(() => {
        return roms.filter(r => isFavorite(r.id)).length;
    }, [roms, isFavorite]);

    const filteredRoms = useMemo(() => {
        let list = roms;
        if (filterMode === 'downloaded') {
            list = list.filter(isAnyFileDownloaded);
        } else if (filterMode === 'favorites') {
            list = list.filter(r => isFavorite(r.id));
        }
        const sorted = [...list];
        sorted.sort((a, b) => {
            if (sortBy === 'name_asc') {
                const nameA = (a.name || a.fs_name || '').toLowerCase();
                const nameB = (b.name || b.fs_name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            }
            if (sortBy === 'name_desc') {
                const nameA = (a.name || a.fs_name || '').toLowerCase();
                const nameB = (b.name || b.fs_name || '').toLowerCase();
                return nameB.localeCompare(nameA);
            }
            if (sortBy === 'size_desc') {
                const sizeA = a.fs_size_bytes || (a.files?.[0]?.file_size_bytes) || 0;
                const sizeB = b.fs_size_bytes || (b.files?.[0]?.file_size_bytes) || 0;
                return sizeB - sizeA;
            }
            if (sortBy === 'size_asc') {
                const sizeA = a.fs_size_bytes || (a.files?.[0]?.file_size_bytes) || 0;
                const sizeB = b.fs_size_bytes || (b.files?.[0]?.file_size_bytes) || 0;
                return sizeA - sizeB;
            }
            return 0;
        });
        return sorted;
    }, [roms, filterMode, sortBy, isAnyFileDownloaded, isFavorite]);

    // Prepare data for FlatList with empty items to fill last row
    const gridData = useMemo(() => {
        const totalItems = filteredRoms.length;
        const remainder = totalItems % columns;
        if (remainder === 0) return filteredRoms;

        const emptyItems = columns - remainder;
        const paddedData = [...filteredRoms];
        for (let i = 0; i < emptyItems; i++) {
            paddedData.push({ id: `empty-${i}`, isEmpty: true } as any);
        }
        return paddedData;
    }, [filteredRoms, columns]);

    if (romsLoading || platformLoading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>{t('loading')}</Text>
            </View>
        );
    }

    if (!platformId || isNaN(platformId) || !currentPlatform) {
        return (
            <View style={[styles.container, styles.centered]}>
                <Text style={styles.errorText}>{t('platformNotFound')}</Text>
            </View>
        );
    }

    // Calculate available ROMs to download
    const availableToDownload = roms.filter(rom => {
        const firstFile = rom.files?.[0];
        if (!firstFile) return false;
        return !isRomDownloading(firstFile) && !isRomDownloaded(firstFile);
    }).length;

    // Footer component for loading more items
    const renderFooter = () => {
        if (!loadingMore) return null;

        return (
            <View style={styles.loadingFooter}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.loadingFooterText}>{t('loadingMore')}</Text>
            </View>
        );
    };

    // Handle end reached for infinite scroll
    const handleEndReached = () => {
        if (hasMore && !loadingMore && !romsLoading) {
            console.log('Loading more ROMs for platform...');
            loadMoreRoms();
        }
    };

    return (
        <ProtectedRoute>
            <View style={styles.container}>
                <DynamicConsoleBackdrop
                    platformSlug={currentPlatform?.slug}
                />
                {/* Header Section */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <View style={styles.headerTop}>
                        <GamepadFocusable style={styles.backButton} onPress={() => {
                            if (router.canGoBack()) {
                                router.back();
                            } else {
                                router.replace('/');
                            }
                        }}>
                            <Ionicons name="arrow-back-outline" size={24} color="#fff" />
                        </GamepadFocusable>
                        <View style={styles.headerLeft}>
                            <Text style={styles.headerTitle}>{currentPlatform?.name || t('unknownPlatform')}</Text>
                            <Text style={styles.headerSubtitle}>
                                {total !== null ? `${roms.length}/${total}` : roms.length} {t('games')}
                            </Text>
                        </View>
                        <View style={styles.headerButtons}>
                            {Platform.OS === 'android' && <GamepadFocusable
                                style={styles.folderButton}
                                onPress={() => requestPlatformFolder(currentPlatform, true)}
                            >
                                <Ionicons name="folder-outline" size={20} color="#fff" />
                            </GamepadFocusable>}
                            <GamepadFocusable
                                style={styles.folderButton}
                                onPress={() => router.push({ pathname: '/firmware', params: { platformId } })}
                            >
                                <Ionicons name="hardware-chip-outline" size={20} color="#fff" />
                            </GamepadFocusable>
                            <GamepadFocusable
                                style={[
                                    styles.downloadAllButton,
                                    availableToDownload === 0 && styles.downloadAllButtonDisabled
                                ]}
                                onPress={handleDownloadAll}
                                disabled={isDownloadingAll || availableToDownload === 0}
                            >
                                {isDownloadingAll ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <>
                                        <Ionicons name="download" size={20} color="#fff" />
                                        {availableToDownload > 0 && (
                                            <Text style={styles.downloadAllText}>{availableToDownload}</Text>
                                        )}
                                    </>
                                )}
                            </GamepadFocusable>
                        </View>
                    </View>

                    {/* Filter & Sort Bar */}
                    <View style={styles.filterBar}>
                        <TouchableOpacity
                            style={[styles.filterPill, filterMode === 'all' && styles.filterPillActive]}
                            onPress={() => setFilterMode('all')}
                        >
                            <Text style={[styles.filterPillText, filterMode === 'all' && styles.filterPillTextActive]}>
                                All ({roms.length})
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.filterPill, filterMode === 'downloaded' && styles.filterPillActive]}
                            onPress={() => setFilterMode('downloaded')}
                        >
                            <Ionicons
                                name="checkmark-circle"
                                size={14}
                                color={filterMode === 'downloaded' ? '#00E5FF' : '#34C759'}
                            />
                            <Text style={[styles.filterPillText, filterMode === 'downloaded' && styles.filterPillTextActive]}>
                                Downloaded ({downloadedCount})
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.filterPill, filterMode === 'favorites' && styles.filterPillActive]}
                            onPress={() => setFilterMode('favorites')}
                        >
                            <Ionicons
                                name="star"
                                size={14}
                                color={filterMode === 'favorites' ? '#FFD700' : '#EAB308'}
                            />
                            <Text style={[styles.filterPillText, filterMode === 'favorites' && styles.filterPillTextActive]}>
                                Favorites ({favoritesCount})
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.filterPill, styles.filterPillActive, { marginLeft: 'auto' }]}
                            onPress={cycleSort}
                        >
                            <Ionicons name="swap-vertical" size={14} color="#00E5FF" />
                            <Text style={[styles.filterPillText, styles.filterPillTextActive]}>
                                {getSortLabel(sortBy)}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Games Grid */}
                <FlatList
                    ref={flatListRef}
                    data={gridData}
                    renderItem={renderGameItem}
                    keyExtractor={(item) => item.id.toString()}
                    numColumns={columns}
                    key={`${columns}-${isLandscape}`} // Force re-render when columns or orientation change
                    columnWrapperStyle={columns > 1 ? styles.row : undefined}
                    contentContainerStyle={styles.gamesContainer}
                    showsVerticalScrollIndicator={false}
                    getItemLayout={getItemLayout}
                    removeClippedSubviews={false}
                    windowSize={11}
                    maxToRenderPerBatch={columns * 3}
                    initialNumToRender={columns * 3}
                    onScroll={(e) => {
                        scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    onLayout={(e) => {
                        layoutHeightRef.current = e.nativeEvent.layout.height;
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#fff"
                            colors={['#007AFF']}
                            progressBackgroundColor="#333"
                        />
                    }
                    ListEmptyComponent={
                        !romsLoading && !platformLoading ? (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="game-controller-outline" size={64} color="#666" />
                                <Text style={styles.emptyText}>
                                    {filterMode === 'downloaded'
                                        ? 'No downloaded games for this platform on your device'
                                        : filterMode === 'favorites'
                                            ? 'No favorite games starred for this platform'
                                            : t('noRomsFoundForPlatform')}
                                </Text>
                            </View>
                        ) : null
                    }
                    ListFooterComponent={renderFooter}
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.1}
                />

                <DownloadStatusBar onPress={() => router.push('/downloads')} />
                <GamepadHints hints={[
                    { button: 'L1/R1', label: 'Systems' },
                    { button: 'L2/R2', label: 'Page' },
                    { button: 'X', label: filterMode === 'all' ? 'Downloaded' : filterMode === 'downloaded' ? 'Favorites' : 'All' },
                    { button: 'Y', label: `Sort: ${getSortLabel(sortBy)}` },
                    { button: 'A', label: 'Select' },
                    { button: 'B', label: 'Back' },
                ]} />
            </View>
        </ProtectedRoute>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 10,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 1,
    },
    backButton: {
        paddingRight: 10,
        borderRadius: 8,
    },
    headerLeft: {
        flex: 1,
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    folderButton: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: '#333',
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        color: '#fff',
        fontSize: 32,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        color: '#999',
        fontSize: 14,
        marginTop: 2,
    },
    filterBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    filterPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: '#161922',
        borderWidth: 1,
        borderColor: '#232736',
        gap: 6,
    },
    filterPillActive: {
        backgroundColor: '#1E293B',
        borderColor: '#00E5FF',
    },
    filterPillText: {
        color: '#94A3B8',
        fontSize: 12,
        fontWeight: '600',
    },
    filterPillTextActive: {
        color: '#FFFFFF',
    },
    downloadAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: 10,
        borderRadius: 8,
        backgroundColor: '#007AFF',
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
    },
    downloadAllButtonDisabled: {
        backgroundColor: '#555',
        opacity: 0.6,
    },
    downloadAllText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
        minWidth: 16,
        textAlign: 'center',
    },
    loadingText: {
        color: '#fff',
        fontSize: 16,
        marginTop: 10,
    },
    errorText: {
        color: '#ff6b6b',
        fontSize: 16,
        textAlign: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
        width: '100%',
    },
    emptyText: {
        color: '#666',
        fontSize: 16,
        textAlign: 'center',
        marginTop: 16,
    },
    platformSection: {
        paddingHorizontal: 20,
        paddingVertical: 15,
    },
    platformHeader: {
        marginBottom: 15,
    },
    platformInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    platformTitle: {
        color: '#fff',
        fontSize: 28,
        fontWeight: 'bold',
    },
    controls: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    controlButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#333',
        paddingHorizontal: 15,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 8,
    },
    controlText: {
        color: '#fff',
        fontSize: 14,
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 15,
    },
    statItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#333',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        gap: 6,
    },
    statText: {
        color: '#fff',
        fontSize: 12,
    },
    recentDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#4CAF50',
    },
    categoriesContainer: {
        marginTop: 10,
    },
    categoryTag: {
        backgroundColor: '#333',
        paddingHorizontal: 15,
        paddingVertical: 8,
        borderRadius: 15,
        marginRight: 10,
    },
    categoryText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    gamesContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    row: {
        justifyContent: 'flex-start',
        gap: 12,
        paddingHorizontal: 0,
        marginBottom: 12,
    },
    gameCard: {
        marginTop: 8,
        marginBottom: 8,
    },
    gameImageContainer: {
        position: 'relative',
        width: '100%',
    },
    gameImage: {
        width: '100%',
        height: "100%",
        borderRadius: 12,
        backgroundColor: '#333',
        objectFit: 'cover',
    },
    newBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 215, 0, 0.9)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    completedBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 15,
        padding: 2,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    versionCountBadge: {
        color: '#34C759',
        fontSize: 10,
        fontWeight: 'bold',
        marginLeft: 2,
        marginRight: 4
    },
    checkingBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(255, 149, 0, 0.9)',
        borderRadius: 12,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    topLeftBadges: {
        position: 'absolute',
        top: 8,
        left: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        zIndex: 10,
    },
    downloadingBadge: {
        backgroundColor: 'rgba(0, 122, 255, 0.9)',
        borderRadius: 12,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    favoriteBadge: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 12,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    raTrophyBadge: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        borderRadius: 12,
        padding: 4,
        borderWidth: 1,
        borderColor: 'rgba(255, 215, 0, 0.4)',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    badgeText: {
        color: '#000',
        fontSize: 10,
        fontWeight: 'bold',
    },
    placeholderContainer: {
        width: '100%',
        height: '100%',
        backgroundColor: '#222',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
    },
    placeholderTitle: {
        color: '#ccc',
        fontSize: 10,
        fontWeight: '500',
        textAlign: 'center',
        lineHeight: 12,
        marginTop: 4,
    },
    gameTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
        lineHeight: 18,
        marginTop: 8,
    },
    romOverlay: {
        position: 'absolute',
        bottom: 8,
        right: 8,
    },
    downloadButton: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingFooter: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 20,
        gap: 10,
    },
    loadingFooterText: {
        color: '#999',
        fontSize: 14,
    },
});

interface GameCardItemProps {
    rom: Rom & { isEmpty?: boolean };
    index: number;
    cardWidth: number;
    isDownloaded: boolean;
    isDownloading: boolean;
    isChecking: boolean;
    isFavorite?: boolean;
    downloadedCount: number;
    totalVersions: number;
    onDownload: (rom: Rom) => void;
    onPress: (id: number) => void;
    onFocus?: () => void;
}

const GameCardItem = React.memo(({
    rom,
    index,
    cardWidth,
    isDownloaded,
    isDownloading,
    isChecking,
    isFavorite,
    downloadedCount,
    totalVersions,
    onDownload,
    onPress,
    onFocus,
}: GameCardItemProps) => {
    if (rom.isEmpty) {
        return <View focusable={false} style={[styles.gameCard, { width: cardWidth }]} />;
    }

    const hasImage = !!(rom.url_cover && rom.url_cover.trim() !== '');
    const cardHeight = Math.floor(cardWidth * 1.4);
    const hasMultipleVersions = totalVersions > 1;

    return (
        <GamepadFocusable
            style={[styles.gameCard, { width: cardWidth }]}
            glowColor="#00E5FF"
            focusScale={1.04}
            onPress={() => onPress(rom.id)}
            onFocus={onFocus}
        >
            <View style={[styles.gameImageContainer, { height: cardHeight }]}>
                {hasImage ? (
                    <Image
                        source={{ uri: rom.url_cover }}
                        style={styles.gameImage}
                    />
                ) : (
                    <View style={styles.placeholderContainer}>
                        <Ionicons name="help-outline" size={Math.min(64, cardWidth * 0.4)} color="#666" />
                        <Text style={[styles.gameTitle, { fontSize: Math.min(14, cardWidth * 0.1) }]} numberOfLines={2}>
                            {rom.name || rom.fs_name}
                        </Text>
                    </View>
                )}
                {/* Status Badges */}
                <View style={styles.topLeftBadges}>
                    {isFavorite && (
                        <View style={styles.favoriteBadge}>
                            <Ionicons name="star" size={Math.min(14, cardWidth * 0.11)} color="#FFD700" />
                        </View>
                    )}
                    {Boolean(rom.ra_id) && (
                        <View style={styles.raTrophyBadge}>
                            <Ionicons name="trophy" size={Math.min(13, cardWidth * 0.10)} color="#FFD700" />
                        </View>
                    )}
                    {isDownloading && (
                        <View style={styles.downloadingBadge}>
                            <Ionicons name="download" size={Math.min(18, cardWidth * 0.12)} color="#FFFFFF" />
                        </View>
                    )}
                </View>
                {isDownloaded && (
                    <View style={styles.completedBadge}>
                        <Ionicons name="checkmark-circle" size={Math.min(24, cardWidth * 0.16)} color="#34C759" />
                        {hasMultipleVersions && (
                            <Text style={styles.versionCountBadge}>
                                {downloadedCount}/{totalVersions}
                            </Text>
                        )}
                    </View>
                )}
                {isChecking && !isDownloaded && (
                    <View style={styles.checkingBadge}>
                        <ActivityIndicator size={Math.min(16, cardWidth * 0.11)} color="#FF9500" />
                    </View>
                )}

                {/* Download Button - Use Pressable with focusable={false} so Android D-pad won't get trapped */}
                {!isDownloaded && !isDownloading && (
                    <View style={styles.romOverlay}>
                        <Pressable
                            focusable={false}
                            style={[styles.downloadButton, {
                                width: Math.min(32, cardWidth * 0.21),
                                height: Math.min(32, cardWidth * 0.21)
                            }]}
                            onPress={() => onDownload(rom)}
                        >
                            <Ionicons name="download-outline" size={Math.min(16, cardWidth * 0.11)} color="#fff" />
                        </Pressable>
                    </View>
                )}
            </View>
        </GamepadFocusable>
    );
});