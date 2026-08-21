/* SPDX-License-Identifier: AGPL-3.0-only */

export type DesktopWindowAction =
	| 'minimize'
	| 'toggle-maximize'
	| 'toggle-fullscreen'
	| 'quit'
	| 'reload'
	| 'toggle-dev-tools';

export type DesktopNativeTierControlAction =
	| 'set-probe-helper-enabled'
	| 'clear-probe-helper-quarantine'
	| 'set-audio-helper-enabled'
	| 'clear-audio-helper-quarantine'
	| 'set-native-effect-discovery-enabled';

export interface DesktopNativeTierControls {
	readonly probeHelperEnabled: boolean;
	readonly probeHelperQuarantined: boolean;
	readonly audioHelperEnabled: boolean;
	readonly audioHelperQuarantined: boolean;
	readonly nativeEffectDiscoveryEnabled: boolean;
}

export interface DesktopNativeTierControlsBridge {
	readNativeTierControls(): Promise<DesktopNativeTierControls>;
	applyNativeTierControl(request: Readonly<{
		action: DesktopNativeTierControlAction;
		enabled?: boolean;
	}>): Promise<DesktopNativeTierControls>;
}

export interface DesktopNativeTierControlsStore {
	getSnapshot(): DesktopNativeTierControls | null;
	subscribe(listener: () => void): () => void;
	refresh(): Promise<DesktopNativeTierControls | null>;
	refreshIfStale(now?: number, onError?: (error: unknown) => void): void;
	apply(action: DesktopNativeTierControlAction, enabled?: boolean): Promise<DesktopNativeTierControls | null>;
}

export interface DesktopHostMenuItem {
	readonly id: string;
	readonly label: string;
	readonly shortcut?: string;
	readonly checked?: boolean;
	readonly items?: readonly DesktopHostMenuItem[];
	onClick?(): void;
}

interface DesktopHostCopy {
	readonly desktopServices: string;
	readonly useNativeProbeHelper: string;
	readonly clearProbeHelperQuarantine: string;
	readonly useNativeAudioHelper: string;
	readonly clearAudioHelperQuarantine: string;
	readonly discoverNativeEffects: string;
	readonly productHelp: string;
	readonly checkUpdates: string;
	readonly viewSource: string;
	readonly reloadApplication: string;
	readonly toggleDeveloperTools: string;
}

export interface DesktopHostMenuInput {
	readonly copy: DesktopHostCopy;
	readonly development: boolean;
	readonly platform?: string;
	readonly productName: string;
	readonly snapshot: DesktopNativeTierControls;
	applyNativeTierControl(action: DesktopNativeTierControlAction, enabled?: boolean): void;
	runWindowAction(action: DesktopWindowAction): void;
	checkForUpdates(): void;
	openExternal(destination: 'help' | 'source'): void;
}

export interface DesktopHostMenuItems {
	readonly view: readonly DesktopHostMenuItem[];
	readonly tools: readonly DesktopHostMenuItem[];
	readonly help: readonly DesktopHostMenuItem[];
}

export const DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS = 5_000;

export const PENDING_DESKTOP_NATIVE_TIER_CONTROLS: DesktopNativeTierControls = Object.freeze({
	probeHelperEnabled: false,
	probeHelperQuarantined: false,
	audioHelperEnabled: false,
	audioHelperQuarantined: false,
	nativeEffectDiscoveryEnabled: false,
});

const EMPTY_DESKTOP_HOST_MENU_ITEMS: DesktopHostMenuItems = Object.freeze({
	view: Object.freeze([]),
	tools: Object.freeze([]),
	help: Object.freeze([]),
});

export function createDesktopHostMenuItems(input: DesktopHostMenuInput | null): DesktopHostMenuItems {
	if (input === null) return EMPTY_DESKTOP_HOST_MENU_ITEMS;
	const apply = (action: DesktopNativeTierControlAction, enabled?: boolean) => () => {
		input.applyNativeTierControl(action, enabled);
	};
	const mac = input.platform === 'darwin';
	return Object.freeze({
		view: Object.freeze(input.development ? [
			item('desktop-reload', input.copy.reloadApplication, () => input.runWindowAction('reload'), mac ? 'Cmd+R' : 'Ctrl+R'),
			item('desktop-toggle-dev-tools', input.copy.toggleDeveloperTools, () => input.runWindowAction('toggle-dev-tools'), mac ? 'Option+Cmd+I' : 'Ctrl+Shift+I'),
		] : []),
		tools: Object.freeze([item('desktop-services', input.copy.desktopServices, undefined, undefined, [
			checkedItem('desktop-use-native-probe-helper', input.copy.useNativeProbeHelper,
				input.snapshot.probeHelperEnabled,
				apply('set-probe-helper-enabled', !input.snapshot.probeHelperEnabled)),
			item('desktop-clear-probe-helper-quarantine', input.copy.clearProbeHelperQuarantine,
				apply('clear-probe-helper-quarantine')),
			checkedItem('desktop-use-native-audio-helper', input.copy.useNativeAudioHelper,
				input.snapshot.audioHelperEnabled,
				apply('set-audio-helper-enabled', !input.snapshot.audioHelperEnabled)),
			item('desktop-clear-audio-helper-quarantine', input.copy.clearAudioHelperQuarantine,
				apply('clear-audio-helper-quarantine')),
			checkedItem('desktop-discover-native-effects', input.copy.discoverNativeEffects,
				input.snapshot.nativeEffectDiscoveryEnabled,
				apply('set-native-effect-discovery-enabled', !input.snapshot.nativeEffectDiscoveryEnabled)),
		])]),
		help: Object.freeze([
			item('desktop-product-help', input.copy.productHelp.replace('{product}', input.productName),
				() => input.openExternal('help')),
			item('desktop-check-updates', input.copy.checkUpdates, input.checkForUpdates),
			item('desktop-view-source', input.copy.viewSource, () => input.openExternal('source')),
		]),
	});
}

export function createDesktopNativeTierControlsStore(
	bridge: DesktopNativeTierControlsBridge,
	clock: () => number = () => Date.now(),
): DesktopNativeTierControlsStore {
	let snapshot: DesktopNativeTierControls | null = null;
	let probedAt = Number.NEGATIVE_INFINITY;
	let inFlight: Promise<DesktopNativeTierControls | null> | null = null;
	let mutationTail: Promise<void> = Promise.resolve();
	let pendingMutations = 0;
	let requestedGeneration = 0;
	let publishedGeneration = 0;
	const listeners = new Set<() => void>();
	const publish = (
		next: DesktopNativeTierControls,
		generation: number,
	): DesktopNativeTierControls | null => {
		if (generation < publishedGeneration) return snapshot;
		publishedGeneration = generation;
		probedAt = clock();
		if (snapshot === null || !sameControls(snapshot, next)) {
			snapshot = next;
			for (const listener of listeners) listener();
		}
		return snapshot;
	};
	const refresh = async (): Promise<DesktopNativeTierControls | null> => {
		const generation = ++requestedGeneration;
		// A read requested after a mutation must observe that mutation's committed state.
		if (pendingMutations > 0) {
			const precedingMutations = mutationTail;
			await precedingMutations;
		}
		return publish(await bridge.readNativeTierControls(), generation);
	};
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		refresh,
		refreshIfStale: (now: number = clock(), onError?: (error: unknown) => void) => {
			if (inFlight !== null || now - probedAt < DESKTOP_NATIVE_TIER_REFRESH_INTERVAL_MS) return;
			const request = refresh();
			inFlight = request;
			void request.then(
				() => { if (inFlight === request) inFlight = null; },
				(error: unknown) => {
					if (inFlight === request) inFlight = null;
					try { onError?.(error); } catch { /* Error reporting must not create an unhandled rejection. */ }
				},
			);
		},
		apply: (action: DesktopNativeTierControlAction, enabled?: boolean) => {
			const generation = ++requestedGeneration;
			const request = enabled === undefined ? { action } : { action, enabled };
			pendingMutations += 1;
			// Main receives mutations in menu-invocation order, even after a rejection.
			const mutation = mutationTail.then(async () => (
				publish(await bridge.applyNativeTierControl(request), generation)
			));
			mutationTail = mutation.then(
				() => { pendingMutations -= 1; },
				() => { pendingMutations -= 1; },
			);
			return mutation;
		},
	});
}

const STORES = new WeakMap<DesktopNativeTierControlsBridge, DesktopNativeTierControlsStore>();

export function desktopNativeTierControlsStoreFor(
	bridge: DesktopNativeTierControlsBridge,
): DesktopNativeTierControlsStore {
	const existing = STORES.get(bridge);
	if (existing) return existing;
	const store = createDesktopNativeTierControlsStore(bridge);
	STORES.set(bridge, store);
	return store;
}

function item(
	id: string,
	label: string,
	onClick?: () => void,
	shortcut?: string,
	items?: readonly DesktopHostMenuItem[],
): DesktopHostMenuItem {
	return Object.freeze({ id, label, ...(shortcut ? { shortcut } : {}), ...(items ? { items } : {}), ...(onClick ? { onClick } : {}) });
}

function checkedItem(id: string, label: string, checked: boolean, onClick: () => void): DesktopHostMenuItem {
	return Object.freeze({ id, label, checked, onClick });
}

function sameControls(current: DesktopNativeTierControls, next: DesktopNativeTierControls): boolean {
	return current.probeHelperEnabled === next.probeHelperEnabled
		&& current.probeHelperQuarantined === next.probeHelperQuarantined
		&& current.audioHelperEnabled === next.audioHelperEnabled
		&& current.audioHelperQuarantined === next.audioHelperQuarantined
		&& current.nativeEffectDiscoveryEnabled === next.nativeEffectDiscoveryEnabled;
}
