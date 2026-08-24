/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AV1_QUALIFICATION_CORPUS_CASES,
	AV1_QUALIFICATION_SCHEMA_VERSION,
	AV1_QUALIFICATION_TARGETS,
	Av1QualificationError,
	decideAv1CodecQualification,
	type Av1BenchmarkIdentityV1,
	type Av1QualificationEvidenceRowV1,
	type Av1QualificationInputV1,
} from '../src/common/editor/av1-codec-qualification.ts';

// Synthetic decision-boundary fixtures only; these are not collected benchmark results.
const THRESHOLDS = Object.freeze({
	maximumDav1dCpuTimeRatio: 1,
	maximumDav1dPeakRssRatio: 1.25,
	minimumEncoderThroughputFps: 10,
	maximumBitrateDeltaRatio: 0.05,
	minimumVmaf: 90,
	minimumSsim: 0.95,
	maximumVmafDelta: 1,
	maximumSsimDelta: 0.01,
});

test('the result is a closed five-target matrix and incomplete evidence admits nothing', () => {
	assert.deepEqual(AV1_QUALIFICATION_TARGETS, [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
	assert.equal(AV1_QUALIFICATION_CORPUS_CASES.length, 12);
	assert.deepEqual(new Set(AV1_QUALIFICATION_CORPUS_CASES.map(({ resolution }) => resolution)),
		new Set(['1080p', '4k']));
	assert.deepEqual(new Set(AV1_QUALIFICATION_CORPUS_CASES.map(({ bitDepth }) => bitDepth)),
		new Set([8, 10]));
	assert.deepEqual(new Set(AV1_QUALIFICATION_CORPUS_CASES.map(({ content }) => content)),
		new Set(['film', 'animation', 'screen']));

	const result = decideAv1CodecQualification(input([]));

	assert.equal(result.schemaVersion, AV1_QUALIFICATION_SCHEMA_VERSION);
	assert.equal(result.requiredCorpusCaseCount, 12);
	assert.deepEqual(result.targets.map(({ target }) => target), AV1_QUALIFICATION_TARGETS);
	for (const target of result.targets) {
		assert.equal(target.evidenceComplete, false);
		assert.equal(target.evidenceCaseCount, 0);
		assert.equal(target.benchmark, null);
		assert.deepEqual(target.decode, {
			defaultCandidate: 'dav1d',
			comparedAgainst: 'libaom',
			admitted: false,
			selected: null,
			failures: ['incomplete-corpus-evidence'],
		});
		assert.equal(target.encode.defaultCandidate, 'svt-av1');
		assert.equal(target.encode.fallbackCandidate, target.target === 'win-arm64' ? 'libaom' : null);
		assert.equal(target.encode.selected, null);
		assert.equal(target.encode.admitted, false);
	}
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.targets), true);
	assert.equal(Object.isFrozen(result.targets[0]), true);
});

test('complete matched evidence admits dav1d decode and default SVT-AV1 encode', () => {
	const result = decideAv1CodecQualification(input(completeEvidence()));

	for (const target of result.targets) {
		assert.equal(target.evidenceComplete, true);
		assert.equal(target.evidenceCaseCount, 12);
		assert.deepEqual(target.benchmark, benchmarkIdentity(target.target));
		assert.equal(Object.isFrozen(target.benchmark), true);
		assert.equal(target.decode.selected, 'dav1d');
		assert.equal(target.decode.admitted, true);
		assert.deepEqual(target.decode.failures, []);
		assert.equal(target.encode.selected, 'svt-av1');
		assert.equal(target.encode.admitted, true);
		assert.deepEqual(target.encode.defaultFailures, []);
	}
});

test('libaom can never satisfy decode, even when it is correct and much faster', () => {
	const evidence = completeEvidence().map((row) => ({
		...row,
		decode: {
			dav1d: { correct: false, cpuTimeMs: 100, peakRssBytes: 1_000 },
			libaom: { correct: true, cpuTimeMs: 1, peakRssBytes: 1 },
		},
	}));
	const result = decideAv1CodecQualification(input(evidence));

	for (const target of result.targets) {
		assert.equal(target.decode.selected, null);
		assert.equal(target.decode.admitted, false);
		assert.deepEqual(target.decode.failures, [
			'dav1d-correctness-failed',
			'dav1d-cpu-time-threshold-failed',
			'dav1d-peak-rss-threshold-failed',
		]);
	}
});

test('libaom is an encoder fallback only on Windows ARM64 after SVT-AV1 fails', () => {
	const evidence = completeEvidence().map((row) => ({
		...row,
		encode: {
			'svt-av1': { ...row.encode['svt-av1'], correct: false },
			libaom: row.encode.libaom,
		},
	}));
	const result = decideAv1CodecQualification(input(evidence));

	for (const target of result.targets) {
		assert.deepEqual(target.encode.defaultFailures, ['correctness-failed']);
		if (target.target === 'win-arm64') {
			assert.equal(target.encode.fallbackCandidate, 'libaom');
			assert.deepEqual(target.encode.fallbackFailures, []);
			assert.equal(target.encode.selected, 'libaom');
			assert.equal(target.encode.admitted, true);
		} else {
			assert.equal(target.encode.fallbackCandidate, null);
			assert.equal(target.encode.fallbackFailures, null);
			assert.equal(target.encode.selected, null);
			assert.equal(target.encode.admitted, false);
		}
	}
});

test('Windows ARM64 libaom fallback must itself clear correctness, speed, and quality', () => {
	const cases = [
		['throughput-threshold-failed', { libaom: { throughputFps: 9 } }],
		['vmaf-threshold-failed', { both: { vmaf: 89 } }],
		['ssim-threshold-failed', { both: { ssim: 0.94 } }],
	] as const;
	for (const [failure, replacement] of cases) {
		const evidence = completeEvidence('win-arm64').map((row) => ({
			...row,
			encode: {
				'svt-av1': {
					...row.encode['svt-av1'],
					...('both' in replacement ? replacement.both : {}),
					correct: false,
				},
				libaom: {
					...row.encode.libaom,
					...('both' in replacement ? replacement.both : replacement.libaom),
				},
			},
		}));
		const target = decideAv1CodecQualification(input(evidence)).targets[4];

		assert.equal(target.encode.selected, null);
		assert.equal(target.encode.admitted, false);
		assert.ok(target.encode.fallbackFailures?.includes(failure));
	}
});

test('encoder throughput is judged only when bitrate, VMAF, and SSIM are matched', () => {
	const cases = [
		['bitrate-not-matched', { bitrateKbps: 1_200 }],
		['vmaf-not-matched', { vmaf: 93.1 }],
		['ssim-not-matched', { ssim: 0.981 }],
	] as const;
	for (const [failure, replacement] of cases) {
		const evidence = completeEvidence('win-arm64').map((row, index) => index === 0 ? {
			...row,
			encode: { ...row.encode, libaom: { ...row.encode.libaom, ...replacement } },
		} : row);
		const [target] = decideAv1CodecQualification(input(evidence)).targets
			.filter(({ target: candidate }) => candidate === 'win-arm64');

		assert.ok(target);
		assert.equal(target.encode.selected, null);
		assert.equal(target.encode.admitted, false);
		assert.ok(target.encode.defaultFailures.includes(failure));
		assert.ok(target.encode.fallbackFailures?.includes(failure));
		assert.equal(target.encode.defaultFailures.includes('throughput-threshold-failed'), false);
		assert.equal(target.encode.fallbackFailures?.includes('throughput-threshold-failed'), false);
	}
});

test('missing one corpus case or failing a decode resource threshold remains fail-closed', () => {
	const missing = decideAv1CodecQualification(input(completeEvidence('linux-x64').slice(1)));
	const linux = missing.targets[0];
	assert.equal(linux.evidenceCaseCount, 11);
	assert.equal(linux.decode.admitted, false);
	assert.equal(linux.encode.admitted, false);
	assert.ok(linux.decode.failures.includes('incomplete-corpus-evidence'));
	assert.ok(linux.encode.defaultFailures.includes('incomplete-corpus-evidence'));

	const excessiveCpu = completeEvidence('linux-x64').map((row, index) => index === 0 ? {
		...row,
		decode: { ...row.decode, dav1d: { ...row.decode.dav1d, cpuTimeMs: 11 } },
	} : row);
	const failed = decideAv1CodecQualification(input(excessiveCpu)).targets[0];
	assert.equal(failed.decode.selected, null);
	assert.deepEqual(failed.decode.failures, ['dav1d-cpu-time-threshold-failed']);
});

test('all rows for one target must share an exact environment, toolchain, and settings identity', () => {
	const mutations = [
		(identity: Av1BenchmarkIdentityV1): Av1BenchmarkIdentityV1 => ({
			...identity,
			environment: { ...identity.environment, cpuModel: 'Synthetic-drift-CPU' },
		}),
		(identity: Av1BenchmarkIdentityV1): Av1BenchmarkIdentityV1 => ({
			...identity,
			toolchain: {
				...identity.toolchain,
				dav1d: { ...identity.toolchain.dav1d, buildSha256: 'f'.repeat(64) },
			},
		}),
		(identity: Av1BenchmarkIdentityV1): Av1BenchmarkIdentityV1 => ({
			...identity,
			encoderSettings: { ...identity.encoderSettings, svtAv1Preset: 'preset-9' },
		}),
	];
	for (const mutate of mutations) {
		const evidence = [...completeEvidence('win-arm64')];
		const row = evidence[1];
		if (row === undefined) throw new RangeError('Synthetic evidence row is missing.');
		evidence[1] = { ...row, benchmark: mutate(row.benchmark) };

		assert.throws(() => decideAv1CodecQualification(input(evidence)), /benchmark.*drift/iu);
	}

	const row = evidenceRow('win-arm64', 0);
	assert.throws(() => decideAv1CodecQualification(input([{
		...row,
		benchmark: {
			...row.benchmark,
			environment: { ...row.benchmark.environment, cpuArchitecture: 'x64' },
		},
	}])), /does not match its benchmark environment/u);
});

test('one shared corpus and settings identity owns both encoder measurements', () => {
	const row = evidenceRow('win-arm64', 0);
	assert.deepEqual(Object.keys(row.benchmark.encoderSettings).sort(), [
		'libaomPreset', 'settingsSha256', 'svtAv1Preset', 'threadCount',
	]);
	assert.throws(() => decideAv1CodecQualification(input([{
		...row,
		encode: {
			...row.encode,
			'svt-av1': { ...row.encode['svt-av1'], sourceSha256: 'e'.repeat(64) },
		},
	}] as never)), /exactly its schema keys/u);
});

test('macOS x64, duplicates, malformed metrics, and unknown fields are rejected', () => {
	assert.throws(() => decideAv1CodecQualification(input([{
		...evidenceRow('linux-x64', 0), target: 'mac-x64',
	}] as never)), /macOS x64 is explicitly unsupported/u);
	const row = evidenceRow('linux-x64', 0);
	assert.throws(() => decideAv1CodecQualification(input([row, row])), /reported more than once/u);
	assert.throws(() => decideAv1CodecQualification(input([{
		...row,
		decode: { ...row.decode, dav1d: { ...row.decode.dav1d, cpuTimeMs: Number.NaN } },
	}])), Av1QualificationError);
	assert.throws(() => decideAv1CodecQualification({
		...input([]), rendererArgv: ['ffmpeg'],
	}), /exactly its schema keys/u);
	assert.throws(() => decideAv1CodecQualification(input([{
		...row, corpus: { ...row.corpus, url: 'https://example.invalid/video' },
	}] as never)), /exactly its schema keys/u);
});

function input(evidence: readonly Av1QualificationEvidenceRowV1[]): Av1QualificationInputV1 {
	return { schemaVersion: 1, thresholds: THRESHOLDS, evidence };
}

function completeEvidence(
	onlyTarget?: typeof AV1_QUALIFICATION_TARGETS[number],
): readonly Av1QualificationEvidenceRowV1[] {
	const targets = onlyTarget === undefined ? AV1_QUALIFICATION_TARGETS : [onlyTarget];
	return targets.flatMap((target) => AV1_QUALIFICATION_CORPUS_CASES.map((_, index) =>
		evidenceRow(target, index)));
}

function evidenceRow(
	target: typeof AV1_QUALIFICATION_TARGETS[number],
	caseIndex: number,
): Av1QualificationEvidenceRowV1 {
	const corpusCase = AV1_QUALIFICATION_CORPUS_CASES[caseIndex];
	if (corpusCase === undefined) throw new RangeError('Synthetic corpus case is missing.');
	return {
		target,
		benchmark: benchmarkIdentity(target),
		corpus: {
			...corpusCase,
			sourceSha256: caseIndex.toString(16).padStart(64, '0'),
		},
		decode: {
			dav1d: { correct: true, cpuTimeMs: 8, peakRssBytes: 100 },
			libaom: { correct: true, cpuTimeMs: 10, peakRssBytes: 100 },
		},
		encode: {
			'svt-av1': {
				correct: true, throughputFps: 20, bitrateKbps: 1_000, vmaf: 92, ssim: 0.97,
			},
			libaom: {
				correct: true, throughputFps: 15, bitrateKbps: 1_020, vmaf: 91.5, ssim: 0.965,
			},
		},
	};
}

function benchmarkIdentity(target: typeof AV1_QUALIFICATION_TARGETS[number]): Av1BenchmarkIdentityV1 {
	const operatingSystem = target.startsWith('linux-')
		? 'linux' : target.startsWith('win-') ? 'windows' : 'macos';
	const cpuArchitecture = target.endsWith('-x64') ? 'x64' : 'arm64';
	const operatingSystemVersion = operatingSystem === 'windows'
		? '10.0.26100' : operatingSystem === 'linux' ? '6.12.1' : '15.4.0';
	return {
		environment: {
			operatingSystem,
			operatingSystemVersion,
			cpuModel: `Synthetic-${cpuArchitecture}-CPU`,
			cpuArchitecture,
			logicalCoreCount: 16,
		},
		toolchain: {
			dav1d: { version: '1.5.4', buildSha256: 'a'.repeat(64) },
			libaom: { version: '3.14.1', buildSha256: 'b'.repeat(64) },
			'svt-av1': { version: '4.2.0', buildSha256: 'c'.repeat(64) },
			benchmarkHarnessSha256: 'd'.repeat(64),
		},
		encoderSettings: {
			settingsSha256: 'e'.repeat(64),
			threadCount: 16,
			svtAv1Preset: 'preset-8',
			libaomPreset: 'cpu-used-6',
		},
	};
}
