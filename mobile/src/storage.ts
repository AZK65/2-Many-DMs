import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const SERVER_URL_KEY = "omni.server-url";
const CACHE_PREFIX = "omni.cache.";

export async function loadServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(SERVER_URL_KEY);
}

export async function saveServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_URL_KEY, url, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function forgetServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // A full cache should never stop a live request from succeeding.
  }
}

export async function clearCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const cacheKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX));
  if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
}
