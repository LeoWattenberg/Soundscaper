/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runSoundscaperNativeServicesAction } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

function fixture(granted = false, outcome: unknown = undefined) {
	const calls: unknown[] = [];
	const bridge = {
		nativePluginAvailability: async () => ({ consent: { formats: [{ format: 'vst3', granted }] } }),
		setNativePluginConsent: async (request: unknown) => { calls.push(request); return outcome; },
	} as unknown as SoundscaperNativeServicesBridge;
	return { bridge, calls };
}

test('choosing a folder grants its format without a separate format switch', async () => {
	for (const consent of ['add-standard-root', 'add-custom-root'] as const) {
		const { bridge, calls } = fixture();
		const result = await runSoundscaperNativeServicesAction(bridge, { type: 'consent', format: 'vst3', consent, rootId: 'root' });
		assert.equal(result.type, 'settled');
		assert.deepEqual(calls, [
			{ format: 'vst3', action: 'grant' },
			{ format: 'vst3', action: consent, rootId: 'root' },
		]);
	}
});

test('folder removal never grants a format and an existing grant is reused', async () => {
	for (const consent of ['remove-root', 'add-standard-root'] as const) {
		const { bridge, calls } = fixture(true);
		await runSoundscaperNativeServicesAction(bridge, { type: 'consent', format: 'vst3', consent, rootId: 'root' });
		assert.deepEqual(calls, [{ format: 'vst3', action: consent, rootId: 'root' }]);
	}
});

test('a refused custom path is reported as an error', async () => {
	const { bridge } = fixture(true, { status: 'refused', message: 'This path is already in the list.' });
	const result = await runSoundscaperNativeServicesAction(bridge, { type: 'consent', format: 'vst3', consent: 'add-custom-root' });
	assert.equal(result.type, 'failed');
	if (result.type === 'failed') assert.equal(result.message, 'This path is already in the list.');
});

test('a cancelled folder picker settles without an error', async () => {
	const { bridge } = fixture(true, { status: 'declined' });
	const result = await runSoundscaperNativeServicesAction(bridge, { type: 'consent', format: 'vst3', consent: 'add-custom-root' });
	assert.equal(result.type, 'settled');
});

test('scanning a saved folder recovers a previously disabled format', async () => {
	const { bridge, calls } = fixture();
	const scanBridge: SoundscaperNativeServicesBridge = { ...bridge,
		scanNativePlugins: async (request) => {
			calls.push(request);
			return { status: 'described', scan: { format: 'vst3', status: 'complete', detail: '', entries: [] } };
		},
		listNativePlugins: async () => ({ entries: [] }),
	};
	const result = await runSoundscaperNativeServicesAction(scanBridge, { type: 'scan', format: 'vst3', rootId: 'saved' });
	assert.equal(result.type, 'settled');
	assert.deepEqual(calls, [{ format: 'vst3', action: 'grant' }, { format: 'vst3', rootId: 'saved' }]);
});
