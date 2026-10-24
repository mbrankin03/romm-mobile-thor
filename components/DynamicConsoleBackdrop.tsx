import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export const PLATFORM_THEME_COLORS: Record<string, string> = {
    gba: '#6B21A8',       // GBA Indigo / Purple
    gbc: '#7E22CE',       // GBC Violet
    gb: '#4D7C0F',        // Game Boy Olive Green
    ps1: '#1E3A8A',       // PS1 Navy Blue
    ps2: '#1E40AF',       // PS2 Royal Blue
    ps3: '#0F172A',       // PS3 Slate
    ps4: '#1D4ED8',       // PS4 Blue
    psp: '#334155',       // PSP Charcoal
    psvita: '#0284C7',    // PS Vita Sky Blue
    vita: '#0284C7',
    dc: '#EA580C',        // Dreamcast Orange
    dreamcast: '#EA580C',
    genesis: '#0369A1',   // Mega Drive / Genesis Blue
    megadrive: '#0369A1',
    md: '#0369A1',
    saturn: '#D97706',    // Saturn Amber / Gold
    sega32x: '#B91C1C',   // 32X Crimson
    segacd: '#0D9488',    // Sega CD Teal
    gamegear: '#475569',  // Game Gear Slate
    gg: '#475569',
    snes: '#7C3AED',      // SNES Purple / Lavender
    nes: '#DC2626',       // NES Red
    n64: '#15803D',       // N64 Emerald Green
    gamecube: '#4338CA',  // GameCube Indigo
    gc: '#4338CA',
    wii: '#0EA5E9',       // Wii Light Cyan
    wiiu: '#0284C7',      // Wii U Blue
    switch: '#E11D48',    // Switch Neon Red
    nds: '#0891B2',       // NDS Teal
    ds: '#0891B2',
    '3ds': '#E11D48',     // 3DS Red
    xbox: '#15803D',      // Xbox Green
    xbox360: '#65A30D',   // Xbox 360 Lime
    mame: '#CA8A04',      // Arcade Gold
    arcade: '#CA8A04',
    neogeo: '#E11D48',    // Neo Geo Red
    default: '#1E293B',   // Deep Slate
};

export type BackdropUpdateData = {
    imageUrl?: string | null;
    platformSlug?: string | null;
    accentColor?: string | null;
};

type Listener = (data: BackdropUpdateData) => void;
const listeners = new Set<Listener>();
let pendingUpdate: BackdropUpdateData | null = null;
let updateTimer: any = null;

export const updateBackdrop = (data: BackdropUpdateData, immediate: boolean = false) => {
    if (immediate) {
        if (updateTimer) {
            clearTimeout(updateTimer);
            updateTimer = null;
        }
        pendingUpdate = null;
        listeners.forEach(fn => fn(data));
        return;
    }

    pendingUpdate = data;
    if (!updateTimer) {
        updateTimer = setTimeout(() => {
            updateTimer = null;
            if (pendingUpdate) {
                const toApply = pendingUpdate;
                pendingUpdate = null;
                listeners.forEach(fn => fn(toApply));
            }
        }, 50);
    }
};

export interface DynamicConsoleBackdropProps {
    imageUrl?: string | null;
    platformSlug?: string | null;
    accentColor?: string | null;
}

export const DynamicConsoleBackdrop: React.FC<DynamicConsoleBackdropProps> = ({
    imageUrl,
    platformSlug,
    accentColor,
}) => {
    const calcColor = (slug?: string | null, accent?: string | null) => {
        const raw = slug ? slug.toLowerCase().trim() : '';
        return accent || (raw ? PLATFORM_THEME_COLORS[raw] : null) || PLATFORM_THEME_COLORS.default;
    };

    const [resolvedColor, setResolvedColor] = useState<string>(() => calcColor(platformSlug, accentColor));
    const [liveImageUrl, setLiveImageUrl] = useState<string | null>(imageUrl || null);

    // Sync from props if passed
    useEffect(() => {
        setResolvedColor(calcColor(platformSlug, accentColor));
    }, [platformSlug, accentColor]);

    useEffect(() => {
        setLiveImageUrl(imageUrl || null);
    }, [imageUrl]);

    // Listen to decoupled updateBackdrop calls
    useEffect(() => {
        const handler = (data: BackdropUpdateData) => {
            if (data.imageUrl !== undefined) {
                setLiveImageUrl(data.imageUrl);
            }
            if (data.platformSlug !== undefined || data.accentColor !== undefined) {
                setResolvedColor(calcColor(data.platformSlug, data.accentColor));
            }
        };
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    }, []);

    const [activeColor, setActiveColor] = useState<string>(resolvedColor);
    const [prevColor, setPrevColor] = useState<string | null>(null);
    const colorFadeAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (resolvedColor !== activeColor) {
            setPrevColor(activeColor);
            setActiveColor(resolvedColor);
            colorFadeAnim.setValue(0);
            Animated.timing(colorFadeAnim, {
                toValue: 1,
                duration: 350,
                useNativeDriver: true,
            }).start(() => {
                setPrevColor(null);
            });
        }
    }, [resolvedColor]);

    const [displayImage, setDisplayImage] = useState<string | null>(liveImageUrl || null);
    const imageFadeAnim = useRef(new Animated.Value(liveImageUrl ? 1 : 0)).current;

    useEffect(() => {
        if (!liveImageUrl) {
            Animated.timing(imageFadeAnim, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }).start(() => setDisplayImage(null));
            return;
        }

        if (liveImageUrl !== displayImage) {
            setDisplayImage(liveImageUrl);
            imageFadeAnim.setValue(0.2);
            Animated.timing(imageFadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [liveImageUrl]);

    return (
        <View
            pointerEvents="none"
            focusable={false}
            accessible={false}
            importantForAccessibility="no"
            style={styles.container}
        >
            {/* Previous Color Glow (fading out) */}
            {prevColor && (
                <Animated.View
                    style={[
                        styles.colorGlow,
                        {
                            backgroundColor: prevColor,
                            opacity: colorFadeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.35, 0],
                            }),
                        },
                    ]}
                />
            )}

            {/* Current Color Glow (fading in or solid) */}
            <Animated.View
                style={[
                    styles.colorGlow,
                    {
                        backgroundColor: activeColor,
                        opacity: prevColor
                            ? colorFadeAnim.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0, 0.35],
                              })
                            : 0.35,
                    },
                ]}
            />

            {/* Blurred Artwork Layer */}
            {displayImage && (
                <Animated.Image
                    source={{ uri: displayImage }}
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.blurredImage,
                        {
                            opacity: imageFadeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, 0.32],
                            }),
                        },
                    ]}
                    blurRadius={65}
                    resizeMode="cover"
                />
            )}

            {/* Dark Vignette Gradient Overlay */}
            <Svg height="100%" width="100%" style={StyleSheet.absoluteFillObject}>
                <Defs>
                    <LinearGradient id="consoleBackdropFade" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#000000" stopOpacity="0.35" />
                        <Stop offset="0.5" stopColor="#000000" stopOpacity="0.7" />
                        <Stop offset="1" stopColor="#000000" stopOpacity="0.95" />
                    </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#consoleBackdropFade)" />
            </Svg>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000000',
        zIndex: 0,
        overflow: 'hidden',
    },
    colorGlow: {
        position: 'absolute',
        top: -120,
        left: '10%',
        right: '10%',
        height: 480,
        borderRadius: 240,
        opacity: 0.35,
        transform: [{ scaleX: 1.5 }],
    },
    blurredImage: {
        width: '100%',
        height: '100%',
    },
});
