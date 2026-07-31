/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_PREFIX,
	DIRECT_AIFF_SMOKE_FILE_BYTES,
	DIRECT_BWF_SMOKE_FILE_BYTES,
	DIRECT_WAV_SMOKE_FILE_BYTES,
	createDirectWavSmokeTargetHarness,
	decodeDirectWavSmokePlan,
	encodeDirectWavSmokePlan,
	runDirectWavRendererSmoke,
	validateDirectWavRendererResult,
	validateDirectWavSmokePlan,
	validateDirectWavSmokeResult,
} from '../desktop/direct-wav-smoke.js';
import { createRendererScope } from './helpers/desktop-direct-wav-renderer-scope.js';

const PLAN = Object.freeze({
	schemaVersion: 1,
	mode: 'direct-wav-export-v1',
	productId: 'soundscaper',
	token: '0123456789abcdef0123456789abcdef',
});

test('direct WAV smoke plans are canonical, bounded, token-only base64url JSON', () => {
	const encoded = encodeDirectWavSmokePlan(PLAN);
	assert.match(encoded, /^[A-Za-z\d_-]+$/u);
	assert.deepEqual(decodeDirectWavSmokePlan(encoded), PLAN);
	assert.deepEqual(validateDirectWavSmokePlan({
		token: PLAN.token,
		productId: PLAN.productId,
		mode: PLAN.mode,
		schemaVersion: PLAN.schemaVersion,
	}), PLAN);
	assert.equal(Object.isFrozen(decodeDirectWavSmokePlan(encoded)), true);
	assert.equal(DESKTOP_DIRECT_WAV_SMOKE_MODE, PLAN.mode);
	assert.equal(DESKTOP_DIRECT_WAV_SMOKE_PREFIX, 'SOUNDSCAPER_DESKTOP_DIRECT_WAV_SMOKE');
	assert.equal(DIRECT_AIFF_SMOKE_FILE_BYTES, 202_751_798);
	assert.equal(DIRECT_BWF_SMOKE_FILE_BYTES, 202_752_510);
	assert.equal(DIRECT_WAV_SMOKE_FILE_BYTES, 202_751_788);

	for (const invalid of [
		null,
		{ ...PLAN, schemaVersion: 2 },
		{ ...PLAN, mode: 'artifact' },
		{ ...PLAN, productId: 'unknown' },
		{ ...PLAN, token: PLAN.token.toUpperCase() },
		{ ...PLAN, token: '../completed.wav' },
		{ ...PLAN, path: '/tmp/completed.wav' },
	]) {
		assert.throws(() => validateDirectWavSmokePlan(invalid), /plan|schema|mode|product|token|field/iu);
	}
	assert.throws(() => decodeDirectWavSmokePlan('not+base64'), /base64url/iu);
	assert.throws(() => decodeDirectWavSmokePlan(`${encoded}=`), /base64url/iu);
	assert.throws(() => decodeDirectWavSmokePlan('A'.repeat(1_024)), /byte limit/iu);
	assert.throws(() => validateDirectWavSmokePlan(Object.assign(new Date(), PLAN)), /plain object/iu);
	const nonCanonicalJson = Buffer.from(JSON.stringify({
		token: PLAN.token,
		productId: PLAN.productId,
		mode: PLAN.mode,
		schemaVersion: PLAN.schemaVersion,
	})).toString('base64url');
	assert.throws(() => decodeDirectWavSmokePlan(nonCanonicalJson), /canonical/iu);
});

test('direct WAV target harness pins argv, creates one exclusive private root, and reports bounded evidence', async () => {
	const appDataPath = '/tmp/soundscaper-smoke-app-data';
	const encoded = encodeDirectWavSmokePlan(PLAN);
	const argv = directArgv(encoded, appDataPath);
	const directories = new Map();
	const files = new Map();
	const mkdirCalls = [];
	const harness = createDirectWavSmokeTargetHarness({
		argv,
		mkdirImpl: async (path, options) => {
			mkdirCalls.push([path, options]);
			if (directories.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
			directories.set(path, options.mode);
		},
		statImpl: async (path) => {
			if (directories.has(path)) return fakeDirectoryStat(directories.get(path));
			if (files.has(path)) return fakeFileStat(files.get(path));
			throw Object.assign(new Error('missing'), { code: 'ENOENT' });
		},
		readdirImpl: async (path) => [...files.keys()]
			.filter((candidate) => candidate.startsWith(`${path}/`))
			.map((candidate) => candidate.slice(path.length + 1)),
		waitImpl: async () => {},
	});
	const smokeRoot = join(appDataPath, `direct-wav-smoke-${PLAN.token}`);
	assert.deepEqual(mkdirCalls, []);
	assert.equal(await harness.resolveSavePath({ purpose: 'audio-pcm-mix', suggestedName: 'anything.wav' }), join(smokeRoot, 'completed.wav'));
	assert.deepEqual(mkdirCalls, [[smokeRoot, { recursive: false, mode: 0o700 }]]);
	files.set(join(smokeRoot, 'completed.wav'), DIRECT_WAV_SMOKE_FILE_BYTES);
	files.set(join(smokeRoot, '.cancelled.wav.aabb.soundscaper-part'), 44);
	assert.equal(await harness.resolveSavePath({ purpose: 'audio-pcm-mix', suggestedName: 'ignored.wav' }), join(smokeRoot, 'cancelled.wav'));
	files.delete(join(smokeRoot, '.cancelled.wav.aabb.soundscaper-part'));
	assert.equal(await harness.resolveSavePath({
		purpose: 'audio-pcm-mix',
		suggestedName: 'Soundscaper Export.aiff',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	}), join(smokeRoot, 'completed.aiff'));
	files.set(join(smokeRoot, 'completed.aiff'), DIRECT_AIFF_SMOKE_FILE_BYTES);
	assert.equal(await harness.resolveSavePath({
		purpose: 'audio-pcm-mix',
		suggestedName: 'Soundscaper Export.wav',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	}), join(smokeRoot, 'completed-bwf.wav'));
	files.set(join(smokeRoot, 'completed-bwf.wav'), DIRECT_BWF_SMOKE_FILE_BYTES);
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
	await assert.rejects(
		harness.resolveSavePath({ purpose: 'audio-pcm-mix', suggestedName: 'fifth.wav' }),
		/exactly four/iu,
	);
});

test('direct WAV target harness rejects mismatched authority and unsafe choices before filesystem use', async () => {
	const appDataPath = '/tmp/direct-wav-authority';
	const encoded = encodeDirectWavSmokePlan(PLAN);
	for (const options of [
		{ argv: directArgv(encoded, '../relative'), plan: PLAN, appDataPath },
		{ argv: directArgv(encoded, '/tmp/direct-wav-authority/../drift'), plan: PLAN },
		{ argv: directArgv(encoded, `${appDataPath}-other`), plan: PLAN, appDataPath },
		{ argv: [...directArgv(encoded, appDataPath), `--soundscaper-smoke-app-data=${appDataPath}`], plan: PLAN, appDataPath },
		{ argv: directArgv(encodeDirectWavSmokePlan({ ...PLAN, token: 'f'.repeat(32) }), appDataPath), plan: PLAN, appDataPath },
	]) {
		assert.throws(() => createDirectWavSmokeTargetHarness(options), /app data|exactly one|plan/iu);
	}
	let mkdirCalls = 0;
	const harness = createDirectWavSmokeTargetHarness({
		argv: directArgv(encoded, appDataPath),
		plan: PLAN,
		appDataPath,
		mkdirImpl: async () => { mkdirCalls += 1; },
		statImpl: async () => fakeDirectoryStat(0o700),
		readdirImpl: async () => [],
	});
	await assert.rejects(harness.resolveSavePath({ purpose: 'audio', suggestedName: 'wrong.wav' }), /audio-pcm-mix/iu);
	assert.equal(mkdirCalls, 0);

	for (const invalidChoice of [
		{ purpose: 'audio-pcm-mix', suggestedName: 'wrong.wav', filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }] },
		{ purpose: 'audio-pcm-mix', suggestedName: 'mix.AIFF', filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }] },
		{ purpose: 'audio-pcm-mix', suggestedName: 'mix.aiff', filters: [{ name: 'All files', extensions: ['*'] }] },
	]) {
		const guarded = createDirectWavSmokeTargetHarness({
			argv: directArgv(encoded, appDataPath),
			mkdirImpl: async () => {},
			statImpl: async () => fakeDirectoryStat(0o700),
			readdirImpl: async () => [],
		});
		await guarded.resolveSavePath({ purpose: 'audio-pcm-mix' });
		await guarded.resolveSavePath({ purpose: 'audio-pcm-mix' });
		await assert.rejects(guarded.resolveSavePath(invalidChoice), /AIFF|filter/iu);
	}
});

test('direct WAV target harness reports bounded directory state when native evidence times out', async () => {
	const appDataPath = '/tmp/direct-wav-timeout';
	const smokeRoot = join(appDataPath, `direct-wav-smoke-${PLAN.token}`);
	const files = new Map([
		[join(smokeRoot, 'completed.wav'), DIRECT_WAV_SMOKE_FILE_BYTES],
		[join(smokeRoot, 'cancelled.wav'), 48],
		[join(smokeRoot, '.cancelled.wav.0123456789abcdef0123456789abcdef.soundscaper-part'), 4_096],
	]);
	let now = 0;
	const harness = createDirectWavSmokeTargetHarness({
		argv: directArgv(encodeDirectWavSmokePlan(PLAN), appDataPath),
		mkdirImpl: async () => {},
		statImpl: async (path) => {
			if (path === smokeRoot) return fakeDirectoryStat(0o700);
			if (files.has(path)) return fakeFileStat(files.get(path));
			throw Object.assign(new Error('missing'), { code: 'ENOENT' });
		},
		readdirImpl: async () => [...files.keys()].map((path) => path.slice(smokeRoot.length + 1)),
		waitImpl: async () => {},
		now: () => {
			now += 16_000;
			return now;
		},
	});
	await harness.resolveSavePath({ purpose: 'audio-pcm-mix' });
	await harness.resolveSavePath({ purpose: 'audio-pcm-mix' });
	await harness.resolveSavePath({
		purpose: 'audio-pcm-mix',
		suggestedName: 'Soundscaper Export.aiff',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	});
	await harness.resolveSavePath({
		purpose: 'audio-pcm-mix',
		suggestedName: 'Soundscaper Export.wav',
		filters: [{ name: 'WAV and AIFF audio mix', extensions: ['wav', 'aif', 'aiff'] }],
	});
	await assert.rejects(
		harness.evidence(),
		(error) => /native evidence timed out/iu.test(error.message)
			&& error.message.includes('completed.wav","size":202751788')
			&& error.message.includes('cancelled.wav","size":48')
			&& error.message.includes('soundscaper-part","size":4096'),
	);
});

test('direct WAV result validation closes renderer and native evidence schemas', () => {
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
	const validated = validateDirectWavSmokeResult(payload, PLAN);
	assert.deepEqual(validated, payload);
	assert.equal(Object.isFrozen(validated), true);
	assert.equal(Object.isFrozen(validated.renderer), true);
	assert.equal(Object.isFrozen(validated.native.selectionPurposes), true);

	for (const invalid of [
		{ ...payload, path: '/tmp/completed.wav' },
		{ ...payload, token: 'f'.repeat(32) },
		{ ...payload, renderer: { ...renderer, realtimeCount: 1 } },
		{ ...payload, renderer: { ...renderer, aiffCompleted: false } },
		{ ...payload, renderer: { ...renderer, bwfCompleted: false } },
		{ ...payload, renderer: { ...renderer, downloadVisible: true } },
		{ ...payload, native: { ...payload.native, completedBytes: DIRECT_WAV_SMOKE_FILE_BYTES - 1 } },
		{ ...payload, native: { ...payload.native, completedAiffBytes: DIRECT_AIFF_SMOKE_FILE_BYTES - 1 } },
		{ ...payload, native: { ...payload.native, completedBwfBytes: DIRECT_BWF_SMOKE_FILE_BYTES - 1 } },
		{ ...payload, native: { ...payload.native, cancelledAbsent: false } },
		{ ...payload, native: { ...payload.native, selectionPurposes: ['audio-pcm-mix'] } },
	]) {
		assert.throws(() => validateDirectWavSmokeResult(invalid, PLAN), /result|field|token|realtime|download|byte|cancel|selection|AIFF export|BWF export/iu);
	}
});

test('renderer smoke is self-contained and drives import, completed export, and cancellation', async () => {
	const scope = createRendererScope();
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	const result = await serializedRoutine(scope, PLAN);
	assert.deepEqual(result, {
		imported: true,
		completed: true,
		cancelled: true,
		aiffCompleted: true,
		bwfCompleted: true,
		bw64Completed: true,
		realtimeCount: 5,
		downloadVisible: false,
	});
	assert.equal(scope.document.fixture.importedFiles[0].name, `direct-wav-smoke-${PLAN.token}.wav`);
	assert.equal(scope.document.fixture.importedFiles[0].size, 3_168_044);
	const input = new DataView(
		scope.document.fixture.importedFiles[0].bytes.buffer,
		scope.document.fixture.importedFiles[0].bytes.byteOffset,
		scope.document.fixture.importedFiles[0].bytes.byteLength,
	);
	assert.equal(input.getUint16(22, true), 2);
	assert.equal(input.getUint32(24, true), 48_000);
	assert.equal(input.getUint32(40, true) / 4, 792_000);
	assert.equal(scope.document.fixture.importedFiles[1].name, `direct-bw64-smoke-${PLAN.token}.wav`);
	assert.equal(scope.document.fixture.importedFiles[1].size, 25_344_044);
	const bw64Input = new DataView(
		scope.document.fixture.importedFiles[1].bytes.buffer,
		scope.document.fixture.importedFiles[1].bytes.byteOffset,
		scope.document.fixture.importedFiles[1].bytes.byteLength,
	);
	assert.equal(bw64Input.getUint16(22, true), 6);
	assert.equal(bw64Input.getUint32(24, true), 48_000);
	assert.equal(bw64Input.getUint32(40, true) / 12, 2_112_000);
	assert.ok((bw64Input.getUint32(40, true) / 2) * 4 > 32 * 1024 ** 2);
	for (const frame of [0, 1, 48_000, 2_111_999]) {
		const sample = bw64Input.getInt16(44 + frame * 12, true);
		for (let channel = 1; channel < 6; channel += 1) {
			assert.equal(bw64Input.getInt16(44 + (frame * 6 + channel) * 2, true), sample);
		}
	}
	assert.equal(scope.document.fixture.settings.format, 2);
	assert.equal(scope.document.fixture.settings.bitDepth, 0);
	assert.equal(scope.document.fixture.settings.sampleRate, '384000');
	assert.equal(scope.document.fixture.settings.channelMapping, 2);
	assert.equal(scope.document.fixture.settings.dither, 0);
	assert.deepEqual(scope.document.fixture.selectionHistory, [
		['bitDepth', 0], ['channelMapping', 3], ['dither', 0], ['format', 3], ['bitDepth', 0],
		['format', 1], ['bitDepth', 0], ['channelMapping', 3], ['format', 2], ['bitDepth', 0], ['dither', 0],
	]);
	assert.deepEqual(scope.document.fixture.bextAtStart[3], {
		description: 'Soundscaper packaged BWF smoke', originator: 'Soundscaper',
		originatorReference: 'PACKAGED-BWF-0001', originationDate: '2026-07-30',
		originationTime: '12:34:56', timeReference: '6000', umid: '',
		loudnessValue: '', loudnessRange: '', maxTruePeakLevel: '',
		maxMomentaryLoudness: '', maxShortTermLoudness: '',
		codingHistory: 'A=PCM,F=48000,W=16,M=stereo,T=SmokeFixture\n',
	});
	assert.deepEqual(scope.document.fixture.bextAtStart[4], {
		description: 'Soundscaper packaged BW64 smoke', originator: 'Soundscaper',
		originatorReference: 'PACKAGED-BW64-0001', originationDate: '2026-07-30',
		originationTime: '12:34:56', timeReference: '6000', umid: '',
		loudnessValue: '', loudnessRange: '', maxTruePeakLevel: '',
		maxMomentaryLoudness: '', maxShortTermLoudness: '',
		codingHistory: 'A=PCM,F=48000,W=16,M=multi,T=SmokeFixture\n',
	});
	assert.deepEqual(scope.document.fixture.adm, {
		'adm-programme-name': 'Soundscaper packaged BW64 programme',
		'adm-programme-language': '',
		'adm-content-name': 'Soundscaper packaged BW64 content',
		'adm-content-language': '',
		'adm-bed-name': 'Soundscaper packaged BW64 5.1 bed',
	});
	assert.equal(scope.document.fixture.admLayout, '5.1');
	assert.deepEqual(scope.document.fixture.admRoutes, ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
	assert.deepEqual(scope.document.fixture.metadataFields, Array.from({ length: 8 }, () => ''));
	assert.equal(scope.document.fixture.customMetadata, '{}');
	assert.equal(scope.document.fixture.completedRuns, 4);
	assert.equal(scope.document.fixture.cancelledRuns, 1);
	assert.equal(scope.document.fixture.newProjectCount, 1);
	assert.equal(scope.document.fixture.dialogCloseCount, 1);
	assert.ok(scope.document.fixture.progressQueries > 0);
});

test('renderer smoke reports the editor import failure without waiting for a timeout', async () => {
	const scope = createRendererScope({
		importFailure: 'The WAV fixture could not be decoded.',
		waitFailure: 'The smoke waited after the editor had already rejected the fixture.',
	});
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await assert.rejects(
		serializedRoutine(scope, PLAN),
		/The WAV fixture could not be decoded/iu,
	);
});

test('renderer smoke closes the project bin so its fixture reaches the timeline', async () => {
	const scope = createRendererScope({
		projectBinVisible: true,
		waitFailure: 'The fixture was routed into the open project bin.',
	});
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	const result = await serializedRoutine(scope, PLAN);
	assert.equal(result.imported, true);
	assert.equal(scope.document.fixture.projectBinCloseCount, 1);
	assert.equal(scope.document.fixture.routedToProjectBin, false);
});

test('renderer smoke reports the editor export failure before starting cancellation', async () => {
	const scope = createRendererScope({ exportFailure: 'The direct WAV write failed.' });
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await assert.rejects(
		serializedRoutine(scope, PLAN),
		/The direct WAV write failed/iu,
	);
	assert.equal(scope.document.fixture.completedRuns, 1);
	assert.equal(scope.document.fixture.cancelledRuns, 0);
});

test('renderer smoke reports an AIFF export failure after preserving the WAV sequence', async () => {
	const scope = createRendererScope({ aiffExportFailure: 'The direct AIFF write failed.' });
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await assert.rejects(serializedRoutine(scope, PLAN), /direct AIFF write failed/iu);
	assert.equal(scope.document.fixture.completedRuns, 2);
	assert.equal(scope.document.fixture.cancelledRuns, 1);
});

test('renderer smoke reports a BWF export failure after preserving WAV and AIFF evidence', async () => {
	const scope = createRendererScope({ bwfExportFailure: 'The direct BWF write failed.' });
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await assert.rejects(serializedRoutine(scope, PLAN), /direct BWF write failed/iu);
	assert.equal(scope.document.fixture.completedRuns, 3);
	assert.equal(scope.document.fixture.cancelledRuns, 1);
});

test('renderer smoke reports a BW64 export failure after preserving earlier container evidence', async () => {
	const scope = createRendererScope({ bw64ExportFailure: 'The direct BW64 write failed.' });
	const serializedRoutine = Function(`"use strict"; return (${runDirectWavRendererSmoke.toString()});`)();
	await assert.rejects(serializedRoutine(scope, PLAN), /direct BW64 write failed/iu);
	assert.equal(scope.document.fixture.completedRuns, 4);
	assert.equal(scope.document.fixture.cancelledRuns, 1);
});

function directArgv(encodedPlan, appDataPath) {
	return [
		'/packaged/soundscaper',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_DIRECT_WAV_SMOKE_MODE}`,
		`--soundscaper-smoke-plan=${encodedPlan}`,
		`--soundscaper-smoke-app-data=${appDataPath}`,
	];
}

function fakeDirectoryStat(mode) {
	return { mode, isDirectory: () => true, isFile: () => false };
}

function fakeFileStat(size) {
	return { size, isDirectory: () => false, isFile: () => true };
}
