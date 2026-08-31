#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compareM4ParityAudio,
	compareM4ParityVideo,
	decodeM4ParityAudio,
	decodeM4ParityRgba,
	validateM4ParityRenderReport,
} from './lib/m4-production-parity-metrics.mjs';
import {
	M4_PARITY_HOSTED_ENVIRONMENT_ID as HOSTED_ENVIRONMENT_ID,
	M4_PARITY_WORKLOAD_ID as WORKLOAD_ID,
	assertM4ParityCollectionEnvironment,
	isM4ParityDiagnosticEnvironmentId,
	parseM4ParityCliOptions,
	resolveM4ParityCollectionEnvironment,
} from './lib/m4-production-parity-identity.mjs';
import { snapshotStrictJsonData } from './lib/strict-json-snapshot.mjs';
import { validateM4ParityVideoFixture } from './lib/m4-production-parity-video-fixture.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_ID = 'm4-production-parity-v1';
const VIDEO_FIXTURE_ID = 'video-effect-parity-rgba-v1';
const PROFILE = 'deterministic-production-parity-v1';
const DIAGNOSTIC_MARKER = 'SOUNDSCAPER_M4_PRODUCTION_PARITY ';
const BROWSER_SPEC = 'tests/browser/audio-editor-m4-production-parity.spec.js';
const LOCAL_ENVIRONMENT_ID = 'local-runtime-diagnostics';
const METRIC_IDS = Object.freeze([
	'parity.audioMaximumAbsoluteSampleError',
	'parity.pdcErrorSamples',
	'parity.videoMinimumSsim',
	'parity.videoMaximumChannelMae',
	'parity.silentlyOmittedEffects',
]);

export {
	parseM4ParityCliOptions as parseM4ProductionParityCliOptions,
	resolveM4ParityCollectionEnvironment as resolveM4ProductionParityCollectionEnvironment,
};

/** Run the single-worker/no-retry diagnostic and publish only admitted evidence. */
export async function collectM4ProductionParityDiagnostic(options, dependencies = {}) {
	const collectorOptions = snapshotStrictJsonData(options, 'collector options');
	const outputDirectory = ownString(collectorOptions, 'outputDirectory');
	const config = snapshotStrictJsonData(
		dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8')),
		'config',
	);
	const collectionEnvironment = resolveM4ParityCollectionEnvironment(
		collectorOptions,
		config,
		dependencies.processEnvironment ?? process.env,
	);
	const runBrowser = dependencies.runBrowser ?? runBrowserDiagnostic;
	const { stdout, stderr } = await runBrowser(collectionEnvironment);
	const diagnostic = parseM4ProductionParityDiagnostic(`${stdout}\n${stderr}`);
	assertM4ParityCollectionEnvironment(diagnostic, collectionEnvironment);
	const result = createPendingM4ProductionParityResult(diagnostic, config);
	const writeResult = dependencies.writeResult ?? writeM4ProductionParityResult;
	return writeResult(outputDirectory, result);
}

/** Admit one and only one complete diagnostic with the frozen identity. */
export function parseM4ProductionParityDiagnostic(output) {
	if (typeof output !== 'string') throw new TypeError('Browser diagnostic output must be a string.');
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		if (!line.startsWith(DIAGNOSTIC_MARKER)) continue;
		const payload = line.slice(DIAGNOSTIC_MARKER.length);
		if (!payload.length || payload.trim() !== payload) {
			throw new Error('M4 browser diagnostic marker has a malformed payload.');
		}
		let candidate;
		try {
			candidate = JSON.parse(payload);
		} catch (error) {
			throw new Error('M4 browser diagnostic marker has malformed JSON.', { cause: error });
		}
		if (!isRecord(candidate)
			|| candidate.profile !== PROFILE
			|| candidate.workloadId !== WORKLOAD_ID
			|| candidate.fixtureId !== FIXTURE_ID) {
			throw new Error('Marked M4 browser diagnostic does not match the frozen identity.');
		}
		matches.push(candidate);
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one ${WORKLOAD_ID} browser diagnostic; received ${matches.length}.`);
	}
	return matches[0];
}

/** Recompute the exact five metrics from complete PCM, RGBA, and work ledgers. */
export function createPendingM4ProductionParityResult(input, inputConfig) {
	const diagnostic = snapshotStrictJsonData(input, 'diagnostic');
	const config = snapshotStrictJsonData(inputConfig, 'config');
	const workload = exactDescriptor(config.workloads, WORKLOAD_ID, 'workload');
	const fixture = exactDescriptor(config.fixtures, FIXTURE_ID, 'fixture');
	const videoFixture = exactDescriptor(config.fixtures, VIDEO_FIXTURE_ID, 'fixture');
	const policy = requireRecord(config.measurementPolicy, 'measurementPolicy');
	assertIdentity(diagnostic);
	assertMeasurementPolicy(policy);
	assertWorkloadRegistration(workload);
	const expectedFixture = expectedFixtureContract(fixture);
	if (!deepEqualJson(diagnostic.fixture, expectedFixture)) {
		throw new Error('Browser diagnostic fixture does not match the frozen M4 fixture.');
	}

	const audio = exactRecord(
		diagnostic.audio,
		['exportBase64', 'previewBase64', 'referenceBase64'],
		'diagnostic.audio',
	);
	const previewAudio = decodeM4ParityAudio(audio.previewBase64, expectedFixture, 'Preview');
	const exportAudio = decodeM4ParityAudio(audio.exportBase64, expectedFixture, 'Export');
	const referenceAudio = decodeM4ParityAudio(audio.referenceBase64, expectedFixture, 'Reference');
	const referenceArtifact = exactArtifact(fixture.artifacts, 'audio-reference-interleaved-f32le');
	if (referenceArtifact.byteLength !== referenceAudio.bytes.byteLength
		|| referenceArtifact.sha256 !== sha256(referenceAudio.bytes)) {
		throw new Error('Reference audio evidence does not match its fixture digest.');
	}
	const previewAudioMetrics = compareM4ParityAudio(
		previewAudio.channels,
		referenceAudio.channels,
		expectedFixture,
	);
	const exportAudioMetrics = compareM4ParityAudio(
		exportAudio.channels,
		referenceAudio.channels,
		expectedFixture,
	);

	const registeredVideoFixture = validateM4ParityVideoFixture(
		videoFixture,
		expectedFixture.videoWidth,
		expectedFixture.videoHeight,
	);
	const videoCases = boundedArray(
		diagnostic.videoCases,
		registeredVideoFixture.cases.length,
		registeredVideoFixture.cases.length,
		'diagnostic.videoCases',
	);
	const caseNames = new Set();
	const requestedEffectIds = new Set();
	const requestedCompositionIds = new Set();
	const unrenderedOperationIds = new Set();
	let minimumSsim = 1;
	let maximumChannelMae = 0;
	let videoPixels = 0;
	for (const [index, value] of videoCases.entries()) {
		const path = `diagnostic.videoCases[${index}]`;
		const videoCase = exactRecord(value, [
			'exportBase64', 'fixtureArtifactId', 'fixtureBase64', 'height', 'name',
			'previewBase64', 'renderReport', 'width',
		], path);
		const name = boundedString(videoCase.name, 1, 160, `${path}.name`);
		const registeredCase = registeredVideoFixture.cases[index];
		if (name !== registeredCase.name
			|| videoCase.fixtureArtifactId !== registeredCase.fixtureArtifactId) {
			throw new Error(`${path} does not match the frozen M4 video case inventory.`);
		}
		if (caseNames.has(name)) throw new Error(`Duplicate M4 video parity case ${name}.`);
		caseNames.add(name);
		if (videoCase.width !== expectedFixture.videoWidth
			|| videoCase.height !== expectedFixture.videoHeight) {
			throw new Error(`${path} does not use the frozen video geometry.`);
		}
		const byteLength = videoCase.width * videoCase.height * 4;
		const fixtureBytes = decodeM4ParityRgba(
			videoCase.fixtureBase64,
			byteLength,
			`${path} fixture`,
		);
		const registeredArtifact = registeredVideoFixture.artifacts.get(videoCase.fixtureArtifactId);
		if (!registeredArtifact
			|| registeredArtifact.byteLength !== fixtureBytes.byteLength
			|| registeredArtifact.sha256 !== sha256(fixtureBytes)) {
			throw new Error(`${path} fixture bytes do not match the registered RGBA golden.`);
		}
		const preview = decodeM4ParityRgba(videoCase.previewBase64, byteLength, `${path} preview`);
		const exported = decodeM4ParityRgba(videoCase.exportBase64, byteLength, `${path} export`);
		const metrics = compareM4ParityVideo(preview, exported, videoCase.width, videoCase.height);
		minimumSsim = Math.min(minimumSsim, metrics.ssim);
		maximumChannelMae = Math.max(maximumChannelMae, metrics.maximumChannelMae);
		videoPixels += videoCase.width * videoCase.height;
		const report = validateM4ParityRenderReport(videoCase.renderReport, `${path}.renderReport`);
		for (const id of report.requestedEffects) {
			if (requestedEffectIds.has(id)) {
				throw new Error(`Effect instance ${id} is requested by more than one M4 parity case.`);
			}
			requestedEffectIds.add(id);
		}
		for (const id of report.requestedCompositions) {
			if (requestedCompositionIds.has(id)) {
				throw new Error(`Composition instance ${id} is requested by more than one M4 parity case.`);
			}
			requestedCompositionIds.add(id);
		}
		for (const id of report.unrendered) unrenderedOperationIds.add(id);
	}

	const metrics = Object.freeze({
		'parity.audioMaximumAbsoluteSampleError': Math.max(
			previewAudioMetrics.maximumAbsoluteSampleError,
			exportAudioMetrics.maximumAbsoluteSampleError,
		),
		'parity.pdcErrorSamples': Math.max(
			previewAudioMetrics.pdcErrorSamples,
			exportAudioMetrics.pdcErrorSamples,
		),
		'parity.videoMinimumSsim': minimumSsim,
		'parity.videoMaximumChannelMae': maximumChannelMae,
		'parity.silentlyOmittedEffects': unrenderedOperationIds.size,
	});
	const rendererClass = diagnostic.rendererClass;
	if (!['hardware', 'software', 'unknown'].includes(rendererClass)) {
		throw new Error('Browser diagnostic rendererClass must be hardware, software, or unknown.');
	}
	const environmentFingerprint = requireRecord(
		diagnostic.environmentFingerprint,
		'diagnostic.environmentFingerprint',
	);
	if (Object.keys(environmentFingerprint).length === 0) {
		throw new Error('Browser diagnostic environmentFingerprint must not be empty.');
	}
	const verdicts = metricVerdicts(metrics, workload.thresholds);
	const failures = verdicts.filter(({ passed }) => !passed)
		.map(({ metricId }) => `${metricId} did not pass.`);
	const metricGatePassed = verdicts.length === METRIC_IDS.length
		&& verdicts.every(({ passed }) => passed);
	return Object.freeze({
		schemaVersion: 1,
		status: metricGatePassed ? 'passed' : 'failed',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: diagnostic.environmentId,
		profile: PROFILE,
		observationClass: diagnostic.observationClass,
		attemptCount: 1,
		retryCount: policy.benchmarkRetries,
		rendererClass,
		environmentFingerprint: Object.freeze(environmentFingerprint),
		fixture: Object.freeze(expectedFixture),
		metrics,
		rawSampleCounts: Object.freeze({
			audioChannels: expectedFixture.channelCount,
			audioFrames: expectedFixture.frameCount,
			videoCases: videoCases.length,
			videoPixels,
			requestedEffectInstances: requestedEffectIds.size,
			requestedCompositionInstances: requestedCompositionIds.size,
		}),
		metricGatePassed,
		evaluation: Object.freeze({
			passed: metricGatePassed,
			failures: Object.freeze(failures),
			verdicts: Object.freeze(verdicts),
		}),
	});
}

/** Persist diagnostic results with exclusive-create semantics. */
export function writeM4ProductionParityResult(outputDirectory, result) {
	const resultSnapshot = snapshotStrictJsonData(result, 'result');
	if (!['passed', 'failed'].includes(resultSnapshot.status)) {
		throw new Error('The M4 collector can write only passed or failed diagnostics.');
	}
	return writePendingResult(outputDirectory, resultSnapshot);
}

async function runBrowserDiagnostic(collectionEnvironment) {
	await execFileAsync('npm', ['run', 'build'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	const collectionVariables = {
		SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: collectionEnvironment.environmentId,
	};
	return execFileAsync('npm', [
		'run', 'test:browser:built', '--', BROWSER_SPEC,
		'--project=chromium', '--workers=1', '--retries=0',
	], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: {
			...process.env,
			...collectionVariables,
			AUDIO_EDITOR_FFMPEG_BROWSER: '1',
			SOUNDSCAPER_M4_PRODUCTION_PARITY: '1',
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
	return snapshotStrictJsonData({
		generatorRevision: specification.generatorRevision,
		seed: specification.seed,
		sampleRate: specification.sampleRate,
		frameCount: specification.frameCount,
		channelCount: specification.channelCount,
		pdcLatencyFrames: specification.pdcLatencyFrames,
		automationChangeFrame: specification.automationChangeFrame,
		inputImpulseFrames: specification.inputImpulseFrames,
		outputImpulseFrames: specification.outputImpulseFrames,
		inputChannelSha256: specification.inputChannelSha256,
		referenceChannelSha256: specification.referenceChannelSha256,
		videoFixtureId: specification.videoFixtureId,
		videoWidth: specification.videoWidth,
		videoHeight: specification.videoHeight,
	}, 'expectedFixture');
}

function assertIdentity(diagnostic) {
	if (diagnostic.schemaVersion !== 1
		|| diagnostic.profile !== PROFILE
		|| diagnostic.observationClass !== 'complete-pcm-rgba-render-ledger-v1'
		|| diagnostic.workloadId !== WORKLOAD_ID
		|| diagnostic.fixtureId !== FIXTURE_ID
		|| !isM4DiagnosticEnvironmentId(diagnostic.environmentId)) {
		throw new Error('Browser diagnostic identity does not match the frozen M4 workload.');
	}
}

function isM4DiagnosticEnvironmentId(value) {
	return isM4ParityDiagnosticEnvironmentId(value);
}

function assertMeasurementPolicy(policy) {
	if (policy.benchmarkRetries !== 0 || policy.timingWorkers !== 1) {
		throw new Error('M4 parity collection requires the frozen one-worker/no-retry policy.');
	}
}

function assertWorkloadRegistration(workload) {
	const thresholdIds = Array.isArray(workload.thresholds)
		? workload.thresholds.map((threshold) => threshold?.metricId)
		: [];
	if (!deepEqualJson(workload.fixtureIds, [VIDEO_FIXTURE_ID, FIXTURE_ID])
		|| !Array.isArray(workload.environmentIds)
		|| !workload.environmentIds.includes(HOSTED_ENVIRONMENT_ID)
		|| !workload.environmentIds.includes(LOCAL_ENVIRONMENT_ID)
		|| !deepEqualJson(thresholdIds, METRIC_IDS)) {
		throw new Error(`Workload ${WORKLOAD_ID} does not own the frozen fixtures, environments, and five metrics.`);
	}
}

function metricVerdicts(metrics, thresholds) {
	if (!Array.isArray(thresholds) || thresholds.length !== METRIC_IDS.length) {
		throw new Error('M4 production parity workload must register exactly five thresholds.');
	}
	return thresholds.map((thresholdValue) => {
		const threshold = requireRecord(thresholdValue, 'M4 production parity threshold');
		const actual = metrics[threshold.metricId];
		if (typeof actual !== 'number' || !Number.isFinite(actual)
			|| typeof threshold.value !== 'number' || !Number.isFinite(threshold.value)
			|| !['eq', 'gte', 'lte'].includes(threshold.comparison)) {
			throw new Error('M4 production parity threshold registration is invalid.');
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

function exactArtifact(collection, id) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`M4 fixture must contain exact artifact ${id}.`);
	return matches[0];
}

function exactDescriptor(collection, id, label) {
	const matches = Array.isArray(collection)
		? collection.filter((value) => isRecord(value) && value.id === id)
		: [];
	if (matches.length !== 1) throw new Error(`Quality config must contain exactly one ${label} ${id}.`);
	return matches[0];
}

function boundedArray(value, minimum, maximum, path) {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must contain ${minimum} through ${maximum} entries.`);
	}
	return value;
}

function boundedString(value, minimum, maximum, path) {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must be a bounded string.`);
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

function ownString(value, property) {
	const record = requireRecord(value, 'collector options');
	return boundedString(record[property], 1, 4_096, `collector option ${property}`);
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

function deepEqualJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
	const cli = parseM4ParityCliOptions(process.argv.slice(2), process.env);
	const outputDirectory = resolve(cli.outputDirectory
		?? fileURLToPath(new URL('../test-results/quality/m4-production-render-parity', import.meta.url)));
	const collected = await collectM4ProductionParityDiagnostic({
		outputDirectory,
	});
	process.stdout.write(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
