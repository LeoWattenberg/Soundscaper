/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
	NativePluginAvailability,
	SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	reduceSoundscaperNativeServicesDialog,
	runSoundscaperNativeServicesAction,
	soundscaperNativeServicesActionKey,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import SoundscaperNativeServicesDialog from '../src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx';
import {
	createSoundscaperNativeServicesSurfaceHost,
} from '../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';

function availability(overrides: Partial<NativePluginAvailability> = {}): NativePluginAvailability {
	return {
		enabled: true,
		quarantined: false,
		payload: { status: 'available', reason: null },
		formats: [{ format: 'fixture', consented: true }],
		consent: {
			scanningEnabled: true,
			formats: [{
				format: 'fixture',
				supported: true,
				granted: true,
				roots: [
					{ rootId: 'r1', origin: 'standard', name: 'System fixture folder', admitted: true },
					{ rootId: 'r2', origin: 'standard', name: 'User fixture folder', admitted: false },
				],
			}],
		},
		quarantine: {
			loaded: true,
			degraded: false,
			records: [{ digest: 'a'.repeat(64), scope: 'plugin', kind: 'scanner-crash', quarantinedAt: 1 }],
			pendingFaults: 0,
		},
		...overrides,
	};
}

function fakeBridge(overrides: Partial<SoundscaperNativeServicesBridge> = {}) {
	const calls: unknown[][] = [];
	const bridge = {
		nativeAudioHelperAvailability: () => {
			calls.push(['nativeAudioHelperAvailability']);
			return Promise.resolve({
				enabled: true,
				quarantined: false,
				payload: { status: 'available', reason: null, detail: '' },
				backends: ['alsa'],
			});
		},
		setNativeAudioHelperEnabled: (enabled: boolean) => {
			calls.push(['setNativeAudioHelperEnabled', enabled]);
			return Promise.resolve(enabled);
		},
		describeNativeAudioBackend: (request: Readonly<{ backend: string }>) => {
			calls.push(['describeNativeAudioBackend', request.backend]);
			return Promise.resolve({
				status: 'described' as const,
				inventory: {
					backend: 'alsa',
					status: 'ready',
					detail: '',
					devices: [{ handle: 'h1', label: 'Built-in', direction: 'output' }],
				},
			});
		},
		nativePluginAvailability: () => {
			calls.push(['nativePluginAvailability']);
			return Promise.resolve(availability());
		},
		setNativePluginConsent: (request: unknown) => {
			calls.push(['setNativePluginConsent', request]);
			return Promise.resolve({ scanningEnabled: true, formats: [] });
		},
		scanNativePlugins: (request: Readonly<{ format: string; rootId: string }>) => {
			calls.push(['scanNativePlugins', request.format, request.rootId]);
			return Promise.resolve({
				status: 'described' as const,
				scan: {
					format: 'fixture',
					status: 'scanned',
					detail: 'two plug-ins',
					entries: [{
						stableId: 's1', name: 'Proof Gain', vendor: 'Soundscaper', version: '1.0.0',
						classification: 'effect', signature: 'unsigned', compatibility: 'compatible',
					}],
				},
			});
		},
		listNativePlugins: () => {
			calls.push(['listNativePlugins']);
			return Promise.resolve({ entries: [] });
		},
		clearNativePluginQuarantine: (request: unknown) => {
			calls.push(['clearNativePluginQuarantine', request]);
			return Promise.resolve(true);
		},
		...overrides,
	} as unknown as SoundscaperNativeServicesBridge;
	return { bridge, calls };
}

async function settle(
	state: SoundscaperNativeServicesDialogState,
	bridge: SoundscaperNativeServicesBridge,
	action: SoundscaperNativeServicesDialogAction,
): Promise<SoundscaperNativeServicesDialogState> {
	const begun = reduceSoundscaperNativeServicesDialog(state, { type: 'begin', action });
	assert.equal(begun.pending, soundscaperNativeServicesActionKey(action), 'the surface must announce work in flight');
	return reduceSoundscaperNativeServicesDialog(begun, await runSoundscaperNativeServicesAction(bridge, action));
}

test('a quarantined digest is cleared from the product surface by rescan and by re-enabling', async () => {
	const { bridge, calls } = fakeBridge({
		nativePluginAvailability: () => Promise.resolve(availability({
			quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 },
		})),
	});
	const digest = 'a'.repeat(64);

	const rescanned = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'clear-quarantine', digest, clearance: 'rescan',
	});
	const reEnabled = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'clear-quarantine', digest, clearance: 're-enable',
	});

	assert.deepEqual(calls.filter(([name]) => name === 'clearNativePluginQuarantine'), [
		['clearNativePluginQuarantine', { digest, clearance: 'rescan' }],
		['clearNativePluginQuarantine', { digest, clearance: 're-enable' }],
	]);
	assert.equal(rescanned.error, '');
	assert.equal(reEnabled.error, '');
	assert.equal(rescanned.pending, null);
	assert.deepEqual(rescanned.plugins?.quarantine.records, [], 'clearing must re-read the quarantine it emptied');
});

test('native audio preferences can enable the desktop tier and re-read its state', async () => {
	let enabled = false;
	const { bridge, calls } = fakeBridge({
		setNativeAudioHelperEnabled: (next: boolean) => {
			calls.push(['setNativeAudioHelperEnabled', next]);
			enabled = next;
			return Promise.resolve(next);
		},
		nativeAudioHelperAvailability: () => Promise.resolve({
			enabled,
			quarantined: false,
			payload: { status: 'available', reason: null, detail: '' },
			backends: enabled ? ['alsa'] : [],
		}),
	});

	const state = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'set-audio-enabled', enabled: true,
	});

	assert.deepEqual(calls.filter(([name]) => name === 'setNativeAudioHelperEnabled'), [
		['setNativeAudioHelperEnabled', true],
	]);
	assert.equal(state.audio?.enabled, true);
});

test('turning native audio off clears its device inventory', async () => {
	const { bridge } = fakeBridge({
		nativeAudioHelperAvailability: () => Promise.resolve({
			enabled: false,
			quarantined: false,
			payload: { status: 'available', reason: null, detail: '' },
			backends: ['alsa'],
		}),
	});
	const state = await settle({
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		devices: {
			status: 'described',
			inventory: {
				backend: 'alsa', status: 'ready', detail: '',
				devices: [{ handle: 'h1', label: 'Built-in', direction: 'output' }],
			},
		},
	}, bridge, { type: 'set-audio-enabled', enabled: false });

	assert.equal(state.devices, null, 'devices described before disable are no longer authoritative');
});

test('a desktop shell without the clearance call refuses instead of pretending the quarantine went', async () => {
	const { bridge } = fakeBridge({ clearNativePluginQuarantine: undefined });

	const state = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'clear-quarantine', digest: 'b'.repeat(64), clearance: 'rescan',
	});

	assert.notEqual(state.error, '');
	assert.equal(state.pending, null);
});

test('a scan announces that it is running and then publishes what it found', async () => {
	const { bridge, calls } = fakeBridge();
	const action: SoundscaperNativeServicesDialogAction = { type: 'scan', format: 'fixture', rootId: 'r1' };
	const key = soundscaperNativeServicesActionKey(action);

	const running = reduceSoundscaperNativeServicesDialog(
		EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, { type: 'begin', action },
	);
	assert.equal(running.scans[key]?.running, true);
	const settled = reduceSoundscaperNativeServicesDialog(running, await runSoundscaperNativeServicesAction(bridge, action));

	assert.equal(settled.scans[key]?.running, false);
	assert.equal(settled.scans[key]?.status, 'scanned');
	assert.deepEqual(settled.scans[key]?.entries.map(({ name }) => name), ['Proof Gain']);
	assert.deepEqual(calls.filter(([name]) => name === 'scanNativePlugins'), [['scanNativePlugins', 'fixture', 'r1']]);
	assert.ok(calls.some(([name]) => name === 'listNativePlugins'), 'a finished scan must refresh what is installed');
});

test('a refused scan keeps its refusal against the root that was asked for', async () => {
	const { bridge } = fakeBridge({
		scanNativePlugins: () => Promise.resolve({ status: 'failed', code: 'consent-required', message: 'Scanning this plug-in format has not been allowed.' }),
	});
	const action: SoundscaperNativeServicesDialogAction = { type: 'scan', format: 'fixture', rootId: 'r1' };

	const settled = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, action);

	const scan = settled.scans[soundscaperNativeServicesActionKey(action)];
	assert.equal(scan?.status, 'failed');
	assert.match(scan?.detail ?? '', /not been allowed/u);
});

test('consent and root admission go through the bridge and re-read what the tier now allows', async () => {
	const { bridge, calls } = fakeBridge();

	await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'consent', format: 'fixture', consent: 'grant',
	});
	await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'consent', format: 'fixture', consent: 'revoke',
	});
	const admitted = await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'consent', format: 'fixture', consent: 'add-standard-root', rootId: 'r2',
	});
	await settle(EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, bridge, {
		type: 'consent', format: 'fixture', consent: 'add-custom-root',
	});

	assert.deepEqual(calls.filter(([name]) => name === 'setNativePluginConsent').map(([, request]) => request), [
		{ format: 'fixture', action: 'grant', rootId: '' },
		{ format: 'fixture', action: 'revoke', rootId: '' },
		{ format: 'fixture', action: 'add-standard-root', rootId: 'r2' },
		{ format: 'fixture', action: 'add-custom-root', rootId: '' },
	]);
	assert.equal(admitted.plugins?.consent.formats[0]?.format, 'fixture');
});

test('the dialog is an accessible modal that shows progress, results, consent and the quarantine exit', () => {
	const action: SoundscaperNativeServicesDialogAction = { type: 'scan', format: 'fixture', rootId: 'r1' };
	const seeded: SoundscaperNativeServicesDialogState = {
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		audio: {
			enabled: true, quarantined: false,
			payload: { status: 'available', reason: null, detail: '' }, backends: ['alsa'],
		},
		plugins: availability(),
		registry: {
			entries: [{
				entryId: 'e1', format: 'fixture', name: 'Proof Gain', vendor: 'Soundscaper',
				eligible: true, ineligibleReason: null,
				installations: [{ installationId: 'i1', version: '1.0.0', reviewed: true, selected: true, quarantined: false }],
			}],
		},
		scans: {
			[soundscaperNativeServicesActionKey(action)]: {
				format: 'fixture', rootId: 'r1', running: true, status: '', detail: '', entries: [],
			},
		},
	};

	const markup = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="native-effect-scan"
		initialState={seeded}
		onClose={() => {}}
	/>);

	assert.match(markup, /role="dialog"/u);
	assert.match(markup, /aria-modal="true"/u);
	assert.match(markup, /role="tablist"/u);
	assert.match(markup, /data-native-service-tab="native-effect-scan"/u);
	assert.match(markup, /aria-live="polite"/u, 'progress must be announced, not merely drawn');
	assert.match(markup, /aria-busy="true"/u, 'a running scan must say so');
	assert.match(markup, /System fixture folder/u, 'an admitted root must be nameable');
	assert.match(markup, /User fixture folder/u, 'an offered root must be admittable');

	const manage = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="native-effect-manage"
		initialState={seeded}
		onClose={() => {}}
	/>);
	assert.match(manage, /data-native-quarantine-clear="rescan"/u);
	assert.match(manage, /data-native-quarantine-clear="re-enable"/u);
	assert.match(manage, /Proof Gain/u);

	const preferences = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="native-audio-preferences"
		initialState={{ ...seeded, audio: { ...seeded.audio!, enabled: false } }}
		onClose={() => {}}
	/>);
	assert.match(preferences, /data-native-audio-set-enabled="true"/u);
	assert.match(preferences, /Turn on native audio/u);

	const devices = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={fakeBridge().bridge}
		initialSurface="native-audio-device"
		initialState={{ ...seeded, audio: { ...seeded.audio!, enabled: false } }}
		onClose={() => {}}
	/>);
	assert.match(devices, /disabled="" data-native-audio-describe="alsa"/u,
		'device discovery must remain unavailable while native audio is off');
});

test('the menu-opened surface mounts and unmounts one host, and nothing before it is opened', () => {
	const rendered: unknown[] = [];
	const removed: string[] = [];
	let unmounted = 0;
	const container = {
		dataset: {} as Record<string, string>,
		remove: () => { removed.push('container'); },
	};
	const appended: unknown[] = [];
	const documentValue = {
		createElement: () => container,
		body: { append: (node: unknown) => { appended.push(node); } },
		querySelector: () => null,
	} as unknown as Document;
	const host = createSoundscaperNativeServicesSurfaceHost({
		bridge: fakeBridge().bridge,
		documentValue,
		createHostRoot: () => ({
			render: (node: unknown) => { rendered.push(node); },
			unmount: () => { unmounted += 1; },
		}),
	});

	assert.deepEqual(rendered, [], 'nothing is mounted until a menu entry asks for it');
	host.open('native-effect-manage');
	assert.equal(rendered.length, 1);
	host.open('native-effect-scan');
	assert.equal(rendered.length, 2, 'reopening reuses the one host rather than stacking dialogs');
	assert.equal(appended.length, 1, 'one container, however often the menu opens the surface');
	assert.equal(container.dataset.editorSurface, 'soundscaper-native-services');
	host.dispose();
	assert.equal(unmounted, 1);
	assert.deepEqual(removed, ['container']);
});
