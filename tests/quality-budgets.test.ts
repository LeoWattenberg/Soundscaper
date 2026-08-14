import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	evaluateQualityBudget,
} from '../scripts/quality-budget-evaluator.mjs';
import {
	createVideoEffectParityFixture,
} from './browser/video-effect-parity-helpers.js';

type BudgetStatus = 'blocked' | 'optional' | 'planned' | 'provisional' | 'qualified';
type Comparison = 'eq' | 'gte' | 'lte';
type EnvironmentStatus = 'active' | 'unprovisioned';
type RendererRequirement = 'any' | 'hardware';

interface BudgetArtifact {
	readonly byteLength: number;
	readonly id: string;
	readonly sha256: string;
}

interface BudgetEnvironment {
	readonly evidence: readonly string[];
	readonly fingerprint: Readonly<Record<string, string | number | null>>;
	readonly id: string;
	readonly qualificationEligible: boolean;
	readonly rendererRequirement: RendererRequirement;
	readonly status: EnvironmentStatus;
}

interface BudgetFixture {
	readonly artifacts?: readonly BudgetArtifact[];
	readonly evidence: readonly string[];
	readonly id: string;
	readonly kind: string;
	readonly limitation?: string;
	readonly milestones: readonly string[];
	readonly specification: Readonly<Record<string, unknown>>;
	readonly status: BudgetStatus;
}

interface BudgetThreshold {
	readonly comparison: Comparison;
	readonly metricId: string;
	readonly unit: string;
	readonly value: number;
}

interface BudgetWorkload {
	readonly activationGate?: string;
	readonly environmentIds: readonly string[];
	readonly evidence: readonly string[];
	readonly fixtureIds: readonly string[];
	readonly id: string;
	readonly milestone: string;
	readonly status: BudgetStatus;
	readonly thresholds: readonly BudgetThreshold[];
}

interface BrowserInput {
	readonly evidence: readonly string[];
	readonly project: string;
	readonly revision: string;
	readonly status: 'planned' | 'provisional';
	readonly version: string;
}

interface QualityBudgetConfig {
	readonly environments: readonly BudgetEnvironment[];
	readonly fixtures: readonly BudgetFixture[];
	readonly groundedAt: string;
	readonly measurementPolicy: Readonly<{
		benchmarkRetries: number;
		environmentMismatch: string;
		forcedCollectionsPerHeapSnapshot: number;
		missingMetric: string;
		nonFiniteMetric: string;
		percentileMethod: string;
		rendererMismatch: string;
		timingTrials: number;
		timingWarmupTrials: number;
		timingWorkers: number;
	}>;
	readonly qualification: Readonly<{
		acceptedResultCohorts: readonly Readonly<Record<string, unknown>>[];
		qualifiedWorkloadIds: readonly string[];
		resultContract: Readonly<{
			attemptCount: number;
			budgetDigest: string;
			cohortAuditor: string;
			environmentFingerprint: string;
			evidenceWriter: string;
			evaluator: string;
			fileVerifier: string;
			metricSet: string;
			rawEvidence: string;
			retryCount: number;
			schemaVersion: number;
		}>;
		status: string;
	}>;
	readonly schemaVersion: number;
	readonly softwareInputs: Readonly<{
		browsers: Readonly<Record<string, BrowserInput>>;
		node: Readonly<{ evidence: readonly string[]; version: string }>;
		npm: Readonly<{ evidence: readonly string[]; version: string }>;
		playwright: Readonly<{ evidence: readonly string[]; version: string }>;
	}>;
	readonly units: readonly string[];
	readonly workloads: readonly BudgetWorkload[];
}

const configUrl = new URL('../config/quality-budgets.json', import.meta.url);

test('quality budget contract names numeric gates and the exact qualified structural set', async () => {
	const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;
	const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
		readonly scripts: Readonly<Record<string, string>>;
	};
	const referenceScaleTest = await readFile(
		new URL('./desktop-scape-sparse-full-import-integration.test.ts', import.meta.url),
		'utf8',
	);
	const directWavReferenceTest = await readFile(
		new URL('./audio-editor-export-direct-wav-reference.test.ts', import.meta.url),
		'utf8',
	);

	assert.equal(config.schemaVersion, 1);
	assert.match(config.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.equal(config.qualification.status, 'in-progress');
	assert.deepEqual(config.qualification.qualifiedWorkloadIds, [
		'm2-streaming-project-8gib-v1',
		'm2-direct-wav-385mib-v1',
		'm2-direct-stem-archives-v3',
		'm2-direct-compressed-output-v2',
		'm2-direct-mp4-webm-video-output-v1',
	]);
	assert.equal(config.qualification.acceptedResultCohorts.length, 1);
	assert.deepEqual(config.qualification.resultContract, {
		schemaVersion: 1,
		evaluator: 'scripts/quality-budget-result.mjs',
		fileVerifier: 'scripts/verify-quality-budget-result.mjs',
		evidenceWriter: 'scripts/quality-budget-evidence.mjs',
		cohortAuditor: 'scripts/audit-quality-result-cohorts.mjs',
		attemptCount: 1,
		retryCount: 0,
		budgetDigest: 'sha256-exact-config-bytes',
		environmentFingerprint: 'exact-descriptor-match',
		metricSet: 'exact-workload-thresholds',
		rawEvidence: 'positive-byte-length-and-sha256',
	});
	await assertEvidenceExists([
		config.qualification.resultContract.evaluator,
		config.qualification.resultContract.fileVerifier,
		config.qualification.resultContract.evidenceWriter,
		config.qualification.resultContract.cohortAuditor,
	]);
	assert.deepEqual(config.measurementPolicy, {
		percentileMethod: 'nearest-rank',
		missingMetric: 'fail',
		nonFiniteMetric: 'fail',
		environmentMismatch: 'fail',
		rendererMismatch: 'fail',
		benchmarkRetries: 0,
		timingWorkers: 1,
		timingWarmupTrials: 1,
		timingTrials: 5,
		forcedCollectionsPerHeapSnapshot: 3,
	});

	const fixtures = new Map(config.fixtures.map((fixture) => [fixture.id, fixture]));
	const environments = new Map(config.environments.map((environment) => [environment.id, environment]));
	assert.equal(fixtures.size, config.fixtures.length, 'fixture IDs must be unique');
	assert.equal(environments.size, config.environments.length, 'environment IDs must be unique');
	assert.equal(new Set(config.workloads.map(({ id }) => id)).size, config.workloads.length, 'workload IDs must be unique');

	assert.deepEqual(
		[...new Set(config.workloads.map(({ milestone }) => milestone).filter((milestone) => milestone !== '1'))].sort(),
		['2', '3', '4', '5', '6', '7', '8A', '8B', '9'],
	);
	for (const workload of config.workloads) {
		assert.ok(workload.fixtureIds.length > 0, `${workload.id} must name a fixture`);
		assert.ok(workload.environmentIds.length > 0, `${workload.id} must name an environment`);
		assert.ok(workload.thresholds.length > 0, `${workload.id} must define numeric thresholds`);
		assert.ok(workload.evidence.length > 0, `${workload.id} must point at evidence`);
		for (const fixtureId of workload.fixtureIds) {
			assert.ok(fixtures.has(fixtureId), `${workload.id} references unknown fixture ${fixtureId}`);
		}
		for (const environmentId of workload.environmentIds) {
			assert.ok(environments.has(environmentId), `${workload.id} references unknown environment ${environmentId}`);
		}
		const metricIds = new Set<string>();
		for (const threshold of workload.thresholds) {
			assert.match(threshold.metricId, /^[a-z][a-zA-Z\d.]+$/u, `${workload.id} has an invalid metric ID`);
			assert.equal(metricIds.has(threshold.metricId), false, `${workload.id} repeats ${threshold.metricId}`);
			metricIds.add(threshold.metricId);
			assert.ok(['eq', 'gte', 'lte'].includes(threshold.comparison), `${threshold.metricId} has an invalid comparison`);
			assert.ok(Number.isFinite(threshold.value), `${threshold.metricId} must have a finite threshold`);
			assert.ok(config.units.includes(threshold.unit), `${threshold.metricId} has an unknown unit`);
		}
	}

	const blockedMidi = config.workloads.find(({ milestone }) => milestone === '8B');
	assert.equal(blockedMidi?.status, 'blocked');
	assert.match(blockedMidi?.activationGate ?? '', /Audacity.*design/iu);

	const milestone2Fixture = fixtures.get('m2-streaming-project-8gib-v1');
	assert.equal(milestone2Fixture?.status, 'provisional');
	assert.equal(milestone2Fixture?.kind, 'sparse-zip64-desktop-range-and-counting-import-witness');
	assert.deepEqual(milestone2Fixture?.specification, {
		referenceScaleExecutionCommand: 'npm run test:reference:scape-8gib',
		referenceScaleEnvironmentOverride: 'SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB=1',
		routineNodeTestBehavior: 'skip-with-reference-command',
		routineCoverageBehavior: 'skip-with-reference-command',
		observedAllFilesCoverageTestResult: 'passed',
		observedAllFilesCoverageTestDurationSeconds: 525,
		logicalBytes: 8_589_934_592,
		assetBytes: 8_589_932_094,
		assetSha256: '7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be',
		assetCrc32: 2_909_126_900,
		archiveFormat: 'zip64',
		projectSchemaVersion: 9,
		sparseFilesystemRequired: true,
		rangeRequestShape: 'single-exact-closed',
		rangeResponseStatus: 206,
		maxRangeBytes: 16_777_216,
		maxInspectionTransferBytesExclusive: 8_388_608,
		inspectionStopsAt: 'collision-cancel',
		inspectionPayloadLazy: true,
		inspectionWholeBlobMaterialization: false,
		fullImportPipeline: [
			'read-capability-store',
			'protocol',
			'desktop-range-adapter',
			'file-service',
			'project-file-service',
			'scape-import',
		],
		fullImportSink: 'counting-independent-sha256-transactional-no-payload-retention',
		zipCrcVerification: 'strict-reader-check-signature',
		manifestSha256Verification: 'importer-and-independent-sink',
		maxMediaEmissionBytes: 4_194_304,
		retainedSinkPayloadBytes: 0,
		projectPublicationVerified: true,
		exactCapabilityReleaseCount: 1,
		exactPinnedHandleCloseCount: 1,
		fullImportWholeBlobMaterialization: false,
		packagedElectronUiQualified: false,
		opfsIndexedDbDurableStorageQualified: false,
		quotaPreflightQualified: true,
		quotaPreflightPolicy: 'point-in-time-validated-asset-bytes-plus-ceil-10-percent',
		quotaPreflightRequiredFreeBytes: 9_448_925_304,
		realBrowserQuotaAvailabilityQualified: false,
		rendererBrowserHeapQualified: false,
		mainRendererRssQualified: false,
		wholeArchiveStorageAtomicityQualified: false,
		publisherAuthenticationQualified: false,
	});
	assert.equal(
		milestone2Fixture?.specification.quotaPreflightRequiredFreeBytes,
		8_589_932_094 + Math.ceil(8_589_932_094 / 10),
	);
	assert.match(milestone2Fixture?.limitation ?? '', /sparse filesystem/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /counting.*sink/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /packaged Electron UI/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /OPFS.*IndexedDB/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /point-in-time capacity admission.*injected estimate/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /8,589,932,094.*9,448,925,304/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /not a storage reservation/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /does not guarantee.*capacity UI snapshot.*write-time success/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /actual browser quota.*estimate freshness.*concurrent writers/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /browser-record.*filesystem-allocation.*policy headroom/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /RSS/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /browser heap/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /quota/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /atomicity/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /publisher authentication/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /routine.*coverage.*skip/iu);
	assert.equal(
		packageMetadata.scripts['test:reference:scape-8gib'],
		'node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/desktop-scape-sparse-full-import-integration.test.ts',
	);
	assert.match(referenceScaleTest, /process\.env\.npm_lifecycle_event/u);
	assert.match(referenceScaleTest, /SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB/u);
	assert.match(referenceScaleTest, /npm run test:reference:scape-8gib/u);
	assert.deepEqual(milestone2Fixture?.evidence, [
		'package.json',
		'src/common/editor/scape-import-capacity.ts',
		'tests/audio-editor-scape-import-capacity.test.ts',
		'tests/audio-editor-scape-import-capacity-admission.test.ts',
		'tests/desktop-scape-sparse-range-integration.test.ts',
		'tests/desktop-scape-sparse-full-import-integration.test.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/helpers/sparse-scape-zip64-fixture.ts',
		'docs/quality-budgets.md#fixtures-and-project-sizes',
	]);

	const directWavFixture = fixtures.get('m2-direct-wav-385mib-v1');
	assert.equal(directWavFixture?.status, 'provisional');
	assert.equal(directWavFixture?.kind, 'deterministic-direct-wav-counting-sha256-node-witness');
	assert.deepEqual(directWavFixture?.specification, {
		referenceScaleExecutionCommand: 'npm run test:reference:wav-385mib',
		referenceScaleEnvironmentOverride: 'SOUNDSCAPER_RUN_REFERENCE_WAV_385MIB=1',
		routineNodeTestBehavior: 'skip-with-reference-command',
		routineCoverageBehavior: 'skip-with-reference-command',
		generatorRevision: 2,
		sampleRate: 48_000,
		channelCount: 32,
		sampleFormat: 'float32',
		signal: 'silence',
		packetFrames: 16_384,
		outputFrames: 3_153_920,
		outputPcmBytes: 403_701_760,
		outputFileBytes: 403_701_804,
		outputSha256: 'f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe',
		desktopOutputThresholdBytes: 402_653_184,
		renderStrategy: 'realtime-stream',
		renderReason: 'output-memory',
		renderPackets: 193,
		maximumPendingPackets: 16,
		maximumPendingPcmBytes: 33_554_432,
		maximumDestinationWriteBytes: 4_194_304,
		maximumPathOwnedBinaryBytes: 41_943_384,
		maximumBudgetBufferedBinaryBytes: 67_108_864,
		retainedOutputPayloadBytes: 0,
		oversizePreflightBytesRead: 0,
		partialPublishedOutputs: 0,
		productionPipeline: [
			'export-planner',
			'export-controller',
			'channel-aware-32-mib-pcm-sink-queue',
			'passthrough-streaming-resampler',
			'wav-stream-encoder',
			'direct-exact-size-destination',
		],
		cancellationAfterCoalescedPcmWriteVerified: true,
		rendererHeapQualified: false,
		processRssQualified: false,
		filesystemDurabilityQualified: false,
		packagedElectronQualified: false,
	});
	assert.match(directWavFixture?.limitation ?? '', /Node.*counting SHA-256 target/iu);
	assert.match(directWavFixture?.limitation ?? '', /typed-array and coalescing-buffer backing bytes.*ownership/iu);
	assert.match(directWavFixture?.limitation ?? '', /not.*renderer heap.*process RSS/iu);
	assert.match(directWavFixture?.limitation ?? '', /File System Access.*Electron filesystem/iu);
	assert.match(directWavFixture?.limitation ?? '', /quota.*durability/iu);
	assert.match(directWavFixture?.limitation ?? '', /packaged.*UI/iu);
	assert.match(directWavFixture?.limitation ?? '', /routine.*coverage.*skip/iu);
	assert.equal(
		packageMetadata.scripts['test:reference:wav-385mib'],
		'node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/audio-editor-export-direct-wav-reference.test.ts',
	);
	assert.match(directWavReferenceTest, /process\.env\.npm_lifecycle_event/u);
	assert.match(directWavReferenceTest, /SOUNDSCAPER_RUN_REFERENCE_WAV_385MIB/u);
	assert.match(directWavReferenceTest, /npm run test:reference:wav-385mib/u);
	assert.deepEqual(directWavFixture?.evidence, [
		'package.json',
		'src/common/editor/export.js',
		'src/common/editor/pcm-sink.js',
		'src/common/editor/resample.js',
		'src/common/editor/wav.js',
		'src/common/editor/controller/direct-pcm-export.ts',
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'docs/quality-budgets.md#fixtures-and-project-sizes',
	]);
	assert.deepEqual(
		config.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.fixtureIds,
		['m2-streaming-project-8gib-v1', 'm2-direct-wav-385mib-v1'],
	);
	assert.equal(
		config.workloads.find(({ id }) => id === 'm2-streaming-bounded-memory')?.status,
		'planned',
		'the counting-sink witness does not qualify the bounded-memory workload',
	);

	const gpuEnvironment = environments.get('reference-linux-gpu-01');
	assert.equal(gpuEnvironment?.status, 'unprovisioned');
	assert.equal(gpuEnvironment?.qualificationEligible, false);
	assert.equal(gpuEnvironment?.rendererRequirement, 'hardware');
	assert.ok(Object.values(gpuEnvironment?.fingerprint ?? {}).every((value) => value === null));
	const hostedPlaywright = environments.get('github-ubuntu-playwright-1.61.1');
	assert.equal(hostedPlaywright?.status, 'active');
	assert.equal(hostedPlaywright?.qualificationEligible, false);

	const keyedFixture = fixtures.get('m4b2-keyframe-parity-rgba-v1');
	const keyedWorkload = config.workloads.find(({ id }) => id === 'm4b2-keyframe-render-parity');
	const keyedEvidence = [
		'src/common/editor/quality/m4b2-keyframe-parity-workload.ts',
		'scripts/lib/m4b2-keyframe-parity-metrics.mjs',
		'scripts/collect-m4b2-keyframe-parity-quality.mjs',
		'tests/audio-editor-m4b2-keyframe-parity-workload.test.ts',
		'tests/helpers/m4b2-keyframe-parity-fixture.ts',
		'tests/quality-budget-m4b2-keyframe-parity-collector.test.ts',
		'tests/browser/audio-editor-m4b2-keyframe-parity.spec.js',
	];
	assert.equal(keyedFixture?.status, 'provisional');
	assert.equal(keyedFixture?.kind, 'deterministic-keyed-preview-offline-rgba-parity');
	assert.deepEqual(keyedFixture?.specification, {
		profile: 'deterministic-keyframe-parity-v1',
		observationClass: 'complete-keyed-rgba-consumer-ledger-v1',
		generatorRevision: 2, seed: 1_801_382_864, width: 128, height: 72,
		sampleRate: 48_000, frameRate: { num: 12, den: 1 }, frameCount: 12,
		sourceByteLength: 442_368,
		sourceSha256: 'db9fa74f23eb1b5f9565cd10f10794a975492b629731534b56d0af3072b3ad8a',
		caseIds: ['opacity-hold', 'opacity-linear', 'opacity-eased', 'opacity-bezier'],
		queryIds: ['start', 'interior', 'end'],
		evidenceClipIds: ['m4b2-opacity-hold-clip', 'm4b2-opacity-linear-clip',
			'm4b2-opacity-eased-clip', 'framescaper-v18-flat-clip-4f2ad5b3a72f098f3878c158c7025f70'],
		presentationClasses: ['authenticated-cfr-occurrence', 'authenticated-cfr-occurrence',
			'authenticated-cfr-occurrence', 'authenticated-vfr-materialized-occurrence'],
		localDiagnosticCommand: 'node scripts/collect-m4b2-keyframe-parity-quality.mjs',
		qualificationPublication: 'pending-external-only',
	});
	assert.deepEqual(keyedFixture?.evidence, keyedEvidence);
	assert.match(keyedFixture?.limitation ?? '', /correctness.*pending-external/iu);
	assert.match(keyedFixture?.limitation ?? '', /provisioned.*accepted reference cohort/iu);
	assert.equal(keyedWorkload?.status, 'provisional');
	assert.deepEqual(keyedWorkload?.fixtureIds, ['m4b2-keyframe-parity-rgba-v1']);
	assert.deepEqual(keyedWorkload?.environmentIds,
		['github-ubuntu-playwright-1.61.1', 'reference-linux-gpu-01']);
	assert.deepEqual(keyedWorkload?.thresholds, [
		{ metricId: 'keyframes.videoMinimumSsim', comparison: 'gte', value: 0.98, unit: 'ratio' },
		{ metricId: 'keyframes.videoMaximumChannelMae', comparison: 'lte', value: 6 / 255, unit: 'ratio' },
		{ metricId: 'keyframes.omittedOperations', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'keyframes.substitutedOperations', comparison: 'eq', value: 0, unit: 'count' },
		{ metricId: 'keyframes.fallbackOperations', comparison: 'eq', value: 0, unit: 'count' },
	]);
	assert.deepEqual(keyedWorkload?.evidence, keyedEvidence);
	assert.equal(config.qualification.qualifiedWorkloadIds.includes(keyedWorkload?.id ?? ''), false);
	assert.equal(JSON.stringify(config.qualification.acceptedResultCohorts)
		.includes('m4b2-keyframe-render-parity'), false);

	await assertEvidenceExists([
		...config.environments.flatMap(({ evidence }) => evidence),
		...config.fixtures.flatMap(({ evidence }) => evidence),
		...config.workloads.flatMap(({ evidence }) => evidence),
	]);
});

test('quality budget inputs pin the checked-in Node, npm, Playwright, and browser revisions', async () => {
	const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;
	const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
		readonly devDependencies: Readonly<Record<string, string>>;
		readonly packageManager: string;
	};
	const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
		readonly packages: Readonly<Record<string, Readonly<{ version?: string }>>>;
	};
	const browserRegistry = JSON.parse(
		await readFile(new URL('../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8'),
	) as {
		readonly browsers: readonly Readonly<{
			browserVersion?: string;
			name: string;
			revision: string;
		}>[];
	};

	assert.equal(config.softwareInputs.node.version, (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim());
	assert.equal(config.softwareInputs.npm.version, packageMetadata.packageManager.split('@').at(-1));
	assert.equal(config.softwareInputs.playwright.version, packageLock.packages['node_modules/@playwright/test']?.version);
	assert.equal(packageMetadata.devDependencies['@playwright/test'], `^${config.softwareInputs.playwright.version}`);
	assert.deepEqual(config.softwareInputs.browsers, {
		chromium: {
			version: '149.0.7827.55', revision: '1228', project: 'chromium', status: 'provisional',
			evidence: ['package-lock.json', 'playwright.config.mjs', '.github/workflows/quality.yml'],
		},
		firefox: {
			version: '151.0', revision: '1532', project: 'firefox', status: 'provisional',
			evidence: ['package-lock.json', 'playwright.config.mjs', '.github/workflows/quality.yml'],
		},
		webkit: {
			version: '26.5', revision: '2311', project: 'webkit', status: 'provisional',
			evidence: ['package-lock.json', 'playwright.config.mjs', '.github/workflows/quality.yml'],
		},
	});
	for (const [browserId, input] of Object.entries(config.softwareInputs.browsers)) {
		const installed = browserRegistry.browsers.find(({ name }) => name === browserId);
		assert.equal(input.version, installed?.browserVersion, `${browserId} version must match Playwright`);
		assert.equal(input.revision, installed?.revision, `${browserId} revision must match Playwright`);
	}
	await assertEvidenceExists([
		...config.softwareInputs.node.evidence,
		...config.softwareInputs.npm.evidence,
		...config.softwareInputs.playwright.evidence,
		...Object.values(config.softwareInputs.browsers).flatMap(({ evidence }) => evidence),
	]);
});

test('registered video parity artifacts retain their deterministic hashes', async () => {
	const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;
	const fixture = config.fixtures.find(({ id }) => id === 'video-effect-parity-rgba-v1');
	assert.ok(fixture?.artifacts);
	for (const artifact of fixture.artifacts) {
		const generated = createVideoEffectParityFixture(artifact.id);
		assert.equal(generated.bytes.byteLength, artifact.byteLength);
		assert.equal(createHash('sha256').update(generated.bytes).digest('hex'), artifact.sha256);
	}
});

test('quality budget evaluator accepts exact boundaries on an eligible environment', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'fixed-gpu',
			rendererRequirement: 'hardware',
			thresholds: [
				{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' },
				{ metricId: 'preview.ssimMinimum', comparison: 'gte', value: 0.98, unit: 'ratio' },
				{ metricId: 'preview.omissions', comparison: 'eq', value: 0, unit: 'count' },
			],
		},
		{ id: 'fixed-gpu', status: 'active', qualificationEligible: true },
		{
			environmentId: 'fixed-gpu',
			rendererClass: 'hardware',
			metrics: {
				'preview.frameIntervalP95Ms': 33.34,
				'preview.ssimMinimum': 0.98,
				'preview.omissions': 0,
			},
		},
	);

	assert.equal(evaluation.passed, true);
	assert.deepEqual(evaluation.failures, []);
	assert.ok(evaluation.verdicts.every(({ passed }: { readonly passed: boolean }) => passed));
});

test('quality budget evaluator fails closed on missing metrics, environment mismatch, and software rendering', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'fixed-gpu',
			rendererRequirement: 'hardware',
			thresholds: [
				{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' },
				{ metricId: 'preview.heapDeltaBytes', comparison: 'lte', value: 1_048_576, unit: 'bytes' },
			],
		},
		{ id: 'fixed-gpu', status: 'active', qualificationEligible: true },
		{
			environmentId: 'another-host',
			rendererClass: 'software',
			metrics: { 'preview.frameIntervalP95Ms': Number.NaN },
		},
	);

	assert.equal(evaluation.passed, false);
	assert.ok(evaluation.failures.some((failure: string) => /environment mismatch/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /hardware renderer/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /finite/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /missing metric.*heapDeltaBytes/iu.test(failure)));
});

test('quality budget evaluator cannot qualify an unprovisioned environment', () => {
	const evaluation = evaluateQualityBudget(
		{
			environmentId: 'reference-linux-gpu-01',
			rendererRequirement: 'hardware',
			thresholds: [{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34, unit: 'ms' }],
		},
		{ id: 'reference-linux-gpu-01', status: 'unprovisioned', qualificationEligible: false },
		{
			environmentId: 'reference-linux-gpu-01',
			rendererClass: 'hardware',
			metrics: { 'preview.frameIntervalP95Ms': 10 },
		},
	);

	assert.equal(evaluation.passed, false);
	assert.ok(evaluation.failures.some((failure: string) => /unprovisioned/iu.test(failure)));
	assert.ok(evaluation.failures.some((failure: string) => /not qualification-eligible/iu.test(failure)));
});

async function assertEvidenceExists(references: readonly string[]): Promise<void> {
	for (const reference of new Set(references)) {
		const [repositoryPath] = reference.split('#');
		await assert.doesNotReject(
			access(new URL(`../${repositoryPath}`, import.meta.url)),
			`Missing quality-budget evidence: ${reference}`,
		);
	}
}
