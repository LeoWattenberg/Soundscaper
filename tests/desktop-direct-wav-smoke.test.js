/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	appendFile,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE,
	DESKTOP_DIRECT_BWF_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
	DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX,
	MAX_DESKTOP_DIRECT_WAV_PLAN_BYTES,
	createDesktopDirectWavSmokeAggregate,
	createDesktopDirectWavSmokeInvocation,
	createDesktopDirectWavSmokePlan,
	createDesktopDirectWavStagingObserver,
	decodeDesktopDirectWavSmokePlan,
	deriveDesktopDirectWavSmokePaths,
	encodeDesktopDirectWavSmokePlan,
	formatDesktopDirectWavSmokeAggregate,
	parseDesktopDirectWavSmokeOutput,
	runBoundedDesktopDirectWavChild,
	runDesktopDirectWavSmoke,
} from '../scripts/lib/desktop-direct-wav-smoke.mjs';
import { validDesktopDirectBwfFileEvidence } from './helpers/desktop-direct-bwf-file-evidence.js';

const TOKEN = '0123456789abcdef0123456789abcdef';

test('direct-WAV packaged smoke plans are strict canonical token-only JSON', () => {
	const plan = createDesktopDirectWavSmokePlan({ token: TOKEN });
	assert.deepEqual(plan, {
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: 'soundscaper',
		token: TOKEN,
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(DESKTOP_DIRECT_WAV_SMOKE_MODE, 'direct-wav-export-v1');
	assert.deepEqual(DESKTOP_DIRECT_WAV_SMOKE_FIXTURE, {
		input: { sampleRate: 48_000, channelCount: 2, frameCount: 792_000 },
		output: {
			sampleRate: 384_000,
			channelCount: 16,
			bitDepth: 16,
			frameCount: 6_335_992,
			dataBytes: 202_751_744,
			byteLength: 202_751_788,
		},
	});
	assert.equal(Object.isFrozen(DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output), true);
	assert.equal(DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output.byteLength, 202_751_798);
	assert.equal(DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output.byteLength, 202_752_510);

	const encoded = encodeDesktopDirectWavSmokePlan(plan);
	assert.match(encoded, /^[A-Za-z0-9_-]+$/u);
	assert.ok(Buffer.byteLength(encoded) <= MAX_DESKTOP_DIRECT_WAV_PLAN_BYTES);
	assert.deepEqual(decodeDesktopDirectWavSmokePlan(encoded), plan);
	assert.doesNotMatch(Buffer.from(encoded, 'base64url').toString('utf8'), /(?:\/|\\|path|frame|sample|byte)/iu);
	assert.equal(
		encodeDesktopDirectWavSmokePlan({ token: TOKEN, productId: 'soundscaper', mode: DESKTOP_DIRECT_WAV_SMOKE_MODE, schemaVersion: 1 }),
		encoded,
	);

	for (const invalid of [
		{ ...plan, token: TOKEN.toUpperCase() },
		{ ...plan, token: '../escape' },
		{ ...plan, outputPath: '/tmp/export.wav' },
		{ ...plan, productId: 'unknown' },
		{ ...plan, schemaVersion: 2 },
		{ ...plan, mode: 'artifact' },
	]) {
		assert.throws(() => encodeDesktopDirectWavSmokePlan(invalid), /plan|token|product|schema|mode|field/iu);
	}
	assert.throws(() => decodeDesktopDirectWavSmokePlan('not+base64'), /base64url/iu);
	assert.throws(
		() => decodeDesktopDirectWavSmokePlan(Buffer.from(` ${JSON.stringify(plan)}`).toString('base64url')),
		/canonical/iu,
	);
});

test('direct-WAV smoke invocation derives WAV, AIFF, and BWF targets under isolated app data', () => {
	const invocation = createDesktopDirectWavSmokeInvocation({
		arch: 'x64',
		outputRoot: '/release/desktop',
		platform: 'linux',
		profileRoot: '/tmp/direct-wav-profile',
		token: TOKEN,
	});
	assert.deepEqual(invocation.plan, createDesktopDirectWavSmokePlan({ token: TOKEN }));
	assert.equal(invocation.sharedAppDataPath, '/tmp/direct-wav-profile/application-data');
	assert.equal(invocation.userDataPath, '/tmp/direct-wav-profile/profile');
	assert.deepEqual(invocation.outputPaths, {
		root: `/tmp/direct-wav-profile/application-data/direct-wav-smoke-${TOKEN}`,
		completed: `/tmp/direct-wav-profile/application-data/direct-wav-smoke-${TOKEN}/completed.wav`,
		completedAiff: `/tmp/direct-wav-profile/application-data/direct-wav-smoke-${TOKEN}/completed.aiff`,
		completedBwf: `/tmp/direct-wav-profile/application-data/direct-wav-smoke-${TOKEN}/completed-bwf.wav`,
		cancelled: `/tmp/direct-wav-profile/application-data/direct-wav-smoke-${TOKEN}/cancelled.wav`,
	});
	assert.ok(invocation.executableCandidates.includes('/release/desktop/linux-unpacked/soundscaper'));
	assert.deepEqual(invocation.appArguments, [
		'--user-data-dir=/tmp/direct-wav-profile/profile',
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_DIRECT_WAV_SMOKE_MODE}`,
		`--soundscaper-smoke-plan=${invocation.encodedPlan}`,
		'--soundscaper-smoke-app-data=/tmp/direct-wav-profile/application-data',
		'--lang=en',
		'--mute-audio',
		'--autoplay-policy=no-user-gesture-required',
	]);
	assert.doesNotMatch(invocation.encodedPlan, /tmp|wav|profile/iu);
	assert.equal(Object.isFrozen(invocation.outputPaths), true);

	assert.deepEqual(
		deriveDesktopDirectWavSmokePaths('/tmp/app-data', TOKEN),
		{
			root: `/tmp/app-data/direct-wav-smoke-${TOKEN}`,
			completed: `/tmp/app-data/direct-wav-smoke-${TOKEN}/completed.wav`,
			completedAiff: `/tmp/app-data/direct-wav-smoke-${TOKEN}/completed.aiff`,
			completedBwf: `/tmp/app-data/direct-wav-smoke-${TOKEN}/completed-bwf.wav`,
			cancelled: `/tmp/app-data/direct-wav-smoke-${TOKEN}/cancelled.wav`,
		},
	);
	for (const [appDataPath, token] of [
		['relative', TOKEN],
		['/tmp/app-data/../other', TOKEN],
		['/tmp/app-data', '../escape'],
	]) {
		assert.throws(() => deriveDesktopDirectWavSmokePaths(appDataPath, token), /absolute|token/iu);
	}
});

test('direct-WAV child output parser requires one exact plan-bound result', () => {
	const invocation = createDesktopDirectWavSmokeInvocation({
		arch: 'x64',
		outputRoot: '/release/desktop',
		platform: 'linux',
		profileRoot: '/tmp/direct-wav-profile',
		token: TOKEN,
	});
	const payload = validPayload(invocation);
	const line = `${DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX}${JSON.stringify(payload)}`;
	assert.deepEqual(
		parseDesktopDirectWavSmokeOutput(`diagnostic\n${line}\n`, invocation),
		payload,
	);
	assert.throws(() => parseDesktopDirectWavSmokeOutput(`${line}\n${line}\n`, invocation), /exactly one/iu);
	assert.throws(() => parseDesktopDirectWavSmokeOutput('x'.repeat(1024 * 1024 + 1), invocation), /1 MiB/iu);

	for (const [field, mutation] of [
		['token', (value) => ({ ...value, token: 'f'.repeat(32) })],
		['product', (value) => ({ ...value, productId: 'framescaper' })],
		['renderer', (value) => ({ ...value, renderer: { ...value.renderer, realtimeCount: 1 } })],
		['AIFF', (value) => ({ ...value, renderer: { ...value.renderer, aiffCompleted: false } })],
		['BWF', (value) => ({ ...value, renderer: { ...value.renderer, bwfCompleted: false } })],
		['download', (value) => ({ ...value, renderer: { ...value.renderer, downloadVisible: true } })],
		['purpose', (value) => ({ ...value, native: { ...value.native, selectionPurposes: ['audio'] } })],
		['bytes', (value) => ({ ...value, native: { ...value.native, completedBytes: 44 } })],
		['AIFF.*bytes', (value) => ({ ...value, native: { ...value.native, completedAiffBytes: 54 } })],
		['BWF.*bytes', (value) => ({ ...value, native: { ...value.native, completedBwfBytes: 766 } })],
		['save choice', (value) => ({ ...value, native: { ...value.native, aiffChoiceValidated: false } })],
		['cancel', (value) => ({ ...value, native: { ...value.native, cancelledAbsent: false } })],
		['staging', (value) => ({ ...value, native: { ...value.native, stagingFilesRemaining: 1 } })],
		['extra', (value) => ({ ...value, extra: true })],
	]) {
		const changed = mutation(payload);
		assert.throws(
			() => parseDesktopDirectWavSmokeOutput(`${DESKTOP_DIRECT_WAV_SMOKE_OUTPUT_PREFIX}${JSON.stringify(changed)}`, invocation),
			new RegExp(field, 'iu'),
		);
	}
});

test('direct-WAV staging observer requires bounded valid geometry and nonzero payload evidence', async (t) => {
	const appData = await mkdtemp(join(tmpdir(), 'direct-wav-observer-'));
	t.after(() => rm(appData, { recursive: true, force: true }));
	const paths = deriveDesktopDirectWavSmokePaths(appData, TOKEN);
	await mkdir(paths.root, { mode: 0o700 });
	const stage = join(paths.root, '.cancelled.wav.0123456789abcdef0123456789abcdef.soundscaper-part');
	await t.test('inspects a capped prefix and reports cleanup', async () => {
		const observer = createDesktopDirectWavStagingObserver(paths, { pollIntervalMs: 5, maximumPrefixBytes: 64 });
		const unrelated = join(paths.root, '.completed.wav.0123456789abcdef0123456789abcdef.soundscaper-part');
		await writeFile(unrelated, Buffer.alloc(100));
		await writeFile(stage, directWavStagingPrefix(0));
		await delay(15);
		await appendFile(stage, directWavStagingPayload(256, 8));
		await delay(20);
		await rm(stage);
		await rm(unrelated);
		const result = await observer.stop();
		assert.deepEqual(result, {
			observed: true, riffHeaderValidated: true, nonzeroPayloadByteObserved: true,
			maximumStagedBytes: 300, maximumInspectedPrefixBytes: 64, remainingStagingFiles: 0,
		});
		assert.equal(Object.isFrozen(result), true);
	});
	await t.test('size alone does not imply nonzero payload', async () => {
		await writeFile(stage, Buffer.concat([directWavStagingPrefix(0), directWavStagingPayload(256)]));
		const observer = createDesktopDirectWavStagingObserver(paths, { pollIntervalMs: 2 });
		await delay(15);
		await rm(stage);
		const result = await observer.stop();
		assert.equal(result.maximumStagedBytes, 300);
		assert.equal(result.riffHeaderValidated, true);
		assert.equal(result.nonzeroPayloadByteObserved, false);
	});
	await t.test('waits for payload before judging a concurrently written header', async () => {
		const observer = createDesktopDirectWavStagingObserver(paths, { pollIntervalMs: 2 });
		await writeFile(stage, Buffer.alloc(44));
		await delay(15);
		await writeFile(stage, Buffer.concat([directWavStagingPrefix(0), directWavStagingPayload(16, 1)]));
		await delay(15);
		await rm(stage);
		const result = await observer.stop();
		assert.equal(result.riffHeaderValidated, true);
		assert.equal(result.nonzeroPayloadByteObserved, true);
	});
	await t.test('malformed RIFF geometry fails closed', async () => {
		const malformed = Buffer.concat([directWavStagingPrefix(0), directWavStagingPayload(16, 0)]);
		malformed.write('RIFX', 0);
		await writeFile(stage, malformed);
		const observer = createDesktopDirectWavStagingObserver(paths, { pollIntervalMs: 2 });
		await delay(15);
		await assert.rejects(observer.stop(), /staging RIFF geometry/iu);
	});
});

test('direct-WAV staging observation is single-flight and stop bounds a stuck filesystem sample', async () => {
	const paths = deriveDesktopDirectWavSmokePaths('/tmp/direct-wav-single-flight', TOKEN);
	let active = 0, calls = 0, maximumActive = 0;
	const observer = createDesktopDirectWavStagingObserver(paths, {
		pollIntervalMs: 1,
		sampleTimeoutMs: 100,
		readdirImpl: async () => {
			calls += 1;
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await delay(15);
			active -= 1;
			return [];
		},
	});
	await delay(40);
	await observer.stop();
	assert.equal(maximumActive, 1);
	assert.ok(calls >= 2 && calls <= 4, `unexpected filesystem sample count: ${String(calls)}`);

	const stuck = createDesktopDirectWavStagingObserver(paths, {
		pollIntervalMs: 1,
		sampleTimeoutMs: 20,
		readdirImpl: () => new Promise(() => {}),
	});
	await assert.rejects(Promise.race([
		stuck.stop(),
		delay(500).then(() => { throw new Error('observer stop exceeded its bound'); }),
	]), /sampling timed out.*20 milliseconds/iu);
});

test('bounded direct-WAV child runner caps output and elapsed time', async () => {
	const success = await runBoundedDesktopDirectWavChild(process.execPath, ['--version'], {
		cwd: process.cwd(),
		environment: process.env,
		maximumOutputBytes: 64,
		timeoutMs: 2_000,
	});
	assert.equal(success.code, 0);
	assert.match(success.stdout, /^v\d+/u);
	assert.equal(success.stderr, '');
	assert.deepEqual(Object.keys(success).sort(), ['code', 'stderr', 'stdout']);
	if (process.platform !== 'win32') {
		const separated = await runBoundedDesktopDirectWavChild('/bin/sh', [
			'-c', 'printf stdout-only; printf stderr-only >&2',
		], {
			cwd: process.cwd(),
			environment: process.env,
			maximumOutputBytes: 64,
			timeoutMs: 2_000,
		});
		assert.deepEqual(separated, { code: 0, stdout: 'stdout-only', stderr: 'stderr-only' });
	}
	await assert.rejects(
		() => runBoundedDesktopDirectWavChild(process.execPath, ['--v8-options'], {
			cwd: process.cwd(),
			environment: process.env,
			maximumOutputBytes: 64,
			timeoutMs: 2_000,
		}),
		/output.*64 bytes/iu,
	);
	const timeoutCommand = process.platform === 'win32' ? process.execPath : '/bin/sleep';
	const timeoutArguments = process.platform === 'win32'
		? [resolve('tests/fixtures/desktop-direct-wav-child-tree.mjs'), 'descendant', 'unused']
		: ['10'];
	await assert.rejects(
		() => runBoundedDesktopDirectWavChild(timeoutCommand, timeoutArguments, {
			cwd: process.cwd(),
			environment: process.env,
			maximumOutputBytes: 64,
			timeoutMs: 20,
		}),
		/timed out.*20 milliseconds/iu,
	);
});

test('bounded direct-WAV child runner terminates a pipe-holding process tree', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'direct-wav-child-tree-'));
	const marker = join(root, 'pids.json');
	const fixture = resolve('tests/fixtures/desktop-direct-wav-child-tree.mjs');
	let pids = null;
	t.after(async () => {
		pids ??= await readPidMarker(marker);
		await forceKillPids(pids);
		await rm(root, { recursive: true, force: true });
	});
	const command = process.platform === 'win32' ? process.execPath : '/bin/sh';
	const runArguments = process.platform === 'win32'
		? [fixture, 'leader', marker]
		: [fixture, marker];
	const startedAt = Date.now();
	const runPromise = runBoundedDesktopDirectWavChild(command, runArguments, {
		cwd: process.cwd(), environment: process.env, maximumOutputBytes: 64, timeoutMs: 10_000,
	});
	const result = await boundedChildResult(runPromise);
	pids = await readPidMarker(marker);
	assert.match(result?.message || '', /output.*64 bytes/iu);
	assert.ok(Date.now() - startedAt < 2_000, 'process-tree termination exceeded its hard bound');
	assert.ok(pids, 'process-tree fixture did not publish its PIDs before overflowing output');
	await waitForPidsToExit(pids);
});

test('direct-WAV runner preserves its primary failure when profile cleanup also fails', async () => {
	const cleanupError = new Error('injected profile cleanup failure');
	await assert.rejects(
		() => runDesktopDirectWavSmoke({
			repositoryRoot: process.cwd(),
			outputRoot: resolve('missing-direct-wav-package-output'),
			removeProfile: async (...args) => {
				await rm(...args);
				throw cleanupError;
			},
		}),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.errors[0].message, /No packaged .* executable/iu);
			assert.equal(error.errors[1], cleanupError);
			return true;
		},
	);
});

test('direct-WAV aggregate surfaces bounded WAV, AIFF, BWF, and cancellation evidence without paths', () => {
	const invocation = createDesktopDirectWavSmokeInvocation({
		arch: 'x64',
		outputRoot: '/release/desktop',
		platform: 'linux',
		profileRoot: '/tmp/direct-wav-profile',
		token: TOKEN,
	});
	const payload = validPayload(invocation);
	const file = {
		byteLength: DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength,
		sha256: 'a'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		signal: validSignalEvidence(),
		riff: {
			riffId: 'RIFF', riffBytes: DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength,
			waveId: 'WAVE', formatId: 'fmt ', formatBytes: 16, formatTag: 1,
			channelCount: 16, sampleRate: 384_000, byteRate: 12_288_000,
			blockAlign: 32, bitsPerSample: 16, dataId: 'data', dataBytes: 202_751_744,
			frameCount: 6_335_992,
		},
	};
	const aggregate = createDesktopDirectWavSmokeAggregate({
		invocation,
		payload,
		platform: 'linux',
		arch: 'x64',
		file,
		aiffFile: validAiffFileEvidence(),
		bwfFile: validDesktopDirectBwfFileEvidence(),
		cancellation: {
			observed: true,
			riffHeaderValidated: true,
			nonzeroPayloadByteObserved: true,
			maximumStagedBytes: 8192,
			maximumInspectedPrefixBytes: 4096,
			cancelledFileAbsent: true,
			remainingStagingFiles: 0,
		},
	});
	assert.equal(aggregate.file.sha256, 'a'.repeat(64));
	assert.equal(aggregate.file.riff.dataBytes, 202_751_744);
	assert.equal(aggregate.file.signal.channelMismatchSamples, 0);
	assert.equal(aggregate.aiffFile.aiff.typeId, 'AIFF');
	assert.equal(aggregate.aiffFile.signal.channelMismatchSamples, 0);
	assert.equal(aggregate.bwfFile.riff.bextPayloadBytes, 689);
	assert.equal(aggregate.bwfFile.bext.timeReference, '48000');
	assert.equal(aggregate.bwfFile.signal.channelComparisons, 95_039_880);
	assert.throws(() => createDesktopDirectWavSmokeAggregate({
		invocation, payload, platform: 'linux', arch: 'x64',
		file: { ...file, signal: { ...file.signal, channelMismatchSamples: 1 } },
		aiffFile: validAiffFileEvidence(),
		bwfFile: validDesktopDirectBwfFileEvidence(),
		cancellation: {
			observed: true, riffHeaderValidated: true, nonzeroPayloadByteObserved: true,
			maximumStagedBytes: 8192, maximumInspectedPrefixBytes: 4096,
			cancelledFileAbsent: true, remainingStagingFiles: 0,
		},
	}), /channel mapping/iu);
	assert.deepEqual(aggregate.cancellation, {
		stagingRiffGeometryValidated: true,
		nonzeroStagingPayloadByteObserved: true,
		maximumStagedBytes: 8192,
		maximumInspectedPrefixBytes: 4096,
		cancelledFileAbsent: true,
		stagingFilesRemaining: 0,
	});
	const line = formatDesktopDirectWavSmokeAggregate(aggregate);
	assert.ok(line.startsWith(DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX));
	assert.doesNotMatch(line, /\/tmp|application-data|\.soundscaper-part/iu);
	assert.ok(Buffer.byteLength(line) < 64 * 1024);
	assert.deepEqual(JSON.parse(line.slice(DESKTOP_DIRECT_WAV_ACCEPTANCE_PREFIX.length)), aggregate);
});

test('direct-WAV script is a thin runner wrapper', async () => {
	const source = await readFile(resolve('scripts/desktop-direct-wav-smoke.mjs'), 'utf8');
	assert.match(source, /runDesktopDirectWavSmoke/u);
	assert.match(source, /formatDesktopDirectWavSmokeAggregate/u);
	assert.doesNotMatch(source, /spawn\(|createReadStream|showSaveFilePicker/u);
});

function validPayload(invocation) {
	return {
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: invocation.productId,
		token: invocation.plan.token,
		renderer: {
			imported: true,
			completed: true,
			cancelled: true,
			aiffCompleted: true,
			bwfCompleted: true,
			realtimeCount: 4,
			downloadVisible: false,
		},
		native: {
			selectionPurposes: Array.from({ length: 4 }, () => 'audio-pcm-mix'),
			completedBytes: DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength,
			completedAiffBytes: DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output.byteLength,
			completedBwfBytes: DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output.byteLength,
			aiffChoiceValidated: true,
			bwfChoiceValidated: true,
			cancelledAbsent: true,
			stagingFilesRemaining: 0,
		},
	};
}

function validSignalEvidence() {
	return {
		frameCount: 6_335_992, channelComparisons: 95_039_880,
		channelMismatchSamples: 0, maximumCarryBytes: 20,
		nonzeroFrames: 6_335_333, positiveFrames: 3_167_671,
		negativeFrames: 3_167_662, zeroCrossings: 7_259,
		peakAbsoluteSample: 9_830, sampleSum: 2_612,
		sampleSquareSum: 306_120_561_101_570, meanSample: 0.000_412_247_995_262_620_3,
		rmsSample: 6_950.866_384_869_063,
	};
}

function validAiffFileEvidence() {
	const output = DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output;
	return {
		byteLength: output.byteLength, sha256: 'b'.repeat(64), maximumReadChunkBytes: 1024 * 1024,
		aiff: {
			formId: 'FORM', formBytes: output.byteLength, typeId: 'AIFF', commId: 'COMM', commBytes: 18,
			channelCount: output.channelCount, frameCount: output.frameCount, bitsPerSample: output.bitDepth,
			sampleRateHex: output.sampleRateHex, soundId: 'SSND', soundBytes: output.dataBytes + 8,
			offset: 0, blockSize: 0, pcmOffset: output.headerBytes, pcmBytes: output.dataBytes,
			dataPadBytes: 0, trailingBytes: 0,
		},
		signal: validSignalEvidence(),
	};
}

function directWavStagingPrefix(payloadBytes) {
	const output = DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output;
	const bytes = Buffer.alloc(44 + payloadBytes);
	bytes.write('RIFF', 0);
	bytes.writeUInt32LE(output.byteLength - 8, 4);
	bytes.write('WAVE', 8);
	bytes.write('fmt ', 12);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(output.channelCount, 22);
	bytes.writeUInt32LE(output.sampleRate, 24);
	bytes.writeUInt32LE(output.sampleRate * output.channelCount * output.bitDepth / 8, 28);
	bytes.writeUInt16LE(output.channelCount * output.bitDepth / 8, 32);
	bytes.writeUInt16LE(output.bitDepth, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(output.dataBytes, 40);
	return bytes;
}

function directWavStagingPayload(byteLength, nonzeroAt = -1) {
	const bytes = Buffer.alloc(byteLength);
	if (nonzeroAt >= 0) bytes[nonzeroAt] = 1;
	return bytes;
}

function delay(milliseconds) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function readPidMarker(path) {
	try {
		const value = JSON.parse(await readFile(path, 'utf8'));
		return Number.isSafeInteger(value.leader) && Number.isSafeInteger(value.descendant) ? value : null;
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

async function forceKillPids(pids) {
	if (!pids) return;
	for (const pid of [pids.descendant, pids.leader]) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch (error) {
			if (error?.code !== 'ESRCH') throw error;
		}
	}
}

async function waitForPidsToExit(pids) {
	const deadline = Date.now() + 1_000;
	while (!(await Promise.all([pids.leader, pids.descendant].map(pidHasExited))).every(Boolean)) {
		if (Date.now() >= deadline) throw new Error('Direct-WAV child process tree survived forced termination');
		await delay(20);
	}
}

async function pidHasExited(pid) {
	try {
		process.kill(pid, 0);
		return process.platform === 'linux'
			&& /^\d+ \(.+\) Z /u.test(await readFile(`/proc/${String(pid)}/stat`, 'utf8'));
	} catch (error) {
		if (error?.code === 'ESRCH' || error?.code === 'ENOENT') return true;
		throw error;
	}
}

function boundedChildResult(promise) {
	return new Promise((resolvePromise) => {
		const timer = setTimeout(
			() => resolvePromise(new Error('TERM-resistant process tree exceeded its hard settlement bound')),
			2_000,
		);
		void promise.then(
			() => resolvePromise(new Error('TERM-resistant process tree unexpectedly succeeded')),
			(error) => resolvePromise(error),
		).finally(() => clearTimeout(timer));
	});
}
