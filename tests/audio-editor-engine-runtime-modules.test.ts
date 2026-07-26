/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as engineFacade from '../src/common/editor/engine.js';
import { WebAudioEditorEngine } from '../src/common/editor/engine.js';
import { installEngineMethodMaps } from '../src/common/editor/engine/method-installer.ts';
import { ENGINE_PUBLIC_METHOD_NAMES } from '../src/common/editor/engine/runtime-methods.ts';

test('the decomposed engine runtime preserves the public prototype surface', () => {
	assert.deepEqual(
		Object.getOwnPropertyNames(WebAudioEditorEngine.prototype).sort(),
		['constructor', ...ENGINE_PUBLIC_METHOD_NAMES].sort(),
	);
});

test('runtime composition rejects duplicate method ownership', () => {
	assert.throws(
		() => installEngineMethodMaps({}, [
			{ play() {} },
			{ play() {} },
		]),
		/duplicate engine runtime method: play/i,
	);
});

test('the engine facade retains its established exports and factory identity', async () => {
	assert.deepEqual(Object.keys(engineFacade).sort(), [
		'AudioEditorEngineDisposedError',
		'PARAMETRIC_EQ_SPECTRUM_FFT_SIZE',
		'PLAY_AT_SPEED_STAFFPAD_MEMORY_LIMIT_BYTES',
		'WebAudioEditorEngine',
		'applyEffectRack',
		'assertPlayAtSpeedStaffPadMemorySafe',
		'automaticCrossfadeRanges',
		'buildProjectGraph',
		'createAudioEditorEngine',
		'createRecordingCapturePool',
		'createRecordingController',
		'effectRackLatencyFrames',
		'estimatePlayAtSpeedStaffPadPeakBytes',
		'getProjectDurationFrames',
		'getProjectTimelineDurationFrames',
		'isAudioEditorEngineSupported',
		'projectEffectRacks',
		'projectGraphLatencyFrames',
		'requestDisplayInput',
		'requestHardwareInput',
		'requestMicrophone',
	].sort());

	const engine = engineFacade.createAudioEditorEngine({ audioContextFactory: null });
	assert.equal(WebAudioEditorEngine.name, 'WebAudioEditorEngine');
	assert.strictEqual(engine.constructor, WebAudioEditorEngine);
	assert.ok(engine instanceof WebAudioEditorEngine);
	await engine.dispose();
});
