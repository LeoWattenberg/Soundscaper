/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_COMP_MAXIMUM_ID_CHARACTERS,
	TAKE_COMP_MAXIMUM_ENTITIES,
	normalizeTakeCompGroup,
	type TakeCompGroup,
	type TakeCompTake,
	type TakeId,
	type TakeLaneId,
} from './take-comp-domain.ts';

export interface TakeCompDocumentTake extends TakeCompTake {
	readonly sourceId: string;
	readonly startSample: number;
	readonly endSample: number;
	readonly sourceStartSample: number;
}

export interface TakeCompDocumentGroup extends Omit<TakeCompGroup, 'takes'> {
	readonly sequenceId: string;
	readonly trackId: string;
	readonly takes: readonly TakeCompDocumentTake[];
}

type DataRecord = Readonly<Record<string, unknown>>;

interface DocumentContext {
	readonly sources: ReadonlyMap<string, DataRecord>;
	readonly tracks: ReadonlyMap<string, DataRecord>;
	readonly sequenceOrder: ReadonlyMap<string, number>;
	readonly trackOrder: ReadonlyMap<string, number>;
	readonly sequenceTracks: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Normalize the complete schema-V17 take graph against project media ownership. */
export function createTakeCompDocumentGroupsV17(
	value: unknown,
	project: Readonly<Record<string, unknown>>,
): readonly TakeCompDocumentGroup[] {
	const context = documentContext(project);
	const values = denseArray(value, 'project.takeGroups');
	if (values.length > TAKE_COMP_MAXIMUM_ENTITIES) {
		throw new RangeError(`project.takeGroups cannot exceed ${String(TAKE_COMP_MAXIMUM_ENTITIES)} groups.`);
	}
	const groups = values.map((candidate, index) => normalizeDocumentGroup(
		candidate,
		`project.takeGroups[${String(index)}]`,
		context,
	));
	groups.sort((left, right) => compareGroups(left, right, context));
	validateGlobalGraph(groups);
	return Object.freeze(groups);
}

/** Validate that persisted V17 state is already in its one canonical ordering. */
export function validateTakeCompDocumentGroupsV17(
	value: unknown,
	project: Readonly<Record<string, unknown>>,
): value is readonly TakeCompDocumentGroup[] {
	const normalized = createTakeCompDocumentGroupsV17(value, project);
	if (!equivalentData(value, normalized)) {
		throw new RangeError('project.takeGroups must use canonical lane, take, region, and group ordering.');
	}
	return true;
}

function normalizeDocumentGroup(
	value: unknown,
	name: string,
	context: DocumentContext,
): TakeCompDocumentGroup {
	const input = closedRecord(value, name, [
		'id', 'sequenceId', 'trackId', 'startSample', 'endSample',
		'laneOrder', 'lanes', 'takes', 'compRegions',
	]);
	const sequenceId = stableId(input.sequenceId, `${name}.sequenceId`);
	const trackId = stableId(input.trackId, `${name}.trackId`);
	const track = context.tracks.get(trackId);
	if (!track) throw new ReferenceError(`${name} references missing track ${trackId}.`);
	if (dataValue(track, 'type', `track ${trackId}`) !== 'audio') {
		throw new RangeError(`${name} requires an audio track.`);
	}
	const sequenceTracks = context.sequenceTracks.get(sequenceId);
	if (!sequenceTracks) throw new ReferenceError(`${name} references missing sequence ${sequenceId}.`);
	if (!sequenceTracks.has(trackId)) {
		throw new RangeError(`${name} track ${trackId} does not belong to sequence ${sequenceId}.`);
	}

	const takeValues = denseArray(input.takes, `${name}.takes`);
	const enrichedById = new Map<string, TakeCompDocumentTake>();
	const coreTakes = takeValues.map((candidate, index) => {
		const takeName = `${name}.takes[${String(index)}]`;
		const take = closedRecord(candidate, takeName, [
			'id', 'laneId', 'sourceId', 'startSample', 'endSample', 'sourceStartSample',
		]);
		const id = stableId(take.id, `${takeName}.id`) as TakeId;
		const laneId = stableId(take.laneId, `${takeName}.laneId`) as TakeLaneId;
		const sourceId = stableId(take.sourceId, `${takeName}.sourceId`);
		const source = context.sources.get(sourceId);
		if (!source) throw new ReferenceError(`${takeName} references missing source ${sourceId}.`);
		if (dataValue(source, 'kind', `source ${sourceId}`) !== 'audio') {
			throw new RangeError(`${takeName} requires an audio source.`);
		}
		const startSample = safeInteger(take.startSample, 0, `${takeName}.startSample`);
		const endSample = safeInteger(take.endSample, 0, `${takeName}.endSample`);
		const sourceStartSample = safeInteger(take.sourceStartSample, 0, `${takeName}.sourceStartSample`);
		if (endSample <= startSample) throw new RangeError(`${takeName} must have positive extent.`);
		const sourceFrameCount = safeInteger(
			dataValue(source, 'frameCount', `source ${sourceId}`),
			1,
			`source ${sourceId}.frameCount`,
		);
		if (sourceStartSample + endSample - startSample > sourceFrameCount) {
			throw new RangeError(`${takeName} exceeds source bounds.`);
		}
		const enriched = Object.freeze({
			id, laneId, sourceId, startSample, endSample, sourceStartSample,
		});
		if (enrichedById.has(id)) throw new RangeError(`Duplicate take ID ${id}.`);
		enrichedById.set(id, enriched);
		return { id, laneId };
	});

	const core = normalizeTakeCompGroup({
		id: input.id,
		startSample: input.startSample,
		endSample: input.endSample,
		laneOrder: input.laneOrder,
		lanes: input.lanes,
		takes: coreTakes,
		compRegions: input.compRegions,
	});
	const takes = core.takes.map(({ id }) => enrichedById.get(id)!);
	for (const take of takes) {
		if (take.startSample < core.startSample || take.endSample > core.endSample) {
			throw new RangeError(`Take ${take.id} must remain within take group ${core.id}.`);
		}
	}
	const takeById = new Map(takes.map((take) => [take.id, take]));
	for (const region of core.compRegions) {
		const take = takeById.get(region.takeId)!;
		if (region.startSample < take.startSample || region.endSample > take.endSample) {
			throw new RangeError(`Comp region ${region.id} must remain within its available take span.`);
		}
	}
	return Object.freeze({
		id: core.id,
		sequenceId,
		trackId,
		startSample: core.startSample,
		endSample: core.endSample,
		laneOrder: core.laneOrder,
		lanes: core.lanes,
		takes: Object.freeze(takes),
		compRegions: core.compRegions,
	});
}

function documentContext(project: Readonly<Record<string, unknown>>): DocumentContext {
	const sources = dataRecords(dataValue(project, 'sources', 'project'), 'project.sources');
	const tracks = dataRecords(dataValue(project, 'tracks', 'project'), 'project.tracks');
	const sequences = dataRecords(dataValue(project, 'sequences', 'project'), 'project.sequences');
	const sourceMap = uniqueRecordMap(sources, 'source');
	const trackMap = uniqueRecordMap(tracks, 'track');
	const sequenceOrder = new Map<string, number>();
	const trackOrder = new Map<string, number>();
	const sequenceTracks = new Map<string, ReadonlySet<string>>();
	for (const [sequenceIndex, sequence] of sequences.entries()) {
		const sequenceId = stableId(dataValue(sequence, 'id', 'project sequence'), 'sequence ID');
		if (sequenceOrder.has(sequenceId)) throw new RangeError(`Duplicate sequence ID ${sequenceId}.`);
		sequenceOrder.set(sequenceId, sequenceIndex);
		const ids = denseArray(dataValue(sequence, 'trackIds', `sequence ${sequenceId}`), `sequence ${sequenceId}.trackIds`)
			.map((id, index) => stableId(id, `sequence ${sequenceId}.trackIds[${String(index)}]`));
		sequenceTracks.set(sequenceId, new Set(ids));
		for (const [index, trackId] of ids.entries()) {
			if (!trackMap.has(trackId)) throw new ReferenceError(`Sequence ${sequenceId} references missing track ${trackId}.`);
			trackOrder.set(`${sequenceId}\u0000${trackId}`, index);
		}
	}
	return { sources: sourceMap, tracks: trackMap, sequenceOrder, trackOrder, sequenceTracks };
}

function validateGlobalGraph(groups: readonly TakeCompDocumentGroup[]): void {
	const identities = new Set<string>();
	const previousByTrack = new Map<string, TakeCompDocumentGroup>();
	let count = 0;
	for (const group of groups) {
		for (const id of groupIdentities(group)) {
			count += 1;
			if (count > TAKE_COMP_MAXIMUM_ENTITIES) {
				throw new RangeError(`Take comp document exceeds ${String(TAKE_COMP_MAXIMUM_ENTITIES)} identities.`);
			}
			if (identities.has(id)) throw new RangeError(`Duplicate take/comp identity ${id}.`);
			identities.add(id);
		}
		const key = `${group.sequenceId}\u0000${group.trackId}`;
		const previous = previousByTrack.get(key);
		if (previous && group.startSample < previous.endSample) {
			throw new RangeError(`Take groups ${previous.id} and ${group.id} overlap on track ${group.trackId}.`);
		}
		previousByTrack.set(key, group);
	}
}

function groupIdentities(group: TakeCompDocumentGroup): readonly string[] {
	return [
		group.id,
		...group.lanes.map(({ id }) => id),
		...group.takes.map(({ id }) => id),
		...group.compRegions.map(({ id }) => id),
	];
}

function compareGroups(
	left: TakeCompDocumentGroup,
	right: TakeCompDocumentGroup,
	context: DocumentContext,
): number {
	return (context.sequenceOrder.get(left.sequenceId)! - context.sequenceOrder.get(right.sequenceId)!)
		|| (context.trackOrder.get(`${left.sequenceId}\u0000${left.trackId}`)!
			- context.trackOrder.get(`${right.sequenceId}\u0000${right.trackId}`)!)
		|| left.startSample - right.startSample
		|| compareText(left.id, right.id);
}

function uniqueRecordMap(values: readonly DataRecord[], label: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const value of values) {
		const id = stableId(dataValue(value, 'id', label), `${label} ID`);
		if (result.has(id)) throw new RangeError(`Duplicate ${label} ID ${id}.`);
		result.set(id, value);
	}
	return result;
}

function dataRecords(value: unknown, name: string): readonly DataRecord[] {
	return denseArray(value, name).map((entry, index) => dataRecord(entry, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function dataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function closedRecord(value: unknown, name: string, expectedKeys: readonly string[]): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== expectedKeys.length
		|| keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of expectedKeys) result[key] = dataValue(record as DataRecord, key, name);
	return Object.freeze(result);
}

function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > TAKE_COMP_MAXIMUM_ENTITIES
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a standard dense data array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data items.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	if (value.length > TAKE_COMP_MAXIMUM_ID_CHARACTERS) {
		throw new RangeError(`${name} cannot exceed ${String(TAKE_COMP_MAXIMUM_ID_CHARACTERS)} characters.`);
	}
	return value;
}

function safeInteger(value: unknown, minimum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`${name} must be a safe integer of at least ${String(minimum)}.`);
	}
	return Number(value);
}

function equivalentData(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length
			&& left.every((value, index) => equivalentData(value, right[index]));
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key) => rightKeys.includes(key)
			&& equivalentData((left as DataRecord)[key], (right as DataRecord)[key]));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
