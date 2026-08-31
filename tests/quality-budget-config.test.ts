/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	evaluateQualityWorkload,
	qualityFixture,
	qualityWorkload,
	workloadThresholds,
} from '../scripts/lib/quality-budget-config.mjs';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url), 'utf8',
)) as Record<string, unknown>;

test('quality budgets contain only executable fixtures, workloads, measurements, and thresholds', () => {
	assert.deepEqual(Object.keys(config), [
		'schemaVersion', 'fixtures', 'measurements', 'thresholds', 'workloads',
	]);
	assert.equal(config.schemaVersion, 2);
	const fixtures = config.fixtures as Array<Record<string, unknown>>;
	const measurements = config.measurements as Array<Record<string, unknown>>;
	const thresholds = config.thresholds as Array<Record<string, unknown>>;
	const workloads = config.workloads as Array<Record<string, unknown>>;
	assert.equal(new Set(fixtures.map(({ id }) => id)).size, fixtures.length);
	assert.equal(new Set(measurements.map(({ id }) => id)).size, measurements.length);
	assert.equal(new Set(thresholds.map(({ measurementId }) => measurementId)).size, thresholds.length);
	assert.equal(new Set(workloads.map(({ id }) => id)).size, workloads.length);
	assert.deepEqual(
		new Set(thresholds.map(({ measurementId }) => measurementId)),
		new Set(measurements.map(({ id }) => id)),
	);

	for (const fixture of fixtures) {
		assert.deepEqual(
			Object.keys(fixture).sort(),
			Object.keys(fixture).filter((field) => (
				['artifacts', 'id', 'kind', 'limitation', 'specification'].includes(field)
			)).sort(),
			String(fixture.id),
		);
	}
	for (const measurement of measurements) {
		assert.deepEqual(Object.keys(measurement).sort(), ['behavior', 'id']);
		assert.match(String(measurement.behavior), /^(?:blocking|observational)$/u);
	}
	for (const threshold of thresholds) {
		assert.deepEqual(
			Object.keys(threshold).sort(),
			['comparison', 'measurementId', 'unit', 'value'],
		);
		assert.match(String(threshold.comparison), /^(?:eq|gte|lte)$/u);
		assert.equal(Number.isFinite(threshold.value), true);
	}
	for (const workload of workloads) {
		assert.deepEqual(
			Object.keys(workload).sort(),
			['behavior', 'fixtureIds', 'id', 'measurementIds'],
		);
		assert.match(String(workload.behavior), /^(?:blocking|observational)$/u);
		assert.ok(Array.isArray(workload.fixtureIds) && workload.fixtureIds.length > 0);
		assert.ok(Array.isArray(workload.measurementIds) && workload.measurementIds.length > 0);
		for (const fixtureId of workload.fixtureIds as string[]) assert.ok(
			fixtures.some(({ id }) => id === fixtureId), `${String(workload.id)} fixture ${fixtureId}`,
		);
		const behaviors = (workload.measurementIds as string[]).map((measurementId) => {
			const measurement = measurements.find(({ id }) => id === measurementId);
			assert.ok(measurement, `${String(workload.id)} measurement ${measurementId}`);
			return measurement.behavior;
		});
		assert.equal(
			workload.behavior,
			behaviors.includes('blocking') ? 'blocking' : 'observational',
			String(workload.id),
		);
	}

	const serialized = JSON.stringify(config);
	assert.doesNotMatch(serialized, /groundedAt|offlineCacheNarrative|measurementPolicy|softwareInputs|environments|environmentIds|activationGate/iu);
	assert.doesNotMatch(serialized, /"status"|"evidence"|"milestones"/u);
	assert.doesNotMatch(serialized, /qualification|cohort|passRatio|defect|capture-device-matrix/iu);
	for (const removed of [
		'm2-streaming-bounded-memory',
		'm7-local-assistance-speech-accuracy',
		'm7-local-assistance-visual-accuracy',
		'm8plus-web-vcr-long-session',
		'm8b-reviewed-design-timing',
	]) assert.equal(workloads.some(({ id }) => id === removed), false, removed);
});

test('mixed diagnostics make correctness blocking and performance observational', () => {
	assert.equal(qualityWorkload(config, 'm1-video-preview-12fx-720p').behavior, 'observational');
	assert.equal(qualityWorkload(config, 'm3-longform-editorial').behavior, 'blocking');
	assert.deepEqual(
		workloadThresholds(config, 'm3-longform-editorial').map(({
			metricId, behavior,
		}: { metricId: string; behavior: string }) => ({
			metricId, behavior,
		})),
		[
			{ metricId: 'editorial.audioPositionErrorSamples', behavior: 'blocking' },
			{ metricId: 'editorial.videoPositionErrorFrames', behavior: 'blocking' },
			{ metricId: 'editorial.avDriftMaximumMs', behavior: 'blocking' },
			{ metricId: 'editorial.seekP95Ms', behavior: 'observational' },
			{ metricId: 'editorial.scrollFrameIntervalP95Ms', behavior: 'observational' },
			{ metricId: 'editorial.retainedHeapDeltaBytes', behavior: 'observational' },
		],
	);
	assert.ok(qualityFixture(config, 'm3-longform-editorial-2h-v2'));
});

test('observational threshold misses warn while blocking misses fail', () => {
	const passingCorrectness = {
		'editorial.audioPositionErrorSamples': 0,
		'editorial.videoPositionErrorFrames': 0,
		'editorial.avDriftMaximumMs': 0,
		'editorial.seekP95Ms': 500,
		'editorial.scrollFrameIntervalP95Ms': 100,
		'editorial.retainedHeapDeltaBytes': 999_999_999,
	};
	const warning = evaluateQualityWorkload(config, 'm3-longform-editorial', passingCorrectness);
	assert.equal(warning.passed, true);
	assert.equal(warning.warnings.length, 3);
	assert.deepEqual(warning.failures, []);

	const failed = evaluateQualityWorkload(config, 'm3-longform-editorial', {
		...passingCorrectness,
		'editorial.audioPositionErrorSamples': 1,
	});
	assert.equal(failed.passed, false);
	assert.equal(failed.failures.length, 1);
	assert.equal(failed.warnings.length, 3);
});
