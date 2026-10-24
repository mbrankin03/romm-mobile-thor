import { useToast } from '@/contexts/ToastContext';
import { useTranslation } from '@/hooks/useTranslation';
import * as SAF from '@joplin/react-native-saf-x';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { useStorageAccessFramework } from './useStorageAccessFramework';
import * as Application from 'expo-application';

import { Platform } from '@/services/api';
import * as FileSystem from 'expo-file-system/legacy';
import RNFS from 'react-native-fs';
import { resolveAndroidPath } from '@/services/storageService';
import {
    Alert,
    Platform as RNPlatform,
} from 'react-native';


export interface PlatformFolder {
    platformSlug: string;
    platformName: string;
    folderUri: string;
    folderName: string;
}

export const COCOON_PLATFORM_ALIASES: Record<string, string[]> = {
    // Nintendo
    snes: ['snes', 'sfc', 'super-nintendo', 'super-famicom', 'snesna'],
    sfc: ['snes', 'sfc', 'super-nintendo', 'super-famicom'],
    nes: ['nes', 'fc', 'famicom'],
    fc: ['nes', 'fc', 'famicom'],
    gba: ['gba', 'gameboyadvance', 'gameboy-advance'],
    gbc: ['gbc', 'gameboycolor', 'gameboy-color'],
    gb: ['gb', 'gameboy'],
    n64: ['n64', 'nintendo64', 'n64dd'],
    nds: ['nds', 'ds', 'nintendods'],
    '3ds': ['n3ds', '3ds', 'nintendo3ds'],
    n3ds: ['n3ds', '3ds', 'nintendo3ds'],
    ngc: ['gc', 'gamecube', 'ngc'],
    gc: ['gc', 'gamecube', 'ngc'],
    gamecube: ['gc', 'gamecube', 'ngc'],
    wii: ['wii'],
    wiiu: ['wiiu'],
    switch: ['switch'],
    'switch-2': ['switch', 'switch2', 'switch-2'],
    virtualboy: ['virtualboy', 'vb'],
    pokemini: ['pokemini'],

    // Sega
    dc: ['dreamcast', 'dc'],
    dreamcast: ['dreamcast', 'dc'],
    genesis: ['genesis', 'megadrive', 'md', 'sega-genesis', 'megadrivejp'],
    megadrive: ['genesis', 'megadrive', 'md', 'sega-genesis'],
    gamegear: ['gamegear', 'gg'],
    mastersystem: ['mastersystem', 'sms', 'mark3'],
    saturn: ['saturn', 'sega-saturn', 'saturnjp'],
    sega32: ['sega32x', 'sega32', '32x', 'sega32xna', 'sega32xjp'],
    sega32x: ['sega32x', 'sega32', '32x'],
    segacd: ['segacd', 'megacd', 'megacdjp'],
    segacd32: ['segacd32', 'sega32x', 'segacd', 'megacd'],

    // Sony
    psx: ['psx', 'ps1', 'playstation', 'ps'],
    ps1: ['psx', 'ps1', 'playstation', 'ps'],
    ps2: ['ps2', 'playstation2'],
    ps3: ['ps3', 'playstation3'],
    ps4: ['ps4', 'playstation4'],
    psp: ['psp', 'playstationportable'],
    psvita: ['psvita', 'vita'],
    vita: ['psvita', 'vita'],

    // Microsoft
    xbox: ['xbox'],
    xbox360: ['xbox360', 'x360'],

    // PC / Computers
    win: ['windows', 'pc', 'dos', 'windows9x', 'windows3x'],
    pc: ['windows', 'pc', 'dos'],
    dos: ['dos', 'pc'],
    amiga: ['amiga', 'amiga1200', 'amiga600', 'amigacd32'],
    c64: ['c64'],
    atarist: ['atarist'],
    zxspectrum: ['zxspectrum'],

    // Arcade & Other
    arcade: ['arcade', 'mame', 'fba', 'fbneo'],
    mame: ['mame', 'arcade'],
    fba: ['fba', 'fbneo', 'arcade'],
    neogeo: ['neogeo', 'neo-geo', 'neogeocd'],
    '3do': ['3do'],
    atari2600: ['atari2600', 'a2600'],
    atari5200: ['atari5200', 'a5200'],
    atari7800: ['atari7800', 'a7800'],
    atarilynx: ['atarilynx', 'lynx'],
    atarijaguar: ['atarijaguar', 'jaguar'],
    tg16: ['tg16', 'pcengine', 'tg-cd', 'pcenginecd', 'pcfx'],
    pcengine: ['pcengine', 'tg16', 'pcenginecd', 'pcfx'],
    wonderswan: ['wonderswan', 'wonderswancolor'],
    wonderswancolor: ['wonderswancolor', 'wonderswan'],
};

export const getPlatformAliases = (platformSlug: string, fsSlug?: string): string[] => {
    const slug = (platformSlug || '').toLowerCase();
    const fs = (fsSlug || '').toLowerCase();
    const aliases = new Set<string>();
    if (slug) aliases.add(slug);
    if (fs) aliases.add(fs);
    (COCOON_PLATFORM_ALIASES[slug] || []).forEach(a => aliases.add(a.toLowerCase()));
    if (fs) {
        (COCOON_PLATFORM_ALIASES[fs] || []).forEach(a => aliases.add(a.toLowerCase()));
    }
    return Array.from(aliases).filter(Boolean);
};

export const usePlatformFolders = () => {
    const { checkDirectoryPermissions, requestDirectoryPermissions } = useStorageAccessFramework();
    const [platformFolders, setPlatformFolders] = useState<PlatformFolder[]>([]);
    const { showSuccessToast, showErrorToast } = useToast();
    const { t } = useTranslation();

    const STORAGE_KEY = 'platformFolders';
    const STORAGE_KEY_BASE = 'platformFoldersBase';

    // // Load platform folders from AsyncStorage when the hook is initialized
    useEffect(() => {
        loadPlatformFolders();
    }, []);

    // Function to save a folder for a specific platform
    const savePlatformFolder = async (
        platformSlug: string,
        platformName: string,
        folderUri: string
    ): Promise<PlatformFolder | null> => {

        try {
            const folderName = extractFolderNameFromUri(folderUri);
            const newFolder: PlatformFolder = {
                platformSlug,
                platformName,
                folderUri,
                folderName: folderName || platformName
            };

            await AsyncStorage.setItem(`${STORAGE_KEY}_${platformSlug}`, JSON.stringify(newFolder));

            // Add folder to the list of configured platforms
            const allFolders = await AsyncStorage.getItem(STORAGE_KEY);
            const folders = allFolders ? JSON.parse(allFolders) : [];

            // Check if the folder already exists
            const existingIndex = folders.findIndex((folder: PlatformFolder) => folder.platformSlug === platformSlug);
            if (existingIndex !== -1) {
                // Update existing folder
                folders[existingIndex] = newFolder;
            } else {
                // Add new folder
                folders.push(newFolder);
            }
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(folders));

            console.log(`Folder for platform ${platformSlug} saved successfully:`, newFolder);
            return newFolder;
        } catch (error) {
            console.error(`Error saving folder for platform ${platformSlug}:`, error);
            return null;
        }
    };

    const createPlatformFolder = async (
        platformSlug: string
    ): Promise<PlatformFolder | null> => {
        try {
            let baseFolder = await AsyncStorage.getItem(STORAGE_KEY_BASE);

            if (!baseFolder) {
                console.warn('No base folder configured for platform folders');
                return null;
            }

            const folderUri = `${baseFolder}${platformSlug}/`;
            console.log('Creating platform folder at:', folderUri);
            console.log('Base folder:', baseFolder);
            // Create folder using platform-specific methods
            if (RNPlatform.OS === 'android') {
                const folderRes = await SAF.mkdir(folderUri);

                if (!folderRes) {
                    console.error(`Failed to create folder for platform ${platformSlug}`);
                    return null;
                }
            } else {
                // For iOS, use expo-file-system
                // First ensure base folder exists
                await FileSystem.makeDirectoryAsync(baseFolder, { intermediates: true });
                // Then create platform folder
                await FileSystem.makeDirectoryAsync(folderUri, { intermediates: true });
            }

            const folderName = extractFolderNameFromUri(folderUri) || platformSlug;
            const newFolder: PlatformFolder = {
                platformSlug,
                platformName: folderName,
                folderUri,
                folderName
            };

            await AsyncStorage.setItem(`${STORAGE_KEY}_${platformSlug}`, JSON.stringify(newFolder));

            // Add to the list of configured platforms
            const allFolders = await AsyncStorage.getItem(STORAGE_KEY);
            const folders = allFolders ? JSON.parse(allFolders) : [];

            const existingIndex = folders.findIndex((folder: PlatformFolder) => folder.platformSlug === platformSlug);
            if (existingIndex !== -1) {
                folders[existingIndex] = newFolder;
            } else {
                folders.push(newFolder);
            }
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(folders));

            console.log(`Folder for platform ${platformSlug} created successfully:`, newFolder);
            return newFolder;
        } catch (error) {
            console.error(`Error creating folder for platform ${platformSlug}:`, error);
            return null;
        }
    };

    // Function to remove a platform folder
    const removePlatformFolder = async (platformSlug: string) => {
        try {
            await AsyncStorage.removeItem(`${STORAGE_KEY}_${platformSlug}`);

            // Remove from the list of configured platforms
            const allFolders = await AsyncStorage.getItem(STORAGE_KEY);
            const folders = allFolders ? JSON.parse(allFolders) : [];
            const updatedFolders = folders.filter((folder: PlatformFolder) => folder.platformSlug !== platformSlug);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedFolders));
        } catch (error) {
            console.error(`Error removing folder for platform ${platformSlug}:`, error);
            throw error;
        }
    };

    // Function to remove all platform folders
    const removeAllPlatformFolders = async () => {
        try {
            const allFolders = await AsyncStorage.getItem(STORAGE_KEY);
            const folders = allFolders ? JSON.parse(allFolders) : [];

            // Remove each platform folder individually
            for (const folder of folders) {
                await AsyncStorage.removeItem(`${STORAGE_KEY}_${folder.platformSlug}`);
            }

            // Clear the main list
            await AsyncStorage.removeItem(STORAGE_KEY);

            // Update state
            setPlatformFolders([]);

            console.log('All platform folders removed successfully');
        } catch (error) {
            console.error('Error removing all platform folders:', error);
            throw error;
        }
    };

    // Function to get the folder for a specific platform
    const getPlatformFolder = async (platformSlug: string): Promise<PlatformFolder | null> => {
        const folder = await AsyncStorage.getItem(`${STORAGE_KEY}_${platformSlug}`);
        return folder ? JSON.parse(folder) : null;
    };

    // Function to check if a platform has a configured folder
    const hasPlatformFolder = async (platformSlug: string): Promise<boolean> => {
        const folder = await getPlatformFolder(platformSlug);
        return !!folder;
    };

    // Function to check if a platform's folder is still accessible
    const checkPlatformFolderAccess = async (platformSlug: string): Promise<boolean> => {
        const folder = await getPlatformFolder(platformSlug);
        if (!folder) {
            return false;
        }

        try {
            if (RNPlatform.OS === 'android') {
                // Use SAF for Android
                return await checkDirectoryPermissions(folder.folderUri);
            } else {
                // Use expo-file-system for iOS
                const fileInfo = await FileSystem.getInfoAsync(folder.folderUri);
                return fileInfo.exists && fileInfo.isDirectory;
            }
        } catch (error) {
            console.error(`Error checking folder access for platform ${platformSlug}:`, error);
            return false;
        }
    };

    // Function to extract folder name from URI
    const extractFolderNameFromUri = (uri: string): string | undefined => {
        try {
            const decodedUri = decodeURIComponent(uri);
            const parts = decodedUri.split('/');
            const lastPart = parts[parts.length - 1];

            if (lastPart.includes('%3A')) {
                return lastPart.split('%3A').pop() || undefined;
            }

            return lastPart || undefined;
        } catch (error) {
            return undefined;
        }
    };

    const loadPlatformFolders = useCallback(async () => {
        try {
            const allFolders = await AsyncStorage.getItem(STORAGE_KEY);
            console.log('Loaded platform folders:', allFolders);
            if (allFolders) {
                setPlatformFolders(JSON.parse(allFolders));
            } else {
                setPlatformFolders([]);
            }
        } catch (error) {
            console.error('Error loading platform folders:', error);
            throw error;
        }
    }, []);

    // Returns all matching folders for a platform (checking baseFolder against all known aliases)
    const getAllPlatformFolders = useCallback(
        async (platform: Platform): Promise<PlatformFolder[]> => {
            try {
                const baseFolder = await AsyncStorage.getItem(STORAGE_KEY_BASE);
                const aliases = getPlatformAliases(platform.slug, platform.fs_slug);

                if (!baseFolder) {
                    const single = await getPlatformFolder(platform.slug);
                    return single ? [single] : [];
                }

                const resultFolders: PlatformFolder[] = [];

                if (RNPlatform.OS === 'android') {
                    const resolved = baseFolder.startsWith('content://') ? resolveAndroidPath(baseFolder) : baseFolder;
                    if (resolved && (await RNFS.exists(resolved))) {
                        try {
                            const entries = await RNFS.readDir(resolved);
                            for (const entry of entries) {
                                if (entry.isDirectory()) {
                                    const fileName = entry.name.toLowerCase();
                                    if (aliases.includes(fileName)) {
                                        resultFolders.push({
                                            platformSlug: platform.slug,
                                            platformName: platform.name,
                                            folderUri: entry.path,
                                            folderName: entry.name
                                        });
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Error reading resolved baseFolder directory:', err);
                        }
                    } else if (baseFolder.startsWith('content://')) {
                        const files = await SAF.listFiles(baseFolder);
                        for (const file of files) {
                            const fileName = file.name.toLowerCase();
                            if (aliases.includes(fileName)) {
                                resultFolders.push({
                                    platformSlug: platform.slug,
                                    platformName: platform.name,
                                    folderUri: file.uri,
                                    folderName: file.name
                                });
                            }
                        }
                    }
                } else {
                    try {
                        const dirNames = await FileSystem.readDirectoryAsync(baseFolder);
                        for (const name of dirNames) {
                            if (aliases.includes(name.toLowerCase())) {
                                const uri = `${baseFolder}${name}`;
                                resultFolders.push({
                                    platformSlug: platform.slug,
                                    platformName: platform.name,
                                    folderUri: uri,
                                    folderName: name
                                });
                            }
                        }
                    } catch (e) {
                        console.error('Error reading iOS base folder directory:', e);
                    }
                }

                // Fallback to cached platform folder if none matched in base folder
                if (resultFolders.length === 0) {
                    const single = await getPlatformFolder(platform.slug);
                    if (single) resultFolders.push(single);
                }

                return resultFolders;
            } catch (error) {
                console.error(`Error getting all platform folders for ${platform.slug}:`, error);
                return [];
            }
        },
        [getPlatformFolder]
    );

    const searchPlatformFolder = useCallback(
        async (platform: Platform): Promise<PlatformFolder | null> => {
            try {
                const allFolders = await getAllPlatformFolders(platform);

                if (allFolders.length === 1) {
                    await savePlatformFolder(platform.slug, platform.name, allFolders[0].folderUri);
                    if (platform.fs_slug && platform.fs_slug !== platform.slug) {
                        await savePlatformFolder(platform.fs_slug, platform.name, allFolders[0].folderUri);
                    }
                    return allFolders[0];
                }

                if (allFolders.length > 1) {
                    // Pick the folder that actually contains game files!
                    let bestFolder = allFolders[0];
                    let maxFileCount = -1;

                    for (const folder of allFolders) {
                        try {
                            let count = 0;
                            if (RNPlatform.OS === 'android') {
                                const list = await SAF.listFiles(folder.folderUri);
                                count = list.filter(f => {
                                    const fName = f.name.toLowerCase();
                                    if (fName === 'systeminfo.txt' || fName === '.nomedia') return false;
                                    return (f as any).size === undefined || (f as any).size > 0;
                                }).length;
                            } else {
                                const list = await FileSystem.readDirectoryAsync(folder.folderUri);
                                count = list.length;
                            }
                            if (count > maxFileCount) {
                                maxFileCount = count;
                                bestFolder = folder;
                            }
                        } catch (e) {
                            // ignore read errors
                        }
                    }

                    await savePlatformFolder(platform.slug, platform.name, bestFolder.folderUri);
                    if (platform.fs_slug && platform.fs_slug !== platform.slug) {
                        await savePlatformFolder(platform.fs_slug, platform.name, bestFolder.folderUri);
                    }
                    return bestFolder;
                }

                // If not found in base folder, auto-create it!
                const created = await createPlatformFolder(platform.slug);
                if (created && platform.fs_slug && platform.fs_slug !== platform.slug) {
                    await savePlatformFolder(platform.fs_slug, platform.name, created.folderUri);
                }
                return created;
            } catch (error) {
                console.error(`Error searching for platform folder ${platform.slug}:`, error);
                return null;
            }
        },
        [getAllPlatformFolders, savePlatformFolder, createPlatformFolder]
    );


    const requestPlatformFolder = useCallback(
        async (platform: Platform, force: boolean = false): Promise<void> => {

            const currentFolder = await searchPlatformFolder(platform);

            if (currentFolder && !force) {
                return;
            }

            if (RNPlatform.OS === 'ios') {
                // For iOS, try to create the folder automatically in Documents directory
                try {
                    const documentsDir = FileSystem.documentDirectory;
                    if (documentsDir) {
                        const savedFolder = await createPlatformFolder(platform.slug);
                        if (savedFolder) {
                            showSuccessToast(
                                t('folderConfiguredSuccessfully', { platform: platform.name }),
                                t('folderConfigured')
                            );
                        } else {
                            showErrorToast(
                                t('errorCreatingFolder'),
                                t('error')
                            );
                        }
                    }
                } catch (error) {
                    console.error('Error creating iOS folder:', error);
                    showErrorToast(
                        t('errorCreatingFolder'),
                        t('error')
                    );
                }
            } else {
                // Android flow with SAF permissions
                Alert.alert(
                    t('selectFolderTitle'),
                    t('selectFolderToDownload', { platform: platform.name }),
                    [
                        {
                            text: t('notNow'),
                            style: 'cancel'
                        },
                        {
                            text: t('selectFolder'),
                            onPress: async () => {
                                try {
                                    const folderUri = await requestDirectoryPermissions();
                                    if (folderUri) {
                                        const savedFolder = await savePlatformFolder(platform.slug, platform.name, folderUri);

                                        showSuccessToast(
                                            t('folderConfiguredSuccessfully', { platform: platform.name }),
                                            t('folderConfigured')
                                        );
                                    }
                                } catch (error) {
                                    console.error('Error selecting folder:', error);
                                    showErrorToast(
                                        t('errorSelectingFolder'),
                                        t('error')
                                    );
                                }
                            }
                        },
                        {
                            text: t('createFolder'),
                            onPress: async () => {
                                try {
                                    await createPlatformFolder(platform.slug);
                                } catch (error) {
                                    console.error('Error creating folder:', error);
                                    showErrorToast(
                                        t('errorCreatingFolder'),
                                        t('error')
                                    );
                                }
                            },
                        }
                    ]
                );
            }
        },
        [searchPlatformFolder]
    );

    // Function to set the base folder for all platforms
    const setBaseFolder = async (folderUri: string): Promise<void> => {
        try {
            await AsyncStorage.setItem(STORAGE_KEY_BASE, folderUri);
            console.log('Base folder set successfully:', folderUri);
        } catch (error) {
            console.error('Error setting base folder:', error);
            throw error;
        }
    };

    // Function to get the base folder
    const getBaseFolder = async (): Promise<string | null> => {
        try {
            return await AsyncStorage.getItem(STORAGE_KEY_BASE);
        } catch (error) {
            console.error('Error getting base folder:', error);
            return null;
        }
    };

    // Function to check if base folder is configured
    const hasBaseFolder = async (): Promise<boolean> => {
        const baseFolder = await getBaseFolder();
        return !!baseFolder;
    };

    const canAccessBaseFolder = async (): Promise<boolean> => {
        const baseFolder = await getBaseFolder();
        if (!baseFolder) {
            return false;
        }

        if (RNPlatform.OS === 'ios') {
            // For iOS, check if the base folder is the document directory
            return FileSystem.documentDirectory! === baseFolder; 
        }

        try {
            await checkDirectoryPermissions(baseFolder);       
            return true;
        } catch (error) {
            return false;
        }

    };

    // Function to remove the base folder
    const removeBaseFolder = async (): Promise<void> => {
        try {
            await AsyncStorage.removeItem(STORAGE_KEY_BASE);
            console.log('Base folder removed successfully');
        } catch (error) {
            console.error('Error removing base folder:', error);
            throw error;
        }
    };

    return {
        // loadPlatformFolders,
        requestPlatformFolder,
        createPlatformFolder,
        searchPlatformFolder,
        getAllPlatformFolders,
        savePlatformFolder,
        removePlatformFolder,
        hasPlatformFolder,
        checkPlatformFolderAccess,
        loadPlatformFolders,
        platformFolders,
        setPlatformFolders,
        removeAllPlatformFolders,
        setBaseFolder,
        getBaseFolder,
        hasBaseFolder,
        canAccessBaseFolder,
        removeBaseFolder,
    };
};
