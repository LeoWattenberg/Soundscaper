/* SPDX-License-Identifier: AGPL-3.0-only */

const TARGETS = Object.freeze(['browser', 'desktop']);
const PROFILES = Object.freeze(['quick', 'extended']);
const THRESHOLD_METRIC_IDS = Object.freeze([
	'retainedJsHeapDeltaBytes', 'postWarmupHeapSlopeMibPerHour',
	'electronWorkingSetDeltaBytes', 'decodedMediaAvDriftMaximumMs',
	'decodedVideoDroppedFrames', 'failedAutosaves',
]);
const MEASURED_METRIC_IDS = Object.freeze([
	...THRESHOLD_METRIC_IDS, 'streamUnderrunFrames', 'streamedPlaybackObserved',
]);

export function validateSoundscaperSoakConfig(value) {
	const config = record(value, 'Soundscaper soak-debug configuration');
	exactKeys(config, [
		'schemaVersion', 'seed', 'profiles', 'operations', 'thresholds',
		'unavailableMeasurements', 'artifacts',
	], 'Soundscaper soak-debug configuration');
	if (config.schemaVersion !== 1) throw new TypeError('The soak-debug schemaVersion must be 1.');
	const seed = text(config.seed, 8, 128, 'soak-debug seed');
	const profiles = record(config.profiles, 'soak-debug profiles');
	exactKeys(profiles, PROFILES, 'soak-debug profiles');
	const quick = validateQuickProfile(profiles.quick);
	const extended = validateExtendedProfile(profiles.extended);
	const operations = denseArray(config.operations, 'soak-debug operations').map(validateOperation);
	unique(operations.map(({ id }) => id), 'soak-debug operation IDs');
	const thresholds = denseArray(config.thresholds, 'soak-debug thresholds').map(validateThreshold);
	unique(thresholds.map(({ metricId }) => metricId), 'soak-debug threshold metric IDs');
	if (thresholds.length !== THRESHOLD_METRIC_IDS.length
		|| THRESHOLD_METRIC_IDS.some((metricId) => !thresholds.some((row) => row.metricId === metricId))) {
		throw new TypeError('The soak-debug thresholds must cover the complete diagnostic metric inventory.');
	}
	const unavailableMeasurements = denseArray(
		config.unavailableMeasurements, 'soak-debug unavailable measurements',
	).map(validateUnavailableMeasurement);
	unique(unavailableMeasurements.map(({ metricId }) => metricId), 'unavailable measurement IDs');
	if (unavailableMeasurements.some(({ metricId }) => MEASURED_METRIC_IDS.includes(metricId))) {
		throw new TypeError('A soak-debug measurement cannot be both measured and unavailable.');
	}
	const artifactsValue = record(config.artifacts, 'soak-debug artifact limits');
	exactKeys(artifactsValue, [
		'maximumFailureArtifacts', 'maximumFailureArtifactBytes',
	], 'soak-debug artifact limits');
	const artifacts = {
		maximumFailureArtifacts: integer(
			artifactsValue.maximumFailureArtifacts, 0, 20, 'maximum failure artifacts',
		),
		maximumFailureArtifactBytes: integer(
			artifactsValue.maximumFailureArtifactBytes, 1, 8 * 1024 * 1024,
			'maximum failure artifact bytes',
		),
	};
	return deepFreeze({
		schemaVersion: 1, seed, profiles: { quick, extended }, operations,
		thresholds, unavailableMeasurements, artifacts,
	});
}

export function createSoundscaperSoakSchedule(configValue, profileValue, targetValue) {
	const config = validateSoundscaperSoakConfig(configValue);
	const profile = enumValue(profileValue, PROFILES, 'soak-debug profile');
	const target = enumValue(targetValue, TARGETS, 'soak-debug target');
	const profileConfig = config.profiles[profile];
	const rows = [];
	const endSeconds = profile === 'extended'
		? profileConfig.durationSeconds
		: profileConfig.maximumDurationSeconds;
	for (let elapsedSeconds = 0; elapsedSeconds <= endSeconds;
		elapsedSeconds += profileConfig.sampleIntervalSeconds) {
		rows.push({ kind: 'sample', elapsedSeconds });
	}
	const operations = config.operations.filter(({ targets }) => targets.includes(target));
	if (profile === 'quick') {
		operations.forEach((operation, index) => rows.push({
			kind: 'operation', operationId: operation.id,
			elapsedSeconds: profileConfig.warmupSeconds + 1 + (index * 2),
			variant: variant(config.seed, profile, target, operation.id, 0),
		}));
		const operationsEndSeconds = profileConfig.warmupSeconds + 2 + (operations.length * 2);
		if (operationsEndSeconds > profileConfig.maximumDurationSeconds) {
			throw new Error('The quick soak-debug schedule exceeds its maximum duration.');
		}
	} else {
		for (const operation of operations) {
			let iteration = 0;
			for (let elapsedSeconds = profileConfig.warmupSeconds + operation.extendedOffsetSeconds;
				elapsedSeconds < profileConfig.durationSeconds;
				elapsedSeconds += operation.extendedCadenceSeconds) {
				rows.push({
					kind: 'operation', operationId: operation.id, elapsedSeconds,
					variant: variant(config.seed, profile, target, operation.id, iteration),
				});
				iteration += 1;
			}
		}
	}
	rows.sort((left, right) => left.elapsedSeconds - right.elapsedSeconds
		|| scheduleKindPriority(left.kind) - scheduleKindPriority(right.kind)
		|| String(left.operationId ?? '').localeCompare(String(right.operationId ?? '')));
	return deepFreeze(rows.map((row, index) => ({
		eventId: `${target}-${profile}-${String(index + 1).padStart(5, '0')}`,
		...row,
	})));
}

function scheduleKindPriority(kind) {
	return kind === 'sample' ? 0 : 1;
}

/** Watchdog budget; extended gets one sample-time grace after its exact eight-hour boundary. */
export function soundscaperSoakWatchdogSeconds(configValue, profileValue) {
	const config = validateSoundscaperSoakConfig(configValue);
	const profile = enumValue(profileValue, PROFILES, 'soak-debug profile');
	return profile === 'quick'
		? config.profiles.quick.maximumDurationSeconds
		: config.profiles.extended.durationSeconds + 60;
}

function validateQuickProfile(value) {
	const profile = record(value, 'quick soak-debug profile');
	exactKeys(profile, [
		'maximumDurationSeconds', 'warmupSeconds', 'sampleIntervalSeconds',
	], 'quick soak-debug profile');
	const maximumDurationSeconds = integer(
		profile.maximumDurationSeconds, 1, 600, 'quick maximum duration',
	);
	const warmupSeconds = integer(profile.warmupSeconds, 0, maximumDurationSeconds - 1, 'quick warmup');
	const sampleIntervalSeconds = integer(
		profile.sampleIntervalSeconds, 1, maximumDurationSeconds, 'quick sample interval',
	);
	if (warmupSeconds % sampleIntervalSeconds !== 0) {
		throw new TypeError('The quick warmup must align to its sample interval.');
	}
	return { maximumDurationSeconds, warmupSeconds, sampleIntervalSeconds };
}

function validateExtendedProfile(value) {
	const profile = record(value, 'extended soak-debug profile');
	exactKeys(profile, [
		'durationSeconds', 'warmupSeconds', 'sampleIntervalSeconds',
	], 'extended soak-debug profile');
	const durationSeconds = integer(profile.durationSeconds, 1, 28_800, 'extended duration');
	if (durationSeconds !== 28_800) throw new TypeError('The extended soak-debug profile must run for eight hours.');
	const warmupSeconds = integer(profile.warmupSeconds, 0, durationSeconds - 1, 'extended warmup');
	const sampleIntervalSeconds = integer(
		profile.sampleIntervalSeconds, 1, durationSeconds, 'extended sample interval',
	);
	if (durationSeconds % sampleIntervalSeconds !== 0
		|| warmupSeconds % sampleIntervalSeconds !== 0) {
		throw new TypeError('The extended duration and warmup must align to its sample interval.');
	}
	return { durationSeconds, warmupSeconds, sampleIntervalSeconds };
}

function validateOperation(value, index) {
	const operation = record(value, `soak-debug operation ${String(index)}`);
	exactKeys(operation, [
		'id', 'targets', 'extendedCadenceSeconds', 'extendedOffsetSeconds', 'timeoutSeconds',
	], `soak-debug operation ${String(index)}`);
	const id = token(operation.id, `soak-debug operation ${String(index)} id`);
	const targets = denseArray(operation.targets, `${id} targets`)
		.map((target) => enumValue(target, TARGETS, `${id} target`));
	unique(targets, `${id} targets`);
	const extendedCadenceSeconds = integer(
		operation.extendedCadenceSeconds, 1, 28_800, `${id} cadence`,
	);
	const extendedOffsetSeconds = integer(
		operation.extendedOffsetSeconds, 0, extendedCadenceSeconds - 1, `${id} offset`,
	);
	const timeoutSeconds = integer(operation.timeoutSeconds, 1, 600, `${id} timeout`);
	return { id, targets, extendedCadenceSeconds, extendedOffsetSeconds, timeoutSeconds };
}

function validateThreshold(value, index) {
	const threshold = record(value, `soak-debug threshold ${String(index)}`);
	exactKeys(threshold, ['metricId', 'comparison', 'value', 'unit'], `soak-debug threshold ${String(index)}`);
	const metricId = enumValue(threshold.metricId, THRESHOLD_METRIC_IDS, 'threshold metricId');
	const comparison = enumValue(threshold.comparison, ['lte', 'eq'], `${metricId} comparison`);
	if (typeof threshold.value !== 'number' || !Number.isFinite(threshold.value) || threshold.value < 0) {
		throw new TypeError(`${metricId} threshold must be a finite non-negative number.`);
	}
	return { metricId, comparison, value: threshold.value, unit: text(threshold.unit, 1, 32, `${metricId} unit`) };
}

function validateUnavailableMeasurement(value, index) {
	const measurement = record(value, `unavailable measurement ${String(index)}`);
	exactKeys(measurement, ['metricId', 'reason'], `unavailable measurement ${String(index)}`);
	return {
		metricId: metricToken(measurement.metricId, 'unavailable metricId'),
		reason: text(measurement.reason, 24, 300, 'unavailable measurement reason'),
	};
}

function variant(seed, profile, target, operationId, iteration) {
	let hash = 2_166_136_261;
	for (const character of `${seed}:${profile}:${target}:${operationId}:${String(iteration)}`) {
		hash ^= character.codePointAt(0);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function exactKeys(value, keys, label) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new TypeError(`${label} has invalid fields.`);
	}
}

function record(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be an object.`);
	return value;
}

function denseArray(value, label) {
	if (!Array.isArray(value) || value.length === 0
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${label} must be a non-empty dense array.`);
	return value;
}

function unique(values, label) {
	if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique.`);
}

function token(value, label) {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value)) {
		throw new TypeError(`${label} must be a bounded token.`);
	}
	return value;
}

function metricToken(value, label) {
	if (typeof value !== 'string' || !/^[a-z][A-Za-z0-9]{0,63}$/u.test(value)) {
		throw new TypeError(`${label} must be a bounded metric identifier.`);
	}
	return value;
}

function text(value, minimum, maximum, label) {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum
		|| [...value].some(controlCharacter)) throw new TypeError(`${label} is invalid.`);
	return value;
}

function controlCharacter(character) {
	const code = character.codePointAt(0);
	return code < 32 || code === 127;
}

function integer(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new TypeError(`${label} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	}
	return value;
}

function enumValue(value, values, label) {
	if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`${label} is invalid.`);
	return value;
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
