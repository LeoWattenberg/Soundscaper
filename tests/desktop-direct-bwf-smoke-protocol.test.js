/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	DIRECT_AIFF_SMOKE_FILE_BYTES,
	DIRECT_BWF_SMOKE_FILE_BYTES,
	DIRECT_WAV_SMOKE_FILE_BYTES,
	createDirectWavSmokeTargetHarness,
	encodeDirectWavSmokePlan,
	validateDirectWavRendererResult,
	validateDirectWavSmokeResult,
} from '../desktop/direct-wav-smoke.js';

const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'direct-wav-export-v1',
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
});
const FILTERS = Object.freeze([{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }]);

test('direct export target harness admits one exact completed BWF choice and evidence record', async () => {
	const appDataPath = '/tmp/direct-bwf-smoke-protocol';
	const root = join(appDataPath, `direct-wav-smoke-${PLAN.token}`);
	const files = new Map();
	const harness = createHarness(appDataPath, files);
	assert.equal(await harness.resolveSavePath({ purpose: 'audio-pcm-mix' }), join(root, 'completed.wav'));
	files.set(join(root, 'completed.wav'), DIRECT_WAV_SMOKE_FILE_BYTES);
	assert.equal(await harness.resolveSavePath({ purpose: 'audio-pcm-mix' }), join(root, 'cancelled.wav'));
	assert.equal(await harness.resolveSavePath({
		purpose: 'audio-pcm-mix', suggestedName: 'mix.aiff', filters: FILTERS,
	}), join(root, 'completed.aiff'));
	files.set(join(root, 'completed.aiff'), DIRECT_AIFF_SMOKE_FILE_BYTES);
	assert.equal(await harness.resolveSavePath({
		purpose: 'audio-pcm-mix', suggestedName: 'mix.wav', filters: FILTERS,
	}), join(root, 'completed-bwf.wav'));
	files.set(join(root, 'completed-bwf.wav'), DIRECT_BWF_SMOKE_FILE_BYTES);
	assert.deepEqual(await harness.evidence(), {
		selectionPurposes: Array.from({ length: 4 }, () => 'audio-pcm-mix'),
		completedBytes: DIRECT_WAV_SMOKE_FILE_BYTES,
		completedAiffBytes: DIRECT_AIFF_SMOKE_FILE_BYTES,
		completedBwfBytes: DIRECT_BWF_SMOKE_FILE_BYTES,
		aiffChoiceValidated: true,
		bwfChoiceValidated: true,
		cancelledAbsent: true,
		stagingFilesRemaining: 0,
	});
	await assert.rejects(harness.resolveSavePath({ purpose: 'audio-pcm-mix' }), /exactly four/iu);
});

test('direct export target harness rejects noncanonical BWF choices', async () => {
	for (const choice of [
		{ purpose: 'audio-pcm-mix', suggestedName: 'mix.bwf', filters: FILTERS },
		{ purpose: 'audio-pcm-mix', suggestedName: 'mix.WAV', filters: FILTERS },
		{ purpose: 'audio-pcm-mix', suggestedName: 'mix.wav', filters: [{ name: 'WAV', extensions: ['wav'] }] },
	]) {
		const harness = createHarness('/tmp/direct-bwf-choice', new Map());
		await harness.resolveSavePath({ purpose: 'audio-pcm-mix' });
		await harness.resolveSavePath({ purpose: 'audio-pcm-mix' });
		await harness.resolveSavePath({ purpose: 'audio-pcm-mix', suggestedName: 'mix.aiff', filters: FILTERS });
		await assert.rejects(harness.resolveSavePath(choice), /BWF|filter/iu);
	}
});

test('direct export payload closes packaged BWF renderer and native evidence', () => {
	const renderer = {
		imported: true,
		completed: true,
		cancelled: true,
		aiffCompleted: true,
		bwfCompleted: true,
		realtimeCount: 4,
		downloadVisible: false,
	};
	assert.deepEqual(validateDirectWavRendererResult(renderer), renderer);
	const payload = {
		...PLAN,
		renderer,
		native: {
			selectionPurposes: Array.from({ length: 4 }, () => 'audio-pcm-mix'),
			completedBytes: DIRECT_WAV_SMOKE_FILE_BYTES,
			completedAiffBytes: DIRECT_AIFF_SMOKE_FILE_BYTES,
			completedBwfBytes: DIRECT_BWF_SMOKE_FILE_BYTES,
			aiffChoiceValidated: true,
			bwfChoiceValidated: true,
			cancelledAbsent: true,
			stagingFilesRemaining: 0,
		},
	};
	assert.deepEqual(validateDirectWavSmokeResult(payload, PLAN), payload);
	for (const invalid of [
		{ ...payload, renderer: { ...renderer, bwfCompleted: false } },
		{ ...payload, renderer: { ...renderer, realtimeCount: 3 } },
		{ ...payload, native: { ...payload.native, completedBwfBytes: DIRECT_BWF_SMOKE_FILE_BYTES - 1 } },
		{ ...payload, native: { ...payload.native, bwfChoiceValidated: false } },
	]) assert.throws(() => validateDirectWavSmokeResult(invalid, PLAN), /BWF|realtime/iu);
});

function createHarness(appDataPath, files) {
	const root = join(appDataPath, `direct-wav-smoke-${PLAN.token}`);
	return createDirectWavSmokeTargetHarness({
		argv: [
			'/packaged/soundscaper', '--soundscaper-smoke',
			'--soundscaper-smoke-mode=direct-wav-export-v1',
			`--soundscaper-smoke-plan=${encodeDirectWavSmokePlan(PLAN)}`,
			`--soundscaper-smoke-app-data=${appDataPath}`,
		],
		mkdirImpl: async () => {},
		statImpl: async (path) => {
			if (path === root) return { mode: 0o700, isDirectory: () => true, isFile: () => false };
			if (files.has(path)) return { size: files.get(path), isDirectory: () => false, isFile: () => true };
			throw Object.assign(new Error('missing'), { code: 'ENOENT' });
		},
		readdirImpl: async () => [...files.keys()].map((path) => path.slice(root.length + 1)),
		waitImpl: async () => {},
	});
}
