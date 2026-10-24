import { useRomDownload } from '@/hooks/useRomDownload';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    Image,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DynamicConsoleBackdrop, updateBackdrop } from '../components/DynamicConsoleBackdrop';
import { GamepadFocusable } from '../components/GamepadFocusable';
import { GamepadHints } from '../components/GamepadHints';
import { useGamepadNavigation } from '../hooks/useGamepadNavigation';
import { BaseFolderModal } from '../components/BaseFolderModal';
import { CollectionCoverGrid } from '../components/CollectionCoverGrid';
import { DownloadStatusBar } from '../components/DownloadStatusBar';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { useDownload } from '../contexts/DownloadContext';
import { useToast } from '../contexts/ToastContext';
import { useAuthCheck, useLogout } from '../hooks/useAuth';
import { useCollections } from '../hooks/useCollections';
import { usePlatformFolders } from '../hooks/usePlatformFolders';
import { useRomFileSystem } from '../hooks/useRomFileSystem';
import { usePlatforms, useRoms } from '../hooks/useRoms';
import { useStorageAccessFramework } from '../hooks/useStorageAccessFramework';
import { useTranslation } from '../hooks/useTranslation';
import { apiClient, Platform as ApiPlatform, Collection, CollectionType, Rom } from '../services/api';
import { updateService } from '../services/updateService';
import { notificationService } from '../services/notificationService';
import { useFavorites } from '../services/favoritesService';
import * as FileSystem from 'expo-file-system/legacy';
import { detectDefaultRomFolder } from '../services/storageService';
import { soundService } from '../services/soundService';
import { hapticService } from '../services/hapticService';

const { width } = Dimensions.get('window');

export default function LibraryScreen() {
    const { t } = useTranslation();
    const { platforms, loading, error, fetchPlatforms } = usePlatforms(false); // Don't auto-fetch
    const { userCollections, generatedCollections, loading: collectionsLoading, error: collectionsError, fetchCollections, getCollectionTypeName } = useCollections(false);
    const { recentlyAddedRoms, fetchRecentlyAddedRoms } = useRoms();
    const { favoriteRoms, isFavorite, refreshMissingRoms } = useFavorites();
    const { user, username, isAuthenticated } = useAuthCheck();
    const { logout, isLoading: isLoggingOut } = useLogout();
    const { showErrorToast, showInfoToast, showSuccessToast } = useToast();
    const [refreshing, setRefreshing] = useState(false);
    const [recentRomsLoading, setRecentRomsLoading] = useState(false);
    const { activeDownloads, isRomDownloading, completedDownloads } = useDownload();
    const { downloadRom } = useRomDownload();
    const { searchPlatformFolder, hasBaseFolder, canAccessBaseFolder, setBaseFolder, removeAllPlatformFolders } = usePlatformFolders();
    const { requestDirectoryPermissions } = useStorageAccessFramework();
    const { resetRomsCheck, refreshRomCheck, isRomDownloaded, isCheckingRom } = useRomFileSystem();
    const insets = useSafeAreaInsets();
    const [showBaseFolderModal, setShowBaseFolderModal] = useState(false);
    const [baseFolderChecked, setBaseFolderChecked] = useState(false);
    type TabType = 'platforms' | 'favorites' | 'recent' | 'collections';
    const [activeTab, setActiveTab] = useState<TabType>('platforms');
    const tabs: TabType[] = ['platforms', 'favorites', 'recent', 'collections'];

    useEffect(() => {
        if (activeTab === 'collections') {
            updateBackdrop({ imageUrl: null, platformSlug: null, accentColor: '#7E22CE' }, true);
        } else if (activeTab === 'favorites') {
            updateBackdrop({ imageUrl: null, platformSlug: null, accentColor: '#EAB308' }, true);
            refreshMissingRoms();
        } else {
            updateBackdrop({ imageUrl: null, platformSlug: null, accentColor: null }, true);
        }
    }, [activeTab]);

    const [currentTime, setCurrentTime] = useState<string>(() => {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    });
    const [batteryInfo, setBatteryInfo] = useState<{ level: number; isCharging: boolean } | null>(null);

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
        };
        const timer = setInterval(updateTime, 10000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const fetchBattery = async () => {
            const status = await notificationService.getBatteryStatus();
            if (status) {
                setBatteryInfo(status);
            }
        };
        fetchBattery();
        const batteryTimer = setInterval(fetchBattery, 30000);
        return () => clearInterval(batteryTimer);
    }, []);

    const [hasStoragePerm, setHasStoragePerm] = useState<boolean>(true);
    const [detectedRomFolder, setDetectedRomFolder] = useState<string | null>(null);

    const checkStorageAndFolderSetup = useCallback(async () => {
        if (Platform.OS === 'android') {
            const hasPerm = await notificationService.hasManageStoragePermission();
            setHasStoragePerm(hasPerm);

            if (hasPerm) {
                const configured = await hasBaseFolder();
                if (!configured) {
                    const detected = await detectDefaultRomFolder();
                    setDetectedRomFolder(detected);
                } else {
                    setDetectedRomFolder(null);
                }
            }
        }
    }, [hasBaseFolder]);

    useEffect(() => {
        checkStorageAndFolderSetup();
    }, [checkStorageAndFolderSetup]);

    const handleGrantStoragePermission = async () => {
        hapticService.press();
        await notificationService.openManageStorageSettings();
    };

    const handleApplyDetectedFolder = async () => {
        if (detectedRomFolder) {
            await setBaseFolder(detectedRomFolder);
            showSuccessToast(`Base folder configured: ${detectedRomFolder}`, 'Folder Setup');
            setDetectedRomFolder(null);
            soundService.playComplete();
            hapticService.success();
        }
    };

    const loadRecentRoms = async (needResetRom: boolean = false) => {
        await fetchRecentlyAddedRoms();
        if (recentlyAddedRoms && recentlyAddedRoms.length > 0) {
            if (needResetRom) {
                resetRomsCheck(recentlyAddedRoms.map(rom => rom.files[0]));
            }
            await Promise.all(recentlyAddedRoms.map(async rom => {
                const platformFolder = await searchPlatformFolder({ name: rom.platform_name, slug: rom.platform_slug } as ApiPlatform);
                if (!platformFolder) return;
                refreshRomCheck(rom.files[0], platformFolder);
            }));
        }
    };

    // Function for refresh
    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                fetchPlatforms(),
                fetchCollections(),
                loadRecentRoms(true),
            ]);

            // Also check for app updates on refresh (Android only)
            checkForAppUpdates();

            console.log('Refresh completed');
            setRefreshing(false);

        } catch (error) {
            console.error('Error during refresh:', error);
        } finally {
            setRefreshing(false);
        }
    };

    // Fetch platforms only after authentication is verified
    useEffect(() => {
        console.log('isAuthenticated:', isAuthenticated);
        if (isAuthenticated) {

            Promise.all([
                fetchPlatforms(),
                fetchCollections(),
                loadRecentRoms(true)
            ]);

            // Check for app updates when entering the library (Android only)
            checkForAppUpdates();
        }
    }, [isAuthenticated]);

    useEffect(() => {
        resetRomsCheck(recentlyAddedRoms.map(rom => rom.files[0]));
    }, []);

    // Check for base folder when authenticated
    useEffect(() => {
        const checkBaseFolderRequired = async () => {
            if (isAuthenticated && !baseFolderChecked) {
                try {
                    const canAccessBase = await canAccessBaseFolder();
                    if (!canAccessBase) {
                        if(Platform.OS === 'android') {
                            setShowBaseFolderModal(true);
                        }
                        else {
                            // Create automatically base folder for iOS
                            const folderUri = await requestDirectoryPermissions();

                            if (folderUri) {
                                await removeAllPlatformFolders();
                                await setBaseFolder(folderUri);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error checking base folder:', error);
                } finally {
                    setBaseFolderChecked(true);
                }
            }
        };

        checkBaseFolderRequired();
    }, [FileSystem.documentDirectory, canAccessBaseFolder]);

    // // Check filesystem for existing ROMs when recently added ROMs are loaded
    // useEffect(() => {
    //     const checkRecentRomFolders = async () => {
    //         if (recentlyAddedRoms && recentlyAddedRoms.length > 0) {
    //             for (const rom of recentlyAddedRoms) {
    //                 //await refreshRomCheck(rom);
    //             }
    //         }
    //     };
    //     checkRecentRomFolders();
    // }, [recentlyAddedRoms, platformFolders, refreshRomCheck]);

    // Monitor completed downloads to refresh ROM status
    useEffect(() => {
        Promise.all(completedDownloads.map(downloadedItem => refreshRomCheck(downloadedItem.romFile, downloadedItem.platformFolder)));
    }, [completedDownloads.length]);

    const handleLogout = async () => {
        Alert.alert(
            t('logoutAction'),
            t('confirmLogout'),
            [
                {
                    text: t('cancel'),
                    style: 'cancel',
                },
                {
                    text: t('exit'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await AsyncStorage.clear();
                            await logout();
                        } catch (error) {
                            console.error('Logout error:', error);
                        }
                    },
                },
            ],
        );
    };

    // Show error if API call fails
    useEffect(() => {
        if (error || collectionsError) {
            showErrorToast(
                t('unableToLoadData'),
                t('error')
            );
        }
    }, [error, collectionsError, showErrorToast, t]);

    const handleDownload = async (rom: Rom) => {
        if (!rom || !rom.files || rom.files.length === 0) return;

        try {
            await downloadRom(rom, rom.files[0], { name: rom.platform_name, slug: rom.platform_slug } as ApiPlatform);

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

    const handleBaseFolderComplete = () => {
        setShowBaseFolderModal(false);
        setBaseFolderChecked(true);
    };

    const switchTab = (direction: 'next' | 'prev') => {
        setActiveTab(current => {
            const idx = tabs.indexOf(current);
            if (direction === 'next') {
                return tabs[(idx + 1) % tabs.length];
            } else {
                return tabs[(idx - 1 + tabs.length) % tabs.length];
            }
        });
    };

    useGamepadNavigation({
        onButtonL1: () => {
            switchTab('prev');
            return true;
        },
        onButtonR1: () => {
            switchTab('next');
            return true;
        },
    });

    const handlePlatformFocus = useCallback((p: ApiPlatform) => {
        updateBackdrop({ platformSlug: p.slug, imageUrl: null, accentColor: null });
    }, []);

    const handleRomFocus = useCallback((r: Rom) => {
        updateBackdrop({ imageUrl: r.url_cover, platformSlug: r.platform_slug, accentColor: null });
    }, []);

    const handleCollectionFocus = useCallback((_c: Collection) => {
        updateBackdrop({ imageUrl: null, platformSlug: null, accentColor: '#7E22CE' });
    }, []);

    const handlePlatformPress = useCallback((id: number) => {
        router.push(`/platform/${id}`);
    }, []);

    const handleCollectionPress = useCallback((col: Collection) => {
        router.push(`/collection/${col.id}?virtual=${col.is_virtual}`);
    }, []);

    const handleRomPress = useCallback((id: number) => {
        router.push(`/game/${id}`);
    }, []);

    // Function to check for app updates (Android only)
    const checkForAppUpdates = async () => {
        if (Platform.OS !== 'android') return;

        try {
            // Check if app updates are enabled
            const updatesEnabled = await AsyncStorage.getItem('appUpdatesEnabled');
            const isEnabled = updatesEnabled !== null ? JSON.parse(updatesEnabled) : true;

            if (!isEnabled) return;

            // Check for updates silently in the background
            const release = await updateService.checkForUpdates();
            if (release) {
                // Show a toast notification about the available update
                showSuccessToast(
                    t('updateAvailable'),
                    t('settings')
                );
            }
        } catch (error) {
            // Silent fail for library screen update check
            console.log('Library screen update check failed:', error);
        }
    };

    useEffect(() => {
        checkForAppUpdates();
    }, [isAuthenticated]);

    if (loading && collectionsLoading) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.loadingText}>{t('loading')}</Text>
            </View>
        );
    }

    return (
        <ProtectedRoute>
            <View style={styles.container}>
                <DynamicConsoleBackdrop />
                <ScrollView
                    style={styles.content}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            colors={['#5f43b2']} // Android
                            tintColor="#5f43b2" // iOS
                        />
                    }
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.headerTop}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.headerTitle}>{t('library')}</Text>
                                {username && (
                                    <Text style={styles.welcomeText}>
                                        {t('welcomeUser', { username })}
                                    </Text>
                                )}
                            </View>
                            <View style={styles.consoleStatusPill}>
                                <Ionicons
                                    name={batteryInfo?.isCharging ? 'battery-charging-outline' : 'battery-full-outline'}
                                    size={15}
                                    color={batteryInfo?.isCharging ? '#34C759' : '#00E5FF'}
                                />
                                {batteryInfo && batteryInfo.level >= 0 && (
                                    <Text style={styles.consoleStatusText}>
                                        {batteryInfo.level}%
                                    </Text>
                                )}
                                <Text style={styles.consoleStatusDivider}>•</Text>
                                <Text style={styles.consoleStatusText}>{currentTime}</Text>
                            </View>
                            <View style={styles.headerButtons}>
                                <GamepadFocusable
                                    style={styles.headerButton}
                                    glowColor="#00E5FF"
                                    focusScale={1.1}
                                    onPress={() => router.push('/search')}
                                >
                                    <Ionicons name="search-outline" size={24} color="#fff" />
                                </GamepadFocusable>
                                <GamepadFocusable
                                    style={[styles.headerButton, activeDownloads.length > 0 && styles.downloadButtonActive]}
                                    glowColor="#38BDF8"
                                    focusScale={1.1}
                                    onPress={() => router.push('/downloads')}
                                >
                                    <Ionicons name="download-outline" size={24} color="#fff" />
                                    {activeDownloads.length > 0 && (
                                        <View style={styles.downloadBadge}>
                                            <Text style={styles.downloadBadgeText}>
                                                {activeDownloads.length}
                                            </Text>
                                        </View>
                                    )}
                                </GamepadFocusable>
                                <GamepadFocusable
                                    style={styles.headerButton}
                                    glowColor="#10B981"
                                    focusScale={1.1}
                                    onPress={() => router.push('/storage')}
                                >
                                    <Ionicons name="hardware-chip-outline" size={24} color="#fff" />
                                </GamepadFocusable>
                                <GamepadFocusable
                                    style={styles.headerButton}
                                    glowColor="#EAB308"
                                    focusScale={1.1}
                                    onPress={() => router.push('/settings')}
                                >
                                    <Ionicons name="settings-outline" size={24} color="#fff" />
                                </GamepadFocusable>
                                <GamepadFocusable
                                    style={styles.headerButton}
                                    glowColor="#EF4444"
                                    focusScale={1.1}
                                    onPress={handleLogout}
                                    disabled={isLoggingOut}
                                >
                                    {isLoggingOut ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Ionicons name="log-out-outline" size={24} color="#fff" />
                                    )}
                                </GamepadFocusable>
                            </View>
                        </View>
                    </View>


                    {/* Setup / Onboarding Banners */}
                    {!hasStoragePerm && (
                        <View style={styles.setupBanner}>
                            <View style={styles.setupBannerLeft}>
                                <Ionicons name="folder-open-outline" size={24} color="#F59E0B" />
                                <View style={styles.setupBannerTextContainer}>
                                    <Text style={styles.setupBannerTitle}>Storage Access Required</Text>
                                    <Text style={styles.setupBannerSubtitle}>
                                        RomM requires All Files Access to write ROMs directly to your device storage.
                                    </Text>
                                </View>
                            </View>
                            <GamepadFocusable
                                style={styles.setupBannerButton}
                                glowColor="#F59E0B"
                                onPress={handleGrantStoragePermission}
                            >
                                <Text style={styles.setupBannerButtonText}>Grant Access</Text>
                            </GamepadFocusable>
                        </View>
                    )}

                    {hasStoragePerm && detectedRomFolder && (
                        <View style={[styles.setupBanner, styles.setupBannerSuccess]}>
                            <View style={styles.setupBannerLeft}>
                                <Ionicons name="checkmark-circle-outline" size={24} color="#10B981" />
                                <View style={styles.setupBannerTextContainer}>
                                    <Text style={styles.setupBannerTitle}>ROMs Folder Detected</Text>
                                    <Text style={styles.setupBannerSubtitle}>
                                        Found {detectedRomFolder}. Set as your base ROM directory?
                                    </Text>
                                </View>
                            </View>
                            <GamepadFocusable
                                style={[styles.setupBannerButton, styles.setupBannerButtonSuccess]}
                                glowColor="#10B981"
                                onPress={handleApplyDetectedFolder}
                            >
                                <Text style={styles.setupBannerButtonText}>Set Folder</Text>
                            </GamepadFocusable>
                        </View>
                    )}

                    {/* Console Tab Switcher with L1/R1 */}
                    <View style={styles.tabBarContainer}>
                        <View style={styles.tabShoulderPill}>
                            <Text style={styles.shoulderText}>L1</Text>
                        </View>
                        <View style={styles.tabsRow}>
                            <GamepadFocusable
                                style={[styles.tabButton, activeTab === 'platforms' && styles.tabButtonActive]}
                                glowColor="#00E5FF"
                                focusScale={1.05}
                                onPress={() => setActiveTab('platforms')}
                            >
                                <Ionicons
                                    name="game-controller"
                                    size={16}
                                    color={activeTab === 'platforms' ? '#00E5FF' : '#888'}
                                />
                                <Text style={[styles.tabButtonText, activeTab === 'platforms' && styles.tabButtonTextActive]}>
                                    {t('platformsSection')}
                                </Text>
                            </GamepadFocusable>

                            <GamepadFocusable
                                style={[styles.tabButton, activeTab === 'favorites' && styles.tabButtonActive]}
                                glowColor="#FFD700"
                                focusScale={1.05}
                                onPress={() => setActiveTab('favorites')}
                            >
                                <Ionicons
                                    name="star"
                                    size={16}
                                    color={activeTab === 'favorites' ? '#FFD700' : '#888'}
                                />
                                <Text style={[styles.tabButtonText, activeTab === 'favorites' && styles.tabButtonTextActive]}>
                                    Favorites ({favoriteRoms.length})
                                </Text>
                            </GamepadFocusable>

                            <GamepadFocusable
                                style={[styles.tabButton, activeTab === 'recent' && styles.tabButtonActive]}
                                glowColor="#38BDF8"
                                focusScale={1.05}
                                onPress={() => setActiveTab('recent')}
                            >
                                <Ionicons
                                    name="time"
                                    size={16}
                                    color={activeTab === 'recent' ? '#38BDF8' : '#888'}
                                />
                                <Text style={[styles.tabButtonText, activeTab === 'recent' && styles.tabButtonTextActive]}>
                                    {t('recentlyAdded')}
                                </Text>
                            </GamepadFocusable>

                            <GamepadFocusable
                                style={[styles.tabButton, activeTab === 'collections' && styles.tabButtonActive]}
                                glowColor="#A855F7"
                                focusScale={1.05}
                                onPress={() => setActiveTab('collections')}
                            >
                                <Ionicons
                                    name="albums"
                                    size={16}
                                    color={activeTab === 'collections' ? '#A855F7' : '#888'}
                                />
                                <Text style={[styles.tabButtonText, activeTab === 'collections' && styles.tabButtonTextActive]}>
                                    {t('customCollections')}
                                </Text>
                            </GamepadFocusable>
                        </View>
                        <View style={styles.tabShoulderPill}>
                            <Text style={styles.shoulderText}>R1</Text>
                        </View>
                    </View>

                    {/* Platforms Tab */}
                    {activeTab === 'platforms' && (
                        <View style={styles.platformsTabContainer}>
                            {platforms.length > 0 ? (
                                <View style={styles.platformsWrapGrid}>
                                    {platforms
                                        .filter(item => item.rom_count > 0)
                                        .map(item => (
                                            <PlatformCard
                                                key={item.id}
                                                platform={item}
                                                gamesText={t('games')}
                                                onPress={handlePlatformPress}
                                                onFocus={handlePlatformFocus}
                                            />
                                        ))}
                                </View>
                            ) : !loading && (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="game-controller-outline" size={64} color="#666" />
                                    <Text style={styles.emptyText}>{t('noPlatformsAvailable')}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Favorites Tab */}
                    {activeTab === 'favorites' && (
                        <View style={styles.recentTabContainer}>
                            {favoriteRoms && favoriteRoms.length > 0 ? (
                                <View style={styles.romsWrapGrid}>
                                    {favoriteRoms.map(rom => {
                                        const files = rom.files || [];
                                        const downloadedCount = files.filter(f => isRomDownloaded(f)).length;
                                        const isDownloaded = downloadedCount > 0;
                                        const isDownloading = files.some(f => isRomDownloading(f));
                                        const isChecking = files.some(f => isCheckingRom(f));
                                        return (
                                            <RomCard
                                                key={rom.id}
                                                rom={rom}
                                                isDownloaded={isDownloaded}
                                                isDownloading={isDownloading}
                                                isChecking={isChecking}
                                                isFavorite={true}
                                                glowColor="#FFD700"
                                                downloadedCount={downloadedCount}
                                                totalVersions={files.length}
                                                onPress={handleRomPress}
                                                onDownload={handleDownload}
                                                onFocus={handleRomFocus}
                                            />
                                        );
                                    })}
                                </View>
                            ) : (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="star-outline" size={64} color="#666" />
                                    <Text style={styles.emptyText}>No favorite games yet</Text>
                                    <Text style={[styles.emptyText, { fontSize: 13, color: '#888', marginTop: 4 }]}>
                                        Press Y on any game details screen to star it!
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Recent ROMs Tab */}
                    {activeTab === 'recent' && (
                        <View style={styles.recentTabContainer}>
                            {recentRomsLoading ? (
                                <View style={styles.emptyContainer}>
                                    <ActivityIndicator size="large" color="#5f43b2" />
                                </View>
                            ) : recentlyAddedRoms && recentlyAddedRoms.length > 0 ? (
                                <View style={styles.romsWrapGrid}>
                                    {recentlyAddedRoms.map(rom => {
                                        const files = rom.files || [];
                                        const downloadedCount = files.filter(f => isRomDownloaded(f)).length;
                                        const isDownloaded = downloadedCount > 0;
                                        const isDownloading = files.some(f => isRomDownloading(f));
                                        const isChecking = files.some(f => isCheckingRom(f));
                                        return (
                                            <RomCard
                                                key={rom.id}
                                                rom={rom}
                                                isDownloaded={isDownloaded}
                                                isDownloading={isDownloading}
                                                isChecking={isChecking}
                                                isFavorite={isFavorite(rom.id)}
                                                downloadedCount={downloadedCount}
                                                totalVersions={files.length}
                                                onPress={handleRomPress}
                                                onDownload={handleDownload}
                                                onFocus={handleRomFocus}
                                            />
                                        );
                                    })}
                                </View>
                            ) : (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="time-outline" size={64} color="#666" />
                                    <Text style={styles.emptyText}>{t('noRomsFound')}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Collections Tab */}
                    {activeTab === 'collections' && (
                        <View style={styles.collectionsTabContainer}>
                            {userCollections && userCollections.length > 0 && (
                                <View style={styles.collectionsSectionWrap}>
                                    <Text style={styles.collectionSectionHeader}>{t('customCollections')}</Text>
                                    <View style={styles.collectionsWrapGrid}>
                                        {userCollections.map(col => (
                                            <CollectionCard
                                                key={col.id}
                                                collection={col}
                                                gamesText={t('games')}
                                                onPress={handleCollectionPress}
                                                onFocus={handleCollectionFocus}
                                            />
                                        ))}
                                    </View>
                                </View>
                            )}

                            {generatedCollections && Object.keys(generatedCollections).length > 0 && (
                                Object.entries(generatedCollections).map(([type, collections]) => (
                                    <View key={type} style={styles.collectionsSectionWrap}>
                                        <Text style={styles.collectionSectionHeader}>
                                            {getCollectionTypeName(type as CollectionType)}
                                        </Text>
                                        <View style={styles.collectionsWrapGrid}>
                                            {collections.map(col => (
                                                <CollectionCard
                                                    key={col.id}
                                                    collection={col}
                                                    gamesText={t('games')}
                                                    onPress={handleCollectionPress}
                                                    onFocus={handleCollectionFocus}
                                                />
                                            ))}
                                        </View>
                                    </View>
                                ))
                            )}

                            {(!userCollections || userCollections.length === 0) &&
                                (!generatedCollections || Object.keys(generatedCollections).length === 0) && (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="albums-outline" size={64} color="#666" />
                                    <Text style={styles.emptyText}>{t('noCollectionsFound')}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Bottom padding for download status bar */}
                    {activeDownloads.length > 0 && <View style={[styles.bottomPadding, { height: 80 + insets.bottom }]} />}
                </ScrollView>
                <DownloadStatusBar onPress={() => router.push('/downloads')} />
                <GamepadHints hints={[
                    { button: 'L1', label: 'Prev Tab' },
                    { button: 'R1', label: 'Next Tab' },
                    { button: 'A', label: 'Select' },
                    { button: 'Y', label: 'Search' },
                    { button: 'X', label: 'Downloads' },
                    { button: 'B', label: 'Exit (x2)' },
                ]} />
            </View>
            <BaseFolderModal
                visible={showBaseFolderModal}
                onComplete={handleBaseFolderComplete}
            />
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
    content: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 10,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    headerLeft: {
        flex: 1,
    },
    consoleStatusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#161922',
        borderWidth: 1,
        borderColor: '#232736',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
        gap: 6,
        marginRight: 10,
    },
    consoleStatusText: {
        color: '#E2E8F0',
        fontSize: 13,
        fontWeight: '600',
    },
    consoleStatusDivider: {
        color: '#4B5563',
        fontSize: 12,
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerButton: {
        padding: 10,
        borderRadius: 8,
    },
    headerTitle: {
        color: '#fff',
        fontSize: 32,
        fontWeight: 'bold',
    },
    welcomeText: {
        color: '#ccc',
        fontSize: 14,
        marginTop: 4,
    },
    setupBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        borderColor: '#F59E0B',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginHorizontal: 20,
        marginBottom: 16,
    },
    setupBannerSuccess: {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: '#10B981',
    },
    setupBannerLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginRight: 12,
    },
    setupBannerTextContainer: {
        flex: 1,
    },
    setupBannerTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
    },
    setupBannerSubtitle: {
        color: '#D1D5DB',
        fontSize: 12,
        marginTop: 2,
    },
    setupBannerButton: {
        backgroundColor: '#F59E0B',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
    },
    setupBannerButtonSuccess: {
        backgroundColor: '#10B981',
    },
    setupBannerButtonText: {
        color: '#000',
        fontSize: 13,
        fontWeight: 'bold',
    },
    platformsContainer: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    collectionsContainer: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    sectionTitle: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 15,
    },
    horizontalList: {
        paddingHorizontal: 5,
    },
    tabBarContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 12,
        backgroundColor: 'rgba(10, 10, 12, 0.45)',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
        marginBottom: 16,
    },
    tabShoulderPill: {
        backgroundColor: '#1f2937',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#374151',
    },
    shoulderText: {
        color: '#9ca3af',
        fontSize: 11,
        fontWeight: 'bold',
    },
    tabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tabButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#161822',
        borderWidth: 1,
        borderColor: '#262938',
    },
    tabButtonActive: {
        backgroundColor: '#1e2438',
        borderColor: '#00E5FF',
    },
    tabButtonText: {
        color: '#888',
        fontSize: 13,
        fontWeight: '600',
    },
    tabButtonTextActive: {
        color: '#fff',
        fontWeight: '700',
    },
    platformsTabContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    platformsWrapGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        gap: 14,
    },
    recentTabContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    romsWrapGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        gap: 14,
    },
    collectionsTabContainer: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    collectionsSectionWrap: {
        marginBottom: 20,
    },
    collectionSectionHeader: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    collectionsWrapGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        gap: 14,
    },
    platformCard: {
        width: 142,
        backgroundColor: '#14141c',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#222533',
    },
    platformImageContainer: {
        position: 'relative',
        height: 108,
        backgroundColor: '#1c1f2e',
        justifyContent: 'center',
        alignItems: 'center',
    },
    platformImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'contain',
    },
    platformPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1a1a2e',
    },
    platformInfo: {
        padding: 12,
    },
    platformName: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
        textAlign: 'center',
    },
    gamesCount: {
        color: '#999',
        fontSize: 10,
        textAlign: 'center',
    },
    collectionCard: {
        width: 142,
        backgroundColor: '#14141c',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#222533',
    },
    collectionImageContainer: {
        height: 108,
        backgroundColor: '#1c1f2e',
    },
    collectionImage: {
        width: '100%',
        height: '100%',
    },
    collectionInfo: {
        padding: 10,
    },
    collectionName: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
        textAlign: 'center',
    },
    collectionCount: {
        color: '#999',
        fontSize: 11,
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
    romsFolderStatus: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        marginBottom: 10,
    },
    statusIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#111',
        padding: 12,
        borderRadius: 8,
        gap: 8,
    },
    statusText: {
        fontSize: 14,
        flex: 1,
    },
    configureButton: {
        backgroundColor: '#5f43b2',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    configureButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    downloadButtonActive: {
        backgroundColor: '#007AFF',
    },
    downloadBadge: {
        position: 'absolute',
        top: 4,
        right: 4,
        backgroundColor: '#FF3B30',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    downloadBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    bottomPadding: {
        height: 80, // Sufficient height to avoid overlap with the download status bar
    },
    romCard: {
        width: 142,
        backgroundColor: '#14141c',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#222533',
    },
    romImageContainer: {
        height: 180,
        backgroundColor: '#1c1f2e',
        position: 'relative',
    },
    romImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    romPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#222',
    },
    romInfo: {
        padding: 12,
    },
    romName: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
        textAlign: 'center',
    },
    romPlatform: {
        color: '#999',
        fontSize: 10,
        textAlign: 'center',
    },
    recentRomsContainer: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    romOverlay: {
        position: 'absolute',
        bottom: 8,
        right: 8,
    },
    downloadButton: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 16,
        width: 32,
        height: 32,
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
});

interface PlatformCardProps {
    platform: ApiPlatform;
    gamesText: string;
    onPress: (id: number) => void;
    onFocus: (platform: ApiPlatform) => void;
}

const PlatformCard = React.memo(({ platform, gamesText, onPress, onFocus }: PlatformCardProps) => {
    const [imageError, setImageError] = useState(false);

    return (
        <GamepadFocusable
            style={styles.platformCard}
            glowColor="#00E5FF"
            focusScale={1.04}
            onPress={() => onPress(platform.id)}
            onFocus={() => onFocus(platform)}
        >
            <View style={styles.platformImageContainer}>
                {!imageError ? (
                    <Image
                        source={{
                            uri: `${apiClient.baseUrl}/assets/platforms/${platform.slug}.ico`
                        }}
                        style={styles.platformImage}
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <View style={styles.platformPlaceholder}>
                        <Ionicons name="game-controller-outline" size={48} color="#00E5FF" />
                    </View>
                )}
            </View>
            <View style={styles.platformInfo}>
                <Text style={styles.platformName} numberOfLines={1}>
                    {platform.name}
                </Text>
                <Text style={styles.gamesCount}>
                    {platform.rom_count} {gamesText}
                </Text>
            </View>
        </GamepadFocusable>
    );
});

interface CollectionCardProps {
    collection: Collection;
    gamesText: string;
    onPress: (collection: Collection) => void;
    onFocus: (collection: Collection) => void;
}

const CollectionCard = React.memo(({ collection, gamesText, onPress, onFocus }: CollectionCardProps) => (
    <GamepadFocusable
        style={styles.collectionCard}
        glowColor="#A855F7"
        focusScale={1.04}
        onPress={() => onPress(collection)}
        onFocus={() => onFocus(collection)}
    >
        <View style={styles.collectionImageContainer}>
            <CollectionCoverGrid
                covers={collection.path_covers_small || []}
                style={styles.collectionImage}
            />
        </View>
        <View style={styles.collectionInfo}>
            <Text style={styles.collectionName} numberOfLines={1}>
                {collection.name}
            </Text>
            <Text style={styles.collectionCount}>
                {collection.rom_count} {gamesText}
            </Text>
        </View>
    </GamepadFocusable>
));

interface RomCardProps {
    rom: Rom;
    isDownloaded: boolean;
    isDownloading: boolean;
    isChecking: boolean;
    isFavorite?: boolean;
    glowColor?: string;
    downloadedCount: number;
    totalVersions: number;
    onPress: (id: number) => void;
    onDownload: (rom: Rom) => void;
    onFocus: (rom: Rom) => void;
}

const RomCard = React.memo(({
    rom,
    isDownloaded,
    isDownloading,
    isChecking,
    isFavorite,
    glowColor = '#38BDF8',
    downloadedCount,
    totalVersions,
    onPress,
    onDownload,
    onFocus,
}: RomCardProps) => {
    const hasMultipleVersions = totalVersions > 1;

    return (
        <GamepadFocusable
            style={styles.romCard}
            glowColor={glowColor}
            focusScale={1.04}
            onPress={() => onPress(rom.id)}
            onFocus={() => onFocus(rom)}
        >
            <View style={styles.romImageContainer}>
                {rom.url_cover ? (
                    <Image
                        source={{ uri: rom.url_cover }}
                        style={styles.romImage}
                    />
                ) : (
                    <View style={styles.romPlaceholder}>
                        <Ionicons name="game-controller-outline" size={32} color="#666" />
                    </View>
                )}

                {/* Status Badges */}
                <View style={styles.topLeftBadges}>
                    {isFavorite && (
                        <View style={styles.favoriteBadge}>
                            <Ionicons name="star" size={14} color="#FFD700" />
                        </View>
                    )}
                    {Boolean(rom.ra_id) && (
                        <View style={styles.raTrophyBadge}>
                            <Ionicons name="trophy" size={13} color="#FFD700" />
                        </View>
                    )}
                    {isDownloading && (
                        <View style={styles.downloadingBadge}>
                            <Ionicons name="download" size={16} color="#FFFFFF" />
                        </View>
                    )}
                </View>
                {isDownloaded && (
                    <View style={styles.completedBadge}>
                        <Ionicons name="checkmark-circle" size={24} color="#34C759" />
                        {hasMultipleVersions && (
                            <Text style={styles.versionCountBadge}>
                                {downloadedCount}/{totalVersions}
                            </Text>
                        )}
                    </View>
                )}
                {isChecking && !isDownloaded && (
                    <View style={styles.checkingBadge}>
                        <ActivityIndicator size={16} color="#FF9500" />
                    </View>
                )}

                {/* Download Button - Only show if not all versions downloaded and none downloading */}
                {!isDownloaded && !isDownloading && (
                    <View style={styles.romOverlay}>
                        <Pressable
                            focusable={false}
                            style={styles.downloadButton}
                            onPress={() => onDownload(rom)}
                        >
                            <Ionicons name="download-outline" size={16} color="#fff" />
                        </Pressable>
                    </View>
                )}
            </View>
            <View style={styles.romInfo}>
                <Text style={styles.romName} numberOfLines={2}>
                    {rom.name}
                </Text>
                <Text style={styles.romPlatform} numberOfLines={1}>
                    {rom.platform_name}
                </Text>
            </View>
        </GamepadFocusable>
    );
});