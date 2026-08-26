#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudget } from './quality-budget-evaluator.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKLOAD_ID = 'm3-longform-editorial';
const FIXTURE_ID = 'm3-longform-editorial-2h-v2';
const QUALIFICATION_ENVIRONMENT_ID = 'owner-qualified-windows-x64-rtx3090-01';
const LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
const HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';
const PACKAGED_RUNTIME_ENVIRONMENT_ID = /^packaged-runtime-(?:linux|win32|darwin)-(?:x64|arm64)$/u;
const PROFILE = 'deterministic-two-hour-editorial-v1';
const BROWSER_SPEC = 'tests/browser/audio-editor-longform-editorial-benchmark.spec.js';

/**
 * Run one no-retry browser measurement. The standalone collector publishes
 * diagnostic evidence only; formal acceptance belongs to the packaged-nightly
 * verifier, including when this process runs on the owner-designated host.
 */
export async function collectM3LongformEditorialDiagnostic(options, dependencies = {}) {
	const outputDirectory = ownString(options, 'outputDirectory');
	const config = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const runBrowser = dependencies.runBrowser ?? runBrowserDiagnostic;
	const writePending = dependencies.writePending ?? writePendingResult;
	const { stdout, stderr } = await runBrowser();
	const diagnostic = parseM3LongformEditorialDiagnostic(`${stdout}\n${stderr}`);
	const result = createPendingM3LongformEditorialResult(diagnostic, config);
	return writeM3LongformEditorialResult(
		outputDirectory, diagnostic, result, config,
		{ ...dependencies, writePending },
	);
}

export function writeM3LongformEditorialResult(
	outputDirectory,
	_diagnostic,
	result,
	_config,
	dependencies = {},
) {
	return (dependencies.writePending ?? writePendingResult)(outputDirectory, result);
}

/** Admit one and only one diagnostic with the frozen workload identity. */
export function parseM3LongformEditorialDiagnostic(output) {
	if (typeof output !== 'string') throw new TypeError('Browser diagnostic output must be a string.');
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		const jsonStart = line.indexOf('{');
		if (jsonStart < 0) continue;
		let candidate;
		try {
			candidate = JSON.parse(line.slice(jsonStart));
		} catch {
			continue;
		}
		if (isRecord(candidate)
			&& candidate.profile === PROFILE
			&& candidate.workloadId === WORKLOAD_ID
			&& candidate.fixtureId === FIXTURE_ID) matches.push(candidate);
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one ${WORKLOAD_ID} browser diagnostic; received ${matches.length}.`);
	}
	return matches[0];
}

/** Recompute all six metrics; only a configured qualified environment can pass. */
export function createPendingM3LongformEditorialResult(input, inputConfig) {
	const diagnostic = snapshotJsonData(input, 'diagnostic');
	const config = snapshotJsonData(inputConfig, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const environment = exactDescriptor(config.environments, QUALIFICATION_ENVIRONMENT_ID, 'environment');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');

	assertIdentity(diagnostic);
	if (diagnostic.observationClass !== 'decoded-media-av-scheduling-v1') {
		throw new Error('Browser diagnostic observationClass must prove decoded-media A/V scheduling.');
	}
	assertMeasurementPolicy(policy);
	const expectedFixture = expectedFixtureContract(fixture);
	if (!deepEqualJson(diagnostic.fixture, expectedFixture)) {
		throw new Error('Browser diagnostic fixture specification does not match the frozen quality-budget fixture.');
	}
	if (!Array.isArray(workload.fixtureIds)
		|| workload.fixtureIds.length !== 1
		|| workload.fixtureIds[0] !== FIXTURE_ID
		|| !Array.isArray(workload.environmentIds)
		|| !workload.environmentIds.includes(QUALIFICATION_ENVIRONMENT_ID)) {
		throw new Error(`Workload ${WORKLOAD_ID} must own exactly the frozen fixture and environment.`);
	}

	const positionChecks = exactArray(diagnostic.positionChecks, 26, 'position checks');
	const positionKinds = { audio: 0, video: 0 };
	const clipIds = new Set();
	for (const [index, value] of positionChecks.entries()) {
		const check = requireRecord(value, `positionChecks[${index}]`);
		if (check.kind !== 'audio' && check.kind !== 'video') {
			throw new Error(`positionChecks[${index}].kind must be audio or video.`);
		}
		positionKinds[check.kind] += 1;
		const clipId = finiteString(check.clipId, `positionChecks[${index}].clipId`);
		if (clipIds.has(clipId)) throw new Error(`Duplicate position check for ${clipId}.`);
		clipIds.add(clipId);
		finiteNonNegativeInteger(
			check.audioPositionErrorSamples,
			`positionChecks[${index}].audioPositionErrorSamples`,
		);
		finiteNonNegativeInteger(
			check.videoPositionErrorFrames,
			`positionChecks[${index}].videoPositionErrorFrames`,
		);
	}
	if (positionKinds.audio !== expectedFixture.audioTrackCount
		|| positionKinds.video !== expectedFixture.proxyVideoTrackCount) {
		throw new Error('Position checks must cover all 24 audio and 2 proxy-video clips exactly once.');
	}

	if (diagnostic.seekWarmupTrialCount !== policy.timingWarmupTrials) {
		throw new Error(`Expected exactly ${policy.timingWarmupTrials} seek warmup trial.`);
	}
	const seekTrials = exactArray(diagnostic.seekTrials, policy.timingTrials, 'seek trials');
	const expectedCheckpoints = fixture.specification.seekCheckpointsSamples;
	if (!Array.isArray(expectedCheckpoints) || expectedCheckpoints.length !== seekTrials.length) {
		throw new Error('Fixture seek checkpoints must match the measurement trial count.');
	}
	const seekDurations = [];
	for (const [index, value] of seekTrials.entries()) {
		const trial = requireRecord(value, `seekTrials[${index}]`);
		const checkpoint = finiteNonNegativeInteger(trial.checkpointSample, `seekTrials[${index}].checkpointSample`);
		if (checkpoint !== expectedCheckpoints[index]) {
			throw new Error(`seekTrials[${index}] does not use the frozen checkpoint.`);
		}
		const audioSample = finiteNonNegativeInteger(
			trial.observedAudioSample,
			`seekTrials[${index}].observedAudioSample`,
		);
		const videoFrame = finiteNonNegativeInteger(
			trial.observedVideoFrame,
			`seekTrials[${index}].observedVideoFrame`,
		);
		seekDurations.push(finiteNonNegative(trial.elapsedMs, `seekTrials[${index}].elapsedMs`));
		const expectedVideoFrame = audioSample
			* expectedFixture.videoFrameRate.num
			/ expectedFixture.videoFrameRate.den
			/ expectedFixture.sampleRate;
		if (videoFrame !== expectedVideoFrame) {
			throw new Error(`seekTrials[${index}] audio and video timeline coordinates diverged.`);
		}
	}
	const decodedAvSamples = exactArray(diagnostic.decodedAvSamples, 24, 'decoded A/V samples');
	const decodedFixtureCounts = new Map([
		['av-landscape-webm-v1', 0],
		['av-portrait-webm-v1', 0],
	]);
	const driftValues = decodedAvSamples.map((value, index) => {
		const sample = requireRecord(value, `decodedAvSamples[${index}]`);
		const fixtureId = finiteString(sample.fixtureId, `decodedAvSamples[${index}].fixtureId`);
		if (!decodedFixtureCounts.has(fixtureId)) {
			throw new Error(`decodedAvSamples[${index}] uses an unknown decoded fixture.`);
		}
		decodedFixtureCounts.set(fixtureId, decodedFixtureCounts.get(fixtureId) + 1);
		const audioSeconds = finiteNonNegative(
			sample.audioMediaTimeSeconds,
			`decodedAvSamples[${index}].audioMediaTimeSeconds`,
		);
		const videoSeconds = finiteNonNegative(
			sample.videoMediaTimeSeconds,
			`decodedAvSamples[${index}].videoMediaTimeSeconds`,
		);
		const driftMs = finiteNonNegative(sample.driftMs, `decodedAvSamples[${index}].driftMs`);
		if (Math.abs(Math.abs(audioSeconds - videoSeconds) * 1_000 - driftMs) > 0.000_001) {
			throw new Error(`decodedAvSamples[${index}] drift does not match its decoded clocks.`);
		}
		return driftMs;
	});
	if ([...decodedFixtureCounts.values()].some((count) => count !== 12)) {
		throw new Error('Decoded A/V samples must cover both repository fixtures exactly 12 times.');
	}

	const scrollIntervals = exactArray(
		diagnostic.scrollFrameIntervalsMs,
		fixture.specification.scrollFrameIntervalSampleCount,
		'scroll frame intervals',
	).map((value, index) => finiteNonNegative(value, `scrollFrameIntervalsMs[${index}]`));
	const retainedHeap = requireRecord(diagnostic.retainedHeap, 'retainedHeap');
	const forcedBefore = finiteNonNegativeInteger(
		retainedHeap.forcedCollectionsBefore,
		'retainedHeap.forcedCollectionsBefore',
	);
	const forcedAfter = finiteNonNegativeInteger(
		retainedHeap.forcedCollectionsAfter,
		'retainedHeap.forcedCollectionsAfter',
	);
	if (forcedBefore !== policy.forcedCollectionsPerHeapSnapshot
		|| forcedAfter !== policy.forcedCollectionsPerHeapSnapshot) {
		throw new Error('Heap snapshots must use the configured forced-collection count.');
	}
	const beforeBytes = finiteNonNegative(retainedHeap.beforeBytes, 'retainedHeap.beforeBytes');
	const afterBytes = finiteNonNegative(retainedHeap.afterBytes, 'retainedHeap.afterBytes');
	const metrics = Object.freeze({
		'editorial.audioPositionErrorSamples': Math.max(
			...positionChecks.map((check) => check.audioPositionErrorSamples),
		),
		'editorial.videoPositionErrorFrames': Math.max(
			...positionChecks.map((check) => check.videoPositionErrorFrames),
		),
		'editorial.avDriftMaximumMs': Math.max(...driftValues),
		'editorial.seekP95Ms': nearestRank(seekDurations, 0.95),
		'editorial.scrollFrameIntervalP95Ms': nearestRank(scrollIntervals, 0.95),
		'editorial.retainedHeapDeltaBytes': Math.max(0, afterBytes - beforeBytes),
	});
	const rendererClass = diagnostic.rendererClass;
	if (!['hardware', 'software', 'unknown'].includes(rendererClass)) {
		throw new Error('Browser diagnostic rendererClass must be hardware, software, or unknown.');
	}
	const environmentFingerprint = requireRecord(
		diagnostic.environmentFingerprint,
		'environmentFingerprint',
	);
	if (Object.keys(environmentFingerprint).length === 0) {
		throw new Error('Browser diagnostic environmentFingerprint must not be empty.');
	}
	const evaluation = evaluateQualityBudget({
		environmentId: QUALIFICATION_ENVIRONMENT_ID,
		rendererRequirement: environment.rendererRequirement,
		thresholds: workload.thresholds,
	}, environment, {
		environmentId: diagnostic.environmentId,
		rendererClass,
		metrics,
	});
	const metricGatePassed = evaluation.verdicts.length === workload.thresholds.length
		&& evaluation.verdicts.every(({ passed }) => passed);
	return Object.freeze({
		schemaVersion: 1,
		status: metricGatePassed ? 'pending-external' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: diagnostic.environmentId,
		qualificationEnvironmentId: QUALIFICATION_ENVIRONMENT_ID,
		profile: PROFILE,
		observationClass: diagnostic.observationClass,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass,
		environmentFingerprint: Object.freeze(environmentFingerprint),
		fixture: Object.freeze(expectedFixture),
		metrics,
		rawSampleCounts: Object.freeze({
			positionChecks: positionChecks.length,
			decodedAvSamples: decodedAvSamples.length,
			seekWarmupTrials: diagnostic.seekWarmupTrialCount,
			seekTrials: seekTrials.length,
			scrollFrameIntervals: scrollIntervals.length,
			forcedCollectionsBefore: forcedBefore,
			forcedCollectionsAfter: forcedAfter,
		}),
		metricGatePassed,
		qualificationEvidencePublished: false,
		evaluation: Object.freeze({
			...evaluation,
			passed: false,
			failures: Object.freeze([
				...evaluation.failures,
				'Formal qualification is published only by the nightly packaged-runtime verifier on the owner-designated host.',
			]),
		}),
	});
}

async function runBrowserDiagnostic() {
	await execFileAsync('npm', ['run', 'build'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return execFileAsync('npm', [
		'run', 'test:browser:built', '--', BROWSER_SPEC,
		'--project=chromium', '--workers=1', '--retries=0',
	], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: {
			...process.env,
			SOUNDSCAPER_M3_LONGFORM_BENCHMARK: '1',
			SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID: LOCAL_ENVIRONMENT_ID,
		},
	});
}

async function writePendingResult(outputDirectory, result) {
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

function expectedFixtureContract(fixture) {
	const specification = requireRecord(fixture.specification, 'fixture.specification');
	return snapshotJsonData({
		generatorRevision: specification.generatorRevision,
		seed: specification.seed,
		durationSeconds: specification.durationSeconds,
		sampleRate: specification.sampleRate,
		videoFrameRate: specification.videoFrameRate,
		audioTrackCount: specification.audioTrackCount,
		proxyVideoTrackCount: specification.proxyVideoTrackCount,
		editCount: specification.editCount,
		commandsPerTransaction: specification.commandsPerTransaction,
		operationCounts: specification.operationCounts,
		projectSha256: specification.projectSha256,
		editPlanSha256: specification.editPlanSha256,
	}, 'expectedFixture');
}

function assertIdentity(diagnostic) {
	if (diagnostic.schemaVersion !== 1
		|| diagnostic.profile !== PROFILE
		|| diagnostic.workloadId !== WORKLOAD_ID
		|| diagnostic.fixtureId !== FIXTURE_ID
		|| !isM3DiagnosticEnvironmentId(diagnostic.environmentId)) {
		throw new Error('Browser diagnostic identity does not match the frozen workload.');
	}
}

function isM3DiagnosticEnvironmentId(value) {
	return [LOCAL_ENVIRONMENT_ID, HOSTED_ENVIRONMENT_ID, QUALIFICATION_ENVIRONMENT_ID].includes(value)
		|| (typeof value === 'string' && PACKAGED_RUNTIME_ENVIRONMENT_ID.test(value));
}

function assertMeasurementPolicy(policy) {
	if (policy.percentileMethod !== 'nearest-rank'
		|| policy.benchmarkRetries !== 0
		|| policy.timingWorkers !== 1
		|| policy.timingWarmupTrials !== 1
		|| policy.timingTrials !== 5
		|| policy.forcedCollectionsPerHeapSnapshot !== 3) {
		throw new Error('Long-form collector requires the frozen no-retry measurement policy.');
	}
}

function nearestRank(values, percentile) {
	if (values.length === 0) throw new Error('Nearest-rank percentile requires samples.');
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function exactArray(value, length, label) {
	if (!Array.isArray(value) || value.length !== length) {
		throw new Error(`Expected exactly ${length} ${label}; received ${Array.isArray(value) ? value.length : 0}.`);
	}
	return value;
}

function finiteNonNegative(value, path) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${path} must be a finite non-negative number.`);
	}
	return value;
}

function finiteNonNegativeInteger(value, path) {
	const result = finiteNonNegative(value, path);
	if (!Number.isSafeInteger(result)) throw new Error(`${path} must be a safe integer.`);
	return result;
}

function finiteString(value, path) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string.`);
	return value;
}

function exactDescriptor(collection, id, label) {
	if (!Array.isArray(collection)) throw new Error(`Quality config has no ${label} descriptors.`);
	const matches = collection.filter((value) => isRecord(value) && value.id === id);
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function ownString(value, property) {
	const record = requireRecord(value, 'collector options');
	const result = record[property];
	if (typeof result !== 'string' || result.length === 0) {
		throw new Error(`Collector option ${property} must be a non-empty string.`);
	}
	return result;
}

function requireRecord(value, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	return value;
}

function isRecord(value) {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function snapshotJsonData(value, path) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON data.`);
		return value;
	}
	if (Array.isArray(value)) return value.map((entry, index) => snapshotJsonData(entry, `${path}[${index}]`));
	if (!isRecord(value)) throw new Error(`${path} must contain only plain JSON data.`);
	const result = {};
	for (const [key, entry] of Object.entries(value)) result[key] = snapshotJsonData(entry, `${path}.${key}`);
	return result;
}

function deepEqualJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
	if (process.argv.length > 3) {
		process.stderr.write('Usage: node scripts/collect-m3-longform-editorial-quality.mjs [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const outputDirectory = resolve(process.argv[2]
		?? fileURLToPath(new URL('../test-results/quality/m3-longform-editorial', import.meta.url)));
	const collected = await collectM3LongformEditorialDiagnostic({ outputDirectory });
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
