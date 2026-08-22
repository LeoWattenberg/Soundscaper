/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertOfxEffectStateV26,
	type OfxEffectStateV26,
} from '../common/editor/native-ofx-state-v26.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import { validateFramescaperProjectV26, type FramescaperProjectV26 } from './editor-project-v26.ts';

export interface FramescaperOpenFxClipboardV10 {
	readonly schemaVersion: 10;
	readonly kind: 'framescaper-openfx-fragment';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly effects: readonly OfxEffectStateV26[];
}

const CARRIER_FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'effects',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;

export function createFramescaperOpenFxClipboardV10(
	profile: unknown,
	project: unknown,
	instanceIdsValue: readonly string[],
): FramescaperOpenFxClipboardV10 {
	assertFramescaperProjectV26CandidateProfile(profile);
	validateFramescaperProjectV26(profile, project);
	const candidate = project as FramescaperProjectV26;
	const instanceIds = snapshotIds(instanceIdsValue, 'selected OpenFX instance IDs');
	if (instanceIds.length === 0) throw new RangeError('An OpenFX clipboard selection cannot be empty.');
	const selected = new Set(instanceIds);
	const effects = candidate.ofxEffects.filter(({ instanceId }) => selected.has(instanceId));
	if (effects.length !== selected.size) throw new ReferenceError('An OpenFX clipboard selection names a missing effect.');
	return normalizeFramescaperOpenFxClipboardV10({
		schemaVersion: 10,
		kind: 'framescaper-openfx-fragment',
		originProjectId: candidate.id,
		originRevision: candidate.revision,
		effects,
	});
}

export function normalizeFramescaperOpenFxClipboardV10(
	value: unknown,
): FramescaperOpenFxClipboardV10 {
	const carrier = closedRecord(value, CARRIER_FIELDS, 'Framescaper OpenFX clipboard V10');
	if (carrier.schemaVersion !== 10) throw new RangeError('Framescaper OpenFX clipboard requires V10 re-copy.');
	if (carrier.kind !== 'framescaper-openfx-fragment') throw new RangeError('Framescaper OpenFX clipboard kind is unsupported.');
	if (!Array.isArray(carrier.effects) || carrier.effects.length < 1 || carrier.effects.length > 100_000) {
		throw new RangeError('Framescaper OpenFX clipboard effects must be a bounded non-empty array.');
	}
	const ids = new Set<string>();
	const effects = carrier.effects.map((effect) => {
		const snapshot = structuredClone(effect) as OfxEffectStateV26;
		assertOfxEffectStateV26(snapshot);
		if (ids.has(snapshot.instanceId)) throw new RangeError('OpenFX clipboard instance IDs must be unique.');
		ids.add(snapshot.instanceId);
		return deepFreeze(snapshot);
	});
	return deepFreeze({
		schemaVersion: 10 as const,
		kind: 'framescaper-openfx-fragment' as const,
		originProjectId: stableId(carrier.originProjectId, 'originProjectId'),
		originRevision: nonNegativeInteger(carrier.originRevision, 'originRevision'),
		effects,
	});
}

export function prepareFramescaperOpenFxClipboardPasteV10(
	clipboardValue: unknown,
	options: Readonly<{
		instanceIdMap: ReadonlyMap<string, string>;
		projectReferenceIdMap: ReadonlyMap<string, string>;
	}>,
): readonly OfxEffectStateV26[] {
	const clipboard = normalizeFramescaperOpenFxClipboardV10(clipboardValue);
	const instanceIds = allocationMap(options?.instanceIdMap, 'instanceIdMap');
	const projectReferences = allocationMap(options?.projectReferenceIdMap, 'projectReferenceIdMap');
	const oldIds = new Set<string>([...instanceIds.keys(), ...projectReferences.keys()]);
	const freshIds = new Set<string>();
	for (const [name, map] of [['instance', instanceIds], ['project reference', projectReferences]] as const) {
		for (const [source, targetValue] of map) {
			stableId(source, `${name} allocation source`);
			const target = stableId(targetValue, `${name} allocation target`);
			if (oldIds.has(target)) throw new RangeError(`OpenFX paste ${name} allocations must be fresh.`);
			if (freshIds.has(target)) throw new RangeError('OpenFX paste allocations must be unique and collision-free.');
			freshIds.add(target);
		}
	}
	const usedInstances = new Set<string>();
	const usedReferences = new Set<string>();
	const effects = clipboard.effects.map((effect) => {
		const instanceId = mapped(instanceIds, usedInstances, effect.instanceId, 'instance ID');
		const frozenFallback = effect.frozenFallback === null ? null : {
			...effect.frozenFallback,
			externalMediaSourceId: mapped(
				projectReferences,
				usedReferences,
				effect.frozenFallback.externalMediaSourceId,
				'frozen fallback source',
			),
		};
		const state = {
			...structuredClone(effect),
			instanceId,
			attachment: {
				...effect.attachment,
				targetId: mapped(projectReferences, usedReferences, effect.attachment.targetId, 'attachment target'),
			},
			inputs: effect.inputs.map((input) => ({
				...input,
				sourceRef: mapped(projectReferences, usedReferences, input.sourceRef, 'named input'),
			})),
			frozenFallback,
		} as OfxEffectStateV26;
		assertOfxEffectStateV26(state);
		return deepFreeze(state);
	});
	assertNoUnused(instanceIds, usedInstances, 'instance');
	assertNoUnused(projectReferences, usedReferences, 'project reference');
	return Object.freeze(effects);
}

function mapped(
	map: ReadonlyMap<string, string>,
	used: Set<string>,
	source: string,
	label: string,
): string {
	const value = map.get(source);
	if (value === undefined) throw new ReferenceError(`OpenFX paste has no fresh ${label} mapping for ${source}.`);
	used.add(source);
	return stableId(value, `mapped ${label}`);
}

function allocationMap(value: unknown, name: string): ReadonlyMap<string, string> {
	if (!value || typeof value !== 'object'
		|| typeof (value as ReadonlyMap<unknown, unknown>).get !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).entries !== 'function'
		|| !Number.isSafeInteger((value as ReadonlyMap<unknown, unknown>).size)
		|| (value as ReadonlyMap<unknown, unknown>).size > 100_000) {
		throw new TypeError(`OpenFX paste ${name} must be a bounded map.`);
	}
	return value as ReadonlyMap<string, string>;
}

function assertNoUnused(
	map: ReadonlyMap<string, string>,
	used: ReadonlySet<string>,
	name: string,
): void {
	for (const source of map.keys()) {
		if (!used.has(source)) throw new RangeError(`OpenFX paste contains an unused ${name} allocation ${source}.`);
	}
}

function snapshotIds(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const ids = value.map((entry) => stableId(entry, name));
	if (new Set(ids).size !== ids.length) throw new RangeError(`${name} must be unique.`);
	return Object.freeze(ids);
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const result = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(result);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must carry exactly its schema keys.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(result, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
	}
	return result;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable project identity.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}
