/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-owned, lazy renderer host for the Framescaper native-services tier. */

import React, { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import {
	DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
	FRAMESCAPER_NATIVE_SERVICES_RENDERER_REFRESH_INTERVAL_MS,
	framescaperNativeServicesStoreFor,
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesProjection,
	type FramescaperNativeServicesRendererSnapshot,
} from '../framescaper-native-services-bridge.ts';
import type { FramescaperNativeServiceSurface } from '../framescaper-native-services-menu.ts';
import {
	availableFramescaperNativeServicesLifecycleMethods,
	type FramescaperNativeServicesLifecycleMethod,
} from '../framescaper-native-services-lifecycle-bridge.ts';
import type {
	FramescaperNativeServicesDialogContext,
} from '../dialogs/FramescaperNativeServicesDialog.tsx';
import {
	isFramescaperNativeProjectActionRuntime,
	type FramescaperNativeProjectActionRuntime,
} from '../framescaper-native-project-actions.ts';

const FramescaperNativeServicesDialog = React.lazy(() => (
	import('../dialogs/FramescaperNativeServicesDialog.tsx')
));

export const PENDING_FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT:
	FramescaperNativeServicesRendererSnapshot = Object.freeze({
		services: Object.freeze({
			snapshotVersion: 1,
			runtimeAvailable: false,
			nativeMediaEnabled: false,
			queue: Object.freeze([]),
			roots: Object.freeze([]),
			watchRules: Object.freeze([]),
		}),
		capabilitySnapshot: null,
		preferences: DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
		controllablePreferences: Object.freeze([]),
		externalDisplays: Object.freeze([]),
		activeExternalDisplayId: null,
	});

export interface FramescaperNativeServicesWorkspaceRuntime {
	readonly services: FramescaperNativeServicesProjection;
	readonly capabilitySnapshot: FramescaperNativeServicesRendererSnapshot['capabilitySnapshot'];
	readonly externalDisplays: FramescaperNativeServicesRendererSnapshot['externalDisplays'];
	readonly activeExternalDisplayId: string | null;
	readonly lifecycleMethods: readonly FramescaperNativeServicesLifecycleMethod[];
	readonly projectActionSurfaces: FramescaperNativeProjectActionRuntime['surfaces'];
	open(surface: FramescaperNativeServiceSurface): void;
	openExternalDisplay(displayId: string | null): Promise<FramescaperNativeServicesRendererSnapshot>;
}

export type FramescaperNativeServicesMenuRuntime = Omit<
	FramescaperNativeServicesWorkspaceRuntime,
	'openExternalDisplay'
> & Readonly<{ openExternalDisplay(displayId: string | null): unknown }>;

export interface FramescaperNativeServicesSurfaceHost {
	open(surface: FramescaperNativeServiceSurface, context?: FramescaperNativeServicesDialogContext): void;
	close(): void;
	dispose(): void;
}

interface FramescaperNativeServicesHostRoot {
	render(node: React.ReactNode): void;
	unmount(): void;
}

export interface FramescaperNativeServicesSurfaceHostOptions {
	readonly bridge: FramescaperNativeServicesBridge;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly projectActions?: FramescaperNativeProjectActionRuntime | null;
	readonly documentValue?: Document | null;
	readonly createHostRoot?: (container: HTMLElement) => FramescaperNativeServicesHostRoot;
}

export function createFramescaperNativeServicesSurfaceHost(
	options: FramescaperNativeServicesSurfaceHostOptions,
): FramescaperNativeServicesSurfaceHost {
	const documentValue = options.documentValue
		?? (typeof document === 'undefined' ? null : document);
	let container: HTMLElement | null = null;
	let root: FramescaperNativeServicesHostRoot | null = null;
	const close = (): void => { root?.render(null); };
	return Object.freeze({
		open: (surface: FramescaperNativeServiceSurface, context?: FramescaperNativeServicesDialogContext) => {
			if (!documentValue) return;
			if (!container) {
				container = documentValue.createElement('div');
				container.dataset.editorSurface = 'framescaper-native-services';
				(documentValue.querySelector('[data-audio-editor]') ?? documentValue.body).append(container);
			}
			root ??= (options.createHostRoot ?? ((element: HTMLElement) => createRoot(element)))(container);
			root.render(<React.Suspense fallback={null}>
				<FramescaperNativeServicesDialog
					bridge={options.bridge}
					initialSurface={surface}
					copy={options.copy}
					context={context}
					projectActions={options.projectActions}
					onClose={close}
				/>
			</React.Suspense>);
		},
		close,
		dispose: () => {
			root?.unmount();
			root = null;
			container?.remove();
			container = null;
		},
	});
}

const HOSTS = new WeakMap<FramescaperNativeServicesBridge, FramescaperNativeServicesSurfaceHost>();
const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined;
const EMPTY_SNAPSHOT = (): null => null;

/** Rebuild menu gates when the asynchronous main-owned status changes. */
export function useFramescaperNativeServicesMenuRefresh(input: Readonly<{
	productId: string;
	bridge?: FramescaperNativeServicesBridge | null;
}>): void {
	const bridge = resolveBridge(input);
	const store = bridge === null ? null : framescaperNativeServicesStoreFor(bridge);
	useSyncExternalStore(
		store?.subscribe ?? EMPTY_SUBSCRIBE,
		store?.getSnapshot ?? EMPTY_SNAPSHOT,
		store?.getSnapshot ?? EMPTY_SNAPSHOT,
	);
	useEffect(() => {
		if (store === null) return undefined;
		store.refreshIfStale();
		const interval = globalThis.setInterval(
			() => store.refreshIfStale(),
			FRAMESCAPER_NATIVE_SERVICES_RENDERER_REFRESH_INTERVAL_MS,
		);
		return () => globalThis.clearInterval(interval);
	}, [store]);
}

export function resolveFramescaperNativeServicesWorkspaceRuntime(input: Readonly<{
	productId: string;
	bridge?: FramescaperNativeServicesBridge | null;
	copy?: Readonly<Record<string, string | undefined>>;
	project?: unknown;
	projectCapabilities?: Readonly<Record<string, unknown>>;
	projectActions?: FramescaperNativeProjectActionRuntime | null;
}>): Readonly<FramescaperNativeServicesWorkspaceRuntime> | null {
	const bridge = resolveBridge(input);
	if (bridge === null) return null;
	const store = framescaperNativeServicesStoreFor(bridge);
	store.refreshIfStale();
	const snapshot = store.getSnapshot() ?? PENDING_FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT;
	const lifecycleMethods = availableFramescaperNativeServicesLifecycleMethods(bridge);
	const context = dialogContext(input.project, input.projectCapabilities);
	const projectActions = isFramescaperNativeProjectActionRuntime(input.projectActions)
		? input.projectActions : null;
	return Object.freeze({
		services: snapshot.services,
		capabilitySnapshot: snapshot.capabilitySnapshot,
		externalDisplays: snapshot.externalDisplays,
		activeExternalDisplayId: snapshot.activeExternalDisplayId,
		lifecycleMethods,
		projectActionSurfaces: projectActions?.surfaces ?? Object.freeze([]),
		open: (surface: FramescaperNativeServiceSurface) => {
			let host = HOSTS.get(bridge);
			if (!host) {
				host = createFramescaperNativeServicesSurfaceHost({
					bridge, copy: input.copy, projectActions,
				});
				HOSTS.set(bridge, host);
			}
			host.open(surface, context);
		},
		openExternalDisplay: (displayId: string | null) => store.setExternalDisplay(displayId),
	});
}

/** Route a promise-returning display selection through the workspace error surface. */
export function wrapFramescaperNativeServicesMenuRuntime(
	runtime: Readonly<FramescaperNativeServicesWorkspaceRuntime> | null,
	run: (operation: () => unknown) => unknown,
): Readonly<FramescaperNativeServicesMenuRuntime> | null {
	if (runtime === null) return null;
	return Object.freeze({
		...runtime,
		openExternalDisplay: (displayId: string | null) => run(
			() => runtime.openExternalDisplay(displayId),
		),
	});
}

function dialogContext(
	project: unknown,
	capabilities: Readonly<Record<string, unknown>> | undefined,
): FramescaperNativeServicesDialogContext {
	const row = project !== null && typeof project === 'object' && !Array.isArray(project)
		? project as Readonly<Record<string, unknown>> : null;
	const idValue = ownData(row, 'id');
	const versionValue = ownData(row, 'schemaVersion');
	const projectId = typeof idValue === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(idValue)
		? idValue : null;
	const schemaVersion = Number.isSafeInteger(versionValue) ? Number(versionValue) : null;
	return Object.freeze({
		projectId,
		binId: null,
		allowProxyGeneration: (schemaVersion === 25 || schemaVersion === 26)
			&& capabilities?.sourceCharacteristics === true,
	});
}

function ownData(record: Readonly<Record<string, unknown>> | null, key: string): unknown {
	if (record === null) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		? descriptor.value : undefined;
}

function resolveBridge(input: Readonly<{
	productId: string;
	bridge?: FramescaperNativeServicesBridge | null;
}>): FramescaperNativeServicesBridge | null {
	return input.productId === 'framescaper'
		? input.bridge ?? resolveFramescaperNativeServicesBridge()
		: null;
}
