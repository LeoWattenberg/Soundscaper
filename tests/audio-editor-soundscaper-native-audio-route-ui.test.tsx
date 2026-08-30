/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
	NativeAudioSessionOpenRequestV1,
	SoundscaperNativeServicesBridge,
} from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	runSoundscaperNativeServicesAction,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type {
	SoundscaperNativeServicesDialogRuntime,
} from '../src/common/editor/ui/soundscaper-native-services-dialog-runtime.ts';
import SoundscaperNativeServicesDialog, {
	createNativeAudioRouteOpenRequest,
} from '../src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const bridge = {} as SoundscaperNativeServicesBridge;

test('enumerated routes expose exact format and backend-valid mode choices', () => {
	const base = {
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		audio: {
			enabled: true, quarantined: false,
			payload: { status: 'available' as const, reason: null, detail: '' }, backends: ['asio'],
		},
	};
	const asio = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-audio-device"
		initialState={{ ...base, devices: { status: 'described', inventory: {
			backend: 'asio', status: 'ready', detail: '', devices: [
				{ handle: 'studio-interface', label: 'Studio interface', direction: 'input' },
				{ handle: 'studio-interface', label: 'Studio interface', direction: 'output' },
			],
		} } }}
		onClose={() => undefined}
	/>);
	assert.match(asio, /data-native-audio-direction="studio-interface"[^>]*>[^]*value="duplex"[^]*selected/iu,
		'a matching real input/output handle must be openable as one duplex route');
	assert.match(asio, /data-native-audio-mode="studio-interface"[^>]*disabled=""[^>]*>[^]*value="exclusive"/iu,
		'ASIO must issue an exclusive request rather than the shared request its adapter refuses');
	assert.match(asio, /data-native-audio-sample-rate="studio-interface"/u);
	assert.match(asio, /data-native-audio-period-frames="studio-interface"/u);
	assert.match(asio, /data-native-audio-channel-count="studio-interface"/u);

	const wasapi = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-audio-device"
		initialState={{ ...base, audio: { ...base.audio, backends: ['wasapi'] }, devices: {
			status: 'described', inventory: { backend: 'wasapi', status: 'ready', detail: '', devices: [
				{ handle: 'speakers', label: 'Speakers', direction: 'output' },
			] },
		} }}
		onClose={() => undefined}
	/>);
	assert.match(wasapi, /data-native-audio-mode="speakers"[^>]*>[^]*value="shared"[^]*value="exclusive"/iu,
		'WASAPI must let the user choose shared or exclusive before opening');
});

test('asymmetric duplex handles preserve the channel limit of each selected direction', () => {
	const inventory = {
		backend: 'asio', status: 'ready', detail: '', devices: [
			{ handle: 'studio-interface', label: 'Studio interface', direction: 'input', channelCount: 8 },
			{ handle: 'studio-interface', label: 'Studio interface', direction: 'output', channelCount: 2 },
		],
	};
	const renderRoute = (preference: NativeAudioSessionOpenRequestV1): string => renderToStaticMarkup(
		<SoundscaperNativeServicesDialog
			bridge={bridge}
			initialSurface="native-audio-device"
			initialState={{
				...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
				audio: {
					enabled: true, quarantined: false, routePreference: preference,
					payload: { status: 'available', reason: null, detail: '' }, backends: ['asio'],
				},
				devices: { status: 'described', inventory },
			}}
			onClose={() => undefined}
		/>,
	);
	const preference = (direction: 'input' | 'output', channelCount: number) => createNativeAudioRouteOpenRequest({
		candidates: [{ backend: 'asio', deviceHandle: 'studio-interface' }],
		direction, mode: 'exclusive', sampleRate: 48_000, periodFrames: 256, channelCount,
	});

	const input = renderRoute(preference('input', 8));
	assert.match(input, /data-native-audio-direction="studio-interface"[^>]*>[^]*value="input" selected=""/iu);
	assert.match(input, /max="8"[^>]*data-native-audio-channel-count="studio-interface"[^>]*value="8"/iu);

	const output = renderRoute(preference('output', 2));
	assert.match(output, /data-native-audio-direction="studio-interface"[^>]*>[^]*value="output" selected=""/iu);
	assert.match(output, /max="2"[^>]*data-native-audio-channel-count="studio-interface"[^>]*value="2"/iu);
});

test('a device handle reused by another backend receives that backend route defaults', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<() => void>();
	const actions: SoundscaperNativeServicesDialogAction[] = [];
	let state = routeState('wasapi');
	const runtime: SoundscaperNativeServicesDialogRuntime = {
		getState: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		perform: (action) => {
			actions.push(action);
			return Promise.resolve(state);
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperNativeServicesDialog
			bridge={bridge}
			runtime={runtime}
			initialSurface="native-audio-device"
			onClose={() => undefined}
		/>));
		assert.equal(reactProps(dom.one('[data-native-audio-mode="shared-handle"]')).value, 'shared');
		actions.length = 0;

		await act(async () => {
			state = routeState('asio');
			for (const listener of listeners) listener();
		});
		assert.equal(reactProps(dom.one('[data-native-audio-mode="shared-handle"]')).value, 'exclusive',
			'an ASIO route must not inherit the shared mode from a same-handle WASAPI route');
		await act(async () => {
			state = routeState('asio', 'input');
			for (const listener of listeners) listener();
		});
		assert.equal(reactProps(dom.one('[data-native-audio-direction="shared-handle"]')).value, 'input',
			'a refreshed handle must not retain a direction the new inventory no longer offers');
		await act(async () => {
			reactProps(dom.one('[data-native-audio-open="shared-handle"]')).onClick({});
		});
		assert.equal(actions.at(-1)?.type, 'open-audio-session');
		if (actions.at(-1)?.type === 'open-audio-session') {
			assert.equal(actions.at(-1).request.mode, 'exclusive');
			assert.equal(actions.at(-1).request.direction, 'input');
		}
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('route controls resolve every user-visible label through the host copy catalog', () => {
	const markup = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-audio-device"
		initialState={{
			...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
			audio: {
				enabled: true, quarantined: false,
				payload: { status: 'available', reason: null, detail: '' }, backends: ['wasapi'],
			},
			devices: { status: 'described', inventory: {
				backend: 'wasapi', status: 'ready', detail: '', devices: [
					{ handle: 'speakers', label: 'Speakers', direction: 'output' },
				],
			} },
		}}
		copy={{
			audioRouteDirection: 'Localized direction',
			audioRouteMode: 'Localized mode',
			audioRouteSampleRate: 'Localized sample rate',
			audioRoutePeriod: 'Localized period',
			audioRouteChannels: 'Localized channels',
			openAudioSession: 'Localized open session',
		}}
		onClose={() => undefined}
	/>);
	for (const label of [
		'Localized direction', 'Localized mode', 'Localized sample rate',
		'Localized period', 'Localized channels', 'Localized open session',
	]) assert.match(markup, new RegExp(label, 'u'));
});

test('session controls disclose fallback and disable calibration when the exact route cannot measure it', () => {
	const markup = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-audio-device"
		initialState={{
			...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
			audioSession: {
				sessionId: 'audio_session_01', state: 'device-lost', backend: 'wasapi',
				format: { direction: 'output', mode: 'exclusive', sampleRate: 48_000, periodFrames: 256, channelCount: 2 },
				attempts: [{ backend: 'wasapi', status: 'opened', detail: 'The exact requested stream opened.' }],
				framesTransferred: 4_096, lostFrames: 256, calibrationFrames: null,
				calibrationAvailable: false, calibrationUnavailableReason: 'duplex-required',
				transport: 'web-core',
				fallback: { active: true, eligible: true, reason: 'device-loss' },
			},
		}}
		onClose={() => undefined}
	/>);
	assert.match(markup, /disabled="" data-native-audio-calibrate="true"/u);
	assert.match(markup, /Calibration requires a bound duplex route/u);
	assert.match(markup, /Web Core fallback is active after device loss/u);
	assert.match(markup, /4096 frames transferred; 256 frames lost/u);
});

test('restored route values and changed controls issue the exact request through the bridge', async () => {
	const preference = createNativeAudioRouteOpenRequest({
		candidates: [{ backend: 'asio', deviceHandle: 'studio-interface' }],
		direction: 'output', mode: 'exclusive', sampleRate: 96_000,
		periodFrames: 256, channelCount: 32,
	});
	const markup = renderToStaticMarkup(<SoundscaperNativeServicesDialog
		bridge={bridge}
		initialSurface="native-audio-device"
		initialState={{
			...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
			audio: {
				enabled: true, quarantined: false, routePreference: preference,
				payload: { status: 'available', reason: null, detail: '' }, backends: ['asio'],
			},
			devices: { status: 'described', inventory: {
				backend: 'asio', status: 'ready', detail: '', devices: [{
					handle: 'studio-interface', label: 'Studio interface', direction: 'duplex', channelCount: 32,
				}],
			} },
		}}
		onClose={() => undefined}
	/>);
	for (const selected of ['output', '96000', '256']) {
		assert.match(markup, new RegExp(`value="${selected}" selected=""`, 'u'));
	}
	assert.match(markup, /data-native-audio-channel-count="studio-interface" value="32"/u);

	const calls: unknown[] = [];
	const event = await runSoundscaperNativeServicesAction({
		openNativeAudioSession: (request: NativeAudioSessionOpenRequestV1) => {
			calls.push(request);
			return Promise.resolve({ status: 'opened', sessionId: 'audio_session_01', backend: 'asio',
				deviceHandle: 'studio-interface',
				format: preference, attempts: [] });
		},
		nativeAudioSessionStatus: () => Promise.resolve({
			sessionId: 'audio_session_01', state: 'open', backend: 'asio', format: preference,
			attempts: [], framesTransferred: 0, lostFrames: 0, calibrationFrames: null,
			calibrationAvailable: false, calibrationUnavailableReason: 'bind-required',
			transport: 'native', fallback: null,
		}),
	} as unknown as SoundscaperNativeServicesBridge, { type: 'open-audio-session', request: preference });
	assert.equal(event.type, 'settled');
	assert.deepEqual(calls, [preference]);
	assert.throws(() => createNativeAudioRouteOpenRequest({ ...preference, mode: 'shared' }), /selection/iu);
	assert.throws(() => createNativeAudioRouteOpenRequest({ ...preference, channelCount: 33 }), /bounds/iu);
});

function routeState(
	backend: 'wasapi' | 'asio',
	direction: 'input' | 'output' = 'output',
): SoundscaperNativeServicesDialogState {
	return {
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		audio: {
			enabled: true, quarantined: false,
			payload: { status: 'available', reason: null, detail: '' }, backends: [backend],
		},
		devices: { status: 'described', inventory: {
			backend, status: 'ready', detail: '', devices: [{
				handle: 'shared-handle', label: 'Shared handle', direction, channelCount: 2,
			}],
		} },
	};
}
