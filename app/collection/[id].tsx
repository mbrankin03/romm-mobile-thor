import { DownloadStatusBar } from '@/components/DownloadStatusBar';
import { DynamicConsoleBackdrop, updateBackdrop } from '@/components/DynamicConsoleBackdrop';
import { useRomDownload } from '@/hooks/useRomDownload';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useCollections } from '../../hooks/useCollections';
import { useDownload } from '../../contexts/DownloadContext';
import { useToast } from '../../contexts/ToastContext';
import { GamepadFocusable } from '@/components/GamepadFocusable';
import { GamepadHints } from '@/components/GamepadHints';
import { useGamepadNavigation } from '@/hooks/useGamepadNavigation';
import { useDynamicColumns } from '../../hooks/useDynamicColumns';
import { usePlatformFolders } from '../../hooks/usePlatformFolders';
import { useRomFileSystem } from '../../hooks/useRomFileSystem';
import { useRomsByCollection } from '../../hooks/useRoms';
import { useTranslation } from '../../hooks/useTranslation';
import { apiClient, Collection as ApiCollection, Platform, Rom } from '../../services/api';
import { useFavorites } from '../../services/favoritesService';
import { soundService } from '@/services/soundService';
import { formatBytes, validateDiskSpace } from '../../services/storageService';

type FilterMode = 'all' | 'downloaded' | 'favorites';

export default function CollectionScreen() {
    const { id, virtual } = useLocalSearchParams<{ id: string; virtual?: string }>();
    const collectionId = id;
    const isVirtual = virtual === 'true';
    const { t } = useTranslation();
    const { roms, loading, error, fetchRoms, loadMoreRoms, loadingMore, hasMore, total } = useRomsByCollection(collectionId, isVirtual);
    const [collection, setCollection] = useState<ApiCollection | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [isDownloadingAll, setIsDownloadingAll] = useState(false);
    const { activeDownloads, addRomToQueue, isRomDownloading, completedDownloads } = useDownload();
    const { downloadRom } = useRomDownload();
    const { showErrorToast, showInfoToast, showSuccessToast } = useToast();
    const { platformFolders, searchPlatformFolder, getAllPlatformFolders } = usePlatformFolders();
    const { checkMultipleRoms, isRomDownloaded, isCheckingRom, refreshRomCheck } = useRomFileSystem();
    const insets = useSafeAreaInsets();

    const { userCollections, generatedCollections } = useCollections(true);
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'size_desc' | 'size_asc'>('name_asc');
    const { isFavorite } = useFavorites();

    const flatListRef = React.useRef<FlatList>(null);
    const scrollOffsetRef = React.useRef<number>(0);
    const layoutHeightRef = React.useRef<number>(600);

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

    const getSortLabel = (sort: 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc') => {
        switch (sort) {
            case 'name_asc': return 'A → Z';
            case 'name_desc': return 'Z → A';
            case 'size_desc': return 'Size (Largest)';
            case 'size_asc': return 'Size (Smallest)';
        }
    };

    const allCollections = useMemo(() => {
        const list: { id: string; isVirtual: boolean; name: string }[] = [];
        if (userCollections && userCollections.length > 0) {
            userCollections.forEach(c => {
                if ((c.rom_count || 0) > 0) {
                    list.push({ id: String(c.id), isVirtual: false, name: c.name });
                }
            });
        }
        if (generatedCollections) {
            Object.values(generatedCollections).forEach(arr => {
                arr.forEach(c => {
                    if ((c.rom_count || 0) > 0) {
                        list.push({ id: String(c.id), isVirtual: true, name: c.name });
                    }
                });
            });
        }
        return list;
    }, [userCollections, generatedCollections]);

    const cycleCollection = (direction: 'next' | 'prev') => {
        if (allCollections.length <= 1) return;
        const currentIdx = allCollections.findIndex(c => String(c.id) === String(collectionId));
        if (currentIdx === -1) return;
        const nextIdx = direction === 'next'
            ? (currentIdx + 1) % allCollections.length
            : (currentIdx - 1 + allCollections.length) % allCollections.length;
        const nextCol = allCollections[nextIdx];
        router.replace({
            pathname: `/collection/${nextCol.id}`,
            params: { virtual: nextCol.isVirtual ? 'true' : 'false' }
        });
    };

    useGamepadNavigation({
        onButtonL1: () => {
            cycleCollection('prev');
            return true;
        },
        onButtonR1: () => {
            cycleCollection('next');
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
        onButtonX: () => {
            cycleFilter();
            return true;
        },
        onButtonY: () => {
            cycleSort();
            return true;
        },
    });

    // Dynamic columns based on screen orientation and device size
    const { columns, cardWidth, isLandscape } = useDynamicColumns();

    // Debug platform folders
    useEffect(() => {
        console.log('Platform folders updated:', platformFolders);
    }, [platformFolders]);

    // Fetch collection info and roms
    useEffect(() => {
        console.log('Fetching collection data for ID:', collectionId);
        const fetchData = async () => {
            try {
                console.log('Fetching collection data for ID:', collectionId, 'isVirtual:', isVirtual);
                const collectionData = await apiClient.getCollection(collectionId, isVirtual);
                setCollection(collectionData);
                await fetchRoms();
            } catch (error) {
                console.error('Error fetching collection data:', error);
                showErrorToast(
                    t('unableToLoadCollection'),
                    t('error')
                );
                router.back();
            }
        };

        if (collectionId) {
            fetchData();
        }
    }, [collectionId]);

    // Check filesystem for existing ROMs when ROMs are loaded
    useEffect(() => {
        Promise.all(roms.map(async rom => {
            if (!rom.files || rom.files.length === 0) return;
            const folders = await getAllPlatformFolders({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
            const platformFolder = folders.length > 0 ? folders[0] : await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
            const targetFolders = folders.length > 0 ? folders : (platformFolder ? [platformFolder] : []);
            if (targetFolders.length > 0) {
                Promise.all(rom.files.map(file => refreshRomCheck(file, targetFolders)));
            }
        }));
    }, [roms, platformFolders]);

    // Monitor completed downloads to refresh ROM status in collection view
    useEffect(() => {
        Promise.all(completedDownloads.map(downloadedItem => refreshRomCheck(downloadedItem.romFile, downloadedItem.platformFolder)));
    }, [completedDownloads.length, roms.length]);


    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await fetchRoms();
            console.log('Collection data refreshed, forcing complete ROM check');

            // Force a complete refresh of ROM checks for all ROMs
            setTimeout(async () => {
                if (roms && roms.length > 0) {
                    console.log('Force refreshing all ROM checks in collection');
                    for (const rom of roms) {
                        if (!rom.files || rom.files.length === 0) continue;
                        const platformFolder = await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                        if (!platformFolder) continue;
                        await refreshRomCheck(rom.files[0], platformFolder);
                    }
                    console.log('All collection ROM checks refreshed');
                }
            }, 500); // Small delay to ensure data is updated
        } catch (error) {
            console.error('Error during refresh:', error);
        } finally {
            setRefreshing(false);
        }
    };

    const handleDownload = async (rom: Rom) => {
        if (!rom || !rom.files || rom.files.length === 0) return;

        try {
            await downloadRom(rom, rom.files[0], { name: rom.platform_name, slug: rom.platform_slug } as Platform);
        } catch (error: any) {
            console.error('Download error:', error);

            if (error.type === 'already_downloaded') {
                showInfoToast(error.message, t('fileAlreadyDownloaded'));
            } else {
                const errorMessage = error instanceof Error ? error.message : t('errorDuringDownload');
                showErrorToast(
                    errorMessage,
                    t('downloadError')
                );
            }
        }
    };

    const handleDownloadAll = async () => {
        if (!collection || roms.length === 0) {
            showErrorToast(t('noRomsAvailable'), t('error'));
            return;
        }

        // Get all unique platforms from the collection's ROMs
        const uniquePlatforms = [...new Set(roms.map(rom => ({ name: rom.platform_name, slug: rom.platform_slug } as Platform)))];

        // Check if all platforms have configured folders
        const missingFolders: string[] = [];
        for (const platform of uniquePlatforms) {
            const platformFolder = await searchPlatformFolder(platform);
            if (!platformFolder) {
                const missingFolderRom = roms.find(rom => rom.platform_slug === platform?.slug);
                if (missingFolderRom) {
                    missingFolders.push(platform.name);
                }
            }
        }

        if (missingFolders.length > 0) {
            Alert.alert(
                t('error'),
                t('selectFolderFirst', { platform: missingFolders.join(', ') }),
                [{ text: t('ok'), style: 'default' }]
            );
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
            `Download ${romsToDownload.length} games (${formatBytes(totalBatchBytes)}) from ${collection.name}?\n\nAvailable device storage: ${formatBytes(check.freeBytes)}`,
            [
                { text: t('cancel'), style: 'cancel' },
                {
                    text: t('downloadAll'),
                    onPress: async () => {
                        setIsDownloadingAll(true);
                        try {
                            // Add all ROMs to download queue with their respective platform folders
                            for (const rom of romsToDownload) {
                                const platformFolder = await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as Platform);
                                if (platformFolder) {
                                    addRomToQueue(rom, rom.files[0], platformFolder);
                                }
                            }

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

    const handleCardPress = useCallback((id: number) => {
        router.push(`/game/${id}`);
    }, []);

    const renderRomItem = useCallback(({ item, index }: { item: Rom & { isEmpty?: boolean }; index: number }) => {
        const files = item.files || [];
        const downloadedCount = files.filter(f => isRomDownloaded(f)).length;
        const isDownloaded = downloadedCount > 0;
        const isDownloading = files.some(f => isRomDownloading(f));
        const isChecking = files.some(f => isCheckingRom(f));

        return (
            <RomCardItem
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
                onFocus={() => updateBackdrop({ imageUrl: item.url_cover, platformSlug: item.platform_slug })}
            />
        );
    }, [cardWidth, isRomDownloaded, isRomDownloading, isCheckingRom, isFavorite, handleDownload, handleCardPress]);

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

    if (loading && !collection) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>{t('loadingCollection')}</Text>
            </View>
        );
    }

    // Footer component for loading more items
    const renderFooter = () => {
        if (!loadingMore) return null;

        return (
            <View style={styles.loadingFooter}>
                <ActivityIndicator size="small" color="#5f43b2" />
                <Text style={styles.loadingFooterText}>{t('loadingMore')}</Text>
            </View>
        );
    };

    // Handle end reached for infinite scroll
    const handleEndReached = () => {
        if (hasMore && !loadingMore && !loading) {
            console.log('Loading more ROMs...');
            loadMoreRoms();
        }
    };

    // Calculate available ROMs to download
    const availableToDownload = roms.filter(rom => {
        const firstFile = rom.files?.[0];
        if (!firstFile) return false;
        return !isRomDownloading(firstFile) && !isRomDownloaded(firstFile);
    }).length;

    return (
        <ProtectedRoute>
            <View style={styles.container}>
                <DynamicConsoleBackdrop
                    accentColor="#7E22CE"
                />
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <View style={styles.headerTop}>
                        <GamepadFocusable
                            style={styles.backButton}
                            onPress={() => {
                                if (router.canGoBack()) {
                                    router.back();
                                } else {
                                    router.replace('/');
                                }
                            }}
                        >
                            <Ionicons name="arrow-back" size={24} color="#fff" />
                        </GamepadFocusable>
                        <View style={styles.headerInfo}>
                            <Text style={styles.headerTitle} numberOfLines={1}>
                                {collection?.name || t('collection')}
                            </Text>
                            <Text style={styles.headerSubtitle}>
                                {total !== null ? `${roms.length}/${total}` : roms.length} {t('games')}
                            </Text>
                        </View>
                        <View style={styles.headerButtons}>
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

                    {collection?.description && (
                        <Text style={styles.description}>
                            {collection.description}
                        </Text>
                    )}
                </View>

                {/* Roms Grid */}
                <FlatList
                    ref={flatListRef}
                    data={gridData}
                    renderItem={renderRomItem}
                    keyExtractor={(item) => item.id.toString()}
                    numColumns={columns}
                    key={`${columns}-${isLandscape}`} // Force re-render when columns or orientation change
                    columnWrapperStyle={columns > 1 ? styles.row : undefined}
                    contentContainerStyle={styles.gamesContainer}
                    showsVerticalScrollIndicator={false}
                    onScroll={(e) => {
                        scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                    onLayout={(e) => {
                        layoutHeightRef.current = e.nativeEvent.layout.height;
                    }}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            colors={['#5f43b2']}
                            tintColor="#5f43b2"
                        />
                    }
                    ListEmptyComponent={
                        !loading ? (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="library-outline" size={64} color="#666" />
                                <Text style={styles.emptyText}>
                                    {filterMode === 'favorites'
                                        ? 'No favorite games in this collection'
                                        : filterMode === 'downloaded'
                                            ? 'No downloaded games in this collection on your device'
                                            : t('noGamesInCollection')}
                                </Text>
                            </View>
                        ) : null
                    }
                    ListFooterComponent={renderFooter}
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.1}
                    contentInsetAdjustmentBehavior="automatic"
                />

                <DownloadStatusBar onPress={() => router.push('/downloads')} />
                <GamepadHints hints={[
                    { button: 'L1/R1', label: 'Collections' },
                    { button: 'L2/R2', label: 'Page' },
                    { button: 'X', label: `Filter: ${filterMode === 'all' ? 'All' : filterMode === 'downloaded' ? 'Downloaded' : 'Favorites'}` },
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
    loadingText: {
        color: '#fff',
        fontSize: 16,
        marginTop: 10,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    backButton: {
        marginRight: 15,
        padding: 5,
    },
    headerInfo: {
        flex: 1,
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerTitle: {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        color: '#999',
        fontSize: 14,
        marginTop: 2,
    },
    description: {
        color: '#ccc',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
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
    placeholderContainer: {
        width: '100%',
        height: '100%',
        backgroundColor: '#222',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
        borderRadius: 12,
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
        top: 8,
        right: 8,
    },
    downloadButton: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    downloadButtonDisabled: {
        backgroundColor: 'rgba(95, 67, 178, 0.7)',
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
        marginRight: 8,
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
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        color: '#666',
        fontSize: 16,
        textAlign: 'center',
        marginTop: 16,
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

interface RomCardItemProps {
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

const RomCardItem = React.memo(({
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
}: RomCardItemProps) => {
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
                        <Ionicons name="game-controller-outline" size={Math.min(32, cardWidth * 0.2)} color="#666" />
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

                {/* Download Button - Pressable with focusable={false} */}
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
