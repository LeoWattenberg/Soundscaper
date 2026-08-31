/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

const MIB = 1024 * 1024;

export async function readSoundscaperSoakJournal(path) {
	const text = await readFile(path, 'utf8');
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	const events = [];
	let truncatedFinalLine = false;
	for (const [index, line] of lines.entries()) {
		if (!line) throw new TypeError(`Soak-debug journal line ${String(index + 1)} is empty.`);
		try {
			const event = JSON.parse(line);
			validateJournalEvent(event, index + 1);
			events.push(event);
		} catch (error) {
			if (index !== lines.length - 1 || text.endsWith('\n')) throw error;
			truncatedFinalLine = true;
		}
	}
	return Object.freeze({ events: Object.freeze(events), truncatedFinalLine });
}

export function createSoundscaperSoakReport(config, eventsValue, options = {}) {
	if (!Array.isArray(eventsValue)) throw new TypeError('Soak-debug report events must be an array.');
	const events = [...eventsValue];
	const start = events.find(({ type }) => type === 'run-start');
	const end = events.findLast(({ type }) => type === 'run-end');
	const bootstrapError = events.findLast(({ type }) => type === 'bootstrap-error');
	const target = start?.target ?? options.target ?? null;
	const profile = start?.profile ?? options.profile ?? null;
	const metrics = createMetrics(config, events, { target, profile });
	const thresholdResults = config.thresholds.map((threshold) => evaluateThreshold(
		threshold, metrics[threshold.metricId],
	));
	const operations = events.filter(({ type }) => type === 'operation');
	const operationResults = operations.slice(-10_000).map(operationProjection);
	const samples = events.filter(({ type }) => type === 'sample').map(sampleProjection);
	const pageErrors = events.filter(({ type }) => type === 'page-error');
	const consoleErrors = events.filter(({ type }) => type === 'console-error');
	const cleanupErrors = events.filter(({ type }) => type === 'cleanup-error');
	const crashed = end?.outcome === 'crashed';
	const operationFailed = operations.some(({ status }) => status === 'failed');
	const complete = end?.outcome === 'completed' || crashed;
	const incompleteReason = complete ? null
		: boundedReason(bootstrapError?.reason ?? end?.reason ?? options.incompleteReason
			?? 'The run ended before a terminal journal event was appended.');
	let status;
	let exitCode;
	if (!complete) {
		status = 'incomplete';
		exitCode = 2;
	} else if (crashed || operationFailed || pageErrors.length > 0 || cleanupErrors.length > 0) {
		status = 'failed';
		exitCode = 1;
	} else if (thresholdResults.some(({ status: verdict }) => verdict === 'warning')
		|| consoleErrors.length > 0) {
		status = 'warnings';
		exitCode = 0;
	} else {
		status = 'ok';
		exitCode = 0;
	}
	return deepFreeze({
		kind: 'soundscaper-soak-debug-report',
		schemaVersion: 1,
		target,
		profile,
		status,
		exitCode,
		startedAt: start?.occurredAt ?? null,
		endedAt: end?.occurredAt ?? null,
		durationMs: finiteNonNegative(end?.durationMs),
		incompleteReason,
		operations: {
			attempted: operations.length,
			passed: operations.filter(({ status: outcome }) => outcome === 'passed').length,
			failed: operations.filter(({ status: outcome }) => outcome === 'failed').length,
			unavailable: operations.filter(({ status: outcome }) => outcome === 'unavailable').length,
			results: operationResults,
			resultsTruncated: operations.length > operationResults.length,
		},
		samples,
		runtimeErrors: runtimeErrorSummary(pageErrors, consoleErrors),
		cleanupErrors: cleanupErrors.slice(-100).map(runtimeErrorProjection),
		metrics,
		thresholds: thresholdResults,
	});
}

function operationProjection(event) {
	if (!['passed', 'failed', 'unavailable'].includes(event.status)
		|| typeof event.operationId !== 'string' || !event.operationId) {
		throw new TypeError('A soak-debug operation result is invalid.');
	}
	return {
		eventId: typeof event.eventId === 'string' ? event.eventId.slice(0, 128) : null,
		operationId: event.operationId.slice(0, 128),
		status: event.status,
		durationMs: finiteNonNegative(event.durationMs),
		reason: event.status === 'passed' ? null : boundedReason(event.reason),
		code: typeof event.code === 'string' ? event.code.slice(0, 64) : null,
		measurements: operationMeasurements(event.measurements),
	};
}

function operationMeasurements(value) {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const result = {};
	for (const [key, reasonKey] of [
		['decodedMediaAvDriftMaximumMs', 'decodedMediaAvDriftUnavailableReason'],
		['decodedVideoDroppedFrames', 'decodedVideoDroppedFramesUnavailableReason'],
		['streamUnderrunFrames', 'streamUnderrunFramesUnavailableReason'],
	]) {
		const measurement = finiteNonNegative(source[key]);
		if (measurement !== null) result[key] = measurement;
		else if (source[key] === null) {
			result[key] = null;
			result[reasonKey] = boundedReason(source[reasonKey]);
		}
	}
	if (typeof source.streamedPlaybackObserved === 'boolean') {
		result.streamedPlaybackObserved = source.streamedPlaybackObserved;
	} else if (source.streamedPlaybackObserved === null) {
		result.streamedPlaybackObserved = null;
		result.streamedPlaybackObservedUnavailableReason = boundedReason(
			source.streamedPlaybackObservedUnavailableReason,
		);
	}
	return result;
}

function sampleProjection(event) {
	return {
		occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : null,
		monotonicMs: finiteNonNegative(event.monotonicMs),
		usedJsHeapBytes: finiteNonNegative(event.usedJsHeapBytes),
		forcedCollections: nonNegativeInteger(event.forcedCollections),
		electronWorkingSetBytes: finiteNonNegative(event.electronWorkingSetBytes),
		electronWorkingSetUnavailableReason: event.electronWorkingSetBytes === null
			? boundedReason(event.electronWorkingSetUnavailableReason) : null,
	};
}

function runtimeErrorSummary(pageErrors, consoleErrors) {
	const maximumEntries = 100;
	return {
		pageCount: pageErrors.length,
		consoleCount: consoleErrors.length,
		page: pageErrors.slice(-maximumEntries).map(runtimeErrorProjection),
		console: consoleErrors.slice(-maximumEntries).map(runtimeErrorProjection),
		entriesTruncated: pageErrors.length > maximumEntries || consoleErrors.length > maximumEntries,
	};
}

function runtimeErrorProjection(event) {
	return {
		occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : null,
		monotonicMs: finiteNonNegative(event.monotonicMs),
		name: typeof event.name === 'string' ? event.name.slice(0, 64) : 'Error',
		code: typeof event.code === 'string' ? event.code.slice(0, 64) : 'UNCLASSIFIED',
		message: typeof event.message === 'string' ? event.message.slice(0, 2_000)
			: boundedReason(event.reason),
	};
}

function createMetrics(config, events, { target, profile }) {
	const samples = events.filter(({ type }) => type === 'sample');
	const heap = samples.filter(({ usedJsHeapBytes }) => finiteNonNegative(usedJsHeapBytes) !== null);
	const workingSet = samples.filter(({ electronWorkingSetBytes }) => finiteNonNegative(electronWorkingSetBytes) !== null);
	const operations = events.filter(({ type }) => type === 'operation');
	const decodedDrift = operations.flatMap(({ measurements }) => {
		const value = finiteNonNegative(measurements?.decodedMediaAvDriftMaximumMs);
		return value === null ? [] : [value];
	});
	const droppedFrames = operations.flatMap(({ measurements }) => {
		const value = finiteNonNegative(measurements?.decodedVideoDroppedFrames);
		return value === null ? [] : [value];
	});
	const decodedDriftReason = operations.findLast(({ measurements }) => (
		measurements?.decodedMediaAvDriftMaximumMs === null
	))?.measurements?.decodedMediaAvDriftUnavailableReason;
	const droppedFramesReason = operations.findLast(({ measurements }) => (
		measurements?.decodedVideoDroppedFrames === null
	))?.measurements?.decodedVideoDroppedFramesUnavailableReason;
	const streaming = operations.findLast(({ operationId, status, measurements }) => (
		operationId === 'streamed-playback-diagnostics' && status === 'passed'
		&& typeof measurements?.streamedPlaybackObserved === 'boolean'
	));
	const streamingObserved = streaming?.measurements?.streamedPlaybackObserved;
	const streamUnderrunFrames = finiteNonNegative(streaming?.measurements?.streamUnderrunFrames);
	const metrics = {
		retainedJsHeapDeltaBytes: deltaMetric(
			heap, 'usedJsHeapBytes', 'bytes',
			'At least two forced-GC heap samples are required.',
		),
		postWarmupHeapSlopeMibPerHour: profile !== 'extended'
			? unavailable('Heap slope is reported only for the extended profile.')
			: slopeMetric(heap, config.profiles.extended.warmupSeconds * 1000),
		electronWorkingSetDeltaBytes: target !== 'desktop'
			? unavailable('Browser runs have no Electron process working set.')
			: deltaMetric(
				workingSet, 'electronWorkingSetBytes', 'bytes',
				workingSet.at(-1)?.electronWorkingSetUnavailableReason
					?? 'The packaged app did not expose flag-gated process metrics.',
			),
		decodedMediaAvDriftMaximumMs: decodedDrift.length
			? measured(Math.max(...decodedDrift), 'ms')
			: unavailable(decodedDriftReason ?? 'No decoded-media A/V probe completed in this run.'),
		decodedVideoDroppedFrames: droppedFrames.length
			? measured(Math.max(...droppedFrames), 'frames')
			: unavailable(droppedFramesReason ?? 'No decoded-video playback quality sample completed in this run.'),
		failedAutosaves: measured(operations.filter(({ operationId, status }) => (
			operationId === 'autosave-reload' && status === 'failed'
		)).length, 'count'),
		streamedPlaybackObserved: typeof streamingObserved === 'boolean'
			? measured(streamingObserved, 'boolean')
			: unavailable('No Local Diagnostics streamed-playback observation completed in this run.'),
		streamUnderrunFrames: streamingObserved === true && streamUnderrunFrames !== null
			? measured(streamUnderrunFrames, 'frames')
			: unavailable('No observed streamed-playback run exposed a Web Core underrun count.'),
	};
	for (const descriptor of config.unavailableMeasurements) {
		metrics[descriptor.metricId] = unavailable(descriptor.reason);
	}
	return metrics;
}

function slopeMetric(samples, warmupMs) {
	const points = samples.filter(({ monotonicMs }) => Number.isFinite(monotonicMs)
		&& monotonicMs >= warmupMs).map(({ monotonicMs, usedJsHeapBytes }) => ({
		x: monotonicMs / 3_600_000,
		y: usedJsHeapBytes / MIB,
	}));
	if (points.length < 3 || points.at(-1).x === points[0].x) {
		return unavailable('At least three distinct post-warmup heap samples are required.');
	}
	const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
	const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
	const denominator = points.reduce((sum, point) => sum + ((point.x - meanX) ** 2), 0);
	if (!(denominator > 0)) return unavailable('Post-warmup heap sample times are not distinct.');
	const slope = points.reduce((sum, point) => (
		sum + ((point.x - meanX) * (point.y - meanY))
	), 0) / denominator;
	return measured(Math.max(0, slope), 'MiB/hour');
}

function deltaMetric(samples, key, unit, reason) {
	if (samples.length < 2) return unavailable(reason);
	return measured(Math.max(0, samples.at(-1)[key] - samples[0][key]), unit);
}

function evaluateThreshold(threshold, metric) {
	if (!metric || metric.value === null) {
		return { ...threshold, observed: null, status: 'unavailable', reason: metric?.reason ?? 'Not measured.' };
	}
	const passed = threshold.comparison === 'eq'
		? metric.value === threshold.value
		: metric.value <= threshold.value;
	return {
		...threshold,
		observed: metric.value,
		status: passed ? 'ok' : 'warning',
		reason: null,
	};
}

function validateJournalEvent(value, expectedSequence) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| value.schemaVersion !== 1 || value.sequence !== expectedSequence
		|| typeof value.type !== 'string' || !value.type
		|| typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))
		|| !Number.isFinite(value.monotonicMs) || value.monotonicMs < 0) {
		throw new TypeError(`Soak-debug journal event ${String(expectedSequence)} is invalid.`);
	}
}

function measured(value, unit) {
	return { value, unit };
}

function unavailable(reason) {
	return { value: null, reason: boundedReason(reason) };
}

function finiteNonNegative(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedReason(value) {
	const reason = typeof value === 'string' ? value.trim().slice(0, 1_000) : '';
	return reason || 'The measurement is unavailable.';
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
