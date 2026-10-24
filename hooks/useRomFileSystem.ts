import * as SAF from '@joplin/react-native-saf-x';
import RNFetchBlob from "react-native-blob-util";
import RNFS from 'react-native-fs';
import * as FileSystem from 'expo-file-system';
import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { RomFile } from '../services/api';
import { PlatformFolder, usePlatformFolders } from './usePlatformFolders';
import { resolveAndroidPath } from '../services/storageService';


interface RomHash {
    hash: string;
    lastModified: number;
}

export const matchesRomFile = (diskFileName: string, romFileName: string): boolean => {
    if (!diskFileName || !romFileName) return false;

    const getDiscId = (f: string) => {
        const m = f.match(/\b(disc|disk|cd|part|side|track)\s*([0-9a-z]+)\b/i);
        return m ? `${m[1].toLowerCase()}_${m[2].toLowerCase()}` : '';
    };
    const isAux = (f: string) => /\.(m3u|m3u8|cue|gdi|txt|nfo|pdf)$/i.test(f);

    // Playlists/cues must only match playlists/cues; game files only game files
    if (isAux(diskFileName) !== isAux(romFileName)) return false;

    // Discs/parts must match strictly (e.g. Disc 1 != Disc 2 or no-disc)
    if (getDiscId(diskFileName) !== getDiscId(romFileName)) return false;

    const fLower = diskFileName.toLowerCase().trim();
    const rLower = romFileName.toLowerCase().trim();
    if (fLower === rLower) return true;

    const fNoExt = fLower.replace(/\.[^/.]+$/, '');
    const rNoExt = rLower.replace(/\.[^/.]+$/, '');
    if (fNoExt === rNoExt) return true;

    // Strip region/version tags like (USA), (Europe), [Rev 1], but preserve disc tags
    const clean = (s: string) => s.replace(/\.[^/.]+$/, '')
        .replace(/[\(\[\{](?!\s*(?:disc|disk|cd|part|side|track)\b)[^\)\]\}]*[\)\]\}]/gi, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
        .trim();

    const fClean = clean(diskFileName);
    const rClean = clean(romFileName);
    return !!(fClean && rClean && fClean === rClean);
};

export const useRomFileSystem = () => {
    const { searchPlatformFolder } = usePlatformFolders();
    const [fileChecks, setFileChecks] = useState<Record<number, boolean>>({});
    const [checking, setChecking] = useState<Record<number, boolean>>({});

    const checkIfRomExists = useCallback(async (romFile: RomFile, platformFolder: PlatformFolder | PlatformFolder[]): Promise<boolean> => {
        if (!romFile) {
            return false;
        }

        const fileId = romFile.id || romFile.rom_id;
        const folders = Array.isArray(platformFolder) ? platformFolder : [platformFolder];
        const validFolders = folders.filter(f => f && f.folderUri);

        if (validFolders.length === 0) {
            console.warn('No platform folder configured. Cannot check if ROM exists.');
            return false;
        }

        try {
            interface FileInfo {
                name: string;
                size?: number;
            }
            let fileList: FileInfo[] = [];

            for (const folder of validFolders) {
                try {
                    if (Platform.OS === 'android') {
                        const directPath = resolveAndroidPath(folder.folderUri);
                        if (directPath && (await RNFS.exists(directPath))) {
                            const dirItems = await RNFS.readDir(directPath);
                            fileList.push(...dirItems.map(item => ({ name: item.name, size: item.size || 1 })));
                        } else {
                            const files = await SAF.listFiles(folder.folderUri);
                            fileList.push(...files.map(file => ({ name: file.name, size: (file as any).size ?? 1 })));
                        }
                    } else {
                        const names = await FileSystem.readDirectoryAsync(folder.folderUri);
                        fileList.push(...names.map(name => ({ name, size: 1 })));
                    }
                } catch (e) {
                    console.warn(`Error reading folder ${folder.folderUri}:`, e);
                }
            }

            const romExists = fileList.some(file => {
                if (file.size !== undefined && file.size === 0) return false;
                return matchesRomFile(file.name, romFile.file_name || '');
            });

            if (fileId) {
                setFileChecks(prev => ({ ...prev, [fileId]: romExists }));
            }
            return romExists;

        } catch (error) {
            console.error('Error checking existing files:', error);
            if (fileId) {
                setFileChecks(prev => ({ ...prev, [fileId]: false }));
            }
            return false;
        }

    }, []);

    const isRomDownloaded = useCallback((romFile?: RomFile): boolean => {
        if (!romFile) return false;
        const fileId = romFile.id || romFile.rom_id;
        if (!fileId) return false;
        return fileChecks[fileId] || false;
    }, [fileChecks]);

    const isCheckingRom = useCallback((romFile?: RomFile): boolean => {
        if (!romFile) return false;
        const fileId = romFile.id || romFile.rom_id;
        if (!fileId) return false;
        return checking[fileId] || false;
    }, [checking]);

    const checkMultipleRoms = useCallback(async (romsFiles: RomFile[], platformFolder: PlatformFolder | PlatformFolder[]): Promise<void> => {
        if (!romsFiles || romsFiles.length === 0) return;
        const folders = Array.isArray(platformFolder) ? platformFolder : [platformFolder];
        const validFolders = folders.filter(f => f && f.folderUri);
        if (validFolders.length === 0) return;

        try {
            interface FileInfo {
                name: string;
                size?: number;
            }
            let fileList: FileInfo[] = [];

            for (const folder of validFolders) {
                try {
                    if (Platform.OS === 'android') {
                        const directPath = resolveAndroidPath(folder.folderUri);
                        if (directPath && (await RNFS.exists(directPath))) {
                            const dirItems = await RNFS.readDir(directPath);
                            fileList.push(...dirItems.map(item => ({ name: item.name, size: item.size || 1 })));
                        } else {
                            const files = await SAF.listFiles(folder.folderUri);
                            fileList.push(...files.map(file => ({ name: file.name, size: (file as any).size ?? 1 })));
                        }
                    } else {
                        const names = await FileSystem.readDirectoryAsync(folder.folderUri);
                        fileList.push(...names.map(name => ({ name, size: 1 })));
                    }
                } catch (e) {
                    console.warn(`Error reading folder ${folder.folderUri}:`, e);
                }
            }

            const newChecks: Record<number, boolean> = {};

            for (const romFile of romsFiles) {
                if (!romFile) continue;
                const fileId = romFile.id || romFile.rom_id;
                if (!fileId) continue;

                const exists = fileList.some(file => {
                    if (file.size !== undefined && file.size === 0) return false;
                    return matchesRomFile(file.name, romFile.file_name || '');
                });

                newChecks[fileId] = exists;
            }

            setFileChecks(prev => ({ ...prev, ...newChecks }));
        } catch (error) {
            console.error('Error batch checking files:', error);
        }
    }, []);

    const refreshRomCheck = useCallback(async (romFile?: RomFile, platformFolder?: PlatformFolder | PlatformFolder[]): Promise<boolean> => {
        if (!romFile) return false;
        const fileId = romFile.id || romFile.rom_id;
        if (!fileId) return false;

        if (fileChecks[fileId] == true) {
            return true;
        }

        if (!platformFolder) return false;
        return await checkIfRomExists(romFile, platformFolder);
    }, [checkIfRomExists, fileChecks]);

    const resetRomsCheck = useCallback((romsFiles: RomFile[]) => {
        if (!romsFiles) return;
        romsFiles.forEach((romFile) => {
            const fileId = romFile?.id || romFile?.rom_id;
            if (fileId) {
                setFileChecks(prev => ({ ...prev, [fileId]: false }));
                setChecking(prev => ({ ...prev, [fileId]: false }));
            }
        });
    }, []);

    const memoizedReturn = useMemo(() => ({
        resetRomsCheck,
        checkIfRomExists,
        isRomDownloaded,
        isCheckingRom,
        checkMultipleRoms,
        refreshRomCheck,
        fileChecks,
        checking
    }), [
        resetRomsCheck,
        checkIfRomExists,
        isRomDownloaded,
        isCheckingRom,
        checkMultipleRoms,
        refreshRomCheck,
        fileChecks,
        checking
    ]);

    return memoizedReturn;
};
