#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKLOAD_ID = 'm3-framescaper-v18-exit';
const FIXTURE_ID = 'm3-framescaper-v18-exit-2h-v1';
const ENVIRONMENT_ID = 'reference-linux-gpu-01';
const PROFILE = 'deterministic-framescaper-v18-browser-observation-v1';
const OBSERVATION_CLASS = 'framescaper-v18-maintained-projections-v1';
const BROWSER_SPEC = 'tests/browser/framescaper-v18-exit-observation.spec.js';
const REQUIRED_TRIALS = Object.freeze([
	Object.freeze({ id: 'audio-start', kind: 'audio' }),
	Object.freeze({ id: 'integer-video', kind: 'video' }),
	Object.freeze({ id: 'ntsc-video', kind: 'video' }),
	Object.freeze({ id: 'verified-vfr', kind: 'video' }),
	Object.freeze({ id: 'nested-root', kind: 'nested' }),
	Object.freeze({ id: 'multicamera-active', kind: 'multicamera' }),
]);
const EXTERNAL_REQUIREMENTS = Object.freeze([
	'The reference-linux-gpu-01 environment must be provisioned, qualification-eligible, and bound to its complete frozen fingerprint.',
	'The unavailable original-media proxy generator and the reviewed exact-retime executor hard stop require their own qualifying evidence.',
	'Packaged Electron and operating-system durability require external matrix observations.',
	'A separately reviewed external verifier must authenticate and publish accepted evidence; this collector never self-accepts.',
]);

/** Run exactly one opt-in browser observation and retain pending evidence only. */
export async function collectM3FramescaperV18ExitDiagnostic(options, dependencies = {}) {
	const outputDirectory = ownString(options, 'outputDirectory');
	const config = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const runBrowser = dependencies.runBrowser ?? runBrowserDiagnostic;
	const { stdout, stderr } = await runBrowser();
	const diagnostic = parseM3FramescaperV18ExitDiagnostic(`${stdout}\n${stderr}`);
	const result = createPendingM3FramescaperV18ExitResult(diagnostic, config);
	return writePendingResult(outputDirectory, result);
}

/** Admit one and only one diagnostic with the registered V18 exit identity. */
export function parseM3FramescaperV18ExitDiagnostic(output) {
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

/**
 * Recompute maintained V18 projection errors while preserving the external
 * qualification boundary. This function intentionally has no accepted branch.
 */
export function createPendingM3FramescaperV18ExitResult(input, inputConfig) {
	const diagnostic = snapshotJsonData(input, 'diagnostic');
	const config = snapshotJsonData(inputConfig, 'config');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const environment = exactDescriptor(config.environments, ENVIRONMENT_ID, 'environment');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertIdentity(diagnostic);
	assertMeasurementPolicy(policy);
	assertRegisteredContract(workload, fixture);
	if (diagnostic.observationClass !== OBSERVATION_CLASS) {
		throw new Error('Browser diagnostic observationClass must prove maintained V18 projections.');
	}
	const expectedFixture = expectedFixtureContract(fixture);
	if (!deepEqualJson(diagnostic.fixture, expectedFixture)) {
		throw new Error('Browser diagnostic fixture specification does not match the registered V18 exit fixture.');
	}
	const workflow = workflowEvidence(diagnostic.browserWorkflow);
	const trials = exactArray(diagnostic.projectionTrials, REQUIRED_TRIALS.length, 'projection trials');
	const counts = { audio: 0, video: 0, nested: 0, multicamera: 0 };
	const sampleErrors = { audio: [], multicamera: [] };
	const frameErrors = { video: [], nested: [] };
	const ids = new Set();
	for (const [index, expected] of REQUIRED_TRIALS.entries()) {
		const trial = requireRecord(trials[index], `projectionTrials[${String(index)}]`);
		if (trial.id !== expected.id || trial.kind !== expected.kind) {
			throw new Error(`projectionTrials[${String(index)}] must be ${expected.id}/${expected.kind}.`);
		}
		if (ids.has(trial.id)) throw new Error(`Duplicate V18 projection trial ${String(trial.id)}.`);
		ids.add(trial.id);
		counts[expected.kind] += 1;
		finiteNonNegative(trial.elapsedMs, `projectionTrials[${String(index)}].elapsedMs`);
		const sampleError = Math.abs(
			finiteSafeInteger(trial.observedSample, `projectionTrials[${String(index)}].observedSample`)
			- finiteSafeInteger(trial.expectedSample, `projectionTrials[${String(index)}].expectedSample`),
		);
		const frameError = nullableIntegerError(
			trial.observedVideoFrame,
			trial.expectedVideoFrame,
			`projectionTrials[${String(index)}]`,
		);
		if (sampleError !== 0 || frameError !== 0) {
			throw new RangeError(`V18 ${expected.kind} projection drift is nonzero.`);
		}
		if (expected.kind === 'audio' || expected.kind === 'multicamera') {
			sampleErrors[expected.kind].push(sampleError);
		} else {
			frameErrors[expected.kind].push(frameError);
		}
	}
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
	return Object.freeze({
		schemaVersion: 1,
		status: 'pending-external',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: 0,
		rendererClass,
		environmentFingerprint: Object.freeze(environmentFingerprint),
		fixture: Object.freeze(expectedFixture),
		browserWorkflow: Object.freeze(workflow),
		metrics: Object.freeze({
			'framescaperV18.audioPositionErrorSamples': maximum(sampleErrors.audio),
			'framescaperV18.videoPositionErrorFrames': maximum(frameErrors.video),
			'framescaperV18.nestedPositionErrorFrames': maximum(frameErrors.nested),
			'framescaperV18.multicameraSyncErrorSamples': maximum(sampleErrors.multicamera),
		}),
		rawSampleCounts: Object.freeze({
			projectionTrials: trials.length,
			audioTrials: counts.audio,
			videoTrials: counts.video,
			nestedTrials: counts.nested,
			multicameraTrials: counts.multicamera,
		}),
		qualificationEvidencePublished: false,
		externalQualification: Object.freeze({
			environmentStatus: environment.status,
			environmentQualificationEligible: environment.qualificationEligible === true,
			required: EXTERNAL_REQUIREMENTS,
		}),
	});
}

async function runBrowserDiagnostic() {
	await execFileAsync('npm', ['run', 'build'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, SCAPE_PRODUCT: 'framescaper' },
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
			SCAPE_PRODUCT: 'framescaper',
			SOUNDSCAPER_M3_FRAMESCAPER_V18_EXIT: '1',
		},
	});
}

async function writePendingResult(outputDirectory, result) {
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.pending-external.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

function assertRegisteredContract(workload, fixture) {
	if (!Array.isArray(workload.fixtureIds)
		|| workload.fixtureIds.length !== 1
		|| workload.fixtureIds[0] !== FIXTURE_ID
		|| !Array.isArray(workload.environmentIds)
		|| workload.environmentIds.length !== 1
		|| workload.environmentIds[0] !== ENVIRONMENT_ID) {
		throw new Error(`Workload ${WORKLOAD_ID} must own exactly the registered fixture and environment.`);
	}
	const specification = requireRecord(fixture.specification, 'fixture.specification');
	if (specification.localDiagnosticCommand !== 'npm run quality:collect:m3-framescaper-v18-exit'
		|| specification.qualificationPublication !== 'pending-external-only') {
		throw new Error('The V18 exit collector must remain a pending-external-only local diagnostic.');
	}
}

function workflowEvidence(value) {
	const workflow = requireRecord(value, 'browserWorkflow');
	if (workflow.productId !== 'framescaper' || workflow.projectSchemaVersion !== 18) {
		throw new Error('The V18 exit browser workflow must observe Framescaper schemaVersion 18.');
	}
	for (const [field, minimum] of [
		['coldReopenCount', 1],
		['exactTimingSourceCount', 3],
		['nestedPlacementCount', 1],
		['multicameraGroupCount', 1],
		['multicameraMemberCount', 2],
		['activeMemberSwitchCount', 1],
	]) {
		if (finiteNonNegativeInteger(workflow[field], `browserWorkflow.${field}`) < minimum) {
			throw new RangeError(`browserWorkflow.${field} must be at least ${String(minimum)}.`);
		}
	}
	return snapshotJsonData(workflow, 'browserWorkflow');
}

function expectedFixtureContract(fixture) {
	const specification = requireRecord(fixture.specification, 'fixture.specification');
	return snapshotJsonData({
		schemaVersion: specification.schemaVersion,
		durationSeconds: specification.durationSeconds,
		sampleRate: specification.sampleRate,
		contains: specification.contains,
	}, 'expectedFixture');
}

function assertIdentity(diagnostic) {
	if (diagnostic.schemaVersion !== 1
		|| diagnostic.profile !== PROFILE
		|| diagnostic.workloadId !== WORKLOAD_ID
		|| diagnostic.fixtureId !== FIXTURE_ID
		|| diagnostic.environmentId !== ENVIRONMENT_ID) {
		throw new Error('Browser diagnostic identity does not match the registered V18 exit workload.');
	}
}

function assertMeasurementPolicy(policy) {
	if (policy.benchmarkRetries !== 0 || policy.timingWorkers !== 1) {
		throw new Error('The V18 exit collector requires the frozen single-worker no-retry policy.');
	}
}

function maximum(values) {
	if (values.length === 0) throw new Error('A maintained V18 projection metric has no samples.');
	return Math.max(...values);
}

function nullableIntegerError(left, right, path) {
	if (left === null && right === null) return 0;
	if (left === null || right === null) throw new RangeError(`${path} has an incomplete video-frame observation.`);
	return Math.abs(finiteSafeInteger(left, `${path}.observedVideoFrame`)
		- finiteSafeInteger(right, `${path}.expectedVideoFrame`));
}

function exactArray(value, length, label) {
	if (!Array.isArray(value) || value.length !== length) {
		throw new Error(`Expected exactly ${String(length)} ${label}; received ${Array.isArray(value) ? String(value.length) : '0'}.`);
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

function finiteSafeInteger(value, path) {
	if (!Number.isSafeInteger(value)) throw new Error(`${path} must be a finite safe integer.`);
	return Number(value);
}

function exactDescriptor(collection, id, label) {
	if (!Array.isArray(collection)) throw new Error(`Quality config has no ${label} descriptors.`);
	const matches = collection.filter((value) => isRecord(value) && value.id === id);
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function ownString(value, property) {
	const record = requireRecord(value, 'collector options');
	const descriptor = Object.getOwnPropertyDescriptor(record, property);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'string' || descriptor.value.length === 0) {
		throw new Error(`Collector option ${property} must be an own non-empty string.`);
	}
	return descriptor.value;
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
	if (Array.isArray(value)) return value.map((entry, index) => snapshotJsonData(entry, `${path}[${String(index)}]`));
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
		process.stderr.write('Usage: node scripts/collect-m3-framescaper-v18-exit-quality.mjs [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const outputDirectory = resolve(process.argv[2]
		?? fileURLToPath(new URL('../test-results/quality/m3-framescaper-v18-exit', import.meta.url)));
	const collected = await collectM3FramescaperV18ExitDiagnostic({ outputDirectory });
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
