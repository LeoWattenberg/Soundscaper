/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS,
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface MenuItem {
	readonly id?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
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

test('Framescaper gains no Soundscaper native services runtime', async (t) => {
	const { bridge, calls } = fakeBridge();
	t.after(withBridge(bridge));

	const entries = await settledNativeEntries('framescaper');

	assert.deepEqual(entries.map(({ id }) => id), []);
	assert.deepEqual(calls, [], 'the other product must not even probe the native tier');
});

function workspaceMenuInput(productId: string) {
	return {
		aboutLabel: 'About',
		aup4InputRef: { current: null },
		blocked: false,
		capabilities: { audioEffects: true },
		controller: { actions: {} },
		copy: {},
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
		soundscaperProduction: null,
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
