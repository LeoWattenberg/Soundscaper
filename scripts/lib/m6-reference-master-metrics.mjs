/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	boundedString,
	deepFreeze,
	exactRecord,
	isRecord,
	nonNegativeInteger,
	requireRecord,
} from './measurement-admission.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

/*
 * Milestone 6 exit-gate arithmetic. Nothing here renders anything: a reference
 * run hands over one JSON record and this module re-derives every registered
 * metric from what the delivery itself produced.
 *
 * The record carries **sealed delivery reports**, not summary numbers. That is
 * the whole point of the shape: nine of the eleven metrics are recomputed from
 * report items the product wrote at delivery time, so a run cannot file a
 * number its own artifacts do not contain. `delivery.unreportedConversions` is
 * the clearest case — the record carries both the plan's conversion inventory
 * and the sealed report, and this module counts the difference rather than
 * trusting a scalar somebody typed.
 *
 * The schema is closed. A run that omits an artifact, hides a retry, or files
 * four timed runs instead of five is rejected rather than defaulted, because
 * the missing half is exactly the half that would make an unqualified result
 * look qualified.
 */

export const M6_REFERENCE_MASTER_WORKLOAD_ID = 'm6-reference-master-delivery';
export const M6_REFERENCE_MASTER_FIXTURE_ID = 'm6-reference-master-suite-v1';
export const M6_REFERENCE_MASTER_ENVIRONMENT_IDS = Object.freeze([
	'reference-linux-gpu-01',
	'native-os-lab-matrix',
]);
export const M6_REFERENCE_MASTER_PROFILE = 'reference-master-delivery-v1';
export const M6_REFERENCE_MASTER_OBSERVATION_CLASS = 'reference-master-delivery-and-conformance-v1';

/** The exact eleven metrics the workload registers; the collector re-checks this against config. */
export const M6_REFERENCE_MASTER_METRIC_IDS = Object.freeze([
	'delivery.audioDurationErrorSamples',
	'delivery.videoFrameCountError',
	'delivery.avDriftMaximumMs',
	'delivery.integratedLoudnessErrorLu',
	'delivery.truePeakErrorDb',
	'delivery.captionCueErrorFrames',
	'delivery.channelMapErrors',
	'delivery.unreportedConversions',
	'delivery.partialPublishedOutputBytes',
	'delivery.webVideoRenderP95Rtf',
	'delivery.audioRenderP95Rtf',
]);

/**
 * Which report item each conformance metric is read out of.
 *
 * 6A-4 made the exporter write these, so the exit gate reads them rather than
 * measuring the file a second time with different code — two measurements of
 * one artifact is two chances to be wrong about it.
 */
export const M6_CONFORMANCE_METRIC_SOURCES = Object.freeze({
	'delivery.audioDurationErrorSamples': Object.freeze({
		code: 'delivery.conformance-duration', field: 'errorSamples',
	}),
	'delivery.channelMapErrors': Object.freeze({
		code: 'delivery.conformance-channel-map', field: 'channelMapErrors',
	}),
});

const AUDIO_ARTIFACT_FIELDS = Object.freeze([
	'artifactId', 'plannedConversions', 'publishedByteLength', 'publishedComplete', 'report',
]);
const VIDEO_ARTIFACT_FIELDS = Object.freeze([
	'artifactId', 'avDriftMs', 'captionCueErrorFrames', 'frameCountError',
	'plannedConversions', 'publishedByteLength', 'publishedComplete', 'report',
]);

export function computeM6ReferenceMasterMetrics(measurementValue, context) {
	const { fixtureSpecification, measurementPolicy } = requireRecord(context, 'context');
	const policy = assertMeasurementPolicy(measurementPolicy);
	const fixture = requireRecord(fixtureSpecification, 'fixture.specification');
	const measurement = validateMeasurement(measurementValue, policy);

	const audio = measurement.audioArtifacts;
	const video = measurement.videoArtifacts;
	const artifacts = [...audio, ...video];
	const loudness = audio.flatMap((artifact) => loudnessErrors(artifact));
	if (loudness.length === 0) {
		// Same policy the conformance metrics follow: a metric nothing measured
		// fails rather than reporting the zero an empty set would average to. A
		// run whose deliveries filed no delivered loudness cannot answer the
		// loudness gates at all, and must not appear to have passed them.
		throw new Error(
			'M6 run filed no delivered loudness measurement; '
			+ 'delivery.integratedLoudnessErrorLu and delivery.truePeakErrorDb cannot be derived.',
		);
	}

	return deepFreeze({
		environmentId: measurement.environmentId,
		platformId: measurement.platformId,
		fingerprint: measurement.fingerprint,
		metrics: {
			'delivery.audioDurationErrorSamples': conformanceMaximum(
				audio, 'delivery.audioDurationErrorSamples',
			),
			'delivery.videoFrameCountError': maximumMagnitude(
				video.map((artifact) => artifact.frameCountError),
			),
			'delivery.avDriftMaximumMs': maximumMagnitude(video.map((artifact) => artifact.avDriftMs)),
			'delivery.integratedLoudnessErrorLu': maximumMagnitude(loudness.map(({ loudnessLu }) => loudnessLu)),
			'delivery.truePeakErrorDb': maximumMagnitude(loudness.map(({ truePeakDb }) => truePeakDb)),
			'delivery.captionCueErrorFrames': maximumMagnitude(
				video.map((artifact) => artifact.captionCueErrorFrames),
			),
			'delivery.channelMapErrors': conformanceMaximum(audio, 'delivery.channelMapErrors'),
			'delivery.unreportedConversions': artifacts.reduce(
				(total, artifact) => total + unreportedConversions(artifact), 0,
			),
			'delivery.partialPublishedOutputBytes': artifacts.reduce(
				(total, artifact) => total + (artifact.publishedComplete ? 0 : artifact.publishedByteLength), 0,
			),
			'delivery.webVideoRenderP95Rtf': realTimeFactorP95(
				measurement.videoRenderSeconds, fixture.videoDurationSeconds, 'video',
			),
			'delivery.audioRenderP95Rtf': realTimeFactorP95(
				measurement.audioRenderSeconds, fixture.audioDurationSeconds, 'audio',
			),
		},
		rawSampleCounts: {
			audioArtifacts: audio.length,
			videoArtifacts: video.length,
			audioRenderRuns: measurement.audioRenderSeconds.length,
			videoRenderRuns: measurement.videoRenderSeconds.length,
			warmupRuns: measurement.warmupRenderSeconds.length,
			loudnessDeliveries: loudness.length,
		},
	});
}

/**
 * Conversions the plan implied and the report never mentioned.
 *
 * This is `countUnreportedDeliveryConversions` recomputed from the record: the
 * same rule — a converted or omitted conversion whose code is absent from the
 * sealed report — applied to the two artifacts the run filed rather than to a
 * plan this module cannot see. Preserved conversions are not counted, because a
 * delivery that preserved something has nothing to disclose about it.
 */
export function unreportedConversions(artifact) {
	const reported = new Set(artifact.report.items.map((item) => item.code));
	return artifact.plannedConversions.filter((conversion) => (
		(conversion.disposition === 'converted' || conversion.disposition === 'omitted')
		&& !reported.has(conversion.code)
	)).length;
}

/**
 * Every item code the exporter files a loudness result under.
 *
 * The exporter has never written a bare `delivery.loudness`; it keys the item on
 * what the delivery found. Matching that name meant no run ever produced a
 * loudness row, both loudness metrics computed as zero from an empty set, and
 * the exit gate passed without a single measurement being read.
 */
export const M6_LOUDNESS_ITEM_CODES = new Set([
	'delivery.loudness-measured',
	'delivery.loudness-normalized',
	'delivery.loudness-delivered-mismatch',
	'delivery.loudness-target-missed',
	'delivery.loudness-unmeasurable',
]);

/**
 * The gap between what a delivery's gain promised and what its bytes measure.
 *
 * Deliberately not target-versus-delivered: when a true-peak ceiling binds
 * before the integrated target the shortfall is the documented outcome, not a
 * defect, and a gate written the other way would fail every correctly delivered
 * ceiling-limited master. What the gate asks is whether the file measures what
 * the delivery said it would.
 */
export function loudnessErrors(artifact) {
	const rows = [];
	for (const item of artifact.report.items) {
		if (!M6_LOUDNESS_ITEM_CODES.has(item.code)) continue;
		const data = requireRecord(item.data, `${artifact.artifactId} ${item.code} data`);
		if (data.deliveredLoudnessLufs === undefined && data.deliveredTruePeakDb === undefined) continue;
		rows.push({
			loudnessLu: finiteNumber(data.deliveredLoudnessLufs, `${artifact.artifactId} deliveredLoudnessLufs`)
				- finiteNumber(data.projectedLoudnessLufs, `${artifact.artifactId} projectedLoudnessLufs`),
			truePeakDb: finiteNumber(data.deliveredTruePeakDb, `${artifact.artifactId} deliveredTruePeakDb`)
				- finiteNumber(data.projectedTruePeakDb, `${artifact.artifactId} projectedTruePeakDb`),
		});
	}
	return rows;
}

function conformanceMaximum(artifacts, metricId) {
	const { code, field } = M6_CONFORMANCE_METRIC_SOURCES[metricId];
	const values = [];
	for (const artifact of artifacts) {
		const items = artifact.report.items.filter((item) => item.code === code);
		if (items.length === 0) {
			// A missing conformance item is a delivery nothing checked, and the
			// policy for a missing metric is to fail rather than to assume zero.
			throw new Error(`M6 artifact ${artifact.artifactId} has no ${code} item; ${metricId} cannot be derived.`);
		}
		for (const item of items) {
			values.push(finiteNumber(requireRecord(item.data, `${code} data`)[field], `${code}.${field}`));
		}
	}
	return maximumMagnitude(values);
}

function maximumMagnitude(values) {
	// No samples is zero error, which is only ever reached when the run filed no
	// artifacts of that kind — and the collector refuses that separately.
	return values.reduce((widest, value) => Math.max(widest, Math.abs(value)), 0);
}

function realTimeFactorP95(renderSeconds, mediaDurationSeconds, label) {
	const duration = finiteNumber(mediaDurationSeconds, `fixture.${label}DurationSeconds`);
	if (duration <= 0) throw new Error(`M6 fixture ${label} duration must be positive.`);
	return nearestRank(renderSeconds.map((seconds) => seconds / duration), 0.95);
}

function validateMeasurement(measurementValue, policy) {
	const measurement = exactRecord(
		snapshotStrictJsonData(measurementValue, 'M6 measurement'),
		[
			'audioArtifacts', 'audioRenderSeconds', 'environmentId', 'fingerprint', 'platformId',
			'profile', 'schemaVersion', 'videoArtifacts', 'videoRenderSeconds',
			'warmupRenderSeconds', 'workloadId',
		],
		'M6 measurement',
	);
	if (measurement.schemaVersion !== 1) throw new Error('M6 measurement schemaVersion must be 1.');
	if (measurement.workloadId !== M6_REFERENCE_MASTER_WORKLOAD_ID) {
		throw new Error(`M6 measurement must name workload ${M6_REFERENCE_MASTER_WORKLOAD_ID}.`);
	}
	if (measurement.profile !== M6_REFERENCE_MASTER_PROFILE) {
		throw new Error(`M6 measurement must name profile ${M6_REFERENCE_MASTER_PROFILE}.`);
	}
	if (!M6_REFERENCE_MASTER_ENVIRONMENT_IDS.includes(measurement.environmentId)) {
		throw new Error(`M6 measurement environmentId must be one of the workload's two environments.`);
	}
	const audioArtifacts = artifactList(measurement.audioArtifacts, AUDIO_ARTIFACT_FIELDS, 'audioArtifacts');
	const videoArtifacts = artifactList(measurement.videoArtifacts, VIDEO_ARTIFACT_FIELDS, 'videoArtifacts');
	if (audioArtifacts.length === 0) throw new Error('M6 measurement must file at least one audio artifact.');
	if (videoArtifacts.length === 0) throw new Error('M6 measurement must file at least one video artifact.');
	return Object.freeze({
		environmentId: measurement.environmentId,
		platformId: boundedString(measurement.platformId, 1, 128, 'M6 measurement.platformId'),
		fingerprint: Object.freeze(requireRecord(measurement.fingerprint, 'M6 measurement.fingerprint')),
		audioArtifacts,
		videoArtifacts,
		audioRenderSeconds: renderSeconds(measurement.audioRenderSeconds, policy.timingTrials, 'audioRenderSeconds'),
		videoRenderSeconds: renderSeconds(measurement.videoRenderSeconds, policy.timingTrials, 'videoRenderSeconds'),
		warmupRenderSeconds: renderSeconds(
			measurement.warmupRenderSeconds, policy.timingWarmupTrials, 'warmupRenderSeconds',
		),
	});
}

function artifactList(value, fields, label) {
	if (!Array.isArray(value)) throw new TypeError(`M6 measurement.${label} must be an array.`);
	const seen = new Set();
	return Object.freeze(value.map((candidate, index) => {
		const artifact = exactRecord(candidate, fields, `M6 measurement.${label}[${index}]`);
		const artifactId = boundedString(artifact.artifactId, 1, 256, `${label}[${index}].artifactId`);
		if (seen.has(artifactId)) throw new Error(`M6 measurement files artifact ${artifactId} twice.`);
		seen.add(artifactId);
		const report = requireRecord(artifact.report, `${label}[${index}].report`);
		if (!Array.isArray(report.items) || !isRecord(report.counts)) {
			throw new Error(`M6 artifact ${artifactId} must carry a sealed delivery report.`);
		}
		if (typeof artifact.publishedComplete !== 'boolean') {
			throw new Error(`M6 artifact ${artifactId} must say whether its publication completed.`);
		}
		return Object.freeze({
			...artifact,
			artifactId,
			report: Object.freeze({
				...report,
				items: Object.freeze(report.items.map((item, itemIndex) => requireRecord(
					item, `${label}[${index}].report.items[${itemIndex}]`,
				))),
			}),
			plannedConversions: conversionList(artifact.plannedConversions, `${label}[${index}]`),
			publishedByteLength: nonNegativeInteger(
				artifact.publishedByteLength, `${label}[${index}].publishedByteLength`,
			),
			...(fields === VIDEO_ARTIFACT_FIELDS ? {
				frameCountError: finiteNumber(artifact.frameCountError, `${label}[${index}].frameCountError`),
				avDriftMs: finiteNumber(artifact.avDriftMs, `${label}[${index}].avDriftMs`),
				captionCueErrorFrames: finiteNumber(
					artifact.captionCueErrorFrames, `${label}[${index}].captionCueErrorFrames`,
				),
			} : {}),
		});
	}));
}

function conversionList(value, label) {
	if (!Array.isArray(value)) throw new TypeError(`M6 ${label}.plannedConversions must be an array.`);
	return Object.freeze(value.map((candidate, index) => {
		const conversion = exactRecord(candidate, ['code', 'disposition'], `${label}.plannedConversions[${index}]`);
		return Object.freeze({
			code: boundedString(conversion.code, 1, 256, `${label}.plannedConversions[${index}].code`),
			disposition: boundedString(
				conversion.disposition, 1, 32, `${label}.plannedConversions[${index}].disposition`,
			),
		});
	}));
}

function renderSeconds(value, expected, label) {
	if (!Array.isArray(value) || value.length !== expected) {
		throw new Error(`M6 measurement.${label} must contain exactly ${expected} timed runs.`);
	}
	return Object.freeze(value.map((seconds, index) => {
		const number = finiteNumber(seconds, `${label}[${index}]`);
		if (number <= 0) throw new Error(`M6 measurement.${label}[${index}] must be a positive duration.`);
		return number;
	}));
}

function assertMeasurementPolicy(policyValue) {
	const policy = requireRecord(policyValue, 'measurementPolicy');
	if (policy.percentileMethod !== 'nearest-rank'
		|| policy.missingMetric !== 'fail'
		|| policy.nonFiniteMetric !== 'fail'
		|| policy.benchmarkRetries !== 0
		|| policy.timingWarmupTrials !== 1
		|| policy.timingTrials !== 5) {
		throw new Error('M6 metrics require the checked-in nearest-rank, fail-closed, no-retry measurement policy.');
	}
	return policy;
}

function finiteNumber(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`M6 ${label} must be a finite number.`);
	}
	return value;
}

function nearestRank(values, percentile) {
	if (values.length === 0) throw new Error('Nearest-rank percentile requires samples.');
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.ceil(percentile * sorted.length) - 1];
}
