/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	M7_ASSISTANCE_PRIVACY_METRIC_IDS,
	computeM7AssistancePrivacyMetrics,
	validateM7AssistancePrivacyMeasurement,
} from '../scripts/lib/m7-local-assistance-privacy-metrics.mjs';
import {
	collectM7AssistancePrivacyQuality,
	createM7AssistancePrivacyResult,
	parseM7AssistancePrivacyCliOptions,
	writeM7AssistancePrivacyResult,
} from '../scripts/collect-m7-local-assistance-privacy-quality.mjs';
import { qualityBudgetSha256 } from '../scripts/lib/quality-budget-config-digest.mjs';

type MutableRecord = Record<string, unknown>;
type MutableRun = MutableRecord & {
	acceptedOutputs: MutableRecord[];
	cancellationSamplesMs: number[];
	canonicalChecks: MutableRecord[];
	mediaReads: MutableRecord[];
	networkObservation: MutableRecord & { requests: MutableRecord[] };
};
type MutableMeasurement = MutableRecord & {
	artifactAuthority: MutableRecord & { modelArtifacts: MutableRecord[]; runtimeArtifacts: MutableRecord[] };
	mediaAssets: MutableRecord[];
	package: MutableRecord;
	runs: MutableRun[];
	warmupRuns: MutableRun[];
};

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as MutableRecord & {
	environments: Array<MutableRecord & { id: string }>;
	fixtures: Array<MutableRecord & { id: string; specification: MutableRecord }>;
	measurementPolicy: MutableRecord;
	workloads: Array<MutableRecord & { id: string; thresholds: Array<{ metricId: string }> }>;
};
const fixture = config.fixtures.find(({ id }) => id === 'm7-local-assistance-privacy-v1')!;
const workload = config.workloads.find(({ id }) => id === 'm7-local-assistance-privacy')!;
const budgetSha256 = qualityBudgetSha256(config);
const sourceRevision = 'a'.repeat(40);

const mediaAssets = Object.freeze([
	{ assetId: 'selected-audio', selected: true, byteLength: 1_000, sha256: '1'.repeat(64) },
	{ assetId: 'selected-video', selected: true, byteLength: 2_000, sha256: '2'.repeat(64) },
	{ assetId: 'unselected-audio', selected: false, byteLength: 3_000, sha256: '3'.repeat(64) },
	{ assetId: 'unselected-video', selected: false, byteLength: 4_000, sha256: '4'.repeat(64) },
]);

function makeRun(runIndex: number, cancellationMs: number, warmup = false): MutableRun {
	const runKey = `${warmup ? 'warmup' : 'timed'}-${runIndex}`;
	return {
		runIndex,
		attemptCount: 1,
		retried: false,
		freshProcess: true,
		processId: runKey,
		workflowId: runIndex % 2 === 0 ? 'transcribe-captions' : 'make-highlights',
		workflowFenceSha256: '5'.repeat(64),
		packageSha256: '6'.repeat(64),
		catalogSha256: '7'.repeat(64),
		networkObservation: {
			mechanism: 'electron-net-log-and-os-counter-v1',
			osNetworkBlock: 'enforced',
			packageInstalledBeforeObservation: true,
			modelsInstalledBeforeObservation: true,
			startedBeforeWorkflow: true,
			endedAfterWorkflow: true,
			requests: [],
		},
		mediaReads: mediaAssets.map((asset) => ({
			assetId: asset.assetId,
			byteLength: asset.byteLength,
			sha256: asset.sha256,
			opened: asset.selected,
			bytesRead: asset.selected ? asset.byteLength : 0,
		})),
		acceptedOutputs: [{
			outputId: `accepted-output-${runKey}`,
			expectedSha256: '8'.repeat(64),
			observedSha256: '8'.repeat(64),
		}],
		canonicalChecks: [{
			checkId: `canonical-check-${runKey}`,
			scenario: runIndex % 2 === 0 ? 'accept-undo-reopen' : 'cancel-no-mutation',
			expectedSha256: '9'.repeat(64),
			observedSha256: '9'.repeat(64),
		}],
		cancellationSamplesMs: [cancellationMs],
	};
}

function makeMeasurement(): MutableMeasurement {
	return {
		schemaVersion: 1,
		profile: 'packaged-local-assistance-privacy-v1',
		observationClass: 'post-install-network-media-and-canonical-custody-v1',
		workloadId: 'm7-local-assistance-privacy',
		fixtureId: 'm7-local-assistance-privacy-v1',
		diagnosticEnvironmentId: 'native-os-diagnostics',
		observedEnvironmentId: 'local-development-linux-x64',
		observationMode: 'local-development',
		budgetSha256,
		sourceRevision,
		observedEnvironment: {
			platformTarget: 'linux-x64',
			operatingSystem: 'linux',
			architecture: 'x64',
			rendererClass: 'unknown',
			runtimeVersion: 'Electron 43.1.1',
		},
		package: {
			identity: 'soundscaper-linux-x64-development',
			target: 'linux-x64',
			byteLength: 123_456,
			sha256: '6'.repeat(64),
			manifestSha256: 'd'.repeat(64),
			manifestVerified: true,
			sourceRevision,
		},
		artifactAuthority: {
			catalogSha256: '7'.repeat(64),
			catalogSignatureSha256: 'e'.repeat(64),
			catalogSignatureVerified: true,
			modelArtifacts: [{
				modelId: 'parakeet-tdt-0.6b-v2', task: 'speech-recognition',
				artifactRole: 'model', version: '2', byteLength: 20_000, sha256: 'a'.repeat(64),
			}],
			runtimeArtifacts: [{
				familyId: 'sherpa-onnx', version: '1.13.5', artifactId: 'linux-x64-addon',
				target: 'linux-x64', byteLength: 10_000, sha256: 'b'.repeat(64),
			}],
		},
		mediaAssets: mediaAssets.map((asset) => ({ ...asset })),
		warmupRuns: [makeRun(0, 9_000, true)],
		runs: [100, 200, 300, 400, 1_900].map((sample, index) => makeRun(index, sample)),
	};
}

function expectation() {
	return {
		budgetSha256,
		fixtureSpecification: fixture.specification,
		measurementPolicy: config.measurementPolicy,
	};
}

test('the runnable collector owns exactly the five registered privacy metrics', async () => {
	assert.deepEqual(workload.thresholds.map(({ metricId }) => metricId), [
		...M7_ASSISTANCE_PRIVACY_METRIC_IDS,
	]);
	assert.equal(workload.status, 'optional');
	assert.equal(fixture.status, 'optional');
	assert.deepEqual(fixture.specification, {
		selectedMediaAssetCount: 2,
		unselectedMediaAssetCount: 2,
	});
	const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
		scripts: Record<string, string>;
	};
	assert.match(packageJson.scripts['quality:collect:m7-assistance-privacy'],
		/collect-m7-local-assistance-privacy-quality/u);
});

test('a complete authenticated trace deterministically derives all five metrics', () => {
	const computed = computeM7AssistancePrivacyMetrics(makeMeasurement(), expectation());
	assert.deepEqual(computed.metrics, {
		'assistance.networkRequestsAfterInstall': 0,
		'assistance.unselectedMediaBytesRead': 0,
		'assistance.acceptedDigestMismatches': 0,
		'assistance.cancellationP95Ms': 1_900,
		'assistance.canonicalStateLosses': 0,
	});
	assert.deepEqual(computed.rawSampleCounts, {
		warmupRuns: 1,
		timedRuns: 5,
		selectedMediaAssets: 2,
		unselectedMediaAssets: 2,
		networkRequests: 0,
		mediaReadObservations: 24,
		unselectedMediaReadObservations: 12,
		acceptedOutputs: 6,
		canonicalChecks: 6,
		cancellationSamples: 5,
	});
	assert.equal(computed.package.target, 'linux-x64');
	assert.equal(computed.sourceRevision, sourceRevision);
	assert.equal(Object.isFrozen(computed), true);
	assert.equal(Object.isFrozen(computed.metrics), true);
});

test('zero-tolerance ledgers include warm-up failures while timing excludes warm-up', () => {
	const measurement = makeMeasurement();
	measurement.warmupRuns[0]!.networkObservation.requests.push({
		requestId: 'warmup-request', method: 'GET', transport: 'https',
		destinationSha256: 'c'.repeat(64),
	});
	measurement.warmupRuns[0]!.mediaReads[2]!.opened = true;
	measurement.warmupRuns[0]!.mediaReads[2]!.bytesRead = 17;
	measurement.warmupRuns[0]!.acceptedOutputs[0]!.observedSha256 = 'd'.repeat(64);
	measurement.warmupRuns[0]!.canonicalChecks[0]!.observedSha256 = 'e'.repeat(64);
	const computed = computeM7AssistancePrivacyMetrics(measurement, expectation());
	assert.equal(computed.metrics['assistance.networkRequestsAfterInstall'], 1);
	assert.equal(computed.metrics['assistance.unselectedMediaBytesRead'], 17);
	assert.equal(computed.metrics['assistance.acceptedDigestMismatches'], 1);
	assert.equal(computed.metrics['assistance.canonicalStateLosses'], 1);
	assert.equal(computed.metrics['assistance.cancellationP95Ms'], 1_900);

	const result = createM7AssistancePrivacyResult(measurement, config);
	assert.equal(result.status, 'failed');
	assert.equal(result.metricGatePassed, false);
	assert.equal(result.evaluation.verdicts.filter(({ passed }: { passed: boolean }) => !passed).length, 4);
});

test('nearest-rank p95 is stable over bounded samples and breaches at 2001 ms', () => {
	const measurement = makeMeasurement();
	measurement.runs.forEach((run, index) => {
		run.cancellationSamplesMs = [10 + index, 20 + index, 30 + index, 40 + index];
	});
	measurement.runs[4]!.cancellationSamplesMs[2] = 2_001;
	measurement.runs[4]!.cancellationSamplesMs[3] = 9_999;
	const computed = computeM7AssistancePrivacyMetrics(measurement, expectation());
	assert.equal(computed.metrics['assistance.cancellationP95Ms'], 2_001);
	const result = createM7AssistancePrivacyResult(measurement, config);
	assert.equal(result.status, 'failed');
	assert.match(result.evaluation.failures.join('\n'), /cancellationP95Ms was 2001 ms/u);
});

test('fixture, identity, package, artifact, media, observation, and run shapes fail closed', () => {
	const extra = makeMeasurement();
	extra.unexpected = true;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(extra, expectation()), /exact fields/u);

	const wrongBudget = makeMeasurement();
	wrongBudget.budgetSha256 = 'f'.repeat(64);
	assert.throws(() => validateM7AssistancePrivacyMeasurement(wrongBudget, expectation()), /budget digest/u);

	const unsupportedMode = makeMeasurement();
	unsupportedMode.observationMode = 'owner-lab';
	assert.throws(() => validateM7AssistancePrivacyMeasurement(unsupportedMode, expectation()), /observationMode is unsupported/iu);

	const detachedPackage = makeMeasurement();
	detachedPackage.runs[1]!.packageSha256 = 'f'.repeat(64);
	assert.throws(() => validateM7AssistancePrivacyMeasurement(detachedPackage, expectation()), /package digest/u);

	const detachedCatalog = makeMeasurement();
	detachedCatalog.runs[1]!.catalogSha256 = 'f'.repeat(64);
	assert.throws(() => validateM7AssistancePrivacyMeasurement(detachedCatalog, expectation()), /catalog digest/u);

	const wrongTarget = makeMeasurement();
	wrongTarget.package.target = 'win32-x64';
	assert.throws(() => validateM7AssistancePrivacyMeasurement(wrongTarget, expectation()), /package target/u);

	const repeatedAsset = makeMeasurement();
	repeatedAsset.mediaAssets[3]!.assetId = 'unselected-audio';
	assert.throws(() => validateM7AssistancePrivacyMeasurement(repeatedAsset, expectation()), /repeats asset/iu);

	const wrongSelection = makeMeasurement();
	wrongSelection.mediaAssets[1]!.selected = false;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(wrongSelection, expectation()), /exactly 2 selected.*2 unselected/iu);

	const detachedRead = makeMeasurement();
	detachedRead.runs[0]!.mediaReads[0]!.sha256 = 'f'.repeat(64);
	assert.throws(() => validateM7AssistancePrivacyMeasurement(detachedRead, expectation()), /media identity/u);

	const blindNetworkObserver = makeMeasurement();
	blindNetworkObserver.runs[0]!.networkObservation.endedAfterWorkflow = false;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(blindNetworkObserver, expectation()), /network observation.*whole workflow/iu);
	const inventedNetworkObserver = makeMeasurement();
	inventedNetworkObserver.runs[0]!.networkObservation.mechanism = 'asserted-offline';
	assert.throws(() => validateM7AssistancePrivacyMeasurement(inventedNetworkObserver, expectation()), /mechanism is unsupported/iu);
	const installationTrafficHidden = makeMeasurement();
	installationTrafficHidden.runs[0]!.networkObservation.modelsInstalledBeforeObservation = false;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(installationTrafficHidden, expectation()), /installed before network observation/iu);

	const retried = makeMeasurement();
	retried.runs[0]!.retried = true;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(retried, expectation()), /forbids retry-to-pass/u);

	const unsupportedWorkflow = makeMeasurement();
	unsupportedWorkflow.runs[0]!.workflowId = 'download-a-model';
	assert.throws(() => validateM7AssistancePrivacyMeasurement(unsupportedWorkflow, expectation()), /workflowId is not closed/iu);

	const nonFinite = makeMeasurement();
	nonFinite.runs[0]!.cancellationSamplesMs[0] = Number.NaN;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(nonFinite, expectation()), /finite JSON data/u);

	const oversizedArtifacts = makeMeasurement();
	oversizedArtifacts.artifactAuthority.runtimeArtifacts = Array.from(
		{ length: 65 },
		(_, index) => ({
			familyId: 'sherpa-onnx', version: '1.13.5', artifactId: `runtime-${index}`,
			target: 'linux-x64', byteLength: 1, sha256: 'b'.repeat(64),
		}),
	);
	assert.throws(() => validateM7AssistancePrivacyMeasurement(oversizedArtifacts, expectation()), /1 through 64 entries/u);
});

test('all observed assets are covered and selected input must exercise the real path', () => {
	const missingRead = makeMeasurement();
	missingRead.runs[2]!.mediaReads.pop();
	assert.throws(() => validateM7AssistancePrivacyMeasurement(missingRead, expectation()), /exact media inventory/u);

	const selectedUnread = makeMeasurement();
	selectedUnread.runs[2]!.mediaReads[0]!.opened = false;
	selectedUnread.runs[2]!.mediaReads[0]!.bytesRead = 0;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(selectedUnread, expectation()), /selected asset.*read/iu);

	const impossibleRead = makeMeasurement();
	impossibleRead.runs[2]!.mediaReads[3]!.opened = false;
	impossibleRead.runs[2]!.mediaReads[3]!.bytesRead = 1;
	assert.throws(() => validateM7AssistancePrivacyMeasurement(impossibleRead, expectation()), /bytes without opening/iu);
});

test('local results report their thresholds without claiming release authority', () => {
	const result = createM7AssistancePrivacyResult(makeMeasurement(), config);
	assert.equal(result.status, 'passed');
	assert.equal(result.metricGatePassed, true);
	assert.equal('qualificationEvidencePublished' in result, false);
	assert.equal(result.evaluation.passed, true);
	assert.match(result.canonicalMeasurementSha256, /^[a-f\d]{64}$/u);
});

test('collector retains a digest-bound raw diagnostic', async () => {
	const result = createM7AssistancePrivacyResult(makeMeasurement(), config);
	await assert.rejects(
		writeM7AssistancePrivacyResult('/unused', { ...result, status: 'accepted' }, makeMeasurement()),
		/unsupported status accepted/u,
	);
	const detached = makeMeasurement();
	detached.runs[0]!.cancellationSamplesMs[0] = 999;
	await assert.rejects(
		writeM7AssistancePrivacyResult('/unused', result, detached),
		/detached from its raw measurement/u,
	);
	assert.throws(
		() => parseM7AssistancePrivacyCliOptions(['--qualify']),
		/Unknown M7 collector option/u,
	);
	assert.deepEqual(parseM7AssistancePrivacyCliOptions([
		'--measurement', '/lab/m7.json', '/results',
	]), { measurementPath: '/lab/m7.json', outputDirectory: '/results' });

	let written: unknown = null;
	const collected = await collectM7AssistancePrivacyQuality(
		{ measurementPath: '/lab/m7.json', outputDirectory: '/unused' },
		{
			config,
			readMeasurement: (path: string) => {
				assert.equal(path, '/lab/m7.json');
				return Promise.resolve(makeMeasurement());
			},
			writeResult: (directory: string, value: unknown, measurement: unknown) => {
				written = { directory, value, measurement };
				return Promise.resolve(written);
			},
		},
	);
	assert.equal(collected, written);
	assert.equal((written as { directory: string }).directory, '/unused');
	assert.equal((written as { value: { status: string } }).value.status, 'passed');
});

test('the local writer retains one raw record and one digest-bound aggregate', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m7-privacy-'));
	context.after(() => rm(directory, { force: true, recursive: true }));
	const measurement = makeMeasurement();
	const result = createM7AssistancePrivacyResult(measurement, config);
	const written = await writeM7AssistancePrivacyResult(directory, result, measurement);
	assert.match(written.rawPath, /m7-local-assistance-privacy\.linux-x64\.passed\.raw\.json$/u);
	assert.match(written.resultPath, /m7-local-assistance-privacy\.linux-x64\.passed\.json$/u);
	const retainedRaw = JSON.parse(await readFile(written.rawPath, 'utf8')) as MutableMeasurement;
	const retainedResult = JSON.parse(await readFile(written.resultPath, 'utf8')) as MutableRecord;
	assert.equal(retainedRaw.sourceRevision, sourceRevision);
	assert.equal(retainedResult.canonicalMeasurementSha256, result.canonicalMeasurementSha256);
	await assert.rejects(
		writeM7AssistancePrivacyResult(directory, result, measurement),
		/already exists|EEXIST/iu,
	);
});
