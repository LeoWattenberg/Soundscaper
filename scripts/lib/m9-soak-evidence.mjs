/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { evaluateQualityBudget } from '../quality-budget-evaluator.mjs';
import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	m9SoakScheduleSha256,
	validateM9SoakSpec,
} from './m9-soak-fixture.mjs';
import {
	boundedString,
	deepFreeze,
	exactRecord,
	isRecord,
	nonNegativeInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M9_SOAK_ENVIRONMENT_ID = 'release-qualification-matrix';
export const M9_SOAK_METRIC_IDS = Object.freeze([
	'soak.retainedJsHeapDeltaBytes',
	'soak.postWarmupHeapSlopeMibPerHour',
	'soak.electronRssDeltaBytes',
	'soak.audioDropoutFrames',
	'soak.unreportedDroppedFrames',
	'soak.avDriftMaximumMs',
	'soak.failedAutosaves',
	'soak.unrecoveredJobs',
	'qualification.browserPassRatio',
	'qualification.desktopPassRatio',
	'qualification.migrationPassRatio',
	'qualification.releaseBlockingDefects',
]);
export const M9_SOAK_THRESHOLDS = deepFreeze([
	{ metricId: 'soak.retainedJsHeapDeltaBytes', comparison: 'lte', value: 134_217_728, unit: 'bytes' },
	{ metricId: 'soak.postWarmupHeapSlopeMibPerHour', comparison: 'lte', value: 4, unit: 'MiB/hour' },
	{ metricId: 'soak.electronRssDeltaBytes', comparison: 'lte', value: 536_870_912, unit: 'bytes' },
	{ metricId: 'soak.audioDropoutFrames', comparison: 'eq', value: 0, unit: 'frames' },
	{ metricId: 'soak.unreportedDroppedFrames', comparison: 'eq', value: 0, unit: 'frames' },
	{ metricId: 'soak.avDriftMaximumMs', comparison: 'lte', value: 20, unit: 'ms' },
	{ metricId: 'soak.failedAutosaves', comparison: 'eq', value: 0, unit: 'count' },
	{ metricId: 'soak.unrecoveredJobs', comparison: 'eq', value: 0, unit: 'count' },
	{ metricId: 'qualification.browserPassRatio', comparison: 'eq', value: 1, unit: 'ratio' },
	{ metricId: 'qualification.desktopPassRatio', comparison: 'eq', value: 1, unit: 'ratio' },
	{ metricId: 'qualification.migrationPassRatio', comparison: 'eq', value: 1, unit: 'ratio' },
	{ metricId: 'qualification.releaseBlockingDefects', comparison: 'eq', value: 0, unit: 'count' },
]);

const RAW_FIELDS = Object.freeze([
	'schemaVersion', 'mode', 'workloadId', 'fixtureId', 'runId', 'sequence',
	'sourceRevision', 'budgetSha256', 'matrixCellId', 'environmentId', 'rendererClass',
	'environmentFingerprint', 'collection', 'fixture', 'samples', 'qualification',
]);
const COLLECTION_FIELDS = Object.freeze([
	'attemptCount', 'retryCount', 'hostedRunner', 'startedAt', 'endedAt',
	'elapsedTimeSource', 'monotonicDurationMs', 'workloadRunnerSha256', 'packageSha256',
]);
const FIXTURE_FIELDS = Object.freeze([
	'generatorRevision', 'seed', 'artifactSha256', 'scheduleSha256', 'eventCount',
	'executedEventIds',
]);
const SAMPLE_FIELDS = Object.freeze([
	'heap', 'electronRss', 'avDrift', 'audioDropouts', 'droppedFrames', 'autosaves', 'jobs',
]);
const QUALIFICATION_FIELDS = Object.freeze([
	'browserChecks', 'desktopChecks', 'migrationChecks', 'defects',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RENDERER_CLASSES = Object.freeze(['hardware', 'software', 'unknown']);
const RELEASE_BLOCKING_SEVERITIES = new Set(['critical', 'high', 'unclassified']);

export function validateM9SoakRawEvidence(value, specValue) {
	const spec = validateM9SoakSpec(specValue);
	const raw = exactRecord(
		snapshotStrictJsonData(value, 'M9 soak raw evidence'), RAW_FIELDS, 'M9 soak raw evidence',
	);
	if (raw.schemaVersion !== 1 || !['qualification', 'contract'].includes(raw.mode)) {
		throw new Error('M9 soak raw evidence identity is invalid.');
	}
	if (raw.workloadId !== spec.workloadId || raw.fixtureId !== spec.fixtureId
		|| raw.environmentId !== M9_SOAK_ENVIRONMENT_ID) {
		throw new Error('M9 soak raw evidence workload/fixture/environment identity is invalid.');
	}
	boundedString(raw.runId, 1, 128, 'M9 runId');
	if (raw.mode === 'qualification' && ![1, 2].includes(raw.sequence)) {
		throw new Error('M9 qualification sequence must be 1 or 2.');
	}
	if (raw.mode === 'contract' && raw.sequence !== null) {
		throw new Error('M9 contract evidence sequence must be null.');
	}
	if (!SOURCE_REVISION.test(raw.sourceRevision) || !SHA256.test(raw.budgetSha256)) {
		throw new Error('M9 source revision or budget digest is invalid.');
	}
	boundedString(raw.matrixCellId, 1, 128, 'M9 matrixCellId');
	if (!RENDERER_CLASSES.includes(raw.rendererClass)) throw new Error('M9 renderer class is invalid.');
	const fingerprint = validateFingerprint(raw.environmentFingerprint);
	const fixture = generateM9SoakFixture(spec, raw.mode);
	const runSpec = spec[raw.mode];
	const collection = validateCollection(raw.collection, runSpec, raw.mode);
	const fixtureBinding = validateFixtureBinding(raw.fixture, fixture, spec);
	const samples = validateSamples(raw.samples, fixture, runSpec);
	const qualification = validateQualification(raw.qualification);
	return deepFreeze({
		...raw,
		environmentFingerprint: fingerprint,
		collection,
		fixture: fixtureBinding,
		samples,
		qualification,
	});
}

export function computeM9SoakMetrics(value, specValue) {
	const spec = validateM9SoakSpec(specValue);
	const raw = validateM9SoakRawEvidence(value, spec);
	const warmupMs = spec[raw.mode].warmupSeconds * 1_000;
	const heap = raw.samples.heap.filter(({ elapsedMs }) => elapsedMs >= warmupMs);
	const rss = raw.samples.electronRss.filter(({ elapsedMs }) => elapsedMs >= warmupMs);
	const metrics = {
		'soak.retainedJsHeapDeltaBytes': heap.at(-1).retainedJsHeapBytes - heap[0].retainedJsHeapBytes,
		'soak.postWarmupHeapSlopeMibPerHour': linearSlopeMibPerHour(heap),
		'soak.electronRssDeltaBytes': Math.max(...rss.map(({ rssBytes }) => rssBytes)) - rss[0].rssBytes,
		'soak.audioDropoutFrames': sum(raw.samples.audioDropouts.map(({ frames }) => frames)),
		'soak.unreportedDroppedFrames': sum(raw.samples.droppedFrames
			.filter(({ reported }) => !reported).map(({ frames }) => frames)),
		'soak.avDriftMaximumMs': Math.max(...raw.samples.avDrift.map(({ driftMs }) => Math.abs(driftMs))),
		'soak.failedAutosaves': raw.samples.autosaves.filter(({ status }) => status === 'failed').length,
		'soak.unrecoveredJobs': raw.samples.jobs.filter(({ terminalState, recovered }) => (
			terminalState !== 'completed' || !recovered
		)).length,
		'qualification.browserPassRatio': passRatio(raw.qualification.browserChecks),
		'qualification.desktopPassRatio': passRatio(raw.qualification.desktopChecks),
		'qualification.migrationPassRatio': passRatio(raw.qualification.migrationChecks),
		'qualification.releaseBlockingDefects': raw.qualification.defects.filter(({ severity, status }) => (
			status === 'open' && RELEASE_BLOCKING_SEVERITIES.has(severity)
		)).length,
	};
	for (const [metricId, actual] of Object.entries(metrics)) {
		if (!Number.isFinite(actual)) throw new Error(`M9 derived metric ${metricId} is not finite.`);
	}
	return deepFreeze({
		runId: raw.runId,
		mode: raw.mode,
		matrixCellId: raw.matrixCellId,
		environmentId: raw.environmentId,
		metrics,
		rawSampleCounts: {
			heap: raw.samples.heap.length,
			electronRss: raw.samples.electronRss.length,
			avDrift: raw.samples.avDrift.length,
			autosaves: raw.samples.autosaves.length,
			jobs: raw.samples.jobs.length,
			plannedEvents: raw.fixture.eventCount,
			executedEvents: raw.fixture.executedEventIds.length,
		},
	});
}

export function createM9SoakResult(value, contextValue) {
	const context = qualificationContext(contextValue);
	const raw = validateM9SoakRawEvidence(value, context.spec);
	assertM9Registration(context.config, context.spec);
	if (raw.budgetSha256 !== context.budgetSha256) {
		throw new Error('M9 raw evidence does not bind the supplied quality budget.');
	}
	const computed = computeM9SoakMetrics(raw, context.spec);
	const expectedEnvironment = exactDescriptor(
		context.config.environments, M9_SOAK_ENVIRONMENT_ID, 'environment',
	);
	const qualificationEnvironment = raw.mode === 'contract'
		? { ...expectedEnvironment, status: 'active', qualificationEligible: true }
		: expectedEnvironment;
	if (raw.mode === 'qualification') {
		if (!Array.isArray(expectedEnvironment.eligibleWorkloadIds)
			|| !expectedEnvironment.eligibleWorkloadIds.includes(context.spec.workloadId)) {
			throw new Error('M9 release environment has not registered the soak workload.');
		}
		if (!isDeepStrictEqual(raw.environmentFingerprint, expectedEnvironment.fingerprint)) {
			throw new Error('M9 raw environment fingerprint does not match the release descriptor.');
		}
	}
	const evaluation = evaluateQualityBudget({
		environmentId: M9_SOAK_ENVIRONMENT_ID,
		rendererRequirement: expectedEnvironment.rendererRequirement,
		thresholds: M9_SOAK_THRESHOLDS,
	}, qualificationEnvironment, {
		environmentId: raw.environmentId,
		rendererClass: raw.rendererClass,
		metrics: computed.metrics,
	});
	const contractOnly = raw.mode === 'contract';
	return deepFreeze({
		schemaVersion: 1,
		status: contractOnly ? 'contract-only' : evaluation.passed ? 'accepted' : 'failed',
		workloadId: raw.workloadId,
		fixtureId: raw.fixtureId,
		mode: raw.mode,
		runId: raw.runId,
		sequence: raw.sequence,
		matrixCellId: raw.matrixCellId,
		environmentId: raw.environmentId,
		sourceRevision: raw.sourceRevision,
		budgetSha256: raw.budgetSha256,
		durationSeconds: context.spec[raw.mode].durationSeconds,
		metricGatePassed: evaluation.verdicts.every(({ passed }) => passed),
		qualificationEvidencePublished: !contractOnly && evaluation.passed,
		metrics: computed.metrics,
		rawSampleCounts: computed.rawSampleCounts,
		evaluation,
	});
}

export function createM9SoakCohort(values, contextValue) {
	if (!Array.isArray(values) || values.length !== 2) {
		throw new Error('An M9 soak cohort requires exactly two raw runs.');
	}
	const context = qualificationContext(contextValue);
	const raws = values.map((value) => validateM9SoakRawEvidence(value, context.spec));
	if (raws.some(({ mode }) => mode !== 'qualification')) {
		throw new Error('An M9 soak cohort accepts qualification-mode evidence only.');
	}
	const ordered = raws.toSorted((left, right) => left.sequence - right.sequence);
	if (!isDeepStrictEqual(ordered.map(({ sequence }) => sequence), [1, 2])) {
		throw new Error('M9 soak cohort requires consecutive sequences 1 and 2.');
	}
	assertUnique(ordered.map(({ runId }) => runId), 'M9 soak cohort requires unique run IDs.');
	assertSame(ordered, 'sourceRevision', 'one source revision');
	assertSame(ordered, 'budgetSha256', 'one quality budget');
	assertSame(ordered, 'matrixCellId', 'one matrix cell');
	assertSame(ordered, 'environmentId', 'one environment');
	assertDeepSame(ordered, 'environmentFingerprint', 'one environment fingerprint');
	assertDeepSame(ordered, 'collection', 'one collection binding', [
		'workloadRunnerSha256', 'packageSha256',
	]);
	if (Date.parse(ordered[1].collection.startedAt) < Date.parse(ordered[0].collection.endedAt)) {
		throw new Error('M9 soak cohort runs are not consecutive in wall-clock order.');
	}
	const runs = ordered.map((raw) => createM9SoakResult(raw, context));
	for (const run of runs) {
		if (!run.evaluation.passed || run.status !== 'accepted') {
			throw new Error(`M9 soak run ${run.runId} failed: ${run.evaluation.failures.join(' ')}`);
		}
	}
	const bands = context.spec.repeatabilityBands;
	if (!isDeepStrictEqual(bands.map(({ metricId }) => metricId), [...M9_SOAK_METRIC_IDS])) {
		throw new Error('M9 repeatability band registration is not exact.');
	}
	const verdicts = bands.map(({ metricId, maximumAbsoluteDifference }) => {
		const absoluteDifference = Math.abs(runs[0].metrics[metricId] - runs[1].metrics[metricId]);
		return deepFreeze({
			metricId,
			absoluteDifference,
			maximumAbsoluteDifference,
			passed: absoluteDifference <= maximumAbsoluteDifference,
		});
	});
	const failures = verdicts.filter(({ passed }) => !passed);
	if (failures.length > 0) {
		throw new Error(`M9 soak repeatability band failed: ${failures.map(
			({ metricId }) => metricId,
		).join(', ')}.`);
	}
	return deepFreeze({
		schemaVersion: 1,
		status: 'accepted',
		qualificationScope: 'two-consecutive-eight-hour-runs',
		workloadId: context.spec.workloadId,
		fixtureId: context.spec.fixtureId,
		matrixCellId: ordered[0].matrixCellId,
		environmentId: ordered[0].environmentId,
		sourceRevision: ordered[0].sourceRevision,
		budgetSha256: ordered[0].budgetSha256,
		qualificationEvidencePublished: true,
		runs,
		repeatability: { passed: true, verdicts },
	});
}

export async function writeM9SoakEvidence(outputDirectoryValue, values, contextValue) {
	const outputDirectory = boundedString(outputDirectoryValue, 1, 4_096, 'M9 output directory');
	if (!Array.isArray(values) || values.length === 0) throw new Error('M9 evidence writer needs raw evidence.');
	const evidence = values.length === 1
		? createM9SoakResult(values[0], contextValue)
		: createM9SoakCohort(values, contextValue);
	if (values.length === 1 && evidence.mode !== 'contract') {
		throw new Error('A single M9 run can publish contract evidence only.');
	}
	const suffix = values.length === 1 ? 'contract-only' : 'cohort.accepted';
	const path = join(outputDirectory, `${evidence.matrixCellId}.${suffix}.json`);
	const bytes = Buffer.from(`${JSON.stringify(evidence, null, '\t')}\n`, 'utf8');
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path, bytes, { flag: 'wx' });
	return deepFreeze({ path, byteLength: bytes.byteLength, sha256: sha256(bytes), evidence });
}

function qualificationContext(value) {
	const context = requireRecord(value, 'M9 qualification context');
	const spec = validateM9SoakSpec(context.spec);
	const config = snapshotStrictJsonData(context.config, 'M9 quality budget');
	if (!SHA256.test(context.budgetSha256)) throw new Error('M9 context budgetSha256 is invalid.');
	return { config, spec, budgetSha256: context.budgetSha256 };
}

function assertM9Registration(config, spec) {
	const fixture = exactDescriptor(config.fixtures, spec.fixtureId, 'fixture');
	const workload = exactDescriptor(config.workloads, spec.workloadId, 'workload');
	if (!['provisional', 'qualified'].includes(fixture.status)
		|| fixture.kind !== 'deterministic-generator'
		|| !['provisional', 'qualified'].includes(workload.status)) {
		throw new Error('M9 fixture/workload is not ready for qualification evidence.');
	}
	if (!isDeepStrictEqual(workload.fixtureIds, [spec.fixtureId])
		|| !isDeepStrictEqual(workload.environmentIds, [M9_SOAK_ENVIRONMENT_ID])
		|| !isDeepStrictEqual(workload.thresholds, M9_SOAK_THRESHOLDS)) {
		throw new Error('M9 soak threshold registration is not exact.');
	}
	const expectedSpecification = {
		durationSeconds: spec.qualification.durationSeconds,
		requiredBrowserPassRatio: 1,
		requiredDesktopPassRatio: 1,
		generatorRevision: spec.generator.revision,
		seed: spec.generator.seed,
		artifactSha256: spec.generatedArtifacts.qualification.sha256,
		scheduleSha256: spec.generatedArtifacts.qualification.scheduleSha256,
		eventCount: spec.generatedArtifacts.qualification.eventCount,
		contractDurationSeconds: spec.contract.durationSeconds,
	};
	if (!isDeepStrictEqual(fixture.specification, expectedSpecification)) {
		throw new Error('M9 fixture registration does not match the pinned generator specification.');
	}
}

function validateCollection(value, runSpec, mode) {
	const row = exactRecord(value, COLLECTION_FIELDS, 'M9 collection');
	if (row.attemptCount !== 1 || row.retryCount !== 0) {
		throw new Error('M9 collection requires one attempt and zero retries.');
	}
	if (row.hostedRunner !== false) throw new Error('M9 collection refuses a hosted runner.');
	if (row.elapsedTimeSource !== 'monotonic') throw new Error('M9 elapsed time must use a monotonic clock.');
	const started = timestamp(row.startedAt, 'M9 collection.startedAt');
	const ended = timestamp(row.endedAt, 'M9 collection.endedAt');
	const requiredMs = runSpec.durationSeconds * 1_000;
	if (ended - started < requiredMs || row.monotonicDurationMs < requiredMs) {
		throw new Error(`M9 ${mode} collection did not complete its wall-clock duration.`);
	}
	if (!SHA256.test(row.workloadRunnerSha256) || !SHA256.test(row.packageSha256)) {
		throw new Error('M9 collection payload binding is invalid.');
	}
	return row;
}

function validateFixtureBinding(value, fixture, spec) {
	const row = exactRecord(value, FIXTURE_FIELDS, 'M9 fixture binding');
	const expected = {
		generatorRevision: spec.generator.revision,
		seed: spec.generator.seed,
		artifactSha256: sha256(canonicalM9SoakFixtureBytes(fixture)),
		scheduleSha256: m9SoakScheduleSha256(fixture),
		eventCount: fixture.schedule.length,
		executedEventIds: fixture.schedule.map(({ eventId }) => eventId),
	};
	if (!isDeepStrictEqual(row, expected)) {
		throw new Error('M9 fixture binding did not execute the complete deterministic schedule.');
	}
	return row;
}

function validateSamples(value, fixture, runSpec) {
	const samples = exactRecord(value, SAMPLE_FIELDS, 'M9 samples');
	const elapsed = Array.from(
		{ length: (runSpec.durationSeconds / runSpec.sampleIntervalSeconds) + 1 },
		(_, index) => index * runSpec.sampleIntervalSeconds * 1_000,
	);
	const heap = timedSamples(samples.heap, elapsed, ['elapsedMs', 'retainedJsHeapBytes', 'forcedCollections'], 'heap',
		(row) => {
			nonNegativeInteger(row.retainedJsHeapBytes, 'M9 heap bytes');
			if (row.forcedCollections !== 3) throw new Error('M9 heap samples require exactly three forced collections.');
		});
	const electronRss = timedSamples(samples.electronRss, elapsed, ['elapsedMs', 'rssBytes'], 'electronRss',
		(row) => nonNegativeInteger(row.rssBytes, 'M9 RSS bytes'));
	const avDrift = timedSamples(samples.avDrift, elapsed, ['elapsedMs', 'driftMs'], 'avDrift',
		(row) => finite(row.driftMs, 'M9 A/V drift'));
	const audioDropouts = eventSamples(samples.audioDropouts, ['elapsedMs', 'frames'], 'audioDropouts', (row) => {
		elapsedWithin(row.elapsedMs, runSpec);
		nonNegativeInteger(row.frames, 'M9 audio dropout frames');
	});
	const droppedFrames = eventSamples(
		samples.droppedFrames, ['elapsedMs', 'frames', 'reported'], 'droppedFrames', (row) => {
			elapsedWithin(row.elapsedMs, runSpec);
			nonNegativeInteger(row.frames, 'M9 dropped frames');
			if (typeof row.reported !== 'boolean') throw new Error('M9 dropped-frame reported flag is invalid.');
		},
	);
	const autosaves = eventSamples(samples.autosaves, ['eventId', 'status'], 'autosaves', (row) => {
		boundedString(row.eventId, 1, 128, 'M9 autosave eventId');
		if (!['succeeded', 'failed'].includes(row.status)) throw new Error('M9 autosave status is invalid.');
	});
	const expectedAutosaves = fixture.schedule
		.filter(({ kind }) => kind === 'autosave').map(({ eventId }) => eventId);
	if (!isDeepStrictEqual(autosaves.map(({ eventId }) => eventId), expectedAutosaves)) {
		throw new Error('M9 autosave observations do not cover the deterministic schedule.');
	}
	const jobs = eventSamples(samples.jobs, ['jobId', 'terminalState', 'recovered'], 'jobs', (row) => {
		boundedString(row.jobId, 1, 128, 'M9 jobId');
		if (!['completed', 'failed', 'cancelled', 'blocked'].includes(row.terminalState)
			|| typeof row.recovered !== 'boolean') throw new Error('M9 job terminal state is invalid.');
	});
	if (jobs.length === 0) throw new Error('M9 evidence must observe at least one durable job.');
	return { heap, electronRss, avDrift, audioDropouts, droppedFrames, autosaves, jobs };
}

function validateQualification(value) {
	const qualification = exactRecord(value, QUALIFICATION_FIELDS, 'M9 qualification observations');
	const checkList = (rows, path) => {
		const checked = eventSamples(rows, ['id', 'passed'], path, (row) => {
			boundedString(row.id, 1, 128, `M9 ${path} id`);
			if (typeof row.passed !== 'boolean') throw new Error(`M9 ${path} pass flag is invalid.`);
		});
		if (checked.length === 0) throw new Error(`M9 ${path} must not be empty.`);
		assertUnique(checked.map(({ id }) => id), `M9 ${path} IDs must be unique.`);
		return checked;
	};
	const defects = eventSamples(qualification.defects, ['id', 'severity', 'status'], 'defects', (row) => {
		boundedString(row.id, 1, 128, 'M9 defect id');
		if (!['critical', 'high', 'medium', 'low', 'unclassified'].includes(row.severity)
			|| !['open', 'closed'].includes(row.status)) throw new Error('M9 defect state is invalid.');
	});
	assertUnique(defects.map(({ id }) => id), 'M9 defect IDs must be unique.');
	return {
		browserChecks: checkList(qualification.browserChecks, 'browserChecks'),
		desktopChecks: checkList(qualification.desktopChecks, 'desktopChecks'),
		migrationChecks: checkList(qualification.migrationChecks, 'migrationChecks'),
		defects,
	};
}

function timedSamples(value, expectedElapsed, fields, path, validate) {
	const rows = eventSamples(value, fields, path, validate);
	if (!isDeepStrictEqual(rows.map(({ elapsedMs }) => elapsedMs), expectedElapsed)) {
		throw new Error(`M9 ${path} sample schedule is not exact.`);
	}
	return rows;
}

function eventSamples(value, fields, path, validate) {
	if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new Error(`M9 ${path} must be a dense array.`);
	}
	return value.map((entry, index) => {
		const row = exactRecord(entry, fields, `M9 ${path}[${index}]`);
		validate(row);
		return row;
	});
}

function validateFingerprint(value) {
	const fingerprint = requireRecord(value, 'M9 environment fingerprint');
	if (Object.keys(fingerprint).length === 0) throw new Error('M9 environment fingerprint must not be empty.');
	for (const [key, item] of Object.entries(fingerprint)) {
		boundedString(key, 1, 128, 'M9 fingerprint key');
		if (!['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) {
			throw new Error('M9 environment fingerprint values must be finite scalars.');
		}
	}
	return fingerprint;
}

function linearSlopeMibPerHour(samples) {
	if (samples.length < 2) throw new Error('M9 heap slope requires at least two post-warmup samples.');
	const xMean = sum(samples.map(({ elapsedMs }) => elapsedMs)) / samples.length;
	const yMean = sum(samples.map(({ retainedJsHeapBytes }) => retainedJsHeapBytes)) / samples.length;
	let numerator = 0;
	let denominator = 0;
	for (const { elapsedMs, retainedJsHeapBytes } of samples) {
		numerator += (elapsedMs - xMean) * (retainedJsHeapBytes - yMean);
		denominator += (elapsedMs - xMean) ** 2;
	}
	if (denominator === 0) throw new Error('M9 heap slope samples have no elapsed span.');
	return (numerator / denominator) * 3_600_000 / (1024 * 1024);
}

function passRatio(rows) {
	return rows.filter(({ passed }) => passed).length / rows.length;
}

function assertSame(rows, field, label) {
	if (new Set(rows.map((row) => row[field])).size !== 1) throw new Error(`M9 soak cohort must bind ${label}.`);
}

function assertDeepSame(rows, field, label, members = null) {
	const select = (row) => members === null ? row[field] : Object.fromEntries(
		members.map((member) => [member, row[field][member]]),
	);
	if (!isDeepStrictEqual(select(rows[0]), select(rows[1]))) {
		throw new Error(`M9 soak cohort must bind ${label}.`);
	}
}

function assertUnique(values, message) {
	if (new Set(values).size !== values.length) throw new Error(message);
}

function exactDescriptor(values, id, kind) {
	if (!Array.isArray(values)) throw new Error(`M9 quality config has no ${kind} list.`);
	const matches = values.filter((value) => isRecord(value) && value.id === id);
	if (matches.length !== 1) throw new Error(`M9 quality config must contain one ${kind} ${id}.`);
	return matches[0];
}

function elapsedWithin(value, runSpec) {
	nonNegativeInteger(value, 'M9 event elapsedMs');
	if (value > runSpec.durationSeconds * 1_000) throw new Error('M9 event exceeds the run duration.');
}

function timestamp(value, path) {
	boundedString(value, 20, 64, path);
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
		throw new Error(`${path} must be canonical RFC3339 UTC.`);
	}
	return milliseconds;
}

function finite(value, path) {
	if (!Number.isFinite(value)) throw new Error(`${path} must be finite.`);
	return value;
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
