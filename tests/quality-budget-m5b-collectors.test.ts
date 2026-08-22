/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import {
	M5B_QUALITY_PIPELINES,
	M5B_DEFAULT_QUALITY_BUDGET_SHA256,
	M5B_WORKLOAD_DIAGNOSTIC_TYPE,
	assertM5bCollectionHost,
	collectM5bQuality,
	createM5bQualityResult,
	m5bQualityBudgetSha256,
	parseM5bQualityCollectorCliArguments,
	validateM5bQualityMeasurement,
	writeM5bQualityResult,
} from '../scripts/lib/m5b-quality-pipeline.mjs';

type Threshold = Readonly<{
	metricId: string;
	comparison: 'eq' | 'gte' | 'lte';
	value: number;
	unit: string;
}>;
type QualityConfig = Readonly<{
	environments: readonly Readonly<Record<string, unknown> & { id: string }>[];
	fixtures: readonly Readonly<Record<string, unknown> & { id: string }>[];
	workloads: readonly Readonly<Record<string, unknown> & {
		id: string;
		fixtureIds: readonly string[];
		environmentIds: readonly string[];
		thresholds: readonly Threshold[];
	}>[];
}>;
type MutableMeasurement = Record<string, unknown> & {
	metrics: Record<string, number>;
	observedFingerprint: Record<string, unknown>;
};
type Pipeline = Readonly<{
	workloadId: string;
	fixtureId: string;
}>;

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as QualityConfig;
const DIGEST = 'a'.repeat(64);
const SOURCE_REVISION = 'b'.repeat(40);
const WORKLOAD_RUNNER_SHA256 = createHash('sha256')
	.update(await readFile(process.execPath))
	.digest('hex');

test('five exact 5B collector profiles bind the registered workloads and fixtures', () => {
	assert.deepEqual(Object.keys(M5B_QUALITY_PIPELINES), [
		'native-media',
		'professional-media',
		'persistent-services',
		'clean-display',
		'openfx',
	]);
	for (const pipeline of Object.values(M5B_QUALITY_PIPELINES) as Pipeline[]) {
		const workload = config.workloads.find(({ id }) => id === pipeline.workloadId);
		assert.ok(workload, pipeline.workloadId);
		assert.deepEqual(workload.fixtureIds, [pipeline.fixtureId]);
		assert.deepEqual(workload.environmentIds, ['native-os-lab-matrix']);
		assert.ok(workload.thresholds.length > 0);
	}
});

test('each pipeline validates a closed measurement and remains pending-external', () => {
	for (const profileId of Object.keys(M5B_QUALITY_PIPELINES)) {
		const measurement = validateM5bQualityMeasurement(profileId, makeMeasurement(profileId));
		assert.equal(Object.isFrozen(measurement), true);
		assert.equal(Object.isFrozen(measurement.metrics), true);
		const result = createM5bQualityResult(profileId, measurement, config);
		assert.equal(result.status, 'pending-external', profileId);
		assert.equal(result.metricGatePassed, true, profileId);
		assert.equal(result.qualificationEvidencePublished, false, profileId);
		assert.ok(result.qualificationBlockers.some((value: string) => /unprovisioned/iu.test(value)));
		assert.equal(result.evaluation.passed, false);
	}
});

test('a provisioned exact lab can produce digest-bound accepted target evidence', async () => {
	const profileId = 'persistent-services';
	const measurement = makeMeasurement(profileId);
	const provisioned = provisionedConfig(profileId, measurement.observedFingerprint);
	measurement.budgetSha256 = m5bQualityBudgetSha256(provisioned);
	const result = createM5bQualityResult(profileId, measurement, provisioned);
	assert.equal(result.status, 'accepted');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationScope, 'single-target');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.deepEqual(result.qualificationBlockers, []);
	assert.equal(result.evaluation.passed, true);

	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-quality-'));
	try {
		const written = await writeM5bQualityResult(directory, measurement, result, provisioned);
		assert.match(written.resultPath, /\.accepted\.json$/u);
		const stored = JSON.parse(await readFile(written.resultPath, 'utf8')) as {
			qualificationEvidencePublished: boolean;
			raw: { sha256: string };
		};
		assert.equal(stored.qualificationEvidencePublished, false);
		assert.match(stored.raw.sha256, /^[a-f\d]{64}$/u);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('accepted evidence requires the exact registered target fingerprint', () => {
	const profileId = 'native-media';
	const measurement = makeMeasurement(profileId);
	const provisioned = provisionedConfig(profileId, {
		...measurement.observedFingerprint,
		mediaHostSha256: 'b'.repeat(64),
	});
	measurement.budgetSha256 = m5bQualityBudgetSha256(provisioned);
	const result = createM5bQualityResult(profileId, measurement, provisioned);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.ok(result.qualificationBlockers.some((value: string) => /fingerprint/iu.test(value)));
});

test('accepted evidence requires explicit workload eligibility and no-retry source binding', () => {
	const profileId = 'persistent-services';
	const measurement = makeMeasurement(profileId);
	const provisioned = provisionedConfig(profileId, measurement.observedFingerprint);
	const environment = provisioned.environments.find(({ id }) => id === 'native-os-lab-matrix')!;
	Reflect.deleteProperty(environment, 'eligibleWorkloadIds');
	measurement.budgetSha256 = m5bQualityBudgetSha256(provisioned);
	const result = createM5bQualityResult(profileId, measurement, provisioned);
	assert.equal(result.status, 'pending-external');
	assert.equal(result.qualificationEvidencePublished, false);
	assert.ok(result.qualificationBlockers.some((value: string) => /eligible workload/iu.test(value)));

	for (const mutation of [
		(value: MutableMeasurement) => { value.sourceRevision = 'not-a-revision'; },
		(value: MutableMeasurement) => { value.attemptCount = 2; },
		(value: MutableMeasurement) => { value.retryCount = 1; },
		(value: MutableMeasurement) => { value.budgetSha256 = 'c'.repeat(64); },
	]) {
		const invalid = makeMeasurement(profileId);
		mutation(invalid);
		assert.throws(
			() => validateM5bQualityMeasurement(profileId, invalid),
			/source revision|one no-retry|retry|budget digest/iu,
		);
	}
});

test('the evidence writer cannot publish a caller-forged accepted result', async () => {
	const measurement = makeMeasurement('native-media');
	const pending = createM5bQualityResult('native-media', measurement, config);
	const forged = {
		...pending,
		status: 'accepted',
		qualificationEvidencePublished: true,
		qualificationBlockers: [],
		evaluation: { ...pending.evaluation, passed: true, failures: [] },
	};
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-quality-'));
	try {
		await assert.rejects(
			writeM5bQualityResult(directory, measurement, forged),
			/recomputed|qualification|result/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('the evidence writer refuses a result detached from its raw measurement', async () => {
	const raw = makeMeasurement('native-media');
	const other = makeMeasurement('persistent-services');
	const result = createM5bQualityResult(
		'persistent-services',
		other,
		config,
	);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-quality-'));
	try {
		await assert.rejects(
			writeM5bQualityResult(directory, raw, result),
			/raw measurement|disagree|recomputed/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('native-lab evidence cannot be collected on a hosted CI runner', () => {
	assert.doesNotThrow(() => assertM5bCollectionHost({}));
	for (const variable of ['GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI']) {
		assert.throws(() => assertM5bCollectionHost({ [variable]: 'true' }), /hosted-runner/iu);
	}
	assert.throws(
		() => assertM5bCollectionHost(Object.defineProperty({}, 'CI', { get: () => '' })),
		/own string data property/iu,
	);
});

test('all five collectors can derive one validated measurement from a bounded workload diagnostic', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-'));
	try {
		for (const profileId of Object.keys(M5B_QUALITY_PIPELINES)) {
			const diagnostic = makeWorkloadDiagnostic(profileId);
			const collected = await collectM5bQuality(profileId, {
				outputDirectory: directory,
				workloadCommand: nodeCommand(`process.stdout.write(${JSON.stringify(JSON.stringify(diagnostic))});`),
			}, {
				config,
				processEnvironment: {},
			});
			assert.equal(collected.result.profileId, profileId);
			assert.equal(collected.result.status, 'pending-external');
			assert.equal(collected.result.qualificationEvidencePublished, false);
			const raw = JSON.parse(await readFile(collected.rawPath, 'utf8')) as { profileId: string };
			assert.equal(raw.profileId, profileId);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('workload collection rejects hostile output before it can become evidence', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-'));
	try {
		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand("process.stdout.write('x'.repeat(4096));", {
					maxOutputBytes: 512,
				}),
			}, { config, processEnvironment: {} }),
			/output limit/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('workload collection binds the measured runner to the executable bytes', async () => {
	const diagnostic = makeWorkloadDiagnostic('native-media');
	(diagnostic.measurement as MutableMeasurement).observedFingerprint.workloadRunnerSha256 = DIGEST;
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-'));
	try {
		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand(
					`process.stdout.write(${JSON.stringify(JSON.stringify(diagnostic))});`,
				),
			}, { config, processEnvironment: {} }),
			/workload runner|executable digest/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('workload collection terminates a command that exceeds its exact time bound', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-'));
	try {
		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand('setInterval(() => {}, 1_000);', {
					timeoutMilliseconds: 100,
				}),
			}, { config, processEnvironment: {} }),
			/time limit/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a timed-out workload cannot leave a descendant process running', {
	skip: process.platform === 'win32' ? 'POSIX process-group contract' : false,
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-tree-'));
	const markerPath = join(directory, 'descendant-survived');
	const descendantSource = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'survived'), 400);`;
	const parentSource = `require('node:child_process').spawn(process.execPath, ['--eval', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' }); setInterval(() => {}, 1_000);`;
	try {
		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand(parentSource, { timeoutMilliseconds: 100 }),
			}, { config, processEnvironment: {} }),
			/time limit/iu,
		);
		await delay(600);
		await assert.rejects(readFile(markerPath), { code: 'ENOENT' });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('workload collection rejects duplicate and wrong-pipeline diagnostics', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5b-workload-'));
	try {
		const diagnostic = makeWorkloadDiagnostic('native-media');
		const encoded = JSON.stringify(diagnostic);
		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand(
					`const diagnostic = ${JSON.stringify(encoded)}; process.stdout.write(diagnostic + '\\n' + diagnostic);`,
				),
			}, { config, processEnvironment: {} }),
			/exactly one JSON diagnostic/iu,
		);

		await assert.rejects(
			collectM5bQuality('native-media', {
				outputDirectory: directory,
				workloadCommand: nodeCommand(`process.stdout.write(${JSON.stringify(JSON.stringify({
					...diagnostic,
					profileId: 'openfx',
				}))});`),
			}, { config, processEnvironment: {} }),
			/wrong pipeline|profileId/iu,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('the CLI exposes mutually exclusive offline and exact-command modes', () => {
	assert.deepEqual(parseM5bQualityCollectorCliArguments([
		'--run', process.execPath,
		'--timeout-ms', '2500',
		'--max-output-bytes', '4096',
		'--output-directory', 'evidence',
		'--', '--eval', 'process.stdout.write("{}");',
	]), {
		measurementPath: null,
		outputDirectory: 'evidence',
		workloadCommand: {
			executable: process.execPath,
			arguments: ['--eval', 'process.stdout.write("{}");'],
			timeoutMilliseconds: 2500,
			maxOutputBytes: 4096,
		},
	});
	assert.throws(
		() => parseM5bQualityCollectorCliArguments([
			'--measurement', 'measurement.json', '--run', process.execPath,
		]),
		/mutually exclusive/iu,
	);
});

test('a threshold miss is failed rather than disguised as pending qualification', () => {
	const measurement = makeMeasurement('clean-display');
	measurement.metrics['cleanDisplay.corruptFrames'] = 1;
	const result = createM5bQualityResult(
		'clean-display',
		validateM5bQualityMeasurement('clean-display', measurement),
		config,
	);
	assert.equal(result.status, 'failed');
	assert.equal(result.metricGatePassed, false);
	assert.ok(result.evaluation.failures.some((value: string) => /corruptFrames/iu.test(value)));
});

test('measurement admission rejects cross-pipeline, incomplete, extra, and non-finite data', () => {
	const baseline = makeMeasurement('openfx');
	assert.throws(
		() => validateM5bQualityMeasurement('openfx', { ...baseline, workloadId: 'other' }),
		/workload/iu,
	);
	const missing = structuredClone(baseline);
	Reflect.deleteProperty(missing.metrics, Object.keys(missing.metrics)[0]!);
	assert.throws(() => validateM5bQualityMeasurement('openfx', missing), /exact metric/iu);
	const extra = structuredClone(baseline);
	extra.metrics.extra = 0;
	assert.throws(() => validateM5bQualityMeasurement('openfx', extra), /exact metric/iu);
	const nonFinite = structuredClone(baseline);
	nonFinite.metrics[Object.keys(nonFinite.metrics)[0]!] = Number.POSITIVE_INFINITY;
	assert.throws(() => validateM5bQualityMeasurement('openfx', nonFinite), /finite/iu);
	assert.throws(
		() => validateM5bQualityMeasurement('openfx', { ...baseline, authority: 'qualify' }),
		/exact fields/iu,
	);
});

test('all five CLI wrappers are registered and delegate to the closed pipeline', async () => {
	const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
		scripts: Record<string, string>;
	};
	for (const profileId of Object.keys(M5B_QUALITY_PIPELINES)) {
		const scriptName = `quality:collect:m5b-${profileId}`;
		const command = packageJson.scripts[scriptName];
		assert.equal(typeof command, 'string', scriptName);
		assert.match(command, new RegExp(`collect-m5b-${profileId}-quality\\.mjs`, 'u'));
		const source = await readFile(new URL(
			`../scripts/collect-m5b-${profileId}-quality.mjs`, import.meta.url,
		), 'utf8');
		assert.match(source, new RegExp(`runM5bQualityCollectorCli\\('${profileId}'`, 'u'));
	}
});

function makeMeasurement(profileId: string): MutableMeasurement {
	const pipeline = M5B_QUALITY_PIPELINES[profileId as keyof typeof M5B_QUALITY_PIPELINES];
	assert.ok(pipeline);
	const workload = config.workloads.find(({ id }) => id === pipeline.workloadId)!;
	return {
		schemaVersion: 1,
		budgetSha256: M5B_DEFAULT_QUALITY_BUDGET_SHA256,
		sourceRevision: SOURCE_REVISION,
		attemptCount: 1,
		retryCount: 0,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		environmentId: 'native-os-lab-matrix',
		platformId: 'linuxX64',
		rendererClass: 'hardware',
		observedFingerprint: {
			platformId: 'linuxX64',
			architecture: 'x64',
			osVersion: 'qualification-fixture',
			cpuModel: 'qualification-fixture',
			gpuModel: 'qualification-fixture',
			driverVersion: 'qualification-fixture',
			packageSha256: DIGEST,
			mediaHostSha256: DIGEST,
			sourceRevision: SOURCE_REVISION,
			workloadRunnerSha256: WORKLOAD_RUNNER_SHA256,
			ofxScannerSha256: profileId === 'openfx' ? DIGEST : null,
			ofxRuntimeHostSha256: profileId === 'openfx' ? DIGEST : null,
		},
		metrics: Object.fromEntries(workload.thresholds.map(({ metricId, value }) => [metricId, value])),
		sampleCounts: Object.fromEntries(workload.thresholds.map(({ metricId }) => [metricId, 1])),
	};
}

function makeWorkloadDiagnostic(profileId: string): Record<string, unknown> {
	const pipeline = M5B_QUALITY_PIPELINES[profileId as keyof typeof M5B_QUALITY_PIPELINES];
	assert.ok(pipeline);
	return {
		schemaVersion: 1,
		diagnosticType: M5B_WORKLOAD_DIAGNOSTIC_TYPE,
		profileId,
		workloadId: pipeline.workloadId,
		fixtureId: pipeline.fixtureId,
		measurement: makeMeasurement(profileId),
	};
}

function nodeCommand(
	source: string,
	overrides: Partial<Readonly<{ timeoutMilliseconds: number; maxOutputBytes: number }>> = {},
): Readonly<{
	executable: string;
	arguments: readonly string[];
	timeoutMilliseconds: number;
	maxOutputBytes: number;
}> {
	return {
		executable: process.execPath,
		arguments: ['--eval', source],
		timeoutMilliseconds: overrides.timeoutMilliseconds ?? 5_000,
		maxOutputBytes: overrides.maxOutputBytes ?? 128 * 1_024,
	};
}

function provisionedConfig(profileId: string, fingerprint: unknown): QualityConfig {
	const candidate = structuredClone(config) as unknown as Record<string, unknown>;
	const pipeline = M5B_QUALITY_PIPELINES[profileId as keyof typeof M5B_QUALITY_PIPELINES];
	const environments = candidate.environments as Array<Record<string, unknown>>;
	const environment = environments.find(({ id }) => id === 'native-os-lab-matrix')!;
	environment.status = 'active';
	environment.qualificationEligible = true;
	environment.eligibleWorkloadIds = [pipeline.workloadId];
	environment.fingerprint = {
		...(environment.fingerprint as Record<string, unknown>),
		linuxX64: fingerprint,
		windowsX64: fingerprintFor('windowsX64', 'x64'),
		windowsArm64: fingerprintFor('windowsArm64', 'arm64'),
		macosArm64: fingerprintFor('macosArm64', 'arm64'),
		linuxArm64: fingerprintFor('linuxArm64', 'arm64'),
	};
	const fixtures = candidate.fixtures as Array<Record<string, unknown>>;
	fixtures.find(({ id }) => id === pipeline.fixtureId)!.status = 'qualified';
	const workloads = candidate.workloads as Array<Record<string, unknown>>;
	workloads.find(({ id }) => id === pipeline.workloadId)!.status = 'qualified';
	const qualification = candidate.qualification as Record<string, unknown>;
	qualification.qualifiedWorkloadIds = [
		...new Set([
			...((qualification.qualifiedWorkloadIds as string[]) ?? []),
			pipeline.workloadId,
		]),
	];
	return candidate as unknown as QualityConfig;
}

function fingerprintFor(platformId: string, architecture: string): Record<string, unknown> {
	return {
		platformId,
		architecture,
		osVersion: 'qualification-fixture',
		cpuModel: 'qualification-fixture',
		gpuModel: 'qualification-fixture',
		driverVersion: 'qualification-fixture',
		packageSha256: DIGEST,
		mediaHostSha256: DIGEST,
		sourceRevision: SOURCE_REVISION,
		workloadRunnerSha256: WORKLOAD_RUNNER_SHA256,
		ofxScannerSha256: DIGEST,
		ofxRuntimeHostSha256: DIGEST,
	};
}
