/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
	desktopNativeTierControlsStoreFor,
	DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS,
	PENDING_DESKTOP_NATIVE_TIER_CONTROLS,
	type DesktopNativeTierControlAction,
	type DesktopNativeTierControlsBridge,
	type DesktopWindowAction,
} from '../desktop-host-menu.ts';
import {
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';

interface DesktopHostFileService extends DesktopNativeTierControlsBridge {
	readonly bridge?: SoundscaperNativeServicesBridge | null;
	readonly isDesktop: boolean;
	runWindowAction(action: DesktopWindowAction): unknown;
	checkForUpdates(): unknown;
	openExternal(destination: 'help' | 'source'): unknown;
}

export interface DesktopHostMenuRuntime {
	readonly development: boolean;
	readonly platform?: string;
	readonly snapshot: typeof PENDING_DESKTOP_NATIVE_TIER_CONTROLS;
	applyNativeTierControl(action: DesktopNativeTierControlAction, enabled?: boolean): void;
	runWindowAction(action: DesktopWindowAction): void;
	checkForUpdates(): void;
	openExternal(destination: 'help' | 'source'): void;
}

interface DesktopHostMenuRuntimeInput {
	readonly development: boolean;
	readonly fileService: DesktopHostFileService;
	readonly platform?: string;
	readonly productId: string;
	onError(error: unknown): void;
}

const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined;
const EMPTY_SNAPSHOT = (): null => null;

export function useDesktopHostMenuRuntime({
	development,
	fileService,
	onError,
	platform,
	productId,
}: DesktopHostMenuRuntimeInput): DesktopHostMenuRuntime | null {
	const store = useMemo(() => fileService.isDesktop
		&& typeof fileService.readNativeTierControls === 'function'
		&& typeof fileService.applyNativeTierControl === 'function'
		? desktopNativeTierControlsStoreFor(fileService)
		: null, [fileService]);
	const snapshot = useSyncExternalStore(
		store?.subscribe ?? EMPTY_SUBSCRIBE,
		store?.getSnapshot ?? EMPTY_SNAPSHOT,
		store?.getSnapshot ?? EMPTY_SNAPSHOT,
	);
	useEffect(() => {
		if (store === null) return undefined;
		store.refreshIfStale(undefined, onError);
		const interval = globalThis.setInterval(
			() => store.refreshIfStale(undefined, onError),
			DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS,
		);
		return () => globalThis.clearInterval(interval);
	}, [onError, store]);
	return useMemo(() => store === null ? null : Object.freeze({
		development,
		platform,
		snapshot: snapshot ?? PENDING_DESKTOP_NATIVE_TIER_CONTROLS,
		applyNativeTierControl: (action: DesktopNativeTierControlAction, enabled?: boolean) => {
			void store.apply(action, enabled).then(() => {
				if (productId !== 'soundscaper' || !fileService.bridge) return undefined;
				return soundscaperNativeServicesStoreFor(fileService.bridge).refresh();
			}).catch(onError);
		},
		runWindowAction: (action: DesktopWindowAction) => {
			try {
				void Promise.resolve(fileService.runWindowAction(action)).catch(onError);
			} catch (error) {
				onError(error);
			}
		},
		checkForUpdates: () => { void Promise.resolve(fileService.checkForUpdates()).catch(onError); },
		openExternal: (destination: 'help' | 'source') => {
			void Promise.resolve(fileService.openExternal(destination)).catch(onError);
		},
	}), [development, fileService, onError, platform, productId, snapshot, store]);
}
