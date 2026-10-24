import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Rom, apiClient } from './api';

const FAVORITES_STORAGE_KEY = '@romm_favorite_ids';
const FAVORITES_OBJECTS_KEY = '@romm_favorite_objects';

type Listener = (favorites: number[], roms: Rom[]) => void;

class FavoritesService {
    private favoriteIds: Set<number> = new Set();
    private favoriteRoms: Map<number, Rom> = new Map();
    private initialized: boolean = false;
    private listeners: Set<Listener> = new Set();

    constructor() {
        this.loadFavorites();
    }

    async loadFavorites(): Promise<{ ids: number[]; roms: Rom[] }> {
        try {
            const [idsRaw, romsRaw] = await Promise.all([
                AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
                AsyncStorage.getItem(FAVORITES_OBJECTS_KEY),
            ]);

            if (idsRaw) {
                const parsedIds: number[] = JSON.parse(idsRaw);
                this.favoriteIds = new Set(parsedIds);
            } else {
                this.favoriteIds = new Set();
            }

            if (romsRaw) {
                const parsedRoms: Rom[] = JSON.parse(romsRaw);
                this.favoriteRoms = new Map();
                parsedRoms.forEach(r => {
                    if (this.favoriteIds.has(r.id)) {
                        this.favoriteRoms.set(r.id, r);
                    }
                });
            }
        } catch (e) {
            console.error('Failed to load favorites:', e);
            this.favoriteIds = new Set();
            this.favoriteRoms = new Map();
        } finally {
            this.initialized = true;
            this.notify();
        }
        return { ids: Array.from(this.favoriteIds), roms: Array.from(this.favoriteRoms.values()) };
    }

    getFavoriteIds(): number[] {
        return Array.from(this.favoriteIds);
    }

    getFavoriteRoms(): Rom[] {
        return Array.from(this.favoriteRoms.values());
    }

    isFavorite(romId: number): boolean {
        return this.favoriteIds.has(romId);
    }

    async toggleFavorite(romOrId: Rom | number, romData?: Rom): Promise<boolean> {
        const id = typeof romOrId === 'number' ? romOrId : romOrId.id;
        const romObj = typeof romOrId === 'object' ? romOrId : romData;

        const nextState = !this.favoriteIds.has(id);
        if (nextState) {
            this.favoriteIds.add(id);
            if (romObj) {
                this.favoriteRoms.set(id, romObj);
            } else {
                // Background fetch missing ROM details
                this.fetchMissingRom(id);
            }
        } else {
            this.favoriteIds.delete(id);
            this.favoriteRoms.delete(id);
        }

        try {
            await Promise.all([
                AsyncStorage.setItem(
                    FAVORITES_STORAGE_KEY,
                    JSON.stringify(Array.from(this.favoriteIds))
                ),
                AsyncStorage.setItem(
                    FAVORITES_OBJECTS_KEY,
                    JSON.stringify(Array.from(this.favoriteRoms.values()))
                ),
            ]);
        } catch (e) {
            console.error('Failed to persist favorites:', e);
        }

        this.notify();
        return nextState;
    }

    private async fetchMissingRom(id: number) {
        try {
            const fetched = await apiClient.getRomById(id);
            if (fetched && this.favoriteIds.has(id)) {
                this.favoriteRoms.set(id, fetched);
                await AsyncStorage.setItem(
                    FAVORITES_OBJECTS_KEY,
                    JSON.stringify(Array.from(this.favoriteRoms.values()))
                );
                this.notify();
            }
        } catch (err) {
            console.warn(`Could not fetch details for favorited rom #${id}:`, err);
        }
    }

    async refreshMissingRoms() {
        const missingIds = Array.from(this.favoriteIds).filter(id => !this.favoriteRoms.has(id));
        if (missingIds.length === 0) return;

        for (const id of missingIds) {
            await this.fetchMissingRom(id);
        }
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(Array.from(this.favoriteIds), Array.from(this.favoriteRoms.values()));
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        const currentIds = Array.from(this.favoriteIds);
        const currentRoms = Array.from(this.favoriteRoms.values());
        this.listeners.forEach(listener => {
            try {
                listener(currentIds, currentRoms);
            } catch (err) {
                console.error('Error notifying favorite listener:', err);
            }
        });
    }
}

export const favoritesService = new FavoritesService();

export function useFavorites() {
    const [favorites, setFavorites] = useState<number[]>(() => favoritesService.getFavoriteIds());
    const [favoriteRoms, setFavoriteRoms] = useState<Rom[]>(() => favoritesService.getFavoriteRoms());

    useEffect(() => {
        return favoritesService.subscribe((updatedIds, updatedRoms) => {
            setFavorites(updatedIds);
            setFavoriteRoms(updatedRoms);
        });
    }, []);

    const isFavorite = (romId: number) => favoritesService.isFavorite(romId);
    const toggleFavorite = (romOrId: Rom | number, romData?: Rom) => favoritesService.toggleFavorite(romOrId, romData);
    const refreshMissingRoms = () => favoritesService.refreshMissingRoms();

    return {
        favorites,
        favoriteRoms,
        isFavorite,
        toggleFavorite,
        refreshMissingRoms,
    };
}
