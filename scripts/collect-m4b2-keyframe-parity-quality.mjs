#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compareM4B2KeyframeParityVideo,
	createM4B2KeyframeParityExpectedRgba,
	decodeM4B2KeyframeParityRgba,
	decodeM4B2KeyframeParitySourceRgba,
	validateM4B2KeyframeConsumerLedger,
} from './lib/m4b2-keyframe-parity-metrics.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BROWSER_SPEC = 'tests/browser/audio-editor-m4b2-keyframe-parity.spec.js';
const MARKER = 'SOUNDSCAPER_M4B2_KEYFRAME_PARITY ';
const WORKLOAD_ID = 'm4b2-keyframe-render-parity';
const FIXTURE_ID = 'm4b2-keyframe-parity-rgba-v1';
const PROFILE = 'deterministic-keyframe-parity-v1';
const OBSERVATION_CLASS = 'complete-keyed-rgba-consumer-ledger-v1';
const LOCAL_ENVIRONMENT_ID = 'local-browser-correctness';
const HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';
const PACKAGED_RUNTIME_ENVIRONMENT_ID = /^packaged-runtime-(?:linux|win32|darwin)-(?:x64|arm64)$/u;
const LOCAL_ADMISSION_MINIMUM_SSIM = 0.98;
const LOCAL_ADMISSION_MAXIMUM_CHANNEL_MAE = 6 / 255;
const SOURCE_SHA256 = 'db9fa74f23eb1b5f9565cd10f10794a975492b629731534b56d0af3072b3ad8a';
const DEFAULT_THRESHOLDS = Object.freeze([
	Object.freeze({ metricId: 'keyframes.videoMinimumSsim', comparison: 'gte', value: LOCAL_ADMISSION_MINIMUM_SSIM }),
	Object.freeze({ metricId: 'keyframes.videoMaximumChannelMae', comparison: 'lte', value: LOCAL_ADMISSION_MAXIMUM_CHANNEL_MAE }),
	Object.freeze({ metricId: 'keyframes.omittedOperations', comparison: 'eq', value: 0 }),
	Object.freeze({ metricId: 'keyframes.substitutedOperations', comparison: 'eq', value: 0 }),
	Object.freeze({ metricId: 'keyframes.fallbackOperations', comparison: 'eq', value: 0 }),
]);
const QUERY_DEFINITIONS = Object.freeze([
	Object.freeze({ id: 'start', frameIndex: 2, position: Object.freeze({ num: 2, den: 1 }) }),
	Object.freeze({ id: 'interior', frameIndex: 6, position: Object.freeze({ num: 6, den: 1 }) }),
	Object.freeze({ id: 'end', frameIndex: 10, position: Object.freeze({ num: 10, den: 1 }) }),
]);
const CFR_PRESENTATIONS = Object.freeze([
	Object.freeze({ drawableSourceFrame: 2, sourceFrame: '2/1', sourceTime: '1/6' }),
	Object.freeze({ drawableSourceFrame: 6, sourceFrame: '6/1', sourceTime: '1/2' }),
	Object.freeze({ drawableSourceFrame: 10, sourceFrame: '10/1', sourceTime: '5/6' }),
]);
const VFR_PRESENTATIONS = Object.freeze([
	Object.freeze({ drawableSourceFrame: 3, sourceFrame: '3/1', sourceTime: '1/6' }),
	Object.freeze({ drawableSourceFrame: 6, sourceFrame: '47/7', sourceTime: '1/2' }),
	Object.freeze({ drawableSourceFrame: 9, sourceFrame: '29/3', sourceTime: '5/6' }),
]);
const CASE_DEFINITIONS = Object.freeze([
	caseDefinition('opacity-hold', 'hold', [0.2, 0.2, 0.8]),
	caseDefinition('opacity-linear', 'linear', [0.1, 0.5, 0.9]),
	caseDefinition('opacity-eased', 'eased', [0.15, 0.5, 0.85]),
	caseDefinition(
		'opacity-bezier', 'bezier', [0.1, 0.50625, 0.95],
		'framescaper-flat-clip-4f2ad5b3a72f098f3878c158c7025f70',
	),
]);
const FIXTURE = Object.freeze({
	generatorRevision: 3,
	seed: 1_801_382_864,
	width: 128,
	height: 72,
	sampleRate: 48_000,
	frameRate: Object.freeze({ num: 12, den: 1 }),
	frameCount: 12,
	sourceByteLength: 128 * 72 * 4 * 12,
	sourceSha256: SOURCE_SHA256,
	caseIds: Object.freeze(CASE_DEFINITIONS.map(({ id }) => id)),
	queryIds: Object.freeze(QUERY_DEFINITIONS.map(({ id }) => id)),
	evidenceClipIds: Object.freeze(CASE_DEFINITIONS.map(({ evidenceClipId }) => evidenceClipId)),
	presentationClasses: Object.freeze(CASE_DEFINITIONS.map(({ presentationClass }) => presentationClass)),
});

/** Run the keyed-parity diagnostic; formal qualification is intentionally unavailable here. */
export async function collectM4B2KeyframeParityDiagnostic(optionsValue, dependencies = {}) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['outputDirectory'],
		'collector options',
	);
	const outputDirectory = boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory');
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const runBrowser = dependencies.runBrowser ?? runBrowserDiagnostic;
	const { stdout, stderr } = await runBrowser();
	const diagnostic = parseM4B2KeyframeParityDiagnostic(`${stdout}\n${stderr}`);
	const result = createPendingM4B2KeyframeParityResult(diagnostic, config);
	const writeResult = dependencies.writeResult ?? writePendingResult;
	return writeResult(outputDirectory, result);
}

/** Admit exactly one complete marked diagnostic with the frozen keyed identity. */
export function parseM4B2KeyframeParityDiagnostic(output) {
	if (typeof output !== 'string') throw new TypeError('Browser diagnostic output must be a string.');
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		if (!line.startsWith(MARKER)) continue;
		const payload = line.slice(MARKER.length);
		if (!payload.length || payload.trim() !== payload) {
			throw new Error('M4B2 keyed browser diagnostic marker has a malformed payload.');
		}
		let candidate;
		try { candidate = JSON.parse(payload); } catch (error) {
			throw new Error('M4B2 keyed browser diagnostic marker has malformed JSON.', { cause: error });
		}
		if (!isRecord(candidate) || candidate.workloadId !== WORKLOAD_ID
			|| candidate.fixtureId !== FIXTURE_ID || candidate.profile !== PROFILE) {
			throw new Error('Marked M4B2 keyed diagnostic does not match the frozen identity.');
		}
		matches.push(candidate);
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one ${WORKLOAD_ID} browser diagnostic; received ${matches.length}.`);
	}
	return matches[0];
}

/** Recompute every local-admission metric from complete frames and exact consumer ledgers. */
export function createPendingM4B2KeyframeParityResult(input, inputConfig) {
	const diagnostic = exactRecord(snapshotStrictJsonData(input, 'diagnostic'), [
		'cases', 'environmentFingerprint', 'environmentId', 'fixture', 'fixtureId',
		'observationClass', 'profile', 'rendererClass', 'schemaVersion', 'sourceBase64', 'workloadId',
	], 'diagnostic');
	assertIdentity(diagnostic);
	if (!deepEqualJson(diagnostic.fixture, FIXTURE)) {
		throw new Error('Browser diagnostic fixture does not match the frozen M4B2 keyed fixture.');
	}
	const source = decodeM4B2KeyframeParitySourceRgba(
		diagnostic.sourceBase64, FIXTURE.width, FIXTURE.height, FIXTURE.frameCount,
		'M4B2 keyed source fixture',
	);
	if (sha256(source) !== SOURCE_SHA256) throw new Error('M4B2 keyed source fixture digest is invalid.');
	const cases = exactArray(diagnostic.cases, CASE_DEFINITIONS.length, 'diagnostic.cases');
	let minimumSsim = 1;
	let maximumChannelMae = 0;
	let omittedOperations = 0;
	let substitutedOperations = 0;
	let fallbackOperations = 0;
	let renderedConsumerOperations = 0;
	for (const [caseIndex, caseValue] of cases.entries()) {
		const definition = CASE_DEFINITIONS[caseIndex];
		const path = `diagnostic.cases[${String(caseIndex)}]`;
		const candidate = exactRecord(caseValue, [
			'clipId', 'curveKind', 'id', 'presentationClass', 'presentationIdentity', 'queries', 'targetId',
		], path);
		if (candidate.id !== definition.id || candidate.curveKind !== definition.curveKind
			|| candidate.targetId !== definition.targetId || candidate.clipId !== definition.evidenceClipId
			|| candidate.presentationClass !== definition.presentationClass
			|| candidate.presentationIdentity !== `sha256:${SOURCE_SHA256}`) {
			throw new Error(`${path} does not match the frozen keyed case inventory.`);
		}
		const queries = exactArray(candidate.queries, QUERY_DEFINITIONS.length, `${path}.queries`);
		for (const [queryIndex, queryValue] of queries.entries()) {
			const expectedQuery = definition.queries[queryIndex];
			const queryPath = `${path}.queries[${String(queryIndex)}]`;
			const query = exactRecord(queryValue, [
				'frameIndex', 'id', 'offline', 'offlineBase64', 'offlinePresentation',
				'position', 'preview', 'previewBase64', 'previewPresentation',
			], queryPath);
			if (query.id !== expectedQuery.id || query.frameIndex !== expectedQuery.frameIndex
				|| !deepEqualJson(query.position, expectedQuery.position)) {
				throw new Error(`${queryPath} does not match its exact query inventory.`);
			}
			assertPresentation(
				query.previewPresentation, expectedQuery.expectedPresentation,
				`${queryPath}.previewPresentation`,
			);
			assertPresentation(
				query.offlinePresentation, expectedQuery.expectedPresentation,
				`${queryPath}.offlinePresentation`,
			);
			const preview = decodeM4B2KeyframeParityRgba(
				query.previewBase64, FIXTURE.width, FIXTURE.height, `${queryPath} preview`,
			);
			const offline = decodeM4B2KeyframeParityRgba(
				query.offlineBase64, FIXTURE.width, FIXTURE.height, `${queryPath} offline`,
			);
			const expected = createM4B2KeyframeParityExpectedRgba(
				source, expectedQuery.expectedPresentation.drawableSourceFrame,
				expectedQuery.expectedValue, FIXTURE.width, FIXTURE.height,
			);
			for (const [left, right] of [
				[preview, offline], [preview, expected], [offline, expected],
			]) {
				const metrics = compareM4B2KeyframeParityVideo(
					left, right, FIXTURE.width, FIXTURE.height,
				);
				minimumSsim = Math.min(minimumSsim, metrics.ssim);
				maximumChannelMae = Math.max(maximumChannelMae, metrics.maximumChannelMae);
			}
			const operationId = `${definition.id}/${expectedQuery.id}/${definition.targetId}`;
			const clipId = definition.evidenceClipId;
			for (const [consumerName, ledgerValue] of [
				['preview', query.preview], ['offline', query.offline],
			]) {
				const ledger = validateM4B2KeyframeConsumerLedger(
					ledgerValue, { operationId, clipId }, `${queryPath}.${consumerName}`,
				);
				if (ledger.outcome === 'rendered') {
					assertExpectedValue(ledger.stateValue, expectedQuery.expectedValue, queryPath);
					renderedConsumerOperations += 1;
				}
				omittedOperations += ledger.counts.omitted;
				substitutedOperations += ledger.counts.substituted;
				fallbackOperations += ledger.counts.fallback;
			}
		}
	}
	const metrics = Object.freeze({
		'keyframes.videoMinimumSsim': minimumSsim,
		'keyframes.videoMaximumChannelMae': maximumChannelMae,
		'keyframes.omittedOperations': omittedOperations,
		'keyframes.substitutedOperations': substitutedOperations,
		'keyframes.fallbackOperations': fallbackOperations,
	});
	const thresholds = inputConfig === null || inputConfig === undefined
		? DEFAULT_THRESHOLDS
		: exactDescriptor(inputConfig.workloads, WORKLOAD_ID, 'workload').thresholds;
	const verdicts = metricVerdicts(metrics, thresholds);
	const failures = verdicts.filter(({ passed }) => !passed)
		.map(({ metricId }) => `${metricId} did not pass.`);
	const metricGatePassed = verdicts.length === DEFAULT_THRESHOLDS.length
		&& verdicts.every(({ passed }) => passed);
	const fingerprint = requireRecord(diagnostic.environmentFingerprint, 'environmentFingerprint');
	if (Object.keys(fingerprint).length === 0) throw new Error('Environment fingerprint must not be empty.');
	return Object.freeze({
		schemaVersion: 1,
		status: metricGatePassed ? 'pending-external' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: diagnostic.environmentId,
		profile: PROFILE,
		observationClass: OBSERVATION_CLASS,
		attemptCount: 1,
		retryCount: 0,
		rendererClass: diagnostic.rendererClass,
		environmentFingerprint: Object.freeze(fingerprint),
		fixture: FIXTURE,
		metrics,
		rawSampleCounts: Object.freeze({
			cases: CASE_DEFINITIONS.length,
			queries: CASE_DEFINITIONS.length * QUERY_DEFINITIONS.length,
			videoPixels: CASE_DEFINITIONS.length * QUERY_DEFINITIONS.length * FIXTURE.width * FIXTURE.height,
			requestedOperations: CASE_DEFINITIONS.length * QUERY_DEFINITIONS.length,
			requestedConsumerOperations: CASE_DEFINITIONS.length * QUERY_DEFINITIONS.length * 2,
			renderedConsumerOperations,
		}),
		metricGatePassed,
		qualificationEvidencePublished: false,
		evaluation: Object.freeze({
			passed: false,
			failures: Object.freeze([
				...failures,
				'Formal qualification is published only by the nightly packaged-runtime verifier on the owner-designated host.',
			]),
			verdicts: Object.freeze(verdicts),
		}),
	});
}

export function parseM4B2KeyframeParityCliOptions(argsValue) {
	const args = snapshotStrictJsonData(argsValue, 'M4B2 collector CLI arguments');
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M4B2 collector CLI arguments must be strings.');
	}
	let outputDirectory = null;
	for (const argument of args) {
		if (argument.startsWith('-')) throw new Error(`Unknown M4B2 collector option ${argument}.`);
		if (outputDirectory !== null) throw new Error('M4B2 collector accepts one output directory.');
		outputDirectory = argument;
	}
	return Object.freeze({ outputDirectory });
}

async function runBrowserDiagnostic() {
	await execFileAsync('npm', ['run', 'build'], {
		cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
	});
	return execFileAsync('npm', [
		'run', 'test:browser:built', '--', BROWSER_SPEC,
		'--project=chromium', '--workers=1', '--retries=0',
	], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, SOUNDSCAPER_M4B2_KEYFRAME_PARITY: '1' },
	});
}

async function writePendingResult(outputDirectory, result) {
	await mkdir(outputDirectory, { recursive: true });
	const resultPath = join(outputDirectory, `${WORKLOAD_ID}.${result.status}.json`);
	await writeFile(resultPath, `${JSON.stringify(result, null, '\t')}\n`, { flag: 'wx' });
	return Object.freeze({ resultPath, result });
}

function assertIdentity(diagnostic) {
	if (diagnostic.schemaVersion !== 1 || diagnostic.profile !== PROFILE
		|| diagnostic.observationClass !== OBSERVATION_CLASS || diagnostic.workloadId !== WORKLOAD_ID
		|| diagnostic.fixtureId !== FIXTURE_ID
		|| !isM4B2DiagnosticEnvironmentId(diagnostic.environmentId)
		|| !['hardware', 'software', 'unknown'].includes(diagnostic.rendererClass)) {
		throw new Error('Browser diagnostic identity does not match the M4B2 keyed workload.');
	}
}

function isM4B2DiagnosticEnvironmentId(value) {
	return [LOCAL_ENVIRONMENT_ID, HOSTED_ENVIRONMENT_ID].includes(value)
		|| (typeof value === 'string' && PACKAGED_RUNTIME_ENVIRONMENT_ID.test(value));
}

function metricVerdicts(metrics, thresholds) {
	if (!Array.isArray(thresholds) || thresholds.length !== DEFAULT_THRESHOLDS.length) {
		throw new Error('M4B2 keyed workload must register exactly five thresholds.');
	}
	return thresholds.map((thresholdValue) => {
		const threshold = requireRecord(thresholdValue, 'M4B2 keyed threshold');
		const actual = metrics[threshold.metricId];
		if (typeof actual !== 'number' || !Number.isFinite(actual)
			|| typeof threshold.value !== 'number' || !Number.isFinite(threshold.value)
			|| !['eq', 'gte', 'lte'].includes(threshold.comparison)) {
			throw new Error('M4B2 keyed threshold registration is invalid.');
		}
		const passed = threshold.comparison === 'eq'
			? actual === threshold.value
			: threshold.comparison === 'gte' ? actual >= threshold.value : actual <= threshold.value;
		return Object.freeze({
			metricId: threshold.metricId,
			comparison: threshold.comparison,
			expected: threshold.value,
			actual,
			passed,
		});
	});
}

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function assertExpectedValue(actual, expected, path) {
	if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-12) {
		throw new Error(`${path} rendered state does not match the exact keyed value.`);
	}
}

function caseDefinition(id, curveKind, values, evidenceClipId = `m4b2-${id}-clip`) {
	const presentations = curveKind === 'bezier' ? VFR_PRESENTATIONS : CFR_PRESENTATIONS;
	return Object.freeze({
		id, curveKind, targetId: 'composition.opacity', evidenceClipId,
		presentationClass: curveKind === 'bezier'
			? 'authenticated-vfr-materialized-occurrence'
			: 'authenticated-cfr-occurrence',
		queries: Object.freeze(QUERY_DEFINITIONS.map((query, index) => Object.freeze({
			...query, expectedValue: values[index], expectedPresentation: presentations[index],
		}))),
	});
}

function assertPresentation(value, expected, path) {
	const presentation = exactRecord(
		value, ['drawableSourceFrame', 'sourceFrame', 'sourceTime'], path,
	);
	if (!deepEqualJson(presentation, expected)) {
		throw new Error(`${path} does not match its exact presentation descriptor.`);
	}
}

function exactArray(value, length, path) {
	if (!Array.isArray(value) || value.length !== length) {
		throw new Error(`${path} must contain exactly ${String(length)} entries.`);
	}
	return value;
}

function exactRecord(value, fields, path) {
	const record = requireRecord(value, path);
	const actual = Object.keys(record).sort();
	const expected = [...fields].sort();
	if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return record;
}

function boundedString(value, minimum, maximum, path) {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must be a bounded string.`);
	}
	return value;
}

function requireRecord(value, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	return value;
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepEqualJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function main() {
	const options = parseM4B2KeyframeParityCliOptions(process.argv.slice(2));
	const outputDirectory = resolve(options.outputDirectory
		?? fileURLToPath(new URL('../test-results/quality/m4b2-keyframe-render-parity', import.meta.url)));
	const collected = await collectM4B2KeyframeParityDiagnostic({ outputDirectory });
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
