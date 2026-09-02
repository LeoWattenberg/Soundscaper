/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	nonNegativeInteger,
	positiveInteger,
} from './measurement-validation.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

export const M7_ASSISTANCE_PRIVACY_WORKLOAD_ID = 'm7-local-assistance-privacy';
export const M7_ASSISTANCE_PRIVACY_FIXTURE_ID = 'm7-local-assistance-privacy-v1';
export const M7_ASSISTANCE_PRIVACY_ENVIRONMENT_ID = 'native-os-diagnostics';
export const M7_ASSISTANCE_PRIVACY_PROFILE = 'packaged-local-assistance-privacy-v1';
export const M7_ASSISTANCE_PRIVACY_OBSERVATION_CLASS =
	'post-install-network-media-and-canonical-custody-v1';

export const M7_ASSISTANCE_PRIVACY_METRIC_IDS = Object.freeze([
	'assistance.networkRequestsAfterInstall',
	'assistance.unselectedMediaBytesRead',
	'assistance.acceptedDigestMismatches',
	'assistance.cancellationP95Ms',
	'assistance.canonicalStateLosses',
]);

const WORKFLOW_IDS = Object.freeze([
	'transcribe-captions', 'clean-filler-silence', 'identify-speakers', 'enhance-dialogue',
	'reduce-reverb', 'separate-dialogue-music-effects', 'mark-reactions', 'index-transcript',
	'detect-beats-tempo', 'mark-cuts', 'index-video', 'reframe', 'make-highlights',
	'generate-editorial-text',
	'advanced:voice-activity-detection', 'advanced:speech-recognition',
	'advanced:word-alignment', 'advanced:speaker-diarization',
	'advanced:speech-enhancement', 'advanced:dereverberation',
	'advanced:source-separation', 'advanced:audio-tagging',
	'advanced:beat-tracking', 'advanced:text-embedding', 'advanced:image-text-embedding',
	'advanced:optical-character-recognition', 'advanced:shot-detection',
	'advanced:subject-detection', 'advanced:saliency-detection',
	'advanced:editorial-generation',
]);
const MODEL_TASKS = Object.freeze([
	'voice-activity-detection', 'speech-recognition', 'word-alignment', 'speaker-segmentation',
	'speaker-embedding', 'speech-enhancement', 'dereverberation', 'source-separation', 'audio-tagging',
	'beat-tracking', 'face-detection', 'object-detection', 'saliency-detection',
	'optical-character-recognition', 'image-text-embedding', 'text-embedding',
	'shot-detection', 'editorial-generation',
]);
const RUNTIME_FAMILIES = Object.freeze([
	'sherpa-onnx', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'external-ffmpeg',
]);
const TARGETS = Object.freeze({
	'darwin-arm64': Object.freeze({ operatingSystem: 'darwin', architecture: 'arm64' }),
	'linux-arm64': Object.freeze({ operatingSystem: 'linux', architecture: 'arm64' }),
	'linux-x64': Object.freeze({ operatingSystem: 'linux', architecture: 'x64' }),
	'win32-arm64': Object.freeze({ operatingSystem: 'win32', architecture: 'arm64' }),
	'win32-x64': Object.freeze({ operatingSystem: 'win32', architecture: 'x64' }),
});
const OBSERVATION_MODES = Object.freeze(['local-development', 'packaged']);
const RENDERER_CLASSES = Object.freeze(['hardware', 'software', 'unknown']);
const OS_NETWORK_BLOCKS = Object.freeze(['enforced', 'not-available']);
const NETWORK_MECHANISMS = Object.freeze([
	'electron-net-log-and-os-counter-v1', 'packaged-process-network-audit-v1',
]);
const NETWORK_METHODS = Object.freeze([
	'CONNECT', 'DELETE', 'GET', 'HEAD', 'NONE', 'OPTIONS', 'PATCH', 'POST', 'PUT',
]);
const NETWORK_TRANSPORTS = Object.freeze(['http', 'https', 'websocket', 'tcp', 'udp', 'dns', 'other']);
const CANONICAL_SCENARIOS = Object.freeze([
	'accept-undo-reopen', 'cancel-no-mutation', 'reject-no-mutation', 'export-unaffected',
]);

const MEASUREMENT_FIELDS = Object.freeze([
	'artifactAuthority', 'budgetSha256', 'observationMode', 'fixtureId', 'mediaAssets',
	'observationClass', 'observedEnvironment', 'observedEnvironmentId', 'package', 'profile',
	'diagnosticEnvironmentId', 'runs', 'schemaVersion', 'sourceRevision', 'warmupRuns',
	'workloadId',
]);
const OBSERVED_ENVIRONMENT_FIELDS = Object.freeze([
	'architecture', 'operatingSystem', 'platformTarget', 'rendererClass', 'runtimeVersion',
]);
const PACKAGE_FIELDS = Object.freeze([
	'byteLength', 'identity', 'manifestSha256', 'manifestVerified', 'sha256', 'sourceRevision', 'target',
]);
const AUTHORITY_FIELDS = Object.freeze([
	'catalogSha256', 'catalogSignatureSha256', 'catalogSignatureVerified',
	'modelArtifacts', 'runtimeArtifacts',
]);
const MODEL_FIELDS = Object.freeze([
	'artifactRole', 'byteLength', 'modelId', 'sha256', 'task', 'version',
]);
const RUNTIME_FIELDS = Object.freeze([
	'artifactId', 'byteLength', 'familyId', 'sha256', 'target', 'version',
]);
const MEDIA_ASSET_FIELDS = Object.freeze(['assetId', 'byteLength', 'selected', 'sha256']);
const RUN_FIELDS = Object.freeze([
	'acceptedOutputs', 'attemptCount', 'cancellationSamplesMs', 'canonicalChecks',
	'catalogSha256', 'freshProcess', 'mediaReads', 'networkObservation', 'packageSha256',
	'processId', 'retried', 'runIndex', 'workflowFenceSha256', 'workflowId',
]);
const NETWORK_OBSERVATION_FIELDS = Object.freeze([
	'endedAfterWorkflow', 'mechanism', 'modelsInstalledBeforeObservation', 'osNetworkBlock',
	'packageInstalledBeforeObservation', 'requests', 'startedBeforeWorkflow',
]);
const NETWORK_REQUEST_FIELDS = Object.freeze([
	'destinationSha256', 'method', 'requestId', 'transport',
]);
const MEDIA_READ_FIELDS = Object.freeze(['assetId', 'byteLength', 'bytesRead', 'opened', 'sha256']);
const ACCEPTED_OUTPUT_FIELDS = Object.freeze(['expectedSha256', 'observedSha256', 'outputId']);
const CANONICAL_CHECK_FIELDS = Object.freeze([
	'checkId', 'expectedSha256', 'observedSha256', 'scenario',
]);
const EXPECTATION_FIELDS = Object.freeze([
	'budgetSha256', 'fixtureSpecification', 'measurementPolicy',
]);
const FIXTURE_FIELDS = Object.freeze(['selectedMediaAssetCount', 'unselectedMediaAssetCount']);
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const SOURCE_REVISION_PATTERN = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const MAXIMUM_LEDGER_ENTRIES = 65_536;
const MAXIMUM_ARTIFACTS = 64;
const MAXIMUM_CANCELLATION_SAMPLES = 4_096;
const MAXIMUM_CANCELLATION_MS = 600_000;

/** Re-derive the exact five registered metrics from a closed raw diagnostic record. */
export function computeM7AssistancePrivacyMetrics(measurementValue, expectationValue) {
	const validated = validateM7AssistancePrivacyMeasurement(measurementValue, expectationValue);
	let networkRequests = 0;
	let unselectedMediaBytesRead = 0;
	let acceptedDigestMismatches = 0;
	let canonicalStateLosses = 0;
	let mediaReadObservations = 0;
	let unselectedMediaReadObservations = 0;
	let acceptedOutputs = 0;
	let canonicalChecks = 0;
	const cancellationSamples = [];
	const selectedById = new Map(validated.mediaAssets.map((asset) => [asset.assetId, asset.selected]));

	for (const run of [...validated.warmupRuns, ...validated.runs]) {
		networkRequests = addSafe(networkRequests, run.networkObservation.requests.length, 'network requests');
		for (const read of run.mediaReads) {
			mediaReadObservations += 1;
			if (selectedById.get(read.assetId) === false) {
				unselectedMediaReadObservations += 1;
				unselectedMediaBytesRead = addSafe(
					unselectedMediaBytesRead,
					read.bytesRead,
					'unselected media bytes',
				);
			}
		}
		for (const output of run.acceptedOutputs) {
			acceptedOutputs += 1;
			if (output.expectedSha256 !== output.observedSha256) acceptedDigestMismatches += 1;
		}
		for (const check of run.canonicalChecks) {
			canonicalChecks += 1;
			if (check.expectedSha256 !== check.observedSha256) canonicalStateLosses += 1;
		}
	}
	for (const run of validated.runs) cancellationSamples.push(...run.cancellationSamplesMs);

	return deepFreeze({
		budgetSha256: validated.budgetSha256,
		canonicalMeasurementSha256: canonicalMeasurementSha256(validated),
		observationMode: validated.observationMode,
		observedEnvironment: validated.observedEnvironment,
		observedEnvironmentId: validated.observedEnvironmentId,
		package: validated.package,
		sourceRevision: validated.sourceRevision,
		metrics: {
			'assistance.networkRequestsAfterInstall': networkRequests,
			'assistance.unselectedMediaBytesRead': unselectedMediaBytesRead,
			'assistance.acceptedDigestMismatches': acceptedDigestMismatches,
			'assistance.cancellationP95Ms': nearestRank(cancellationSamples, 0.95),
			'assistance.canonicalStateLosses': canonicalStateLosses,
		},
		rawSampleCounts: {
			warmupRuns: validated.warmupRuns.length,
			timedRuns: validated.runs.length,
			selectedMediaAssets: validated.mediaAssets.filter(({ selected }) => selected).length,
			unselectedMediaAssets: validated.mediaAssets.filter(({ selected }) => !selected).length,
			networkRequests,
			mediaReadObservations,
			unselectedMediaReadObservations,
			acceptedOutputs,
			canonicalChecks,
			cancellationSamples: cancellationSamples.length,
		},
	});
}

/** Admit one identity-bound, no-retry warm-up plus five fresh timed runs. */
export function validateM7AssistancePrivacyMeasurement(measurementValue, expectationValue) {
	const expectation = exactRecord(
		snapshotStrictJsonData(expectationValue, 'M7 assistance expectation'),
		EXPECTATION_FIELDS,
		'M7 assistance expectation',
	);
	const fixture = validateFixture(expectation.fixtureSpecification);
	const policy = validatePolicy(expectation.measurementPolicy);
	const expectedBudgetSha256 = sha256(expectation.budgetSha256, 'M7 expectation budgetSha256');
	const measurement = exactRecord(
		snapshotStrictJsonData(measurementValue, 'M7 assistance measurement'),
		MEASUREMENT_FIELDS,
		'M7 assistance measurement',
	);
	validateMeasurementIdentity(measurement, expectedBudgetSha256);
	const observedEnvironment = validateObservedEnvironment(measurement.observedEnvironment);
	const observationMode = oneOf(
		measurement.observationMode,
		OBSERVATION_MODES,
		'M7 measurement observationMode',
	);
	const packageIdentity = validatePackage(
		measurement.package, observedEnvironment.platformTarget, measurement.sourceRevision,
	);
	const artifactAuthority = validateArtifactAuthority(
		measurement.artifactAuthority, observedEnvironment.platformTarget,
	);
	const mediaAssets = validateMediaAssets(measurement.mediaAssets, fixture);
	const processIds = new Set();
	const requestIds = new Set();
	const outputIds = new Set();
	const checkIds = new Set();
	const warmupRuns = exactArray(
		measurement.warmupRuns,
		policy.timingWarmupTrials,
		`M7 measurement.warmupRuns must contain exactly ${policy.timingWarmupTrials} warm-up run`,
	).map((run, index) => validateRun(run, index, mediaAssets, packageIdentity,
		artifactAuthority, processIds, requestIds, outputIds, checkIds,
		`M7 measurement.warmupRuns[${index}]`));
	const runs = exactArray(
		measurement.runs,
		policy.timingTrials,
		`M7 measurement.runs must contain exactly ${policy.timingTrials} timed runs`,
	).map((run, index) => validateRun(run, index, mediaAssets, packageIdentity,
		artifactAuthority, processIds, requestIds, outputIds, checkIds,
		`M7 measurement.runs[${index}]`));
	if (outputIds.size === 0) {
		throw new Error('M7 measurement must observe at least one accepted output digest.');
	}
	return deepFreeze({
		...measurement,
		artifactAuthority,
		observationMode,
		mediaAssets,
		observedEnvironment,
		package: packageIdentity,
		runs,
		warmupRuns,
	});
}

/** Stable digest used to bind an aggregate result to its complete raw record. */
export function canonicalMeasurementSha256(value) {
	const snapshot = snapshotStrictJsonData(value, 'M7 canonical measurement');
	return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

function validateMeasurementIdentity(measurement, expectedBudgetSha256) {
	if (measurement.schemaVersion !== 1
		|| measurement.profile !== M7_ASSISTANCE_PRIVACY_PROFILE
		|| measurement.observationClass !== M7_ASSISTANCE_PRIVACY_OBSERVATION_CLASS
		|| measurement.workloadId !== M7_ASSISTANCE_PRIVACY_WORKLOAD_ID
		|| measurement.fixtureId !== M7_ASSISTANCE_PRIVACY_FIXTURE_ID
		|| measurement.diagnosticEnvironmentId !== M7_ASSISTANCE_PRIVACY_ENVIRONMENT_ID) {
		throw new Error('M7 measurement identity does not match the frozen assistance privacy workload.');
	}
	if (sha256(measurement.budgetSha256, 'M7 measurement budgetSha256') !== expectedBudgetSha256) {
		throw new Error('M7 measurement budget digest does not match the exact quality budget.');
	}
	if (typeof measurement.sourceRevision !== 'string'
		|| !SOURCE_REVISION_PATTERN.test(measurement.sourceRevision)) {
		throw new Error('M7 measurement sourceRevision must be one lowercase Git revision.');
	}
	boundedString(measurement.observedEnvironmentId, 1, 256, 'M7 measurement observedEnvironmentId');
}

function validateObservedEnvironment(value) {
	const observed = exactRecord(value, OBSERVED_ENVIRONMENT_FIELDS, 'M7 observedEnvironment');
	const platformTarget = oneOf(observed.platformTarget, Object.keys(TARGETS), 'M7 platformTarget');
	const target = TARGETS[platformTarget];
	if (observed.operatingSystem !== target.operatingSystem
		|| observed.architecture !== target.architecture) {
		throw new Error('M7 observed environment does not match its platform target.');
	}
	oneOf(observed.rendererClass, RENDERER_CLASSES, 'M7 observed rendererClass');
	boundedString(observed.runtimeVersion, 1, 256, 'M7 observed runtimeVersion');
	return Object.freeze(observed);
}

function validatePackage(value, platformTarget, sourceRevision) {
	const packageIdentity = exactRecord(value, PACKAGE_FIELDS, 'M7 package');
	boundedString(packageIdentity.identity, 1, 1_024, 'M7 package.identity');
	positiveInteger(packageIdentity.byteLength, 'M7 package.byteLength');
	sha256(packageIdentity.sha256, 'M7 package.sha256');
	sha256(packageIdentity.manifestSha256, 'M7 package.manifestSha256');
	if (packageIdentity.manifestVerified !== true) {
		throw new Error('M7 package manifest must be authenticated before measurement.');
	}
	if (packageIdentity.sourceRevision !== sourceRevision) {
		throw new Error('M7 package source revision is detached from the measurement revision.');
	}
	if (packageIdentity.target !== platformTarget) {
		throw new Error('M7 package target does not match the observed platform target.');
	}
	return Object.freeze(packageIdentity);
}

function validateArtifactAuthority(value, platformTarget) {
	const authority = exactRecord(value, AUTHORITY_FIELDS, 'M7 artifactAuthority');
	sha256(authority.catalogSha256, 'M7 artifactAuthority.catalogSha256');
	sha256(authority.catalogSignatureSha256, 'M7 artifactAuthority.catalogSignatureSha256');
	if (authority.catalogSignatureVerified !== true) {
		throw new Error('M7 model catalog signature must be authenticated before measurement.');
	}
	const modelKeys = new Set();
	const modelArtifacts = boundedArray(
		authority.modelArtifacts, 1, MAXIMUM_ARTIFACTS, 'M7 modelArtifacts',
	).map((value, index) => {
		const path = `M7 modelArtifacts[${index}]`;
		const artifact = exactRecord(value, MODEL_FIELDS, path);
		boundedString(artifact.modelId, 1, 256, `${path}.modelId`);
		boundedString(artifact.artifactRole, 1, 256, `${path}.artifactRole`);
		boundedString(artifact.version, 1, 128, `${path}.version`);
		oneOf(artifact.task, MODEL_TASKS, `${path}.task`);
		positiveInteger(artifact.byteLength, `${path}.byteLength`);
		sha256(artifact.sha256, `${path}.sha256`);
		unique(modelKeys, `${artifact.modelId}:${artifact.artifactRole}`, path);
		return Object.freeze(artifact);
	});
	const runtimeIds = new Set();
	const runtimeArtifacts = boundedArray(
		authority.runtimeArtifacts, 1, MAXIMUM_ARTIFACTS, 'M7 runtimeArtifacts',
	).map((value, index) => {
		const path = `M7 runtimeArtifacts[${index}]`;
		const artifact = exactRecord(value, RUNTIME_FIELDS, path);
		oneOf(artifact.familyId, RUNTIME_FAMILIES, `${path}.familyId`);
		boundedString(artifact.version, 1, 128, `${path}.version`);
		boundedString(artifact.artifactId, 1, 256, `${path}.artifactId`);
		if (artifact.target !== platformTarget) {
			throw new Error(`${path}.target is detached from the measured package target.`);
		}
		positiveInteger(artifact.byteLength, `${path}.byteLength`);
		sha256(artifact.sha256, `${path}.sha256`);
		unique(runtimeIds, `${artifact.familyId}:${artifact.artifactId}`, path);
		return Object.freeze(artifact);
	});
	return deepFreeze({ ...authority, modelArtifacts, runtimeArtifacts });
}

function validateMediaAssets(value, fixture) {
	const expectedTotal = fixture.selectedMediaAssetCount + fixture.unselectedMediaAssetCount;
	const values = exactArray(value, expectedTotal,
		`M7 mediaAssets must contain exactly ${expectedTotal} assets`);
	const ids = new Set();
	let selected = 0;
	const assets = values.map((value, index) => {
		const path = `M7 mediaAssets[${index}]`;
		const asset = exactRecord(value, MEDIA_ASSET_FIELDS, path);
		const assetId = boundedString(asset.assetId, 1, 256, `${path}.assetId`);
		unique(ids, assetId, `${path} repeats asset`);
		if (typeof asset.selected !== 'boolean') throw new Error(`${path}.selected must be boolean.`);
		if (asset.selected) selected += 1;
		positiveInteger(asset.byteLength, `${path}.byteLength`);
		sha256(asset.sha256, `${path}.sha256`);
		return Object.freeze(asset);
	});
	if (selected !== fixture.selectedMediaAssetCount
		|| assets.length - selected !== fixture.unselectedMediaAssetCount) {
		throw new Error(`M7 mediaAssets must contain exactly ${fixture.selectedMediaAssetCount} selected and ${fixture.unselectedMediaAssetCount} unselected assets.`);
	}
	return Object.freeze(assets);
}

function validateRun(value, index, assets, packageIdentity, authority,
	processIds, requestIds, outputIds, checkIds, path) {
	const run = exactRecord(value, RUN_FIELDS, path);
	if (run.runIndex !== index) throw new Error(`${path}.runIndex must be ${index}.`);
	if (run.attemptCount !== 1 || run.retried !== false) {
		throw new Error(`${path} forbids retry-to-pass and requires exactly one attempt.`);
	}
	if (run.freshProcess !== true) throw new Error(`${path}.freshProcess must be true.`);
	const processId = boundedString(run.processId, 1, 256, `${path}.processId`);
	unique(processIds, processId, `${path}.processId`);
	if (!WORKFLOW_IDS.includes(run.workflowId)) throw new Error(`${path}.workflowId is not closed.`);
	sha256(run.workflowFenceSha256, `${path}.workflowFenceSha256`);
	if (run.packageSha256 !== packageIdentity.sha256) {
		throw new Error(`${path} package digest is detached from its authenticated package.`);
	}
	if (run.catalogSha256 !== authority.catalogSha256) {
		throw new Error(`${path} catalog digest is detached from its artifact authority.`);
	}
	const networkObservation = validateNetworkObservation(
		run.networkObservation, requestIds, path,
	);
	const mediaReads = validateMediaReads(run.mediaReads, assets, path);
	const acceptedOutputs = validateDigestLedger(
		run.acceptedOutputs, ACCEPTED_OUTPUT_FIELDS, 'outputId', outputIds,
		`${path}.acceptedOutputs`, true,
	);
	const canonicalChecks = validateCanonicalChecks(run.canonicalChecks, checkIds, path);
	const cancellationSamplesMs = Object.freeze(boundedArray(
		run.cancellationSamplesMs, 1, MAXIMUM_CANCELLATION_SAMPLES,
		`${path}.cancellationSamplesMs`,
	).map((sample, sampleIndex) => {
		if (!Number.isFinite(sample) || sample < 0 || sample > MAXIMUM_CANCELLATION_MS) {
			throw new Error(`${path}.cancellationSamplesMs[${sampleIndex}] must be a bounded finite non-negative measurement.`);
		}
		return sample;
	}));
	return Object.freeze({
		...run, acceptedOutputs, cancellationSamplesMs, canonicalChecks, mediaReads, networkObservation,
	});
}

function validateNetworkObservation(value, requestIds, runPath) {
	const path = `${runPath}.networkObservation`;
	const observation = exactRecord(value, NETWORK_OBSERVATION_FIELDS, path);
	oneOf(observation.mechanism, NETWORK_MECHANISMS, `${path}.mechanism`);
	oneOf(observation.osNetworkBlock, OS_NETWORK_BLOCKS, `${path}.osNetworkBlock`);
	if (observation.startedBeforeWorkflow !== true || observation.endedAfterWorkflow !== true) {
		throw new Error(`${path} network observation must cover the whole workflow.`);
	}
	if (observation.packageInstalledBeforeObservation !== true
		|| observation.modelsInstalledBeforeObservation !== true) {
		throw new Error(`${path} requires the package and models installed before network observation.`);
	}
	const requests = boundedArray(
		observation.requests, 0, MAXIMUM_LEDGER_ENTRIES, `${path}.requests`,
	).map((value, index) => {
		const requestPath = `${path}.requests[${index}]`;
		const request = exactRecord(value, NETWORK_REQUEST_FIELDS, requestPath);
		const requestId = boundedString(request.requestId, 1, 256, `${requestPath}.requestId`);
		unique(requestIds, requestId, `${requestPath}.requestId`);
		oneOf(request.method, NETWORK_METHODS, `${requestPath}.method`);
		oneOf(request.transport, NETWORK_TRANSPORTS, `${requestPath}.transport`);
		sha256(request.destinationSha256, `${requestPath}.destinationSha256`);
		return Object.freeze(request);
	});
	return Object.freeze({ ...observation, requests: Object.freeze(requests) });
}

function validateMediaReads(value, assets, runPath) {
	const path = `${runPath}.mediaReads`;
	const reads = exactArray(value, assets.length, `${path} must contain the exact media inventory`);
	return Object.freeze(reads.map((value, index) => {
		const readPath = `${path}[${index}]`;
		const read = exactRecord(value, MEDIA_READ_FIELDS, readPath);
		const asset = assets[index];
		if (read.assetId !== asset.assetId || read.byteLength !== asset.byteLength
			|| read.sha256 !== asset.sha256) {
			throw new Error(`${readPath} media identity is detached from the fixture asset.`);
		}
		if (typeof read.opened !== 'boolean') throw new Error(`${readPath}.opened must be boolean.`);
		nonNegativeInteger(read.bytesRead, `${readPath}.bytesRead`);
		if (!read.opened && read.bytesRead !== 0) throw new Error(`${readPath} records bytes without opening.`);
		if (asset.selected && (!read.opened || read.bytesRead === 0)) {
			throw new Error(`${readPath} selected asset must be read through the real workflow path.`);
		}
		return Object.freeze(read);
	}));
}

function validateDigestLedger(value, fields, idField, ids, path, allowEmpty) {
	const entries = boundedArray(value, allowEmpty ? 0 : 1, MAXIMUM_LEDGER_ENTRIES, path);
	return Object.freeze(entries.map((value, index) => {
		const entryPath = `${path}[${index}]`;
		const entry = exactRecord(value, fields, entryPath);
		const id = boundedString(entry[idField], 1, 256, `${entryPath}.${idField}`);
		unique(ids, id, `${entryPath}.${idField}`);
		sha256(entry.expectedSha256, `${entryPath}.expectedSha256`);
		sha256(entry.observedSha256, `${entryPath}.observedSha256`);
		return Object.freeze(entry);
	}));
}

function validateCanonicalChecks(value, checkIds, runPath) {
	const path = `${runPath}.canonicalChecks`;
	const checks = validateDigestLedger(
		value, CANONICAL_CHECK_FIELDS, 'checkId', checkIds, path, false,
	);
	for (let index = 0; index < checks.length; index += 1) {
		oneOf(checks[index].scenario, CANONICAL_SCENARIOS, `${path}[${index}].scenario`);
	}
	return checks;
}

function validateFixture(value) {
	const fixture = exactRecord(value, FIXTURE_FIELDS, 'M7 fixtureSpecification');
	positiveInteger(fixture.selectedMediaAssetCount, 'M7 fixture selectedMediaAssetCount');
	positiveInteger(fixture.unselectedMediaAssetCount, 'M7 fixture unselectedMediaAssetCount');
	if (fixture.selectedMediaAssetCount !== 2 || fixture.unselectedMediaAssetCount !== 2) {
		throw new Error('M7 fixture must retain exactly two selected and two unselected media assets.');
	}
	return fixture;
}

function validatePolicy(value) {
	if (value?.percentileMethod !== 'nearest-rank'
		|| value?.benchmarkRetries !== 0
		|| value?.timingWorkers !== 1
		|| value?.timingWarmupTrials !== 1
		|| value?.timingTrials !== 5) {
		throw new Error('M7 measurement requires one warm-up, five timed runs, one worker, and no retries.');
	}
	return value;
}

function nearestRank(values, percentile) {
	if (values.length === 0) throw new Error('Nearest-rank percentile requires samples.');
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function boundedArray(value, minimum, maximum, path) {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new Error(`${path} must contain ${minimum} through ${maximum} entries.`);
	}
	return value;
}

function exactArray(value, length, message) {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`${message}.`);
	return value;
}

function sha256(value, path) {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${path} must be one lowercase SHA-256.`);
	}
	return value;
}

function oneOf(value, values, path) {
	if (!values.includes(value)) throw new Error(`${path} is unsupported.`);
	return value;
}

function unique(values, value, path) {
	if (values.has(value)) throw new Error(`${path} repeats ${value}.`);
	values.add(value);
}

function addSafe(left, right, path) {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new Error(`M7 ${path} exceed safe-integer evidence bounds.`);
	return value;
}

function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) =>
		`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
