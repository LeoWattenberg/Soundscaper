/* SPDX-License-Identifier: AGPL-3.0-only */

const PARAMETRIC_EQ_ALIASES: ReadonlySet<string> = new Set([
	'eq',
	'parametric-eq',
	'parametric_eq',
]);
const PARAMETRIC_EQ_BAND_TYPES: readonly string[] = Object.freeze([
	'peaking',
	'lowshelf',
	'highshelf',
	'highpass',
	'lowpass',
	'notch',
]);
const PARAMETRIC_EQ_BAND_TYPE_SET: ReadonlySet<string> = new Set(PARAMETRIC_EQ_BAND_TYPES);
const PARAMETRIC_EQ_SLOPES: readonly number[] = Object.freeze([12, 24, 36, 48]);
const PARAMETRIC_EQ_SLOPE_SET: ReadonlySet<number> = new Set(PARAMETRIC_EQ_SLOPES);
const PARAMETRIC_EQ_MAXIMUM_BANDS = 12;

/**
 * Validate the persistence subset common to editor-owned and opaque audio
 * effects without loading executable effect registries or DSP runtimes.
 */
export function validatePersistedAudioEffects(value: unknown, name: string): true {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const ids = new Set<string>();
	for (const [index, item] of value.entries()) {
		const effectName = `${name}[${String(index)}]`;
		assertCloneable(item, effectName);
		const effect = objectValue(item, effectName);
		const id = nonEmptyString(effect.id, `${effectName}.id`);
		if (ids.has(id)) throw new RangeError(`${name} cannot contain duplicate IDs: ${id}.`);
		ids.add(id);
		const type = nonEmptyString(effect.type, `${effectName}.type`);
		if (typeof effect.enabled !== 'boolean') {
			throw new TypeError(`${effectName}.enabled must be a boolean.`);
		}
		const params = objectValue(effect.params, `${effectName}.params`);
		if (type === 'missing') validateMissingEffect(effect, effectName);
		else if (PARAMETRIC_EQ_ALIASES.has(type)) validateParametricEq(effect, params, effectName);
	}
	return true;
}

function validateMissingEffect(effect: Readonly<Record<string, unknown>>, name: string): void {
	const metadata = objectValue(effect.missing, `${name} missing effect compatibility metadata`);
	boundedNonEmptyString(metadata.name, 'missing effect name');
	boundedNonEmptyString(metadata.nativeId, 'missing effect native ID', 64 * 1_024);
	boundedNonEmptyString(metadata.reason, 'missing effect reason');
	boundedNonEmptyString(metadata.source || 'aup4', 'missing effect source');
	if (effect.opaqueAudacityNode !== undefined) {
		assertCloneable(effect.opaqueAudacityNode, `${name}.opaqueAudacityNode`);
	}
}

function validateParametricEq(
	effect: Readonly<Record<string, unknown>>,
	params: Readonly<Record<string, unknown>>,
	name: string,
): void {
	numberInRange(params.outputGain ?? 0, -24, 24, 'eq.outputGain');
	if (Object.hasOwn(params, 'bands')) {
		if (!Array.isArray(params.bands) || params.bands.length > PARAMETRIC_EQ_MAXIMUM_BANDS) {
			throw new RangeError(
				`The parametric EQ supports between zero and ${String(PARAMETRIC_EQ_MAXIMUM_BANDS)} bands.`,
			);
		}
		validateParametricEqBands(params.bands, String(effect.id));
	}
	if (effect.context !== undefined) validateJsonSafeMetadata(effect.context, `${name}.context`);
	if (effect.state !== undefined) validateJsonSafeMetadata(effect.state, `${name}.state`);
}

function validateParametricEqBands(bands: readonly unknown[], effectId: string): void {
	const explicitIds = new Set<string>();
	const sourceIds = bands.map((value, index) => {
		const name = `eq.bands[${String(index)}]`;
		const band = objectValue(value, name);
		let id: string | null = null;
		if (band.id != null && band.id !== '') {
			if (typeof band.id !== 'string' || !band.id.trim()) {
				throw new TypeError(`${name}.id must be a non-empty string.`);
			}
			id = band.id.trim();
			if (explicitIds.has(id)) throw new RangeError(`Duplicate parametric EQ band ID: ${id}.`);
			explicitIds.add(id);
		}
		optionalBoolean(band.enabled, true, `${name}.enabled`);
		parametricEqBandType(band.type ?? 'peaking', `${name}.type`);
		numberInRange(band.frequency, 10, 24_000, `${name}.frequency`);
		numberInRange(band.gain, -24, 24, `${name}.gain`);
		numberInRange(band.q, 0.1, 30, `${name}.q`);
		parametricEqSlope(band.slope ?? 12, `${name}.slope`);
		return id;
	});

	// Mirror the persisted EQ normalizer's deterministic collision handling so
	// explicit IDs may safely occupy IDs that an omitted band ID would use.
	const assignedIds = new Set(explicitIds);
	for (const [index, id] of sourceIds.entries()) {
		if (id) continue;
		const base = `${effectId ? `${effectId}-` : ''}band-${String(index + 1)}`;
		let generated = base;
		let suffix = 2;
		while (assignedIds.has(generated)) {
			generated = `${base}-${String(suffix)}`;
			suffix += 1;
		}
		assignedIds.add(generated);
	}
}

function validateJsonSafeMetadata(value: unknown, name: string): void {
	if (value === null) return;
	if (!isPlainObject(value)) throw new TypeError(`${name} must be a JSON-safe object or null.`);
	validateJsonSafeValue(value, name, new Set<object>());
}

function validateJsonSafeValue(value: unknown, name: string, ancestors: Set<object>): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`${name} numbers must be finite.`);
		return;
	}
	if (!value || typeof value !== 'object') {
		throw new TypeError(`${name} must contain only JSON-safe values.`);
	}
	if (!Array.isArray(value) && !isPlainObject(value)) {
		throw new TypeError(`${name} must contain only plain objects and arrays.`);
	}
	if (ancestors.has(value)) throw new TypeError(`${name} must not contain circular references.`);
	ancestors.add(value);
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			validateJsonSafeValue(item, `${name}[${String(index)}]`, ancestors);
		}
	} else {
		for (const [key, item] of Object.entries(value)) {
			validateJsonSafeValue(item, `${name}.${key}`, ancestors);
		}
	}
	ancestors.delete(value);
}

function assertCloneable(value: unknown, name: string): void {
	try {
		if (typeof structuredClone === 'function') {
			structuredClone(value);
			return;
		}
		const serialized = JSON.stringify(value);
		if (serialized === undefined) throw new TypeError('Value cannot be serialized.');
		JSON.parse(serialized) as unknown;
	} catch {
		throw new TypeError(`${name} must be cloneable.`);
	}
}

function objectValue(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	return value;
}

function boundedNonEmptyString(value: unknown, name: string, maximumCodeUnits = 1_024): string {
	const result = nonEmptyString(value, name);
	if (result.length > maximumCodeUnits) throw new RangeError(`${name} exceeds its size limit.`);
	return result;
}

function optionalBoolean(value: unknown, defaultValue: boolean, name: string): boolean {
	if (value === undefined) return defaultValue;
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function parametricEqBandType(value: unknown, name: string): string {
	if (typeof value !== 'string' || !PARAMETRIC_EQ_BAND_TYPE_SET.has(value)) {
		throw new RangeError(`${name} must be one of ${PARAMETRIC_EQ_BAND_TYPES.join(', ')}.`);
	}
	return value;
}

function parametricEqSlope(value: unknown, name: string): number {
	if (typeof value !== 'number' || !PARAMETRIC_EQ_SLOPE_SET.has(value)) {
		throw new RangeError(`${name} must be one of ${PARAMETRIC_EQ_SLOPES.join(', ')}.`);
	}
	return value;
}

function numberInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return value;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}
