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

type BudgetStatus = 'blocked' | 'optional' | 'planned' | 'provisional';
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
		qualifiedWorkloadIds: readonly string[];
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

test('quality budget contract names numeric gates for every later milestone without claiming qualification', async () => {
	const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;

	assert.equal(config.schemaVersion, 1);
	assert.match(config.groundedAt, /^\d{4}-\d{2}-\d{2}$/u);
	assert.equal(config.qualification.status, 'in-progress');
	assert.deepEqual(config.qualification.qualifiedWorkloadIds, []);
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
		quotaPreflightQualified: false,
		rendererBrowserHeapQualified: false,
		mainRendererRssQualified: false,
		wholeArchiveStorageAtomicityQualified: false,
		publisherAuthenticationQualified: false,
	});
	assert.match(milestone2Fixture?.limitation ?? '', /sparse filesystem/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /counting.*sink/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /packaged Electron UI/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /OPFS.*IndexedDB/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /preflight/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /RSS/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /browser heap/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /quota/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /atomicity/iu);
	assert.match(milestone2Fixture?.limitation ?? '', /publisher authentication/iu);
	assert.deepEqual(milestone2Fixture?.evidence, [
		'tests/desktop-scape-sparse-range-integration.test.ts',
		'tests/desktop-scape-sparse-full-import-integration.test.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/helpers/sparse-scape-zip64-fixture.ts',
		'docs/quality-budgets.md#fixtures-and-project-sizes',
	]);
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
