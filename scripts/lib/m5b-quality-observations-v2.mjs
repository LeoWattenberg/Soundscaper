/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDeepStrictEqual } from 'node:util';

import {
	boundedString,
	deepFreeze,
	exactRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const MAXIMUM_SAMPLES_PER_METRIC = 262_144;
const SHA256 = /^[a-f\d]{64}$/u;
const ARCHITECTURES = Object.freeze({
	windowsX64: 'x64', windowsArm64: 'arm64', macosArm64: 'arm64',
	linuxX64: 'x64', linuxArm64: 'arm64',
});
const RUNTIME_PROFILE_FIELDS = Object.freeze([
	'architecture', 'displayIdentity', 'displayServer', 'driverVersion',
	'exercisedCapabilityIds', 'gpuModel', 'helperBinarySha256', 'mediaDecodeBackend',
	'mediaEncodeBackend', 'mediaHostSha256', 'nativeAddonSha256', 'ofxGpuBackend',
	'ofxRuntimeHostSha256', 'ofxScannerSha256', 'osImage', 'osVersion',
	'packageSha256', 'platformId', 'rendererClass', 'workloadRunnerSha256',
]);

export const M5B_V2_EXERCISED_CAPABILITIES = deepFreeze({
	'native-media': ['media-decode', 'media-encode', 'media-render'],
	'professional-media': [
		'professional-decode', 'professional-encode', 'image-sequence', 'proxy',
	],
	'persistent-services': ['persistent-queue', 'watch-folder', 'scratch-volume'],
	'clean-display': ['clean-display-1080p60', 'clean-display-uhd30'],
	openfx: ['openfx-scan', 'openfx-render', 'openfx-hostile-suite'],
});

/** Admit runner observations and derive every published metric and count. */
export function deriveM5bQualityMetricsV2(observationsValue, thresholdsValue) {
	if (!Array.isArray(thresholdsValue) || thresholdsValue.length === 0) {
		throw new Error('5B V2 quality thresholds must be a non-empty array.');
	}
	const thresholdIds = thresholdsValue.map(({ metricId }) => metricId);
	if (thresholdIds.some((id) => typeof id !== 'string')
		|| new Set(thresholdIds).size !== thresholdIds.length) {
		throw new Error('5B V2 quality thresholds need unique metric IDs.');
	}
	const observations = exactRecord(
		snapshotStrictJsonData(observationsValue, '5B V2 observations'),
		thresholdIds,
		'5B V2 observations',
	);
	const metrics = {};
	const sampleCounts = {};
	for (const threshold of thresholdsValue) {
		const samples = sampleArray(observations[threshold.metricId], threshold.metricId);
		metrics[threshold.metricId] = aggregate(samples, threshold);
		sampleCounts[threshold.metricId] = samples.length;
	}
	return deepFreeze({ observations, metrics, sampleCounts });
}

/** Bind what the native runner observed to its actual host and artifact set. */
export function validateM5bObservedRuntimeProfileV2(profileId, value, diagnosticBinding) {
	const observed = exactRecord(
		snapshotStrictJsonData(value, '5B V2 observed runtime profile'),
		RUNTIME_PROFILE_FIELDS,
		'5B V2 observed runtime profile',
	);
	if (!Object.hasOwn(M5B_V2_EXERCISED_CAPABILITIES, profileId)
		|| !isDeepStrictEqual(
			observed.exercisedCapabilityIds,
			M5B_V2_EXERCISED_CAPABILITIES[profileId],
		)) throw new Error('5B V2 observed runtime profile did not exercise its exact pipeline capabilities.');
	for (const field of [
		'architecture', 'displayIdentity', 'displayServer', 'driverVersion', 'gpuModel',
		'mediaDecodeBackend', 'mediaEncodeBackend', 'ofxGpuBackend', 'osImage',
		'osVersion', 'platformId', 'rendererClass',
	]) boundedString(observed[field], 1, 1_024, `5B V2 observed runtime profile.${field}`);
	if (!['hardware', 'software', 'unknown'].includes(observed.rendererClass)) {
		throw new Error('5B V2 observed runtime profile rendererClass is unsupported.');
	}
	const expected = {
		platformId: diagnosticBinding.platformId,
		architecture: ARCHITECTURES[diagnosticBinding.platformId],
		osImage: diagnosticBinding.observedHost.osImage,
		osVersion: diagnosticBinding.observedHost.osVersion,
		gpuModel: diagnosticBinding.observedHost.gpuModel,
		driverVersion: diagnosticBinding.observedHost.driverVersion,
		displayIdentity: diagnosticBinding.observedHost.displayIdentity,
	};
	for (const [field, expectedValue] of Object.entries(expected)) {
		if (observed[field] !== expectedValue) {
			throw new Error(`5B V2 observed runtime profile ${field} does not match its diagnostic binding.`);
		}
	}
	for (const field of [
		'packageSha256', 'helperBinarySha256', 'nativeAddonSha256', 'mediaHostSha256',
		'workloadRunnerSha256', 'ofxScannerSha256', 'ofxRuntimeHostSha256',
	]) {
		const digest = observed[field];
		if (digest !== null && (typeof digest !== 'string' || !SHA256.test(digest))) {
			throw new Error(`5B V2 observed runtime profile ${field} must be a SHA-256 or null.`);
		}
		if (digest !== diagnosticBinding.artifacts[field]) {
			throw new Error(`5B V2 observed runtime profile ${field} does not match its artifact binding.`);
		}
	}
	return deepFreeze(observed);
}

function sampleArray(value, metricId) {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_SAMPLES_PER_METRIC
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new Error(`5B V2 observations.${metricId} must be one dense bounded sample array.`);
	}
	return value.map((sample, index) => {
		if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0) {
			throw new Error(`5B V2 observations.${metricId}[${index}] must be finite and non-negative.`);
		}
		return sample;
	});
}

function aggregate(samples, threshold) {
	if (threshold.metricId.endsWith('P95Ms')) return nearestRank(samples, 0.95);
	if (threshold.comparison === 'eq') {
		const total = samples.reduce((sum, value) => sum + value, 0);
		if (!Number.isFinite(total)) throw new Error(`${threshold.metricId} sample total overflowed.`);
		return total;
	}
	if (threshold.comparison === 'lte') {
		return samples.reduce((maximum, value) => Math.max(maximum, value), 0);
	}
	if (threshold.comparison === 'gte') {
		return samples.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
	}
	throw new Error(`${threshold.metricId} uses an unsupported comparison.`);
}

function nearestRank(values, percentile) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}
