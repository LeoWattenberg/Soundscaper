/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitsBoundedOfflineBackend } from '../src/common/editor/engine/bounded-offline-backend-admission.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';

const chromium = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0';
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

test('bounded offline rendering admits the positively identified tested Chromium and Gecko backends', () => {
	for (const identity of [chromium, firefox, chromium.replace('Chrome/', 'Chromium/'), chromium.replace('Chrome/', 'HeadlessChrome/'),
		`${chromium} Electron/43.7.7`, `${chromium} Edg/150.0.0.0`,
		chromium.replace('X11; Linux x86_64', 'Linux; Android 16').replace('Safari/', 'Mobile Safari/'),
		firefox.replace('X11; Linux x86_64', 'Android 16; Mobile'),
	]) assert.equal(admitsBoundedOfflineBackend(identity), true, identity);
});

test('WebKit, iOS wrappers, contradictory and unknown identities retain realtime capture', () => {
	for (const identity of [undefined, null, '', 'Node.js/26', {}, 'Chrome/150.0.0.0', 'Firefox/150.0',
		safari, `${safari} Chrome/150.0.0.0`, `${safari} Firefox/150.0`,
		safari.replace('Version/26.0', 'CriOS/150.0.0.0'), safari.replace('Version/26.0', 'FxiOS/150.0'),
		chromium.replace('X11; Linux x86_64', 'iPhone; CPU iPhone OS 26_0 like Mac OS X'),
		chromium.replace('X11; Linux x86_64', 'iPad; CPU OS 26_0 like Mac OS X'),
		chromium.replace('X11; Linux x86_64', 'iPod touch; CPU iPhone OS 26_0 like Mac OS X'),
		`${chromium} FxiOS/150.0`, `${chromium} CriOS/150.0`, `${chromium} Version/26.0`,
		`${chromium} version/26.0`, chromium.replace('X11; Linux x86_64', 'iphone; CPU OS 26_0'),
		chromium.replace('Mozilla/5.0 ', ''), firefox.replace('Mozilla/5.0 ', ''),
		`${chromium} Firefox/150.0`, firefox.replace('Gecko/20100101', 'AppleWebKit/605.1.15'),
		chromium.replace('AppleWebKit/537.36', 'AppleWebKit/605.1.15'),
		chromium.replace('Safari/537.36', 'Safari/605.1.15'),
		chromium.replace('Chrome/150.0.0.0', 'Chrome/not-a-version'),
	]) assert.equal(admitsBoundedOfflineBackend(identity), false, String(identity));
});

test('the owning render method gates offline windows without changing pure graph admission', async () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	try {
		for (const [identity, admitted] of [[chromium, true], [firefox, true], [safari, false], ['unknown', false]] as const) {
			Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: identity } });
			const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
			let offlineCalls = 0; let delivered = 0;
			engine.loadProject({ sampleRate: 48_000, masterChannels: 2, master: { effects: [] },
				sources: [{ id: 'source', channelCount: 2 }],
				tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'], effects: [] }],
				clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 128 }] });
			engine.renderMix = async () => {
				offlineCalls++;
				return { sampleRate: 48_000, channels: [new Float32Array(128), new Float32Array(128)] };
			};
			try {
				const operation = engine.renderMixRealtime({ preferBoundedOffline: true, onChunk: () => { delivered++; } });
				if (admitted) assert.equal((await operation).frameCount, 128);
				else await assert.rejects(operation, /Realtime AudioWorklet rendering is not supported/u);
				assert.equal(offlineCalls, admitted ? 1 : 0, identity);
				assert.equal(delivered, admitted ? 1 : 0, identity);
			} finally { await engine.dispose(); }
		}
	} finally {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});
