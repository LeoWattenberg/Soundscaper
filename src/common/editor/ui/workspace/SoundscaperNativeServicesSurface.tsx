/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The workspace's end of the milestone-5A native tier: the runtime the
 * application menu asks for, and the menu-opened host that renders the surface.
 *
 * Resolution is synchronous and hook-free because the menu model is built by a
 * plain function, so the tier reports what it already knows and refreshes in the
 * background. Until the first probe answers, the two surfaces that exist to turn
 * the tier on and to repair it are reachable and the rest say they are not ready
 * — the surface itself always re-reads the tier when it opens, so nothing a user
 * acts on is ever drawn from a stale menu.
 *
 * The pathless control host is mounted when the project runtime is composed so
 * an authored native rack can restore before playback. Its dialog DOM remains
 * absent until an existing menu explicitly opens it, so the tier adds no chrome.
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import {
	resolveSoundscaperNativeServicesBridge,
	SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS,
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import type {
	SoundscaperNativeServiceSurface,
	SoundscaperNativeServicesSnapshot,
} from '../soundscaper-native-services-menu.ts';
import { createSoundscaperNativeRendererBridge } from '../soundscaper-native-renderer-bridge.ts';
import {
	createSoundscaperNativeServicesDialogRuntime,
	type SoundscaperNativeServicesDialogRuntime,
} from '../soundscaper-native-services-dialog-runtime.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';

const SoundscaperNativeServicesDialog = React.lazy(() => (
	import('../dialogs/SoundscaperNativeServicesDialog.tsx')
));

/**
 * What an unanswered tier looks like. Nothing here claims a capability: no
 * backend, no enabled format, so every capability-gated entry stays disabled and
 * says which capability it is missing.
 */
export const PENDING_SOUNDSCAPER_NATIVE_SERVICES_SNAPSHOT: SoundscaperNativeServicesSnapshot =
	Object.freeze({
		enabled: true,
		quarantined: false,
		payloadAvailable: true,
		payloadDetail: '',
		usableAudioBackends: Object.freeze([]),
		enabledPluginFormats: Object.freeze([]),
	});

export interface SoundscaperNativeServicesWorkspaceRuntime {
	readonly snapshot: SoundscaperNativeServicesSnapshot;
	open(surface: SoundscaperNativeServiceSurface): void;
}

export interface SoundscaperNativeServicesSurfaceHost {
	readonly dialogRuntime: SoundscaperNativeServicesDialogRuntime;
	restoreProjectNativePlugins(): Promise<readonly unknown[]>;
	setCopy(copy: Readonly<Record<string, string | undefined>> | undefined): void;
	open(surface: SoundscaperNativeServiceSurface): void;
	close(): void;
	dispose(): Promise<void>;
}

interface SoundscaperNativeServicesHostRoot {
	render(node: React.ReactNode): void;
	unmount(): void;
}

export interface SoundscaperNativeServicesSurfaceHostOptions {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly engine?: EnginePublicApi | null;
	readonly controller?: Parameters<typeof createSoundscaperNativeRendererBridge>[0]['controller'];
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly documentValue?: Document | null;
	readonly createHostRoot?: (container: HTMLElement) => SoundscaperNativeServicesHostRoot;
	readonly createRendererBridge?: typeof createSoundscaperNativeRendererBridge;
}

export function createSoundscaperNativeServicesSurfaceHost(
	options: SoundscaperNativeServicesSurfaceHostOptions,
): SoundscaperNativeServicesSurfaceHost {
	const documentValue = options.documentValue
		?? (typeof document === 'undefined' ? null : document);
	let container: HTMLElement | null = null;
	let root: SoundscaperNativeServicesHostRoot | null = null;
	let returnFocus: HTMLElement | null = null;
	let copy = options.copy;
	let openSurface: SoundscaperNativeServiceSurface | null = null;
	const renderer = options.engine
		? (options.createRendererBridge ?? createSoundscaperNativeRendererBridge)({
			bridge: options.bridge, engine: options.engine, controller: options.controller,
		})
		: null;
	const bridge = renderer?.bridge ?? options.bridge;
	const dialogRuntime = createSoundscaperNativeServicesDialogRuntime(bridge);
	let restoredProject: unknown = Symbol('unrestored');
	let restoredStateKey = '';
	let restoration: Promise<readonly unknown[]> | null = null;
	let restorationResult: Promise<readonly unknown[]> | null = null;
	let disposal: Promise<void> | null = null;
	const close = (): void => {
		openSurface = null;
		root?.render(null);
		const target = returnFocus;
		returnFocus = null;
		if (!target) return;
		const restore = () => { if (target.isConnected) target.focus({ preventScroll: true }); };
		const animationFrame = documentValue?.defaultView?.requestAnimationFrame;
		if (animationFrame) animationFrame.call(documentValue.defaultView, restore);
		else queueMicrotask(restore);
	};
	const renderDialog = (surface: SoundscaperNativeServiceSurface): void => {
		root?.render(<React.Suspense fallback={null}>
			<SoundscaperNativeServicesDialog
				bridge={bridge}
				runtime={dialogRuntime}
				initialSurface={surface}
				copy={copy}
				onClose={close}
			/>
		</React.Suspense>);
	};
	return Object.freeze({
		dialogRuntime,
		restoreProjectNativePlugins: () => {
			if (!renderer) return Promise.resolve([]);
			const project = options.controller?.project;
			const stateKey = projectNativeStateKey(project);
			if (restorationResult && restoredProject === project && restoredStateKey === stateKey) {
				return restorationResult;
			}
			restoredProject = project;
			restoredStateKey = stateKey;
			restoration = renderer.restoreProjectNativePlugins().catch((error: unknown) => {
				if (restoredProject === project && restoredStateKey === stateKey) {
					restoredProject = Symbol('failed-restore');
					restorationResult = null;
				}
				throw error;
			}).finally(() => { restoration = null; });
			restorationResult = restoration;
			return restoration;
		},
		setCopy: (next: Readonly<Record<string, string | undefined>> | undefined) => {
			if (copy === next) return;
			copy = next;
			if (openSurface !== null) renderDialog(openSurface);
		},
		open: (surface: SoundscaperNativeServiceSurface) => {
			if (!documentValue) return;
			openSurface = surface;
			const activeElement = focusableElement(documentValue.activeElement)
				? documentValue.activeElement : null;
			returnFocus = documentValue.querySelector<HTMLElement>(
				'[data-application-menubar] [role="menuitem"][aria-expanded="true"]',
			) ?? activeElement;
			if (!container) {
				container = documentValue.createElement('div');
				container.dataset.editorSurface = 'soundscaper-native-services';
				// Inside the editor when there is one, so the surface inherits the
				// theme variables the workspace root carries rather than the bare page.
				(documentValue.querySelector('[data-audio-editor]') ?? documentValue.body).append(container);
			}
			root ??= (options.createHostRoot ?? ((element: HTMLElement) => createRoot(element)))(container);
			renderDialog(surface);
		},
		close,
		dispose: () => {
			if (disposal !== null) return disposal;
			const operation = (async () => {
				root?.unmount();
				root = null;
				openSurface = null;
				returnFocus = null;
				container?.remove();
				container = null;
				restoration = null;
				restorationResult = null;
				await renderer?.dispose();
			})();
			disposal = operation;
			void operation.catch(() => {
				if (disposal === operation) disposal = null;
			});
			return operation;
		},
	});
}

function focusableElement(value: unknown): value is HTMLElement {
	return value !== null && typeof value === 'object'
		&& typeof (value as Readonly<{ readonly focus?: unknown }>).focus === 'function';
}

interface OwnedHost {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly engine: EnginePublicApi | null;
	readonly host: SoundscaperNativeServicesSurfaceHost;
}

const HOSTS = new WeakMap<object, OwnedHost>();
const EMPTY_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_SNAPSHOT = (): null => null;

/** Rebuild the application menu when an asynchronous desktop probe changes. */
export function useSoundscaperNativeServicesMenuRefresh(input: Readonly<{
	productId: string;
	bridge?: SoundscaperNativeServicesBridge | null;
	copy?: Readonly<Record<string, string | undefined>>;
	engine?: EnginePublicApi | null;
	controller?: Parameters<typeof createSoundscaperNativeRendererBridge>[0]['controller'];
}>): void {
	const bridge = resolveBridge(input);
	const { controller } = input;
	const store = bridge === null ? null : soundscaperNativeServicesStoreFor(bridge);
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
			SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS,
		);
		return () => globalThis.clearInterval(interval);
	}, [store]);
	useEffect(() => {
		if (bridge === null) return undefined;
		const owner = hostOwner(controller, bridge);
		// Render may install a replacement under the same controller before this
		// lifecycle cleans up, so release only the host this effect observed.
		const owned = HOSTS.get(owner);
		return () => {
			if (owned) void releaseOwnedHost(owner, owned).catch(reportRuntimeReleaseFailure);
		};
	}, [bridge, controller, input.engine]);
}

/**
 * Only Soundscaper, and only where the desktop bridge answers for the whole
 * tier. Anywhere else this resolves to null, and the menu module drops every
 * native entry rather than showing a row that could never do anything.
 */
export function resolveSoundscaperNativeServicesWorkspaceRuntime(input: Readonly<{
	productId: string;
	bridge?: SoundscaperNativeServicesBridge | null;
	copy?: Readonly<Record<string, string | undefined>>;
	engine?: EnginePublicApi | null;
	controller?: Parameters<typeof createSoundscaperNativeRendererBridge>[0]['controller'];
}>): Readonly<SoundscaperNativeServicesWorkspaceRuntime> | null {
	const bridge = resolveBridge(input);
	if (bridge === null) return null;
	const store = soundscaperNativeServicesStoreFor(bridge);
	store.refreshIfStale();
	const owner = hostOwner(input.controller, bridge);
	let owned = HOSTS.get(owner);
	if (!owned || owned.bridge !== bridge || owned.engine !== (input.engine ?? null)) {
		if (owned) void owned.host.dispose().catch(reportRuntimeReleaseFailure);
		const host = createSoundscaperNativeServicesSurfaceHost({
			bridge, copy: input.copy, engine: input.engine, controller: input.controller,
		});
		owned = Object.freeze({ bridge, engine: input.engine ?? null, host });
		HOSTS.set(owner, owned);
	}
	const { host } = owned;
	host.setCopy(input.copy);
	void host.restoreProjectNativePlugins().catch((error: unknown) => {
		console.error('Persisted native plug-ins could not be restored:', error);
	});
	return Object.freeze({
		snapshot: store.getSnapshot() ?? PENDING_SOUNDSCAPER_NATIVE_SERVICES_SNAPSHOT,
		open: (surface: SoundscaperNativeServiceSurface) => {
			host.open(surface);
		},
	});
}

export function releaseSoundscaperNativeServicesWorkspaceRuntime(owner: object): void {
	void releaseOwnedHost(owner).catch(reportRuntimeReleaseFailure);
}

async function releaseOwnedHost(owner: object, expected: OwnedHost | null = null): Promise<void> {
	return releaseSoundscaperNativeServicesOwnedHost(HOSTS, owner, expected);
}

export async function releaseSoundscaperNativeServicesOwnedHost<Owned extends Readonly<{
	host: Pick<SoundscaperNativeServicesSurfaceHost, 'dispose'>;
}>>(hosts: WeakMap<object, Owned>, owner: object, expected: Owned | null = null): Promise<void> {
	const owned = hosts.get(owner);
	if (!owned || (expected !== null && owned !== expected)) return;
	hosts.delete(owner);
	try {
		await owned.host.dispose();
	} catch (error) {
		if (!hosts.has(owner)) hosts.set(owner, owned);
		throw error;
	}
}

function reportRuntimeReleaseFailure(error: unknown): void {
	console.error('The Soundscaper native workspace runtime did not close cleanly:', error);
}

function hostOwner(
	controller: object | null | undefined,
	bridge: SoundscaperNativeServicesBridge,
): object {
	return controller ?? bridge;
}

function projectNativeStateKey(project: unknown): string {
	const states = (project as { readonly nativePluginStates?: unknown } | null)?.nativePluginStates;
	if (!Array.isArray(states)) return '';
	return states.map((state) => {
		const value = state as Record<string, unknown>;
		const body = value?.stateBody as Record<string, unknown> | undefined;
		return [value?.instanceId, value?.enabled, value?.bypassed, value?.continuity,
			value?.latencySamples, body?.sha256, body?.byteLength].join(':');
	}).join('|');
}

function resolveBridge(input: Readonly<{
	productId: string;
	bridge?: SoundscaperNativeServicesBridge | null;
}>): SoundscaperNativeServicesBridge | null {
	return input.productId === 'soundscaper'
		? input.bridge ?? resolveSoundscaperNativeServicesBridge()
		: null;
}
