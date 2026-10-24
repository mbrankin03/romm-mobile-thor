import RNFS from 'react-native-fs';
import * as SAF from '@joplin/react-native-saf-x';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform as RNPlatform } from 'react-native';
import { PlatformFolder } from '../hooks/usePlatformFolders';
import { Platform as ApiPlatform, apiClient, RomFile } from './api';

export function formatBytes(bytes: number, decimals: number = 1): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function resolveAndroidPath(uri: string): string | null {
    try {
        let decoded = decodeURIComponent(uri);
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
}

export interface StorageOverview {
    totalSpaceBytes: number;
    freeSpaceBytes: number;
    usedSpaceBytes: number;
    romsSpaceBytes: number;
    installedGamesCount: number;
}

export async function getFreeDiskSpace(): Promise<number> {
    try {
        const info = await RNFS.getFSInfo();
        return info?.freeSpace || 0;
    } catch {
        return Infinity;
    }
}

export async function getStorageOverview(romsSpaceBytes: number = 0, installedGamesCount: number = 0): Promise<StorageOverview> {
    try {
        const info = await RNFS.getFSInfo();
        const total = info?.totalSpace || 0;
        const free = info?.freeSpace || 0;
        const used = Math.max(0, total - free);
        return {
            totalSpaceBytes: total,
            freeSpaceBytes: free,
            usedSpaceBytes: used,
            romsSpaceBytes,
            installedGamesCount,
        };
    } catch {
        return {
            totalSpaceBytes: 0,
            freeSpaceBytes: 0,
            usedSpaceBytes: 0,
            romsSpaceBytes,
            installedGamesCount,
        };
    }
}

export async function validateDiskSpace(requiredBytes: number): Promise<{
    canDownload: boolean;
    freeBytes: number;
    warningMessage?: string;
}> {
    const freeBytes = await getFreeDiskSpace();
    if (freeBytes === Infinity || freeBytes === 0) {
        return { canDownload: true, freeBytes: 0 };
    }

    const safetyBuffer = 200 * 1024 * 1024;
    if (requiredBytes + safetyBuffer > freeBytes) {
        return {
            canDownload: false,
            freeBytes,
            warningMessage: `Insufficient storage space. This download requires ${formatBytes(requiredBytes)}, but only ${formatBytes(freeBytes)} is available on your device.`,
        };
    }

    return {
        canDownload: true,
        freeBytes,
    };
}

export interface InstalledGameFile {
    name: string;
    uri: string;
    size: number;
    isAux?: boolean;
}

export interface InstalledGame {
    id: string; // unique identifier
    romId?: number; // matched RomM server rom ID
    name: string;
    cleanTitle: string;
    platformSlug: string;
    platformName: string;
    folderUri: string;
    files: InstalledGameFile[];
    totalSizeBytes: number;
    isMultiFile: boolean;
    coverUrl?: string;
}

const isAuxiliaryFile = (fileName: string): boolean => {
    return /\.(m3u|m3u8|cue|gdi|txt|nfo|pdf|jpg|png|xml)$/i.test(fileName);
};

const extractCleanGameTitle = (fileName: string): string => {
    const noExt = fileName.replace(/\.[^/.]+$/, '');
    // Strip disc/part tags
    const noDisc = noExt.replace(/\b(disc|disk|cd|part|side|track)\s*[0-9a-z]+\b/gi, '').trim();
    // Strip region/release bracketed tags
    const clean = noDisc.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, '').trim();
    return (clean.length > 0 ? clean : noExt).replace(/\s+/g, ' ').trim();
};

export async function scanInstalledGames(
    folders: PlatformFolder[],
    knownPlatforms: ApiPlatform[] = []
): Promise<InstalledGame[]> {
    const results: InstalledGame[] = [];
    const validFolders = folders.filter(f => f && f.folderUri);

    for (const folder of validFolders) {
        try {
            interface RawEntry {
                name: string;
                uri: string;
                size: number;
                isDirectory?: boolean;
            }
            let rawEntries: RawEntry[] = [];

            if (RNPlatform.OS === 'android') {
                const directPath = resolveAndroidPath(folder.folderUri);
                if (directPath && await RNFS.exists(directPath)) {
                    const dirItems = await RNFS.readDir(directPath);
                    rawEntries = dirItems.map(item => ({
                        name: item.name,
                        uri: item.path,
                        size: item.size || 0,
                        isDirectory: item.isDirectory(),
                    }));
                } else {
                    const safItems = await SAF.listFiles(folder.folderUri);
                    rawEntries = safItems.map(item => ({
                        name: item.name,
                        uri: item.uri,
                        size: (item as any).size ?? 0,
                        isDirectory: (item as any).isDirectory ?? false,
                    }));
                }
            } else {
                const names = await FileSystem.readDirectoryAsync(folder.folderUri);
                for (const name of names) {
                    const uri = folder.folderUri.endsWith('/') ? `${folder.folderUri}${name}` : `${folder.folderUri}/${name}`;
                    const info = await FileSystem.getInfoAsync(uri);
                    rawEntries.push({
                        name,
                        uri,
                        size: info.exists && 'size' in info ? (info.size || 0) : 0,
                        isDirectory: info.exists && 'isDirectory' in info ? Boolean(info.isDirectory) : false,
                    });
                }
            }

            // Group files by game
            const gameGroups = new Map<string, RawEntry[]>();

            for (const entry of rawEntries) {
                // Ignore system files
                if (entry.name.startsWith('.') || entry.name === 'Thumbs.db') continue;

                // Handle Subdirectories as single games (e.g. multi-disc folders)
                if (entry.isDirectory) {
                    const subFiles: RawEntry[] = [];
                    if (RNPlatform.OS === 'android') {
                        const subDirectPath = resolveAndroidPath(entry.uri);
                        if (subDirectPath && await RNFS.exists(subDirectPath)) {
                            const subItems = await RNFS.readDir(subDirectPath);
                            for (const s of subItems) {
                                if (!s.name.startsWith('.')) {
                                    subFiles.push({ name: s.name, uri: s.path, size: s.size || 0, isDirectory: false });
                                }
                            }
                        } else {
                            try {
                                const subSaf = await SAF.listFiles(entry.uri);
                                for (const s of subSaf) {
                                    if (!s.name.startsWith('.')) {
                                        subFiles.push({ name: s.name, uri: s.uri, size: (s as any).size ?? 0, isDirectory: false });
                                    }
                                }
                            } catch {}
                        }
                    }
                    if (subFiles.length > 0) {
                        gameGroups.set(entry.name, subFiles);
                    }
                    continue;
                }

                // Skip 0-byte or empty orphan files
                if (entry.size === 0) continue;

                // For root-level files, group by clean title
                const cleanKey = extractCleanGameTitle(entry.name);
                if (!gameGroups.has(cleanKey)) {
                    gameGroups.set(cleanKey, []);
                }
                gameGroups.get(cleanKey)!.push(entry);
            }

            // Transform groups into InstalledGame items
            for (const [groupName, entries] of gameGroups.entries()) {
                const nonAux = entries.filter(e => !isAuxiliaryFile(e.name));
                // Only consider it a game if it contains at least one recognized ROM file
                if (nonAux.length === 0 && !entries.some(e => /\.(m3u|m3u8|cue|iso|chd|bin|zip|7z)$/i.test(e.name))) {
                    continue;
                }

                const totalBytes = entries.reduce((sum, e) => sum + (e.size || 0), 0);
                const files: InstalledGameFile[] = entries.map(e => ({
                    name: e.name,
                    uri: e.uri,
                    size: e.size || 0,
                    isAux: isAuxiliaryFile(e.name),
                }));

                const platformInfo = knownPlatforms.find(p => p.slug === folder.platformSlug || p.name === folder.platformName);

                results.push({
                    id: `${folder.platformSlug}_${groupName}`,
                    name: groupName,
                    cleanTitle: groupName,
                    platformSlug: folder.platformSlug,
                    platformName: folder.platformName,
                    folderUri: folder.folderUri,
                    files,
                    totalSizeBytes: totalBytes,
                    isMultiFile: nonAux.length > 1,
                });
            }

        } catch (err) {
            console.warn(`Error scanning installed ROMs in ${folder.folderName}:`, err);
        }
    }

    return results;
}

export async function deleteInstalledGame(game: InstalledGame): Promise<number> {
    let deletedBytes = 0;

    for (const file of game.files) {
        try {
            if (RNPlatform.OS === 'android') {
                const directPath = resolveAndroidPath(file.uri);
                if (directPath && await RNFS.exists(directPath)) {
                    await RNFS.unlink(directPath);
                    deletedBytes += file.size;
                } else {
                    await SAF.unlink(file.uri);
                    deletedBytes += file.size;
                }
            } else {
                await FileSystem.deleteAsync(file.uri, { idempotent: true });
                deletedBytes += file.size;
            }
        } catch (err) {
            console.warn(`Error deleting file ${file.name}:`, err);
        }
    }

    return deletedBytes;
}

export async function detectDefaultRomFolder(): Promise<string | null> {
    if (RNPlatform.OS !== 'android') return null;
    const candidates = [
        '/sdcard/ROMs',
        '/storage/emulated/0/ROMs',
        '/sdcard/Roms',
        '/storage/emulated/0/Roms',
    ];
    for (const path of candidates) {
        try {
            if (await RNFS.exists(path)) {
                return path;
            }
        } catch {}
    }
    return null;
}

export interface RomVerificationResult {
    status: 'verified' | 'mismatch' | 'no_server_hash' | 'file_not_found' | 'error';
    computedHash?: string;
    expectedHash?: string;
    algorithm?: 'md5' | 'sha1';
    fileSizeBytes?: number;
    expectedSizeBytes?: number;
    message: string;
}

export async function verifyRomIntegrity(
    localFilePath: string,
    romFile: RomFile
): Promise<RomVerificationResult> {
    try {
        const resolved = resolveAndroidPath(localFilePath) || localFilePath;
        const exists = await RNFS.exists(resolved);
        if (!exists) {
            return {
                status: 'file_not_found',
                message: `Local file not found at ${resolved}`,
            };
        }

        const stat = await RNFS.stat(resolved);
        const actualSize = Number(stat.size);
        const expectedSize = romFile.file_size_bytes;

        const expectedMd5 = romFile.md5_hash?.trim();
        const expectedSha1 = romFile.sha1_hash?.trim();

        let algorithm: 'md5' | 'sha1' | null = null;
        let expectedHash: string | null = null;

        if (expectedMd5) {
            algorithm = 'md5';
            expectedHash = expectedMd5.toLowerCase();
        } else if (expectedSha1) {
            algorithm = 'sha1';
            expectedHash = expectedSha1.toLowerCase();
        }

        if (!algorithm || !expectedHash) {
            const sizeMatches = expectedSize ? actualSize === expectedSize : true;
            return {
                status: sizeMatches ? 'no_server_hash' : 'mismatch',
                fileSizeBytes: actualSize,
                expectedSizeBytes: expectedSize,
                message: sizeMatches
                    ? `File size matches (${formatBytes(actualSize)}), but server has no cryptographic hash for this title.`
                    : `Size mismatch: Local is ${formatBytes(actualSize)}, server expects ${formatBytes(expectedSize)}.`,
            };
        }

        const computedHash = (await RNFS.hash(resolved, algorithm)).toLowerCase();
        const hashMatches = computedHash === expectedHash;

        if (hashMatches) {
            return {
                status: 'verified',
                algorithm,
                computedHash,
                expectedHash,
                fileSizeBytes: actualSize,
                expectedSizeBytes: expectedSize,
                message: `Verified authentic Redump/No-Intro dump! Matching ${algorithm.toUpperCase()}: ${computedHash}`,
            };
        } else {
            return {
                status: 'mismatch',
                algorithm,
                computedHash,
                expectedHash,
                fileSizeBytes: actualSize,
                expectedSizeBytes: expectedSize,
                message: `Integrity check failed!\nExpected ${algorithm.toUpperCase()}: ${expectedHash}\nComputed ${algorithm.toUpperCase()}: ${computedHash}`,
            };
        }
    } catch (err: any) {
        return {
            status: 'error',
            message: err?.message || 'Error verifying ROM hash',
        };
    }
}

