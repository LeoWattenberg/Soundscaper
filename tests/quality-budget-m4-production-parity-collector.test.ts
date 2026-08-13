import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createM4ProductionParityAudioFixture,
	encodeM4ProductionParityAudio,
} from '../src/common/editor/quality/m4-production-parity-workload.ts';
import {
	collectM4ProductionParityDiagnostic,
	createPendingM4ProductionParityResult,
	parseM4ProductionParityCliOptions,
	parseM4ProductionParityDiagnostic,
	resolveM4ProductionParityCollectionEnvironment,
	writeM4ProductionParityResult,
} from '../scripts/collect-m4-production-parity-quality.mjs';
import { createVideoEffectParityFixture } from './browser/video-effect-parity-helpers.js';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;
const packageMetadata = JSON.parse(await readFile(
	new URL('../package.json', import.meta.url),
	'utf8',
)) as { readonly scripts: Readonly<Record<string, string>> };
const REFERENCE_FINGERPRINT_FIELDS = [
	'osImage',
	'osUpdatePolicy',
	'cpuModel',
	'logicalCpuCount',
	'memoryBytes',
	'gpuModel',
	'gpuMemoryBytes',
	'gpuDriver',
	'webglVendor',
	'webglRenderer',
	'displayMode',
	'displayRefreshHz',
	'devicePixelRatio',
	'powerProfile',
	'browserVersion',
	'browserBinarySha256',
	'browserLaunchFlags',
	'runnerLabels',
] as const;

type QualityConfig = {
	fixtures: Array<{ id: string; status: string; kind: string; artifacts?: unknown[] }>;
	workloads: Array<{ id: string; status: string; thresholds: unknown[] }>;
	environments: Array<{
		id: string;
		status: string;
		qualificationEligible: boolean;
		eligibleWorkloadIds?: string[];
		fingerprint: Record<string, unknown>;
	}>;
};

function makeDiagnostic(omittedEffectId: string | null = null) {
	const audio = createM4ProductionParityAudioFixture();
	const video = createVideoEffectParityFixture('gradient');
	const effectId = omittedEffectId ?? 'm4-parity-color-adjust';
	const rendered: string[] = omittedEffectId === null ? [effectId] : [];
	const omitted: string[] = omittedEffectId === null ? [] : [effectId];
	return {
		schemaVersion: 1,
		profile: 'deterministic-production-parity-v1',
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		workloadId: 'm4-production-render-parity',
		fixtureId: 'm4-production-parity-v1',
		environmentId: 'local-browser-correctness',
		rendererClass: 'hardware',
		environmentFingerprint: {
			browserVersion: 'Chromium 149.0.7827.55',
			platform: 'linux',
			architecture: 'x64',
			osRelease: 'test-kernel',
			webglVendor: 'diagnostic-vendor',
			webglRenderer: 'diagnostic-gpu',
		},
		fixture: {
			generatorRevision: 1,
			seed: 1_294_994_497,
			sampleRate: 48_000,
			frameCount: 48_000,
			channelCount: 2,
			pdcLatencyFrames: 37,
			automationChangeFrame: 24_000,
			inputImpulseFrames: [1_024, 4_096],
			outputImpulseFrames: [1_061, 4_133],
			inputChannelSha256: [
				'626e70475d9328e0026faac70afb036004ebaa4dfe0404f0da9fba84397a9884',
				'7d2725992a5afeb23416a37f735bc4311589b89f97bb1e71c843ea0dbcad72b2',
			],
			referenceChannelSha256: [
				'8704074d600c3331096c1505a8c22e2428ba2cb3a4e0682f3f432670c5479292',
				'b7e68494b462e5ab8a3999349aacc1bb24919384b5fadb6e581a2a91c8865bf1',
			],
			videoFixtureId: 'video-effect-parity-rgba-v1',
			videoWidth: 128,
			videoHeight: 72,
		},
		audio: {
			previewBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
			exportBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
			referenceBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
		},
		videoCases: [{
			name: 'gradient-color-adjust',
			width: video.width,
			height: video.height,
			previewBase64: toBase64(video.bytes),
			exportBase64: toBase64(video.bytes),
			renderReport: {
				status: omitted.length ? 'fallback' : 'rendered',
				rendererStatus: 'available',
				renderedEntryCount: 1,
				effects: {
					requested: [effectId],
					rendered,
					fallbackRendered: [] as string[],
					omitted,
				},
			},
		}],
	};
}

test('the M4 collector independently recomputes exactly five parity metrics', () => {
	const result = createPendingM4ProductionParityResult(makeDiagnostic(), config);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.environmentId, 'local-browser-correctness');
	assert.equal(result.qualificationEnvironmentId, 'reference-linux-gpu-01');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.deepEqual(result.metrics, {
		'parity.audioMaximumAbsoluteSampleError': 0,
		'parity.pdcErrorSamples': 0,
		'parity.videoMinimumSsim': 1,
		'parity.videoMaximumChannelMae': 0,
		'parity.silentlyOmittedEffects': 0,
	});
	assert.deepEqual(result.rawSampleCounts, {
		audioChannels: 2,
		audioFrames: 48_000,
		videoCases: 1,
		videoPixels: 9_216,
		requestedEffectInstances: 1,
	});
	assert.equal(result.evaluation.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /unprovisioned/iu);
	assert.equal(Object.keys(result.metrics).length, 5);
});

test('one deliberately unreported effect produces one omission and fails the zero budget', () => {
	const result = createPendingM4ProductionParityResult(
		makeDiagnostic('m4-deliberately-omitted-effect'),
		config,
	);
	assert.equal(result.metrics['parity.silentlyOmittedEffects'], 1);
	assert.equal(result.status, 'failed');
	assert.equal(result.metricGatePassed, false);
	const verdict = result.evaluation.verdicts.find(
		({ metricId }: { metricId: string }) => metricId === 'parity.silentlyOmittedEffects',
	);
	assert.equal(verdict?.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /silentlyOmittedEffects/iu);
});

test('visible fallback remains unrendered work and fails the zero parity gate', () => {
	const diagnostic = makeDiagnostic();
	const report = diagnostic.videoCases[0].renderReport;
	report.status = 'fallback';
	report.effects.rendered = [];
	report.effects.fallbackRendered = [...report.effects.requested];
	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.metrics['parity.silentlyOmittedEffects'], 1);
});

test('fixture drift, truncated evidence, and dishonest ledgers fail closed', () => {
	const diagnostic = makeDiagnostic();
	assert.throws(
		() => createPendingM4ProductionParityResult({
			...diagnostic,
			fixture: { ...diagnostic.fixture, frameCount: 47_999 },
		}, config),
		/fixture/iu,
	);
	assert.throws(
		() => createPendingM4ProductionParityResult({
			...diagnostic,
			audio: { ...diagnostic.audio, previewBase64: diagnostic.audio.previewBase64.slice(4) },
		}, config),
		/audio evidence/iu,
	);
	const dishonest = structuredClone(diagnostic);
	dishonest.videoCases[0].renderReport.effects.omitted = ['not-requested'];
	assert.throws(() => createPendingM4ProductionParityResult(dishonest, config), /partition/iu);
	const sixthMetric = structuredClone(config) as QualityConfig;
	const workload = sixthMetric.workloads.find(({ id }) => id === 'm4-production-render-parity');
	assert.ok(workload);
	workload.thresholds.push({ metricId: 'parity.unregisteredSixthMetric' });
	assert.throws(
		() => createPendingM4ProductionParityResult(diagnostic, sixthMetric),
		/five metrics/iu,
	);
});

test('the diagnostic parser admits exactly one matching structured record', () => {
	const diagnostic = makeDiagnostic();
	const line = `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(diagnostic)}`;
	assert.deepEqual(parseM4ProductionParityDiagnostic(`noise\n${line}\n`), diagnostic);
	assert.throws(() => parseM4ProductionParityDiagnostic('no diagnostic'), /exactly one/iu);
	assert.throws(() => parseM4ProductionParityDiagnostic(`${line}\n${line}\n`), /exactly one/iu);
});

test('matching provisioned evidence writes verified files once and never overwrites', async () => {
	const activated = activatedReferenceConfig();
	const diagnostic = makeReferenceDiagnostic();
	const environment = activated.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.ok(environment);
	assert.deepEqual(resolveM4ProductionParityCollectionEnvironment({
		outputDirectory: '/unused',
		qualificationMode: 'reference',
	}, activated).expectedFingerprint, environment.fingerprint);
	const result = createPendingM4ProductionParityResult(diagnostic, activated);
	assert.equal(result.status, 'accepted');

	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m4-parity-'));
	let verificationCalls = 0;
	const dependencies = {
		configBytes: Buffer.from(`${JSON.stringify(activated, null, '\t')}\n`),
		sourceRevision: 'd'.repeat(40),
		verifyAccepted: async () => {
			verificationCalls += 1;
			return { passed: true, failures: [], verdicts: [] };
		},
	};
	const written = await writeM4ProductionParityResult(
		directory, diagnostic, result, activated, dependencies,
	);
	assert.equal(verificationCalls, 1);
	assert.equal(written.resultPath, join(directory, 'm4-production-render-parity.accepted.json'));
	const accepted = JSON.parse(await readFile(written.resultPath, 'utf8'));
	assert.deepEqual(accepted.metrics, result.metrics);
	assert.equal(accepted.rawEvidence.artifactName, 'm4-production-render-parity.raw.json');
	await assert.rejects(
		writeM4ProductionParityResult(directory, diagnostic, result, activated, dependencies),
		/exists|EEXIST/iu,
	);
});

test('hosted correctness stays pending and cannot publish qualification evidence', async () => {
	const diagnostic = makeDiagnostic();
	diagnostic.environmentId = 'github-ubuntu-playwright-1.61.1';
	const identity = resolveM4ProductionParityCollectionEnvironment(
		{ outputDirectory: '/unused', qualificationMode: 'correctness' },
		config,
		{ GITHUB_ACTIONS: 'true' },
	);
	assert.equal(identity.environmentId, diagnostic.environmentId);
	assert.equal(identity.expectedFingerprint, null);
	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	let acceptedVerificationCalls = 0;
	let pendingWrites = 0;
	await writeM4ProductionParityResult('/unused', diagnostic, result, config, {
		verifyAccepted: async () => {
			acceptedVerificationCalls += 1;
			return { passed: true, failures: [], verdicts: [] };
		},
		writePending: async (_directory: string, value: unknown) => {
			pendingWrites += 1;
			return { result: value };
		},
	});
	assert.equal(acceptedVerificationCalls, 0);
	assert.equal(pendingWrites, 1);
});

test('reference mode rejects unprovisioned, incomplete, or mismatched fingerprints', () => {
	assert.throws(() => resolveM4ProductionParityCollectionEnvironment({
		outputDirectory: '/unused',
		qualificationMode: 'reference',
	}, config), /active eligible provisioned descriptor/iu);
	const incomplete = activatedReferenceConfig();
	const reference = incomplete.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.ok(reference);
	reference.fingerprint.gpuDriver = null;
	assert.throws(() => resolveM4ProductionParityCollectionEnvironment({
		outputDirectory: '/unused',
		qualificationMode: 'reference',
	}, incomplete), /active eligible provisioned descriptor/iu);
	assert.throws(() => resolveM4ProductionParityCollectionEnvironment({
		outputDirectory: '/unused',
		qualificationMode: 'invented',
	}, config), /correctness or reference/iu);
});

test('CLI parsing defaults to correctness and admits one explicit reference mode', () => {
	assert.deepEqual(parseM4ProductionParityCliOptions(['/tmp/result'], {}), {
		qualificationMode: 'correctness',
		outputDirectory: '/tmp/result',
	});
	assert.deepEqual(parseM4ProductionParityCliOptions(['--reference', '/tmp/result'], {}), {
		qualificationMode: 'reference',
		outputDirectory: '/tmp/result',
	});
	assert.deepEqual(parseM4ProductionParityCliOptions([], {
		SOUNDSCAPER_M4_REFERENCE_QUALIFICATION: '1',
	}), { qualificationMode: 'reference', outputDirectory: null });
	assert.throws(
		() => parseM4ProductionParityCliOptions(['--reference'], {
			SOUNDSCAPER_M4_REFERENCE_QUALIFICATION: '1',
		}), /only once/iu,
	);
	assert.throws(() => parseM4ProductionParityCliOptions(['--unknown'], {}), /unknown/iu);
	assert.throws(() => parseM4ProductionParityCliOptions(['/one', '/two'], {}), /one output/iu);
});

test('an observed reference fingerprint cannot be spoofed with the expected descriptor', () => {
	const activated = activatedReferenceConfig();
	const spoofed = makeReferenceDiagnostic();
	spoofed.environmentFingerprint.gpuModel = 'different-observed-gpu';
	const result = createPendingM4ProductionParityResult(spoofed, activated);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.match(result.evaluation.failures.join('\n'), /fingerprint is not an exact match/iu);
});

test('reference collection rejects a mismatched browser observation before any publication', async () => {
	const activated = activatedReferenceConfig();
	const observed = makeReferenceDiagnostic();
	observed.environmentFingerprint.gpuModel = 'unexpected-runtime-renderer';
	let pendingWrites = 0;
	let acceptedVerifications = 0;
	await assert.rejects(
		collectM4ProductionParityDiagnostic(
			{ outputDirectory: '/unused', qualificationMode: 'reference' },
			{
				config: activated,
				runBrowser: async () => ({
					stdout: `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(observed)}`,
					stderr: '',
				}),
				writePending: async () => { pendingWrites += 1; },
				verifyAccepted: async () => {
					acceptedVerifications += 1;
					return { passed: true, failures: [], verdicts: [] };
				},
			},
		),
		/browser-observed reference fingerprint/iu,
	);
	assert.equal(pendingWrites, 0);
	assert.equal(acceptedVerifications, 0);
});

test('quality config and package metadata expose the provisional no-retry collector', () => {
	const quality = config as QualityConfig;
	const fixture = quality.fixtures.find(({ id }) => id === 'm4-production-parity-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm4-production-render-parity');
	const reference = quality.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.equal(fixture?.status, 'provisional');
	assert.equal(fixture?.kind, 'deterministic-audio-vectors-and-video-golden-frames');
	assert.equal(fixture?.artifacts?.length, 5);
	assert.equal(workload?.status, 'provisional');
	assert.equal(workload?.thresholds.length, 5);
	assert.deepEqual(Object.keys(reference?.fingerprint ?? {}).sort(),
		[...REFERENCE_FINGERPRINT_FIELDS].sort());
	assert.equal(reference?.status, 'unprovisioned');
	assert.equal(reference?.qualificationEligible, false);
	assert.ok(Object.values(reference?.fingerprint ?? {}).every((value) => value === null));
	assert.equal(packageMetadata.scripts['quality:collect:m4-production-parity'],
		'node scripts/collect-m4-production-parity-quality.mjs');
});

function referenceFingerprint() {
	return {
		osImage: 'ubuntu-24.04',
		osUpdatePolicy: 'pinned-image-no-unattended-upgrades',
		cpuModel: 'provisioned-test-cpu',
		logicalCpuCount: 16,
		memoryBytes: 34_359_738_368,
		gpuModel: 'provisioned-reference-gpu',
		gpuMemoryBytes: 8_589_934_592,
		gpuDriver: 'test-driver-1.0',
		webglVendor: 'provisioned-vendor',
		webglRenderer: 'provisioned-webgl-renderer',
		displayMode: '1920x1080x24',
		displayRefreshHz: 60,
		devicePixelRatio: 1,
		powerProfile: 'performance',
		browserVersion: 'Chromium 149.0.7827.55',
		browserBinarySha256: 'a'.repeat(64),
		browserLaunchFlags: ['--headless=new'],
		runnerLabels: ['self-hosted', 'linux', 'soundscaper-reference-gpu-01'],
	};
}

function makeReferenceDiagnostic() {
	return {
		...makeDiagnostic(),
		environmentId: 'reference-linux-gpu-01',
		environmentFingerprint: referenceFingerprint(),
	};
}

function activatedReferenceConfig(): QualityConfig {
	const activated = structuredClone(config) as QualityConfig;
	const reference = activated.environments.find(({ id }) => id === 'reference-linux-gpu-01');
	assert.ok(reference);
	reference.status = 'active';
	reference.qualificationEligible = true;
	reference.eligibleWorkloadIds = ['m4-production-render-parity'];
	reference.fingerprint = referenceFingerprint();
	return activated;
}

function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}
