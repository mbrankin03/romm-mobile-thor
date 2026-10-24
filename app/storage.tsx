import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { GamepadFocusable } from '../components/GamepadFocusable';
import { GamepadHints } from '../components/GamepadHints';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { useToast } from '../contexts/ToastContext';
import { useGamepadNavigation } from '../hooks/useGamepadNavigation';
import { usePlatformFolders } from '../hooks/usePlatformFolders';
import { useRomFileSystem } from '../hooks/useRomFileSystem';
import { apiClient, Platform as ApiPlatform } from '../services/api';
import { hapticService } from '../services/hapticService';
import { soundService } from '../services/soundService';
import {
    deleteInstalledGame,
    formatBytes,
    getStorageOverview,
    InstalledGame,
    scanInstalledGames,
    StorageOverview,
} from '../services/storageService';

type SortOption = 'size' | 'name' | 'platform';

export default function StorageManagerScreen() {
    const { platformFolders } = usePlatformFolders();
    const { resetRomsCheck } = useRomFileSystem();
    const { showSuccessToast, showErrorToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
    const [storageOverview, setStorageOverview] = useState<StorageOverview | null>(null);
    const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
    const [sortBy, setSortBy] = useState<SortOption>('size');
    const [platforms, setPlatforms] = useState<ApiPlatform[]>([]);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [focusedGameId, setFocusedGameId] = useState<string | null>(null);

    const flatListRef = useRef<FlatList>(null);
    const scrollOffsetRef = useRef(0);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            let apiPlatforms: ApiPlatform[] = [];
            try {
                const platData = await apiClient.getPlatforms();
                apiPlatforms = platData || [];
                setPlatforms(apiPlatforms);
            } catch {
                // Fail graceful if offline
            }

            const games = await scanInstalledGames(platformFolders, apiPlatforms);

            // Attempt to enrich games with RomM server ID and cover art if online
            const enrichedGames = await Promise.all(
                games.map(async (game) => {
                    if (apiPlatforms.length > 0) {
                        try {
                            const searchRes = await apiClient.searchRoms(game.cleanTitle, { limit: 1 });
                            if (searchRes?.items && searchRes.items.length > 0) {
                                const match = searchRes.items[0];
                                return {
                                    ...game,
                                    romId: match.id,
                                    coverUrl: match.url_cover,
                                };
                            }
                        } catch {}
                    }
                    return game;
                })
            );

            setInstalledGames(enrichedGames);

            const totalRomsBytes = enrichedGames.reduce((sum, g) => sum + g.totalSizeBytes, 0);
            const overview = await getStorageOverview(totalRomsBytes, enrichedGames.length);
            setStorageOverview(overview);
        } catch (err) {
            console.error('Failed to scan installed ROMs:', err);
            showErrorToast('Failed to scan device storage');
        } finally {
            setLoading(false);
        }
    }, [platformFolders]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const platformBreakdown = useMemo(() => {
        const map = new Map<string, { count: number; bytes: number; name: string }>();
        installedGames.forEach((g) => {
            const current = map.get(g.platformSlug) || { count: 0, bytes: 0, name: g.platformName };
            map.set(g.platformSlug, {
                count: current.count + 1,
                bytes: current.bytes + g.totalSizeBytes,
                name: g.platformName || current.name,
            });
        });
        return Array.from(map.entries()).map(([slug, data]) => ({
            slug,
            ...data,
        }));
    }, [installedGames]);

    const filteredAndSortedGames = useMemo(() => {
        let list = [...installedGames];
        if (selectedPlatform !== 'all') {
            list = list.filter((g) => g.platformSlug === selectedPlatform);
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(
                (g) =>
                    g.name.toLowerCase().includes(q) ||
                    (g.platformName && g.platformName.toLowerCase().includes(q)) ||
                    g.files.some((f) => f.name.toLowerCase().includes(q))
            );
        }

        list.sort((a, b) => {
            if (sortBy === 'size') {
                return b.totalSizeBytes - a.totalSizeBytes;
            } else if (sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                return (a.platformName || '').localeCompare(b.platformName || '');
            }
        });

        return list;
    }, [installedGames, selectedPlatform, sortBy, searchQuery]);

    const selectedBytesTotal = useMemo(() => {
        return installedGames
            .filter((g) => selectedIds.has(g.id))
            .reduce((sum, g) => sum + g.totalSizeBytes, 0);
    }, [installedGames, selectedIds]);

    const toggleSelectGame = useCallback((gameId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(gameId)) {
                next.delete(gameId);
            } else {
                next.add(gameId);
            }
            return next;
        });
        soundService.playFocus();
        hapticService.press();
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        soundService.playBack();
        hapticService.tick();
    }, []);

    const selectAllFiltered = useCallback(() => {
        const next = new Set(filteredAndSortedGames.map((g) => g.id));
        setSelectedIds(next);
        soundService.playSelect();
        hapticService.press();
    }, [filteredAndSortedGames]);

    const handleDeleteSelected = useCallback(async () => {
        const selectedGames = installedGames.filter((g) => selectedIds.has(g.id));
        if (selectedGames.length === 0) return;

        hapticService.warning();
        Alert.alert(
            'Delete Selected ROMs',
            `Are you sure you want to delete all ${selectedGames.length} selected game(s)?\n\nThis will permanently reclaim ${formatBytes(selectedBytesTotal)} of storage on your device.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: `Delete (${formatBytes(selectedBytesTotal)})`,
                    style: 'destructive',
                    onPress: async () => {
                        setLoading(true);
                        let freedTotal = 0;
                        try {
                            for (const game of selectedGames) {
                                const freed = await deleteInstalledGame(game);
                                freedTotal += freed;
                                resetRomsCheck(
                                    game.files.map((f) => ({
                                        file_name: f.name,
                                        rom_id: game.romId || 0,
                                    })) as any
                                );
                            }

                            soundService.playDelete();
                            hapticService.success();

                            setInstalledGames((prev) => prev.filter((g) => !selectedIds.has(g.id)));
                            setSelectedIds(new Set());
                            setStorageOverview((prev) => {
                                if (!prev) return null;
                                return {
                                    ...prev,
                                    romsSpaceBytes: Math.max(0, prev.romsSpaceBytes - freedTotal),
                                    freeSpaceBytes: prev.freeSpaceBytes + freedTotal,
                                    usedSpaceBytes: Math.max(0, prev.usedSpaceBytes - freedTotal),
                                    installedGamesCount: Math.max(0, prev.installedGamesCount - selectedGames.length),
                                };
                            });

                            showSuccessToast(`Reclaimed ${formatBytes(freedTotal)} across ${selectedGames.length} games!`);
                        } catch (err) {
                            console.error('Failed to batch delete games:', err);
                            showErrorToast('Failed to delete some games');
                        } finally {
                            setLoading(false);
                        }
                    },
                },
            ]
        );
    }, [installedGames, selectedIds, selectedBytesTotal, resetRomsCheck, showSuccessToast, showErrorToast]);

    const handleDeleteGame = useCallback(
        (game: InstalledGame) => {
            hapticService.warning();
            Alert.alert(
                'Delete ROM from Device',
                `Are you sure you want to delete "${game.name}"?\n\nThis will remove all ${game.files.length} file(s) and permanently free up ${formatBytes(game.totalSizeBytes)} of storage.`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                            setDeletingId(game.id);
                            try {
                                const freedBytes = await deleteInstalledGame(game);
                                soundService.playDelete();
                                hapticService.press();

                                // Update local state immediately
                                setInstalledGames((prev) => prev.filter((g) => g.id !== game.id));
                                setStorageOverview((prev) => {
                                    if (!prev) return null;
                                    const newRomsBytes = Math.max(0, prev.romsSpaceBytes - freedBytes);
                                    const newFreeBytes = prev.freeSpaceBytes + freedBytes;
                                    const newUsedBytes = Math.max(0, prev.usedSpaceBytes - freedBytes);
                                    return {
                                        ...prev,
                                        romsSpaceBytes: newRomsBytes,
                                        freeSpaceBytes: newFreeBytes,
                                        usedSpaceBytes: newUsedBytes,
                                        installedGamesCount: Math.max(0, prev.installedGamesCount - 1),
                                    };
                                });

                                // Reset check in cache for this game's files
                                resetRomsCheck(
                                    game.files.map((f) => ({
                                        file_name: f.name,
                                        rom_id: game.romId || 0,
                                    })) as any
                                );

                                showSuccessToast(`Deleted ${game.name} (+${formatBytes(freedBytes)} freed)`);
                            } catch (err) {
                                console.error('Failed to delete game:', err);
                                showErrorToast('Failed to delete game files');
                            } finally {
                                setDeletingId(null);
                            }
                        },
                    },
                ]
            );
        },
        [resetRomsCheck, showSuccessToast, showErrorToast]
    );

    const handleInspectGame = useCallback((game: InstalledGame) => {
        if (game.romId) {
            router.push(`/game/${game.romId}`);
        } else {
            router.push(`/search?q=${encodeURIComponent(game.cleanTitle)}`);
        }
    }, []);

    // Gamepad platform chip cycling
    const cyclePlatform = useCallback(
        (direction: 'next' | 'prev') => {
            const availableSlugs = ['all', ...platformBreakdown.map((p) => p.slug)];
            const currentIndex = availableSlugs.indexOf(selectedPlatform);
            let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
            if (nextIndex >= availableSlugs.length) nextIndex = 0;
            if (nextIndex < 0) nextIndex = availableSlugs.length - 1;
            setSelectedPlatform(availableSlugs[nextIndex]);
            soundService.playTab();
            hapticService.tick();
        },
        [selectedPlatform, platformBreakdown]
    );

    const handlePageDown = useCallback(() => {
        scrollOffsetRef.current += 400;
        flatListRef.current?.scrollToOffset({
            offset: scrollOffsetRef.current,
            animated: true,
        });
        soundService.playFocus();
        hapticService.tick();
        return true;
    }, []);

    const handlePageUp = useCallback(() => {
        scrollOffsetRef.current = Math.max(0, scrollOffsetRef.current - 400);
        flatListRef.current?.scrollToOffset({
            offset: scrollOffsetRef.current,
            animated: true,
        });
        soundService.playFocus();
        hapticService.tick();
        return true;
    }, []);

    useGamepadNavigation({
        onBack: () => {
            if (selectedIds.size > 0) {
                clearSelection();
                return true;
            }
            router.back();
            return true;
        },
        onButtonB: () => {
            if (selectedIds.size > 0) {
                clearSelection();
                return true;
            }
            router.back();
            return true;
        },
        onButtonX: () => {
            if (focusedGameId) {
                toggleSelectGame(focusedGameId);
                return true;
            }
            return false;
        },
        onButtonY: () => {
            if (selectedIds.size > 0) {
                handleDeleteSelected();
                return true;
            }
            return false;
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

    const renderGameItem = ({ item }: { item: InstalledGame }) => {
        const isDeleting = deletingId === item.id;
        const isSelected = selectedIds.has(item.id);

        return (
            <GamepadFocusable
                style={[styles.gameCard, isSelected && styles.gameCardSelected]}
                glowColor={isSelected ? '#00E5FF' : '#38BDF8'}
                focusScale={1.01}
                onPress={() => {
                    if (selectedIds.size > 0) {
                        toggleSelectGame(item.id);
                    } else {
                        handleInspectGame(item);
                    }
                }}
                onFocus={() => setFocusedGameId(item.id)}
            >
                <TouchableOpacity
                    style={styles.selectCheckbox}
                    onPress={() => toggleSelectGame(item.id)}
                >
                    <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isSelected ? '#00E5FF' : '#4B5563'}
                    />
                </TouchableOpacity>

                <View style={styles.gameCardLeft}>
                    {item.coverUrl ? (
                        <Image source={{ uri: item.coverUrl }} style={styles.gameCover} />
                    ) : (
                        <View style={styles.gameCoverPlaceholder}>
                            <Ionicons name="game-controller-outline" size={28} color="#666" />
                        </View>
                    )}
                    <View style={styles.gameInfo}>
                        <Text style={styles.gameTitle} numberOfLines={1}>
                            {item.name}
                        </Text>
                        <View style={styles.metaRow}>
                            <View style={styles.platformBadge}>
                                <Text style={styles.platformBadgeText}>{item.platformName || item.platformSlug}</Text>
                            </View>
                            {item.isMultiFile && (
                                <View style={styles.multiFileBadge}>
                                    <Ionicons name="layers-outline" size={12} color="#38BDF8" />
                                    <Text style={styles.multiFileText}>{item.files.length} Files</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.filePathText} numberOfLines={1}>
                            {item.files[0]?.name || ''}
                        </Text>
                    </View>
                </View>

                <View style={styles.gameCardRight}>
                    <View style={styles.sizePill}>
                        <Text style={styles.sizePillText}>{formatBytes(item.totalSizeBytes)}</Text>
                    </View>
                    <GamepadFocusable
                        style={styles.deleteButton}
                        glowColor="#EF4444"
                        onPress={() => handleDeleteGame(item)}
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <ActivityIndicator size="small" color="#EF4444" />
                        ) : (
                            <Ionicons name="trash-outline" size={20} color="#EF4444" />
                        )}
                    </GamepadFocusable>
                </View>
            </GamepadFocusable>
        );
    };

    return (
        <ProtectedRoute>
            <SafeAreaView style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <GamepadFocusable
                        style={styles.backButton}
                        onPress={() => router.back()}
                    >
                        <Ionicons name="arrow-back" size={24} color="#fff" />
                    </GamepadFocusable>
                    <View style={styles.headerTitleWrap}>
                        <Text style={styles.headerTitle}>Storage Manager</Text>
                        <Text style={styles.headerSubtitle}>
                            {storageOverview
                                ? `${formatBytes(storageOverview.romsSpaceBytes)} in ${installedGames.length} games • ${formatBytes(storageOverview.freeSpaceBytes)} free`
                                : 'Scanning on-device ROMs...'}
                        </Text>
                    </View>
                    <GamepadFocusable
                        style={styles.refreshButton}
                        onPress={loadData}
                        disabled={loading}
                    >
                        <Ionicons name="refresh" size={22} color="#00E5FF" />
                    </GamepadFocusable>
                </View>

                {/* Search Bar */}
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color="#9CA3AF" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search installed games by title, platform, filename..."
                        placeholderTextColor="#6B7280"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        clearButtonMode="while-editing"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Multi-Select Action Bar */}
                {selectedIds.size > 0 && (
                    <View style={styles.selectionToolbar}>
                        <View style={styles.selectionToolbarLeft}>
                            <Ionicons name="checkmark-circle" size={20} color="#00E5FF" />
                            <Text style={styles.selectionCountText}>
                                {selectedIds.size} selected ({formatBytes(selectedBytesTotal)})
                            </Text>
                        </View>
                        <View style={styles.selectionToolbarActions}>
                            <TouchableOpacity
                                style={styles.selectAllBtn}
                                onPress={selectAllFiltered}
                            >
                                <Text style={styles.selectAllText}>Select All ({filteredAndSortedGames.length})</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.cancelSelectionBtn}
                                onPress={clearSelection}
                            >
                                <Text style={styles.cancelSelectionText}>Clear</Text>
                            </TouchableOpacity>
                            <GamepadFocusable
                                style={styles.deleteSelectionBtn}
                                glowColor="#EF4444"
                                onPress={handleDeleteSelected}
                            >
                                <Ionicons name="trash" size={15} color="#fff" />
                                <Text style={styles.deleteSelectionText}>Delete Selected</Text>
                            </GamepadFocusable>
                        </View>
                    </View>
                )}

                {/* Storage Gauge Bar */}
                {storageOverview && storageOverview.totalSpaceBytes > 0 && (
                    <View style={styles.storageOverviewCard}>
                        <View style={styles.gaugeHeader}>
                            <View style={styles.gaugeLegendItem}>
                                <View style={[styles.gaugeDot, { backgroundColor: '#00E5FF' }]} />
                                <Text style={styles.gaugeLegendText}>
                                    ROMs ({formatBytes(storageOverview.romsSpaceBytes)})
                                </Text>
                            </View>
                            <View style={styles.gaugeLegendItem}>
                                <View style={[styles.gaugeDot, { backgroundColor: '#6B7280' }]} />
                                <Text style={styles.gaugeLegendText}>
                                    Other ({formatBytes(Math.max(0, storageOverview.usedSpaceBytes - storageOverview.romsSpaceBytes))})
                                </Text>
                            </View>
                            <View style={styles.gaugeLegendItem}>
                                <View style={[styles.gaugeDot, { backgroundColor: '#34C759' }]} />
                                <Text style={styles.gaugeLegendText}>
                                    Free ({formatBytes(storageOverview.freeSpaceBytes)})
                                </Text>
                            </View>
                        </View>
                        <View style={styles.gaugeTrack}>
                            <View
                                style={[
                                    styles.gaugeFillRoms,
                                    {
                                        width: `${Math.min(100, Math.max(1, Math.round((storageOverview.romsSpaceBytes / storageOverview.totalSpaceBytes) * 100)))}%`,
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.gaugeFillOther,
                                    {
                                        width: `${Math.min(100, Math.max(1, Math.round((Math.max(0, storageOverview.usedSpaceBytes - storageOverview.romsSpaceBytes) / storageOverview.totalSpaceBytes) * 100)))}%`,
                                    },
                                ]}
                            />
                        </View>
                    </View>
                )}

                {/* Platform Filter Chips & Sort Bar */}
                <View style={styles.filterSection}>
                    <FlatList
                        horizontal
                        data={['all', ...platformBreakdown.map((p) => p.slug)]}
                        keyExtractor={(item) => item}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipsContainer}
                        renderItem={({ item: slug }) => {
                            const isSelected = selectedPlatform === slug;
                            const platformData = platformBreakdown.find((p) => p.slug === slug);
                            const label =
                                slug === 'all'
                                    ? `All (${formatBytes(storageOverview?.romsSpaceBytes || 0)})`
                                    : `${platformData?.name || slug} (${formatBytes(platformData?.bytes || 0)})`;

                            return (
                                <TouchableOpacity
                                    style={[styles.chip, isSelected && styles.chipActive]}
                                    onPress={() => {
                                        setSelectedPlatform(slug);
                                        soundService.playFocus();
                                        hapticService.tick();
                                    }}
                                >
                                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                                        {label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        }}
                    />

                    {/* Sort Selector */}
                    <View style={styles.sortRow}>
                        <Text style={styles.sortLabel}>Sort by:</Text>
                        <TouchableOpacity
                            style={[styles.sortPill, sortBy === 'size' && styles.sortPillActive]}
                            onPress={() => setSortBy('size')}
                        >
                            <Text style={[styles.sortPillText, sortBy === 'size' && styles.sortPillTextActive]}>
                                Largest First
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.sortPill, sortBy === 'name' && styles.sortPillActive]}
                            onPress={() => setSortBy('name')}
                        >
                            <Text style={[styles.sortPillText, sortBy === 'name' && styles.sortPillTextActive]}>
                                Name
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Games List */}
                {loading ? (
                    <View style={styles.centered}>
                        <ActivityIndicator size="large" color="#00E5FF" />
                        <Text style={styles.loadingText}>Scanning installed ROMs...</Text>
                    </View>
                ) : filteredAndSortedGames.length === 0 ? (
                    <View style={styles.centered}>
                        <Ionicons name="file-tray-outline" size={64} color="#666" />
                        <Text style={styles.emptyTitle}>No ROMs Found</Text>
                        <Text style={styles.emptySubtitle}>
                            {selectedPlatform !== 'all'
                                ? 'No games found for this platform.'
                                : 'No downloaded ROMs detected in your configured platform folders.'}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={filteredAndSortedGames}
                        keyExtractor={(item) => item.id}
                        renderItem={renderGameItem}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                    />
                )}

                <GamepadHints
                    hints={
                        selectedIds.size > 0
                            ? [
                                  { button: 'X', label: 'Toggle' },
                                  { button: 'Y', label: 'Delete Selected' },
                                  { button: 'B', label: 'Clear' },
                              ]
                            : [
                                  { button: 'L1/R1', label: 'Platform' },
                                  { button: 'L2/R2', label: 'Page' },
                                  { button: 'X', label: 'Select' },
                                  { button: 'A', label: 'Inspect' },
                                  { button: 'B', label: 'Back' },
                              ]
                    }
                />
            </SafeAreaView>
        </ProtectedRoute>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0c',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
        gap: 12,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        color: '#94a3b8',
        fontSize: 12,
        marginTop: 2,
    },
    refreshButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        marginHorizontal: 16,
        marginTop: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        gap: 8,
    },
    searchInput: {
        flex: 1,
        color: '#fff',
        fontSize: 13,
        padding: 0,
    },
    selectionToolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
        marginHorizontal: 16,
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 229, 255, 0.3)',
    },
    selectionToolbarLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    selectionCountText: {
        color: '#00E5FF',
        fontSize: 13,
        fontWeight: 'bold',
    },
    selectionToolbarActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    selectAllBtn: {
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    selectAllText: {
        color: '#E2E8F0',
        fontSize: 11,
    },
    cancelSelectionBtn: {
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    cancelSelectionText: {
        color: '#9CA3AF',
        fontSize: 11,
    },
    deleteSelectionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#EF4444',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    deleteSelectionText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    storageOverviewCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        marginHorizontal: 16,
        marginTop: 10,
        marginBottom: 8,
        padding: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    gaugeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    gaugeLegendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    gaugeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    gaugeLegendText: {
        color: '#cbd5e1',
        fontSize: 11,
        fontWeight: '500',
    },
    gaugeTrack: {
        height: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 4,
        flexDirection: 'row',
        overflow: 'hidden',
    },
    gaugeFillRoms: {
        backgroundColor: '#00E5FF',
        height: '100%',
    },
    gaugeFillOther: {
        backgroundColor: '#6B7280',
        height: '100%',
    },
    filterSection: {
        paddingVertical: 6,
    },
    chipsContainer: {
        paddingHorizontal: 16,
        gap: 8,
    },
    chip: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    chipActive: {
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
        borderColor: '#00E5FF',
    },
    chipText: {
        color: '#94a3b8',
        fontSize: 12,
        fontWeight: '500',
    },
    chipTextActive: {
        color: '#00E5FF',
        fontWeight: 'bold',
    },
    sortRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginTop: 8,
        gap: 8,
    },
    sortLabel: {
        color: '#64748b',
        fontSize: 12,
    },
    sortPill: {
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    sortPillActive: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    sortPillText: {
        color: '#94a3b8',
        fontSize: 11,
    },
    sortPillTextActive: {
        color: '#fff',
        fontWeight: 'bold',
    },
    listContent: {
        padding: 16,
        gap: 10,
        paddingBottom: 40,
    },
    gameCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    gameCardSelected: {
        borderColor: '#00E5FF',
        backgroundColor: 'rgba(0, 229, 255, 0.08)',
    },
    selectCheckbox: {
        paddingRight: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gameCardLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    gameCover: {
        width: 48,
        height: 64,
        borderRadius: 6,
        backgroundColor: '#1f2937',
    },
    gameCoverPlaceholder: {
        width: 48,
        height: 64,
        borderRadius: 6,
        backgroundColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
    },
    gameInfo: {
        flex: 1,
    },
    gameTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,
    },
    platformBadge: {
        backgroundColor: 'rgba(0, 229, 255, 0.12)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    platformBadgeText: {
        color: '#00E5FF',
        fontSize: 10,
        fontWeight: '600',
    },
    multiFileBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    multiFileText: {
        color: '#38BDF8',
        fontSize: 10,
        fontWeight: '600',
    },
    filePathText: {
        color: '#64748b',
        fontSize: 11,
    },
    gameCardRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 8,
    },
    sizePill: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    sizePillText: {
        color: '#E2E8F0',
        fontSize: 12,
        fontWeight: 'bold',
    },
    deleteButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 30,
    },
    loadingText: {
        color: '#00E5FF',
        fontSize: 14,
        marginTop: 12,
    },
    emptyTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
    },
    emptySubtitle: {
        color: '#94a3b8',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 18,
    },
});
