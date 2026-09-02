/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSoundscaperNativeServicesStore,
	SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS,
	soundscaperNativeServicesStoreFor,
	type NativeAudioAvailability,
	type SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import type { DesktopHostMenuRuntime } from '../src/common/editor/ui/workspace/useDesktopHostMenuRuntime.ts';

interface MenuItem {
	readonly id?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function fakeBridge(overrides: Readonly<Record<string, unknown>> = {}) {
	const calls: string[] = [];
	const bridge = {
		nativeAudioHelperAvailability: () => {
			calls.push('nativeAudioHelperAvailability');
			return Promise.resolve({
				enabled: true,
				quarantined: false,
				payload: { status: 'available', reason: null, detail: '' },
				backends: ['alsa'],
			});
		},
		setNativeAudioHelperEnabled: () => Promise.resolve(true),
		nativePluginAvailability: () => {
			calls.push('nativePluginAvailability');
			return Promise.resolve({
				enabled: true,
				quarantined: false,
				payload: { status: 'available', reason: null },
				formats: [{ format: 'fixture', consented: true }, { format: 'vst3', consented: false }],
				consent: { scanningEnabled: true, formats: [] },
				quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
			});
		},
		describeNativeAudioBackend: () => Promise.resolve({ status: 'described', inventory: { backend: 'alsa', status: 'ready', detail: '', devices: [] } }),
		setNativePluginConsent: () => Promise.resolve({ scanningEnabled: false, formats: [] }),
		scanNativePlugins: () => Promise.resolve({ status: 'described', scan: { format: 'fixture', status: 'scanned', detail: '', entries: [] } }),
		listNativePlugins: () => Promise.resolve({ entries: [] }),
		clearNativePluginQuarantine: () => Promise.resolve(true),
		openNativeAudioSession: () => Promise.resolve({
			status: 'opened', sessionId: 'audio_session_01', backend: 'alsa',
		}),
		bindNativeAudioSession: () => Promise.resolve({ status: 'bound', generation: 1 }),
		nativeAudioSessionStatus: () => Promise.resolve({
			sessionId: 'audio_session_01', state: 'open', backend: 'alsa', calibrationFrames: null,
		}),
		calibrateNativeAudioSession: () => Promise.resolve({
			sessionId: 'audio_session_01', state: 'bound', backend: 'alsa', calibrationFrames: 0,
		}),
		reportNativeAudioSessionTransfer: () => Promise.resolve({
			sessionId: 'audio_session_01', state: 'open', backend: 'alsa', calibrationFrames: null,
		}),
		reportNativeAudioSessionLoss: () => Promise.resolve({
			sessionId: 'audio_session_01', state: 'open', backend: 'alsa', calibrationFrames: null,
		}),
		closeNativeAudioSession: () => Promise.resolve(true),
		reviewNativePluginInstallation: () => Promise.resolve({ entries: [] }),
		instantiateNativePlugin: () => Promise.resolve({
			instanceId: 'plugin_instance_01', format: 'fixture', state: 'hosted',
			bypassed: false, latencySamples: 0,
		}),
		runNativePluginOffline: () => Promise.resolve({
			instance: {
				instanceId: 'plugin_instance_01', format: 'fixture', state: 'hosted',
				bypassed: false, latencySamples: 0,
			},
			blocksRendered: 8, renderedSha256: 'a'.repeat(64),
		}),
		setNativePluginBypassed: () => Promise.resolve({
			instanceId: 'plugin_instance_01', format: 'fixture', state: 'hosted',
			bypassed: true, latencySamples: 0,
		}),
		persistNativePluginState: () => Promise.resolve({ outcome: { status: 'refused' }, projectState: null }),
		restoreNativePluginState: () => Promise.resolve({}),
		openNativePluginVendorUi: () => Promise.resolve({ status: 'refused', code: 'vendor-ui-unavailable' }),
		closeNativePluginVendorUi: () => Promise.resolve(false),
		closeNativePluginInstance: () => Promise.resolve(true),
		...overrides,
	};
	return { bridge, calls };
}

function withBridge(bridge: unknown): () => void {
	const scope = globalThis as unknown as Record<string, unknown>;
	const previous = scope.soundscaperDesktop;
	scope.soundscaperDesktop = { v1: bridge };
	return () => { scope.soundscaperDesktop = previous; };
}

function flatten(items: readonly MenuItem[]): MenuItem[] {
	return items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
}

function nativeEntries(productId: string): MenuItem[] {
	const menus = createWorkspaceApplicationMenus(workspaceMenuInput(productId)) as readonly MenuItem[];
	return flatten(menus).filter((item) => (item.id ?? '').startsWith('native-'));
}

async function settledNativeEntries(productId: string): Promise<MenuItem[]> {
	let entries = nativeEntries(productId);
	for (let attempt = 0; attempt < 50 && entries.some((item) => item.disabled === true); attempt += 1) {
		await new Promise((resolve) => { setTimeout(resolve, 1); });
		entries = nativeEntries(productId);
	}
	return entries;
}

test('the workspace supplies the native services runtime so its menu entries are live', async (t) => {
	const { bridge, calls } = fakeBridge();
	t.after(withBridge(bridge));

	const entries = await settledNativeEntries('soundscaper');

	assert.deepEqual(entries.map(({ id, disabled }) => [id, disabled]), [
		['native-effects', false],
		['native-effect-scan', false],
		['native-effect-manage', false],
		['native-audio', false],
		['native-audio-device', false],
		['native-audio-preferences', false],
	]);
	assert.ok(calls.includes('nativePluginAvailability'), 'the runtime must consume the preload bridge');
	for (const entry of entries) {
		if (entry.id === 'native-audio' || entry.id === 'native-effects') continue;
		assert.equal(typeof entry.onClick, 'function', `${entry.id ?? ''} must open its surface`);
	}
});

test('a tier whose formats are all unconsented keeps the scan entry disabled but reachable', async (t) => {
	const { bridge } = fakeBridge({
		nativePluginAvailability: () => Promise.resolve({
			enabled: true,
			quarantined: false,
			payload: { status: 'available', reason: null },
			formats: [{ format: 'fixture', consented: false }],
			consent: { scanningEnabled: false, formats: [] },
			quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
		}),
	});
	t.after(withBridge(bridge));

	let entries = nativeEntries('soundscaper');
	for (let attempt = 0; attempt < 50 && entries.every((item) => item.disabled === false); attempt += 1) {
		await new Promise((resolve) => { setTimeout(resolve, 1); });
		entries = nativeEntries('soundscaper');
	}

	assert.deepEqual(
		entries.filter(({ id }) => (id ?? '').startsWith('native-effect-')).map(({ id, disabled }) => [id, disabled]),
		[['native-effect-scan', true], ['native-effect-manage', false]],
	);
});

test('a build with no desktop bridge advertises no native tier at all', () => {
	assert.deepEqual(nativeEntries('soundscaper'), []);
});

test('an older shell missing one production runtime call advertises no partial native tier', (t) => {
	const { bridge } = fakeBridge({ closeNativePluginInstance: undefined });
	t.after(withBridge(bridge));
	assert.deepEqual(nativeEntries('soundscaper'), []);
});

test('the tier is re-read after the desktop discovery toggle changes behind the renderer', async () => {
	let discovering = false;
	const { bridge } = fakeBridge({
		nativePluginAvailability: () => Promise.resolve({
			enabled: discovering,
			quarantined: false,
			payload: { status: 'available', reason: null },
			formats: [{ format: 'fixture', consented: true }],
			consent: { scanningEnabled: discovering, formats: [] },
			quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
		}),
	});
	const store = soundscaperNativeServicesStoreFor(bridge as unknown as SoundscaperNativeServicesBridge);
	await store.refresh();
	assert.deepEqual(store.getSnapshot()?.enabledPluginFormats, []);

	discovering = true;
	store.refreshIfStale(Date.now());
	await store.refresh();
	assert.deepEqual(store.getSnapshot()?.enabledPluginFormats, ['fixture'],
		'a toggle made outside the renderer must reach the menu without a reload');
	assert.ok(SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS > 0);
});

test('native service stores publish changed async snapshots to React subscribers', async () => {
	let enabled = false;
	const { bridge } = fakeBridge({
		nativeAudioHelperAvailability: () => Promise.resolve({
			enabled,
			quarantined: false,
			payload: { status: 'available', reason: null, detail: '' },
			backends: enabled ? ['alsa'] : [],
		}),
	});
	const store = soundscaperNativeServicesStoreFor(bridge as unknown as SoundscaperNativeServicesBridge);
	let publications = 0;
	const unsubscribe = store.subscribe(() => { publications += 1; });
	await store.refresh();
	const afterInitial = publications;
	await store.refresh();
	assert.equal(publications, afterInitial, 'an unchanged probe must not churn the application menu');
	enabled = true;
	await store.refresh();
	assert.equal(publications, afterInitial + 1);
	assert.equal(store.getSnapshot()?.enabled, true);
	unsubscribe();
});

test('an older native-service probe cannot overwrite a newer published answer', async () => {
	const older = deferred<NativeAudioAvailability>();
	const newer = deferred<NativeAudioAvailability>();
	const answers = [older.promise, newer.promise];
	const { bridge } = fakeBridge({
		nativeAudioHelperAvailability: () => answers.shift(),
	});
	const store = createSoundscaperNativeServicesStore(
		bridge as unknown as SoundscaperNativeServicesBridge,
	);
	const olderRefresh = store.refresh();
	const newerRefresh = store.refresh();

	newer.resolve({
		enabled: true,
		quarantined: false,
		payload: { status: 'available', reason: null, detail: '' },
		backends: ['alsa'],
	});
	await newerRefresh;
	older.resolve({
		enabled: false,
		quarantined: false,
		payload: { status: 'available', reason: null, detail: '' },
		backends: [],
	});
	await olderRefresh;

	assert.equal(store.getSnapshot()?.enabled, true,
		'a late response from an earlier request must not roll the menu back');
});

test('Framescaper gains no Soundscaper native services runtime', async (t) => {
	const { bridge, calls } = fakeBridge();
	t.after(withBridge(bridge));

	const entries = await settledNativeEntries('framescaper');

	assert.deepEqual(entries.map(({ id }) => id), []);
	assert.deepEqual(calls, [], 'the other product must not even probe the native tier');
});

test('both desktop products gain the shared host controls without mounting the Soundscaper runtime', () => {
	const runtime = {
		development: false,
		snapshot: {
			probeHelperEnabled: false,
			probeHelperQuarantined: false,
			audioHelperEnabled: false,
			audioHelperQuarantined: false,
			nativeEffectDiscoveryEnabled: false,
		},
		applyNativeTierControl: () => undefined,
		runWindowAction: () => undefined,
		checkForUpdates: () => undefined,
		openExternal: () => undefined,
	};
	for (const productId of ['soundscaper', 'framescaper']) {
		const menus = createWorkspaceApplicationMenus(workspaceMenuInput(productId, runtime)) as readonly MenuItem[];
		assert.deepEqual(flatten(menus).filter(({ id }) => id?.startsWith('desktop-')).map(({ id }) => id), [
			'desktop-services',
			'desktop-use-native-probe-helper',
			'desktop-clear-probe-helper-quarantine',
			'desktop-use-native-audio-helper',
			'desktop-clear-audio-helper-quarantine',
			'desktop-discover-native-effects',
			'desktop-product-help',
			'desktop-check-updates',
			'desktop-view-source',
		]);
	}
});

test('the shared support action names the active product', () => {
	for (const [productId, productName] of [['soundscaper', 'Soundscaper'], ['framescaper', 'Framescaper']]) {
		let opened = '';
		const menus = createWorkspaceApplicationMenus({
			...workspaceMenuInput(productId), openExternal: (value: string) => { opened = value; },
		}) as readonly MenuItem[];
		flatten(menus).find(({ id }) => id === 'support')?.onClick?.();
		assert.equal(opened, `mailto:team@kw.media?subject=${productName}%20support`);
	}
});

function workspaceMenuInput(productId: string, desktopHostRuntime: DesktopHostMenuRuntime | null = null) {
	return {
		aboutLabel: 'About',
		aup4InputRef: { current: null },
		blocked: false,
		capabilities: { audioEffects: true },
		controller: { actions: {} },
		copy: {
			title: productId === 'framescaper' ? 'Framescaper' : 'Soundscaper',
			desktopServices: 'Desktop services',
			useNativeProbeHelper: 'Use Native Probe Helper',
			clearProbeHelperQuarantine: 'Clear Probe Helper Quarantine',
			useNativeAudioHelper: 'Use Native Audio Helper',
			clearAudioHelperQuarantine: 'Clear Audio Helper Quarantine',
			discoverNativeEffects: 'Discover Native Effects',
			productHelp: '{product} Help',
			checkUpdates: 'Check for updates',
			viewSource: 'View source',
			reloadApplication: 'Reload',
			toggleDeveloperTools: 'Toggle Developer Tools',
		},
		desktopHostRuntime,
		durationFrames: 0,
		editBlocked: false,
		handoffBlocked: false,
		executeEdit: () => {},
		fileService: { isDesktop: true },
		importInputRef: { current: null },
		legacyAupInputRef: { current: null },
		locale: 'en',
		openDesktopFiles: () => {},
		openEffects: () => {},
		openExternal: () => {},
		openGenerator: () => {},
		openProjects: () => {},
		openRecordingOffset: () => {},
		openSelectionEffect: () => {},
		openSpectralSelection: () => {},
		openSurface: () => {},
		openTimedRecording: () => {},
		openWorkspacePanel: () => {},
		parityRuntime: { actions: { timeline: {}, help: {} } },
		productId,
		project: null,
		projectBinEffectivelyOpen: false,
		recordLabel: 'Record',
		run: (operation: () => unknown) => operation(),
		selectedClip: null,
		selectedAudioTrack: null,
		selectionActive: false,
		setDialog: () => {},
		setDialogValue: () => {},
		setNyquistTarget: () => {},
		setShowArmControls: () => {},
		showArmControls: false,
		snapshot: {
			preferences: {
				workspace: {
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((panelId) => [panelId, { visible: false }])),
					custom: [],
					activeId: 'modern',
				},
				view: {},
			},
		},
		toggleFullscreen: () => {},
		toggleRecording: () => {},
		toggleWorkspacePanel: () => {},
		uiFlags: {},
		zoomProject: () => {},
	};
}
