import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { WebView } from 'react-native-webview';
import { GamepadFocusable } from '../../components/GamepadFocusable';
import { PublicRoute } from '../../components/ProtectedRoute';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../hooks/useTranslation';
import { LoginCredentials, apiClient } from '../../services/api';

export default function LoginScreen() {
    const [credentials, setCredentials] = useState<LoginCredentials>({
        username: '',
        password: '',
    });
    const [serverUrl, setServerUrl] = useState<string>('http://192.168.1.147:8082');
    const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'failed'>('checking');
    const [showSsoWebView, setShowSsoWebView] = useState(false);
    const { login, isLoading, error, clearError, refreshUser } = useAuth();
    const { t } = useTranslation();
    const { showErrorToast, showSuccessToast } = useToast();
    const router = useRouter();

    // Load saved server URL on component mount
    useEffect(() => {
        const loadSavedUrl = async () => {
            try {
                const savedUrl = await SecureStore.getItemAsync('server_url');
                if (savedUrl) {
                    setServerUrl(savedUrl);
                    apiClient.updateBaseUrl(savedUrl);
                } else {
                    setServerUrl(apiClient.baseUrl);
                }
            } catch (error) {
                console.error('Failed to load saved URL:', error);
                setServerUrl(apiClient.baseUrl);
            }
        };

        loadSavedUrl();
    }, []);

    // Test connection on component mount and when URL changes
    useEffect(() => {
        const testConnection = async () => {
            if (!serverUrl.trim()) return;

            setConnectionStatus('checking');
            try {
                const formattedUrl = formatUrl(serverUrl);
                apiClient.updateBaseUrl(formattedUrl);

                const isConnected = await apiClient.heartbeat();
                console.log("Trying to connect to server:", formattedUrl);
                setConnectionStatus(isConnected ? 'connected' : 'failed');
            } catch (error) {
                console.error('Connection test failed:', error);
                setConnectionStatus('failed');
            }
        };

        if (serverUrl) {
            // Add debouncing to avoid rapid state changes
            const timeoutId = setTimeout(() => {
                testConnection();
            }, 800);

            return () => clearTimeout(timeoutId);
        }
    }, [serverUrl]);

    const formatUrl = (url: string): string => {
        if (!url.trim()) return url;

        let formattedUrl = url.trim();

        // Add http:// if no protocol is specified
        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
            formattedUrl = 'http://' + formattedUrl;
        }

        // Remove trailing slash
        formattedUrl = formattedUrl.replace(/\/$/, '');

        return formattedUrl;
    };

    const handleUrlChange = async (newUrl: string) => {
        setServerUrl(newUrl);
        if (newUrl.trim()) {
            try {
                const formattedUrl = formatUrl(newUrl);
                apiClient.updateBaseUrl(formattedUrl);
                await SecureStore.setItemAsync('server_url', formattedUrl);
            } catch (error) {
                console.error('Failed to save URL:', error);
            }
        }
    };

    const handleLogin = async () => {
        if (!credentials.username.trim() || !credentials.password.trim()) {
            showErrorToast(t('enterUsernameAndPassword'), t('error'));
            return;
        }

        try {
            clearError();

            // Ensure URL is properly formatted before login
            const formattedUrl = formatUrl(serverUrl);
            apiClient.updateBaseUrl(formattedUrl);

            await login(credentials);

            // Save the formatted server URL after successful login
            if (formattedUrl.trim()) {
                try {
                    await SecureStore.setItemAsync('server_url', formattedUrl);
                } catch (error) {
                    console.error('Failed to save URL after login:', error);
                }
            }

            router.replace('/');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t('errorDuringLogin');
            showErrorToast(errorMessage, t('loginError'));
        }
    };

    const handleSsoLogin = () => {
        const formattedUrl = formatUrl(serverUrl);
        apiClient.updateBaseUrl(formattedUrl);
        setShowSsoWebView(true);
    };

    const handleWebViewNavigationStateChange = async (navState: any) => {
        const { url } = navState;
        console.log('WebView URL:', url);

        // Check if we are redirected to the home page or a success page
        // The API docs say /api/oauth/openid redirects to home page on success
        // We can check if the URL is the base URL (with or without trailing slash)
        const baseUrl = apiClient.baseUrl;
        const cleanUrl = url.replace(/\/$/, '').toLowerCase();
        const cleanBaseUrl = baseUrl.replace(/\/$/, '').toLowerCase();

        // Check if we are back at the base URL
        // We also check if the URL starts with the base URL and doesn't contain /api/login or /api/oauth
        // This covers cases where we might be redirected to /library or /# etc.
        const isBackAtHome = cleanUrl === cleanBaseUrl ||
            (cleanUrl.startsWith(cleanBaseUrl) &&
                !cleanUrl.includes('/api/login') &&
                !cleanUrl.includes('/api/oauth') &&
                !cleanUrl.includes('/auth/'));

        if (isBackAtHome || cleanUrl.includes('/?login=success')) {
            console.log('Detected return to home, checking session...');
            // Add a small delay to ensure cookies are set
            setTimeout(() => checkSessionAndClose(), 1000);
        }
    };

    const checkSessionAndClose = async () => {
        try {
            const isValid = await apiClient.checkSession();
            if (isValid) {
                await refreshUser(); // Update global auth state
                setShowSsoWebView(false);
                showSuccessToast(t('loginSuccess'), t('success'));
                router.replace('/');
            } else {
                console.log('Session check failed after redirect');
            }
        } catch (error) {
            console.error('SSO verification failed:', error);
        }
    };

    const handleCloseModal = async () => {
        // When closing manually, we also check the session just in case
        const isValid = await apiClient.checkSession();
        if (isValid) {
            await refreshUser(); // Update global auth state
            setShowSsoWebView(false);
            showSuccessToast(t('loginSuccess'), t('success'));
            router.replace('/');
        } else {
            setShowSsoWebView(false);
        }
    };

    return (
        <PublicRoute>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.scrollContainer}>
                    <View style={styles.formContainer}>
                        <Text style={styles.title}>RomM</Text>
                        <Text style={styles.subtitle}>{t('loginToAccount')}</Text>

                        {/* Connection Status */}
                        <View style={styles.connectionStatus}>
                            {connectionStatus === 'checking' && (
                                <View style={styles.statusRow}>
                                    <ActivityIndicator size="small" color="#007AFF" />
                                    <Text style={styles.statusText}>{t('verifyingConnection')}</Text>
                                </View>
                            )}
                            {connectionStatus === 'connected' && (
                                <View style={styles.statusRow}>
                                    <Text style={styles.statusIcon}>✓</Text>
                                    <Text style={[styles.statusText, styles.successText]}>
                                        {t('connectedToServer')}
                                    </Text>
                                </View>
                            )}
                            {connectionStatus === 'failed' && (
                                <View style={styles.statusRow}>
                                    <Text style={styles.statusIcon}>⚠️</Text>
                                    <Text style={[styles.statusText, styles.errorText]}>
                                        {t('unableToConnectToServer')}
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Server URL Configuration */}
                        <View style={styles.inputContainer}>
                            <Text style={styles.label}>{t('serverUrl')}</Text>
                            <TextInput
                                style={styles.input}
                                value={serverUrl}
                                onChangeText={handleUrlChange}
                                placeholder="192.168.1.100:8080"
                                placeholderTextColor="#666"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isLoading}
                                keyboardType="url"
                            />
                            <Text style={styles.urlHint}>
                                {t('serverUrlHint')} {'\n'}
                                {t('exampleUrl')}
                            </Text>
                        </View>

                        {error && (
                            <View style={styles.errorContainer}>
                                <Text style={styles.errorContainerText}>{error}</Text>
                            </View>
                        )}

                        <View style={styles.inputContainer}>
                            <Text style={styles.label}>{t('username')}</Text>
                            <TextInput
                                style={styles.input}
                                value={credentials.username}
                                onChangeText={(text) => setCredentials(prev => ({ ...prev, username: text }))}
                                placeholder={t('enterUsername')}
                                placeholderTextColor="#666"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isLoading}
                            />
                        </View>

                        <View style={styles.inputContainer}>
                            <Text style={styles.label}>{t('password')}</Text>
                            <TextInput
                                style={styles.input}
                                value={credentials.password}
                                onChangeText={(text) => setCredentials(prev => ({ ...prev, password: text }))}
                                placeholder={t('enterPassword')}
                                placeholderTextColor="#666"
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isLoading}
                            />
                        </View>

                        <GamepadFocusable
                            style={[styles.loginButton, isLoading && styles.disabledButton]}
                            onPress={handleLogin}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.loginButtonText}>{t('login')}</Text>
                            )}
                        </GamepadFocusable>

                        <View style={styles.divider}>
                            <View style={styles.dividerLine} />
                            <Text style={styles.dividerText}>{t('or')}</Text>
                            <View style={styles.dividerLine} />
                        </View>

                        <GamepadFocusable
                            style={[styles.ssoButton, isLoading && styles.disabledButton]}
                            onPress={handleSsoLogin}
                            disabled={isLoading}
                        >
                            <Text style={styles.ssoButtonText}>{t('loginWithSso')}</Text>
                        </GamepadFocusable>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            <Modal
                visible={showSsoWebView}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={handleCloseModal}
            >
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{t('loginWithSso')}</Text>
                        <TouchableOpacity onPress={handleCloseModal} style={styles.closeButton}>
                            <Text style={styles.closeButtonText}>{t('close')}</Text>
                        </TouchableOpacity>
                    </View>
                    <WebView
                        source={{ uri: `${apiClient.baseUrl}/api/login/openid` }}
                        onNavigationStateChange={handleWebViewNavigationStateChange}
                        startInLoadingState={true}
                        renderLoading={() => <ActivityIndicator size="large" color="#5f43b2" style={styles.loader} />}
                        sharedCookiesEnabled={true}
                        thirdPartyCookiesEnabled={true}
                        userAgent="Mozilla/5.0 (Linux; Android 10; Android SDK built for x86) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36"
                        injectedJavaScriptBeforeContentLoaded={`
                            // Disable WebAuthn to force fallback
                            window.PublicKeyCredential = undefined;
                        `}
                        injectedJavaScript={`
                            const consoleLog = console.log;
                            const consoleWarn = console.warn;
                            const consoleError = console.error;
                            
                            console.log = (...args) => {
                                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: args.join(' ') }));
                                consoleLog(...args);
                            };
                            console.warn = (...args) => {
                                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'warn', message: args.join(' ') }));
                                consoleWarn(...args);
                            };
                            console.error = (...args) => {
                                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: args.join(' ') }));
                                consoleError(...args);
                            };
                            true;
                        `}
                        onMessage={(event) => {
                            try {
                                const data = JSON.parse(event.nativeEvent.data);
                                console.log(`[WebView ${data.type.toUpperCase()}]`, data.message);
                            } catch (e) {
                                console.log('[WebView Message]', event.nativeEvent.data);
                            }
                        }}
                        onError={(syntheticEvent) => {
                            const { nativeEvent } = syntheticEvent;
                            console.warn('WebView error: ', nativeEvent);
                            showErrorToast(`WebView Error: ${nativeEvent.description}`, t('error'));
                        }}
                        onHttpError={(syntheticEvent) => {
                            const { nativeEvent } = syntheticEvent;
                            console.warn('WebView HTTP error: ', nativeEvent);
                            // Don't show toast for 401/403 as they might be part of the flow, but good to log
                        }}
                    />
                </SafeAreaView>
            </Modal>
        </PublicRoute>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 20,
    },
    formContainer: {
        width: '100%',
        maxWidth: 400,
        alignSelf: 'center',
    },
    title: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 18,
        color: '#ccc',
        textAlign: 'center',
        marginBottom: 20,
    },
    connectionStatus: {
        marginBottom: 20,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderColor: '#333',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusIcon: {
        fontSize: 16,
        marginRight: 8,
    },
    statusText: {
        fontSize: 14,
        color: '#ccc',
    },
    successText: {
        color: '#059669',
    },
    errorContainer: {
        backgroundColor: '#dc2626',
        padding: 12,
        borderRadius: 8,
        marginBottom: 20,
    },
    errorContainerText: {
        color: '#fff',
        textAlign: 'center',
        fontSize: 14,
    },
    errorText: {
        color: '#dc2626',
        textAlign: 'center',
        fontSize: 14,
    },
    inputContainer: {
        marginBottom: 20,
    },
    label: {
        fontSize: 16,
        color: '#fff',
        marginBottom: 8,
        fontWeight: '500',
    },
    input: {
        backgroundColor: '#1a1a1a',
        borderColor: '#333',
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        color: '#fff',
    },
    loginButton: {
        backgroundColor: '#5f43b2',
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        marginBottom: 16,
    },
    disabledButton: {
        backgroundColor: '#666',
    },
    loginButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
    },
    ssoButton: {
        backgroundColor: '#333',
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#555',
    },
    ssoButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#333',
    },
    dividerText: {
        color: '#666',
        paddingHorizontal: 10,
        fontSize: 14,
    },
    urlHint: {
        color: '#888',
        fontSize: 12,
        marginTop: 5,
        fontStyle: 'italic',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
        backgroundColor: '#000',
    },
    modalTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    closeButton: {
        padding: 8,
    },
    closeButtonText: {
        color: '#5f43b2',
        fontSize: 16,
        fontWeight: '600',
    },
    loader: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        zIndex: 1,
    },
});
