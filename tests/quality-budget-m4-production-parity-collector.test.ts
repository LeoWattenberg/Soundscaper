import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createM4ProductionParityAudioFixture, encodeM4ProductionParityAudio } from '../src/common/editor/quality/m4-production-parity-workload.ts';
import {
	collectM4ProductionParityDiagnostic,
	createPendingM4ProductionParityResult,
	parseM4ProductionParityCliOptions,
	parseM4ProductionParityDiagnostic,
	resolveM4ProductionParityCollectionEnvironment,
	writeM4ProductionParityResult,
} from '../scripts/collect-m4-production-parity-quality.mjs';
import {
	mergeM4ParityReferenceFingerprint,
	readM4ParityReferenceHostObservation,
} from '../scripts/lib/m4-production-parity-identity.mjs';
import {
	makeM4ProductionParityDiagnostic as makeDiagnostic,
	toBase64,
} from './helpers/m4-production-parity-fixture.ts';

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

test('the M4 collector independently recomputes exactly five parity metrics', () => {
	const result = createPendingM4ProductionParityResult(makeDiagnostic(), config);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.environmentId, 'local-browser-correctness');
	assert.equal(result.qualificationEnvironmentId, 'reference-linux-gpu-01');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(Object.keys(result.metrics).length, 5);
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
		videoCases: 13,
		videoPixels: 119_808,
		requestedEffectInstances: 3,
		requestedCompositionInstances: 18,
	});
	assert.equal(result.evaluation.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /unprovisioned/iu);
});

test('the M4 collector admits packaged-runtime diagnostics without treating them as qualification', () => {
	const diagnostic = makeDiagnostic();
	diagnostic.environmentId = 'packaged-runtime-win32-x64';
	const result = createPendingM4ProductionParityResult(diagnostic, config);

	assert.equal(result.environmentId, diagnostic.environmentId);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
});
test('the M4 collector reports gross PDC shifts outside the former local search window', () => {
	const diagnostic = makeDiagnostic();
	const audio = createM4ProductionParityAudioFixture();
	const shifted = audio.reference.map((channel) => channel.slice());
	const expected = diagnostic.fixture.outputImpulseFrames[0];
	shifted[0]![expected] = 0.001;
	shifted[0]![expected + 100] = 1;
	diagnostic.audio.previewBase64 = toBase64(encodeM4ProductionParityAudio(shifted));

	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.metrics['parity.pdcErrorSamples'], 100);
	assert.equal(result.status, 'failed');
	shifted[0]![expected + 110] = -1;
	diagnostic.audio.previewBase64 = toBase64(encodeM4ProductionParityAudio(shifted));
	assert.equal(
		createPendingM4ProductionParityResult(diagnostic, config)
			.metrics['parity.pdcErrorSamples'],
		100,
	);
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

test('video evidence requires the exact ordered effect and composition inventory and registered digests', () => {
	const missing = makeDiagnostic();
	missing.videoCases.pop();
	assert.throws(() => createPendingM4ProductionParityResult(missing, config), /13 through 13/iu);

	const duplicate = makeDiagnostic();
	duplicate.videoCases[1] = structuredClone(duplicate.videoCases[0]!);
	assert.throws(() => createPendingM4ProductionParityResult(duplicate, config), /case inventory/iu);

	const unknown = makeDiagnostic();
	(unknown.videoCases[0]! as { fixtureArtifactId: string }).fixtureArtifactId = 'unknown';
	assert.throws(() => createPendingM4ProductionParityResult(unknown, config), /case inventory/iu);

	const reordered = makeDiagnostic();
	[reordered.videoCases[0], reordered.videoCases[1]] = [
		reordered.videoCases[1]!,
		reordered.videoCases[0]!,
	];
	assert.throws(() => createPendingM4ProductionParityResult(reordered, config), /case inventory/iu);

	const corrupt = makeDiagnostic();
	const corruptBytes = Buffer.from(corrupt.videoCases[0]!.fixtureBase64, 'base64');
	corruptBytes[0] ^= 1;
	corrupt.videoCases[0]!.fixtureBase64 = toBase64(corruptBytes);
	assert.throws(() => createPendingM4ProductionParityResult(corrupt, config), /registered RGBA golden/iu);

	const wrongGeometry = makeDiagnostic();
	wrongGeometry.videoCases[0]!.width = 127;
	assert.throws(() => createPendingM4ProductionParityResult(wrongGeometry, config), /frozen video geometry/iu);
});

test('collector identity, specification, raw evidence, and config snapshots reject hostile data', () => {
	let getterReads = 0;
	const rawAccessor = makeDiagnostic();
	Object.defineProperty(rawAccessor.audio, 'previewBase64', {
		enumerable: true,
		get() {
			getterReads += 1;
			return '';
		},
	});
	assert.throws(() => createPendingM4ProductionParityResult(rawAccessor, config), /own data/iu);
	assert.equal(getterReads, 0);

	const configAccessor = structuredClone(config) as Record<string, unknown>;
	Object.defineProperty(configAccessor, 'measurementPolicy', {
		enumerable: true,
		get() {
			getterReads += 1;
			return {};
		},
	});
	assert.throws(
		() => createPendingM4ProductionParityResult(makeDiagnostic(), configAccessor),
		/own data/iu,
	);
	assert.equal(getterReads, 0);

	const unsafeSpecification = makeDiagnostic();
	Object.defineProperty(unsafeSpecification.fixture, '__proto__', {
		enumerable: true,
		value: { hidden: true },
	});
	assert.throws(
		() => createPendingM4ProductionParityResult(unsafeSpecification, config),
		/safe string-keyed/iu,
	);
	const symbolicIdentity = makeDiagnostic() as ReturnType<typeof makeDiagnostic> & {
		[key: symbol]: boolean;
	};
	symbolicIdentity[Symbol('hidden-identity')] = true;
	assert.throws(
		() => createPendingM4ProductionParityResult(symbolicIdentity, config),
		/safe string-keyed/iu,
	);

	const sparseRawCases = makeDiagnostic();
	delete sparseRawCases.videoCases[5];
	assert.throws(
		() => createPendingM4ProductionParityResult(sparseRawCases, config),
		/dense own-data array/iu,
	);
	const extraArrayKey = makeDiagnostic();
	Object.defineProperty(extraArrayKey.videoCases, 'unreviewed', { value: true });
	assert.throws(
		() => createPendingM4ProductionParityResult(extraArrayKey, config),
		/extra or symbol array keys/iu,
	);
});

test('the diagnostic parser admits exactly one matching structured record', () => {
	const diagnostic = makeDiagnostic();
	const line = `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(diagnostic)}`;
	assert.deepEqual(parseM4ProductionParityDiagnostic(`noise\n${line}\n`), diagnostic);
	assert.throws(() => parseM4ProductionParityDiagnostic('no diagnostic'), /exactly one/iu);
	assert.throws(() => parseM4ProductionParityDiagnostic(`${line}\n${line}\n`), /exactly one/iu);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(JSON.stringify(diagnostic)),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(`arbitrary prefix ${JSON.stringify(diagnostic)}`),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(
			`SOUNDSCAPER_M4_PRODUCTION_PARITY {not-json\n${line}`,
		),
		/malformed/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(
			`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify({ unrelated: true })}\n${line}`,
		),
		/does not match/iu,
	);
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
	const raw = JSON.parse(await readFile(written.rawPath, 'utf8'));
	assert.deepEqual(accepted.metrics, result.metrics);
	assert.equal(accepted.rawEvidence.artifactName, 'm4-production-render-parity.raw.json');
	assert.equal(accepted.budgetSha256, sha256(dependencies.configBytes));
	assert.equal(raw.budgetSha256, accepted.budgetSha256);
	assert.equal(raw.workloadSha256, sha256(Buffer.from(JSON.stringify(
		activated.workloads.find(({ id }) => id === 'm4-production-render-parity'),
	))));
	await assert.rejects(
		writeM4ProductionParityResult(directory, diagnostic, result, activated, dependencies),
		/exists|EEXIST/iu,
	);
});

test('accepted publication binds hashed config bytes to the evaluated config before writing', async () => {
	const activated = activatedReferenceConfig();
	const diagnostic = makeReferenceDiagnostic();
	const result = createPendingM4ProductionParityResult(diagnostic, activated);
	const mismatched = structuredClone(activated);
	const workload = mismatched.workloads.find(({ id }) => id === 'm4-production-render-parity');
	assert.ok(workload);
	workload.status = 'different-config-bytes';
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m4-parity-mismatch-'));
	let verificationCalls = 0;
	await assert.rejects(
		writeM4ProductionParityResult(directory, diagnostic, result, activated, {
			configBytes: Buffer.from(JSON.stringify(mismatched)),
			sourceRevision: 'd'.repeat(40),
			verifyAccepted: async () => {
				verificationCalls += 1;
				return { passed: true, failures: [], verdicts: [] };
			},
		}),
		/config bytes do not match/iu,
	);
	assert.equal(verificationCalls, 0);
	await assert.rejects(
		readFile(join(directory, 'm4-production-render-parity.raw.json')),
		/ENOENT/iu,
	);
	await assert.rejects(readFile(
		join(directory, 'm4-production-render-parity.accepted.json'),
	), /ENOENT/iu);
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

test('reference observation is independent, complete, and browser-overlap checked', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m4-host-observation-'));
	const path = join(directory, 'reference-host-observation.json');
	const fingerprint = referenceFingerprint();
	await writeFile(path, `${JSON.stringify({
		schemaVersion: 1,
		observationClass: 'm4-reference-host-observation-v1',
		fingerprint,
	}, null, '\t')}\n`);
	const independentlyObserved = await readM4ParityReferenceHostObservation(path);
	assert.deepEqual(
		mergeM4ParityReferenceFingerprint(independentlyObserved, browserReferenceObservation()),
		fingerprint,
	);

	await assert.rejects(
		readM4ParityReferenceHostObservation(join(directory, 'missing.json')),
		/unavailable or invalid/iu,
	);
	const incomplete = structuredClone(fingerprint) as Record<string, unknown>;
	delete incomplete.gpuDriver;
	await writeFile(path, JSON.stringify({
		schemaVersion: 1,
		observationClass: 'm4-reference-host-observation-v1',
		fingerprint: incomplete,
	}));
	await assert.rejects(readM4ParityReferenceHostObservation(path), /exact fields/iu);
	assert.throws(
		() => mergeM4ParityReferenceFingerprint(fingerprint, {
			...browserReferenceObservation(),
			webglRenderer: 'unexpected-runtime-renderer',
		}),
		/browser-observed reference field webglRenderer/iu,
	);
	let reads = 0;
	const accessorFingerprint = referenceFingerprint();
	Object.defineProperty(accessorFingerprint, 'cpuModel', {
		enumerable: true,
		get() {
			reads += 1;
			return 'forged';
		},
	});
	assert.throws(
		() => mergeM4ParityReferenceFingerprint(
			accessorFingerprint,
			browserReferenceObservation(),
		),
		/own data/iu,
	);
	assert.equal(reads, 0);
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
	const spoofed = structuredClone(makeReferenceDiagnostic());
	spoofed.environmentFingerprint.gpuModel = 'different-observed-gpu';
	const result = createPendingM4ProductionParityResult(spoofed, activated);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.match(result.evaluation.failures.join('\n'), /fingerprint is not an exact match/iu);
});

test('reference collection rejects a mismatched browser observation before any publication', async () => {
	const activated = activatedReferenceConfig();
	const observed = structuredClone(makeReferenceDiagnostic());
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
		environmentFingerprint: mergeM4ParityReferenceFingerprint(
			referenceFingerprint(),
			browserReferenceObservation(),
		),
	};
}

function browserReferenceObservation() {
	const fingerprint = referenceFingerprint();
	return {
		osImage: fingerprint.osImage,
		cpuModel: fingerprint.cpuModel,
		logicalCpuCount: fingerprint.logicalCpuCount,
		memoryBytes: fingerprint.memoryBytes,
		webglVendor: fingerprint.webglVendor,
		webglRenderer: fingerprint.webglRenderer,
		devicePixelRatio: fingerprint.devicePixelRatio,
		browserVersion: fingerprint.browserVersion,
		browserBinarySha256: fingerprint.browserBinarySha256,
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

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
