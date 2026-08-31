/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateQualityBudget } from '../quality-budget-evaluator.mjs';

const BEHAVIORS = Object.freeze(['blocking', 'observational']);
const COMPARISONS = Object.freeze(['eq', 'gte', 'lte']);

export const DIAGNOSTIC_MEASUREMENT_POLICY = Object.freeze({
	percentileMethod: 'nearest-rank',
	missingMetric: 'fail',
	nonFiniteMetric: 'fail',
	environmentMismatch: 'fail',
	rendererMismatch: 'fail',
	benchmarkRetries: 0,
	timingWorkers: 1,
	timingWarmupTrials: 1,
	timingTrials: 5,
	forcedCollectionsPerHeapSnapshot: 3,
});

export function qualityFixture(configValue, fixtureId) {
	const config = qualityConfig(configValue);
	return exactDescriptor(config.fixtures, fixtureId, 'fixture');
}

export function qualityWorkload(configValue, workloadId) {
	const config = qualityConfig(configValue);
	const workload = exactDescriptor(config.workloads, workloadId, 'workload');
	assertExactFields(workload, ['behavior', 'fixtureIds', 'id', 'measurementIds'], `workload ${workloadId}`);
	if (!BEHAVIORS.includes(workload.behavior)) {
		throw new Error(`Quality workload ${workloadId} has an invalid behavior.`);
	}
	nonEmptyUniqueStrings(workload.fixtureIds, `Quality workload ${workloadId} fixtureIds`);
	nonEmptyUniqueStrings(workload.measurementIds, `Quality workload ${workloadId} measurementIds`);
	for (const fixtureId of workload.fixtureIds) exactDescriptor(config.fixtures, fixtureId, 'fixture');
	return workload;
}

export function workloadThresholds(configValue, workloadValue) {
	const config = qualityConfig(configValue);
	const workload = typeof workloadValue === 'string'
		? qualityWorkload(config, workloadValue)
		: qualityWorkload(config, ownString(workloadValue, 'id', 'workload'));
	return Object.freeze(workload.measurementIds.map((measurementId) => {
		const measurement = exactDescriptor(config.measurements, measurementId, 'measurement');
		assertExactFields(measurement, ['behavior', 'id'], `measurement ${measurementId}`);
		if (!BEHAVIORS.includes(measurement.behavior)) {
			throw new Error(`Quality measurement ${measurementId} has an invalid behavior.`);
		}
		const threshold = exactDescriptorBy(
			config.thresholds, 'measurementId', measurementId, 'threshold',
		);
		assertExactFields(
			threshold, ['comparison', 'measurementId', 'unit', 'value'],
			`threshold ${measurementId}`,
		);
		if (!COMPARISONS.includes(threshold.comparison)
			|| typeof threshold.value !== 'number'
			|| !Number.isFinite(threshold.value)
			|| typeof threshold.unit !== 'string'
			|| threshold.unit.length === 0) {
			throw new Error(`Quality threshold ${measurementId} is invalid.`);
		}
		return Object.freeze({
			metricId: measurementId,
			behavior: measurement.behavior,
			comparison: threshold.comparison,
			value: threshold.value,
			unit: threshold.unit,
		});
	}));
}

export function qualityWorkloadBudget(configValue, workloadId) {
	const workload = qualityWorkload(configValue, workloadId);
	return Object.freeze({
		...workload,
		thresholds: workloadThresholds(configValue, workload),
	});
}

export function observedDiagnosticEnvironment(environmentId, rendererRequirement = 'any') {
	if (typeof environmentId !== 'string' || environmentId.length === 0
		|| !['any', 'hardware'].includes(rendererRequirement)) {
		throw new Error('Observed diagnostic environment identity is invalid.');
	}
	return Object.freeze({ id: environmentId, status: 'active', rendererRequirement });
}

export function evaluateQualityWorkload(configValue, workloadValue, metricsValue) {
	const workload = typeof workloadValue === 'string'
		? qualityWorkload(configValue, workloadValue)
		: qualityWorkload(configValue, ownString(workloadValue, 'id', 'workload'));
	const thresholds = workloadThresholds(configValue, workload);
	return evaluateQualityBudget(thresholds, metricsValue);
}

export function qualityConfig(value) {
	const config = requireRecord(value, 'Quality config');
	if (config.schemaVersion !== 2
		|| !Array.isArray(config.fixtures)
		|| !Array.isArray(config.measurements)
		|| !Array.isArray(config.thresholds)
		|| !Array.isArray(config.workloads)) {
		throw new Error('Quality config must use schema version 2 with fixtures, measurements, thresholds, and workloads.');
	}
	assertExactFields(
		config,
		['fixtures', 'measurements', 'schemaVersion', 'thresholds', 'workloads'],
		'config',
	);
	if ([config.fixtures, config.measurements, config.thresholds, config.workloads]
		.some((collection) => collection.length === 0)) {
		throw new Error('Quality config collections must not be empty.');
	}
	const fixtureIds = validatedIds(config.fixtures, 'fixture');
	for (const fixture of config.fixtures) {
		assertAllowedFields(
			fixture, ['artifacts', 'id', 'kind', 'limitation', 'specification'],
			`fixture ${String(fixture.id)}`,
		);
		if (typeof fixture.kind !== 'string' || fixture.kind.length === 0
			|| !isRecord(fixture.specification)) {
			throw new Error(`Quality fixture ${String(fixture.id)} is invalid.`);
		}
	}
	const measurementIds = validatedIds(config.measurements, 'measurement');
	for (const measurement of config.measurements) {
		assertExactFields(measurement, ['behavior', 'id'], `measurement ${measurement.id}`);
		if (!BEHAVIORS.includes(measurement.behavior)) {
			throw new Error(`Quality measurement ${measurement.id} has an invalid behavior.`);
		}
	}
	const thresholdIds = uniqueStringsBy(config.thresholds, 'measurementId', 'threshold');
	if (!sameStrings(thresholdIds.toSorted(), measurementIds.toSorted())) {
		throw new Error('Quality thresholds must exactly cover the registered measurements.');
	}
	for (const threshold of config.thresholds) validateThreshold(threshold);
	validatedIds(config.workloads, 'workload');
	const usedMeasurementIds = [];
	for (const workload of config.workloads) {
		assertExactFields(workload, ['behavior', 'fixtureIds', 'id', 'measurementIds'], `workload ${workload.id}`);
		nonEmptyUniqueStrings(workload.fixtureIds, `Quality workload ${workload.id} fixtureIds`);
		nonEmptyUniqueStrings(workload.measurementIds, `Quality workload ${workload.id} measurementIds`);
		if (workload.fixtureIds.some((id) => !fixtureIds.includes(id))
			|| workload.measurementIds.some((id) => !measurementIds.includes(id))) {
			throw new Error(`Quality workload ${workload.id} references an unknown fixture or measurement.`);
		}
		const expectedBehavior = workload.measurementIds.some((id) => (
			config.measurements.find((measurement) => measurement.id === id)?.behavior === 'blocking'
		)) ? 'blocking' : 'observational';
		if (workload.behavior !== expectedBehavior) {
			throw new Error(`Quality workload ${workload.id} behavior does not match its measurements.`);
		}
		usedMeasurementIds.push(...workload.measurementIds);
	}
	if (!sameStrings([...new Set(usedMeasurementIds)].toSorted(), measurementIds.toSorted())) {
		throw new Error('Quality workloads must use every registered measurement.');
	}
	return config;
}

function validateThreshold(threshold) {
	assertExactFields(
		threshold, ['comparison', 'measurementId', 'unit', 'value'],
		`threshold ${String(threshold.measurementId)}`,
	);
	if (!COMPARISONS.includes(threshold.comparison)
		|| typeof threshold.value !== 'number'
		|| !Number.isFinite(threshold.value)
		|| typeof threshold.unit !== 'string'
		|| threshold.unit.length === 0) {
		throw new Error(`Quality threshold ${String(threshold.measurementId)} is invalid.`);
	}
}

function validatedIds(collection, label) {
	return uniqueStringsBy(collection, 'id', label);
}

function uniqueStringsBy(collection, field, label) {
	const values = collection.map((value) => {
		if (!isRecord(value) || typeof value[field] !== 'string' || value[field].length === 0) {
			throw new Error(`Quality ${label} has an invalid ${field}.`);
		}
		return value[field];
	});
	if (new Set(values).size !== values.length) {
		throw new Error(`Quality config must contain unique ${label} ${field} values.`);
	}
	return values;
}

function exactDescriptor(collection, id, label) {
	return exactDescriptorBy(collection, 'id', id, label);
}

function exactDescriptorBy(collection, field, id, label) {
	if (!Array.isArray(collection)) throw new Error(`Quality config has no ${label} descriptors.`);
	const matches = collection.filter((value) => isRecord(value) && value[field] === id);
	if (matches.length !== 1) {
		throw new Error(`Quality config must contain exactly one ${label} descriptor for ${id}.`);
	}
	return matches[0];
}

function assertExactFields(value, expected, label) {
	if (!sameStrings(Object.keys(value).toSorted(), expected.toSorted())) {
		throw new Error(`Quality ${label} must contain its exact fields.`);
	}
}

function assertAllowedFields(value, allowed, label) {
	if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
		throw new Error(`Quality ${label} contains an unsupported field.`);
	}
}

function nonEmptyUniqueStrings(value, label) {
	if (!Array.isArray(value) || value.length === 0
		|| value.some((item) => typeof item !== 'string' || item.length === 0)
		|| new Set(value).size !== value.length) {
		throw new Error(`${label} must be a non-empty unique string list.`);
	}
}

function ownString(value, property, label) {
	const record = requireRecord(value, `Quality ${label}`);
	const descriptor = Object.getOwnPropertyDescriptor(record, property);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'string' || descriptor.value.length === 0) {
		throw new Error(`Quality ${label} ${property} must be an own string data property.`);
	}
	return descriptor.value;
}

function requireRecord(value, label) {
	if (!isRecord(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new Error(`${label} must be a plain record.`);
	}
	return value;
}

function sameStrings(left, right) {
	return Array.isArray(left) && Array.isArray(right)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
