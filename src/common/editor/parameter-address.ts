/* SPDX-License-Identifier: AGPL-3.0-only */

const MAX_STABLE_ID_CODE_UNITS = 1_024;

export type StripRef =
	| Readonly<{ kind: 'track'; id: string }>
	| Readonly<{ kind: 'mixer-node'; id: string }>
	| Readonly<{ kind: 'master' }>;

export type ParameterAddress =
	| Readonly<{
		kind: 'strip';
		strip: StripRef;
		parameterId: 'gain' | 'pan' | 'mute';
	}>
	| Readonly<{
		kind: 'edge';
		edgeId: string;
		parameterId: 'level';
	}>
	| Readonly<{
		kind: 'effect';
		strip: StripRef;
		effectId: string;
		elementId?: string;
		parameterId: string;
	}>;

export type ParameterTaper = 'linear' | 'logarithmic' | 'decibel' | 'discrete';

export interface ParameterDescriptor {
	readonly id: string;
	readonly address: ParameterAddress;
	readonly unit: string;
	readonly minimum: number;
	readonly maximum: number;
	readonly defaultValue: number;
	readonly step: number | null;
	readonly taper: ParameterTaper;
	readonly automationTolerance: number;
	readonly automatable: boolean;
	readonly automationBlockReason?: string;
	readonly latencyFrames: number;
	readonly tailFrames: number;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

/** Validate and freeze the object form accepted by controllers and documents. */
export function normalizeParameterAddress(value: unknown): ParameterAddress {
	const address = record(value, 'A parameter address');
	const kind = address.kind;
	if (kind === 'strip') {
		closed(address, ['kind', 'strip', 'parameterId'], 'strip parameter address');
		const parameterId = address.parameterId;
		if (parameterId !== 'gain' && parameterId !== 'pan' && parameterId !== 'mute') {
			throw new RangeError('A strip parameter must be gain, pan, or mute.');
		}
		return Object.freeze({
			kind,
			strip: normalizeStripRef(address.strip),
			parameterId,
		});
	}
	if (kind === 'edge') {
		closed(address, ['kind', 'edgeId', 'parameterId'], 'edge parameter address');
		if (address.parameterId !== 'level') {
			throw new RangeError('An edge parameter must be level.');
		}
		return Object.freeze({
			kind,
			edgeId: stableId(address.edgeId, 'edge'),
			parameterId: 'level',
		});
	}
	if (kind === 'effect') {
		closed(address, ['kind', 'strip', 'effectId', 'elementId', 'parameterId'], 'effect parameter address');
		const elementId = address.elementId == null
			? undefined
			: stableId(address.elementId, 'effect element');
		return Object.freeze({
			kind,
			strip: normalizeStripRef(address.strip),
			effectId: stableId(address.effectId, 'effect'),
			...(elementId === undefined ? {} : { elementId }),
			parameterId: stableId(address.parameterId, 'effect parameter'),
		});
	}
	throw new RangeError('A parameter address kind must be strip, edge, or effect.');
}

export function normalizeStripRef(value: unknown): StripRef {
	const strip = record(value, 'A strip reference');
	if (strip.kind === 'master') {
		closed(strip, ['kind'], 'master strip reference');
		return Object.freeze({ kind: 'master' });
	}
	if (strip.kind === 'track' || strip.kind === 'mixer-node') {
		closed(strip, ['kind', 'id'], `${strip.kind} strip reference`);
		return Object.freeze({ kind: strip.kind, id: stableId(strip.id, `${strip.kind} strip`) });
	}
	throw new RangeError('A strip reference kind must be track, mixer-node, or master.');
}

/** Canonical collision-free key used by runtime registries and persisted lane indexes. */
export function canonicalParameterAddressKey(value: unknown): string {
	const address = normalizeParameterAddress(value);
	if (address.kind === 'strip') {
		return JSON.stringify(['strip', stripTuple(address.strip), address.parameterId]);
	}
	if (address.kind === 'edge') return JSON.stringify(['edge', address.edgeId, address.parameterId]);
	return JSON.stringify([
		'effect',
		stripTuple(address.strip),
		address.effectId,
		address.elementId ?? null,
		address.parameterId,
	]);
}

export function parameterAddressesEqual(left: unknown, right: unknown): boolean {
	return canonicalParameterAddressKey(left) === canonicalParameterAddressKey(right);
}

/**
 * V17 routes do not have edge IDs. This reserved identity is deterministic and
 * can be retained when 4A materializes the route as a persisted mixer edge.
 */
export function legacySendEdgeId(trackId: unknown, sendId: unknown): string {
	return JSON.stringify([
		'legacy-send-v1',
		stableId(trackId, 'track'),
		stableId(sendId, 'send'),
	]);
}

function stripTuple(strip: StripRef): readonly string[] {
	return strip.kind === 'master' ? ['master'] : [strip.kind, strip.id];
}

function record(value: unknown, name: string): UnknownRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	if (Object.getOwnPropertySymbols(value).length) {
		throw new TypeError(`${name} must contain only named own data properties.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const snapshot: Record<string, unknown> = {};
	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (!Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only own data properties.`);
		}
		snapshot[key] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function closed(value: UnknownRecord, allowed: readonly string[], name: string): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
	if (unknown) throw new TypeError(`${name} has an unknown member: ${unknown}.`);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value.length > MAX_STABLE_ID_CODE_UNITS) {
		throw new TypeError(`A stable ${name} ID is required.`);
	}
	return value;
}
