/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTakeCompProjectSchema } from '../project-schema-version.ts';
import {
	createTakeCompDocumentGroupsV17,
	type TakeCompDocumentGroup,
} from '../take-comp-document-v17.ts';
import {
	normalizeTakeCompGroup,
	TAKE_COMP_MAXIMUM_ENTITIES,
} from '../take-comp-domain.ts';
import type { AudioEditorClipboard, CommandObject } from './protocol.ts';

type DataRecord = Record<string, unknown>;
type IdFactory = (prefix: string) => string;

interface ClipboardTakeLane {
	readonly key: string;
}

interface ClipboardTake {
	readonly key: string;
	readonly laneKey: string;
	readonly sourceId: string;
	readonly startOffsetFrame: number;
	readonly endOffsetFrame: number;
	readonly sourceStartFrame: number;
}

interface ClipboardCompRegion {
	readonly key: string;
	readonly takeKey: string;
	readonly startOffsetFrame: number;
	readonly endOffsetFrame: number;
}

export interface ClipboardTakeGroup {
	readonly key: string;
	readonly sourceSequenceId: string;
	readonly sourceTrackId: string;
	readonly startOffsetFrame: number;
	readonly endOffsetFrame: number;
	readonly laneOrder: readonly string[];
	readonly lanes: readonly ClipboardTakeLane[];
	readonly takes: readonly ClipboardTake[];
	readonly compRegions: readonly ClipboardCompRegion[];
}

interface ClipboardCopyOptions {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
}

interface MutablePasteCommand extends DataRecord {
	trackMap?: Record<string, string>;
	sequenceMap?: Record<string, string>;
	takeGroupIds?: Record<string, string>;
	takeLaneIds?: Record<string, string>;
	takeIds?: Record<string, string>;
	compRegionIds?: Record<string, string>;
}

interface PasteGeometry {
	readonly placementFrameBySequenceId: ReadonlyMap<string, number>;
}

const GROUP_KEYS = new Set([
	'key', 'sourceSequenceId', 'sourceTrackId', 'startOffsetFrame', 'endOffsetFrame',
	'laneOrder', 'lanes', 'takes', 'compRegions',
]);
const LANE_KEYS = new Set(['key']);
const TAKE_KEYS = new Set([
	'key', 'laneKey', 'sourceId', 'startOffsetFrame', 'endOffsetFrame', 'sourceStartFrame',
]);
const REGION_KEYS = new Set(['key', 'takeKey', 'startOffsetFrame', 'endOffsetFrame']);
const PASTE_MAP_FIELDS = [
	'takeGroupIds', 'takeLaneIds', 'takeIds', 'compRegionIds',
] as const;

/** Project exact V17 take geometry into the selected clipboard interval. */
export function createTakeCompClipboardGroups(
	projectValue: unknown,
	options: ClipboardCopyOptions,
): readonly ClipboardTakeGroup[] {
	const project = record(projectValue, 'project');
	if (!isTakeCompProjectSchema(project.schemaVersion)) return Object.freeze([]);
	const startFrame = nonNegativeInteger(options.startFrame, 'clipboard startFrame');
	const endFrame = nonNegativeInteger(options.endFrame, 'clipboard endFrame');
	if (endFrame <= startFrame) throw new RangeError('Clipboard take range must have positive extent.');
	const trackIds = new Set(options.trackIds.map((id, index) => stableId(id, `trackIds[${String(index)}]`)));
	const groups = createTakeCompDocumentGroupsV17(project.takeGroups, project);
	return normalizeTakeCompClipboardGroups(groups.flatMap((group) => {
		if (!trackIds.has(group.trackId)) return [];
		const clippedStart = Math.max(startFrame, group.startSample);
		const clippedEnd = Math.min(endFrame, group.endSample);
		if (clippedEnd <= clippedStart) return [];
		const takes = group.takes.flatMap((take) => {
			const takeStart = Math.max(clippedStart, take.startSample);
			const takeEnd = Math.min(clippedEnd, take.endSample);
			if (takeEnd <= takeStart) return [];
			return [{
				key: take.id,
				laneKey: take.laneId,
				sourceId: take.sourceId,
				startOffsetFrame: takeStart - startFrame,
				endOffsetFrame: takeEnd - startFrame,
				sourceStartFrame: take.sourceStartSample + takeStart - take.startSample,
			}];
		});
		if (takes.length === 0) return [];
		const takeKeys = new Set(takes.map(({ key }) => key));
		return [{
			key: group.id,
			sourceSequenceId: group.sequenceId,
			sourceTrackId: group.trackId,
			startOffsetFrame: clippedStart - startFrame,
			endOffsetFrame: clippedEnd - startFrame,
			laneOrder: [...group.laneOrder],
			lanes: group.lanes.map(({ id }) => ({ key: id })),
			takes,
			compRegions: group.compRegions.flatMap((region) => {
				if (!takeKeys.has(region.takeId)) return [];
				const regionStart = Math.max(clippedStart, region.startSample);
				const regionEnd = Math.min(clippedEnd, region.endSample);
				return regionEnd <= regionStart ? [] : [{
					key: region.id,
					takeKey: region.takeId,
					startOffsetFrame: regionStart - startFrame,
					endOffsetFrame: regionEnd - startFrame,
				}];
			}),
		}];
	}));
}

/** Normalize one closed, bounded V4 take clipboard graph. */
export function normalizeTakeCompClipboardGroups(value: unknown): readonly ClipboardTakeGroup[] {
	const values = denseArray(value, 'clipboard.takeGroups', TAKE_COMP_MAXIMUM_ENTITIES);
	const identities = new Set<string>();
	let identityCount = 0;
	const groups = values.map((entry, index) => normalizeGroup(entry, index, identities, () => {
		identityCount += 1;
		if (identityCount > TAKE_COMP_MAXIMUM_ENTITIES) {
			throw new RangeError(`Clipboard take graph exceeds ${String(TAKE_COMP_MAXIMUM_ENTITIES)} identities.`);
		}
	}));
	groups.sort((left, right) => compareText(left.sourceSequenceId, right.sourceSequenceId)
		|| compareText(left.sourceTrackId, right.sourceTrackId)
		|| left.startOffsetFrame - right.startOffsetFrame
		|| compareText(left.key, right.key));
	const previousByTrack = new Map<string, ClipboardTakeGroup>();
	for (const group of groups) {
		const trackKey = `${group.sourceSequenceId}\u0000${group.sourceTrackId}`;
		const previous = previousByTrack.get(trackKey);
		if (previous && group.startOffsetFrame < previous.endOffsetFrame) {
			throw new RangeError(`Clipboard take groups ${previous.key} and ${group.key} overlap.`);
		}
		previousByTrack.set(trackKey, group);
	}
	return Object.freeze(groups);
}

/** Ensure every take group belongs to one copied audio-track context. */
export function assertTakeCompClipboardTrackOwnership(
	groups: readonly ClipboardTakeGroup[],
	tracksValue: unknown,
): void {
	const tracks = denseArray(tracksValue, 'clipboard.tracks', 100_000).map((value, index) => (
		record(value, `clipboard.tracks[${String(index)}]`)
	));
	for (const group of groups) {
		const matches = tracks.filter((track) => track.sourceTrackId === group.sourceTrackId);
		if (matches.length !== 1) {
			throw new ReferenceError(`Clipboard take group ${group.key} references missing source track ${group.sourceTrackId}.`);
		}
		const track = matches[0]!;
		if (track.sourceTrackType !== 'audio' || track.sourceSequenceId !== group.sourceSequenceId) {
			throw new RangeError(`Clipboard take group ${group.key} must belong to its source audio-track sequence.`);
		}
	}
}

export function collectTakeCompClipboardSourceIds(groups: readonly ClipboardTakeGroup[]): readonly string[] {
	return [...new Set(groups.flatMap(({ takes }) => takes.map(({ sourceId }) => sourceId)))].sort(compareText);
}

/** Allocate all persistent identities before a V4/V5 command crosses history. */
export function prepareTakeCompClipboardPasteIds(
	clipboard: AudioEditorClipboard,
	command: MutablePasteCommand,
	idFactory: IdFactory,
): void {
	if (clipboard.schemaVersion !== 4 && clipboard.schemaVersion !== 5) return;
	const groups = normalizeTakeCompClipboardGroups(clipboard.takeGroups);
	const takeGroupIds = nullRecord();
	const takeLaneIds = nullRecord();
	const takeIds = nullRecord();
	const compRegionIds = nullRecord();
	for (const group of groups) {
		takeGroupIds[group.key] = idFactory('take-group');
		for (const lane of group.lanes) takeLaneIds[lane.key] = idFactory('take-lane');
		for (const take of group.takes) takeIds[take.key] = idFactory('take');
		for (const region of group.compRegions) compRegionIds[region.key] = idFactory('comp-region');
	}
	command.takeGroupIds = { ...takeGroupIds };
	command.takeLaneIds = { ...takeLaneIds };
	command.takeIds = { ...takeIds };
	command.compRegionIds = { ...compRegionIds };
}

/** Validate and stage a V4/V5 take paste beside its media and annotation mutations. */
export function stageTakeCompClipboardPaste(
	projectValue: unknown,
	clipboard: AudioEditorClipboard,
	commandValue: unknown,
	mode: string,
	scale: number,
	geometry: PasteGeometry,
): () => void {
	const project = record(projectValue, 'project');
	const command = record(commandValue, 'clipboard paste command') as MutablePasteCommand;
	if (clipboard.schemaVersion !== 4 && clipboard.schemaVersion !== 5) {
		for (const field of PASTE_MAP_FIELDS) {
			if (Object.hasOwn(command, field)) throw new TypeError(`Legacy clipboard paste cannot contain ${field}.`);
		}
		return () => undefined;
	}
	if (!isTakeCompProjectSchema(project.schemaVersion)) {
		throw new RangeError('Take-comp clipboard paste requires schema 17.');
	}
	const groups = normalizeTakeCompClipboardGroups(clipboard.takeGroups);
	const maps = validatePasteMaps(project, groups, command);
	if (groups.length === 0) return () => undefined;
	if ((mode === 'insert-track' || mode === 'insert-all')
		&& existingTargetGroups(project, groups, command).length > 0) {
		throw new RangeError('Insert paste cannot move an existing take graph without explicit split identities.');
	}
	const additions = groups.map((group) => pastedGroup(group, command, maps, scale, geometry));
	const next = createTakeCompDocumentGroupsV17([
		...denseArray(project.takeGroups, 'project.takeGroups', TAKE_COMP_MAXIMUM_ENTITIES),
		...additions,
	], project);
	return () => { project.takeGroups = next; };
}

function normalizeGroup(
	value: unknown,
	index: number,
	identities: Set<string>,
	countIdentity: () => void,
): ClipboardTakeGroup {
	const name = `clipboard.takeGroups[${String(index)}]`;
	const group = closedRecord(value, name, GROUP_KEYS);
	const key = identity(group.key, `${name}.key`, identities, countIdentity);
	const sourceSequenceId = stableId(group.sourceSequenceId, `${name}.sourceSequenceId`);
	const sourceTrackId = stableId(group.sourceTrackId, `${name}.sourceTrackId`);
	const startOffsetFrame = nonNegativeInteger(group.startOffsetFrame, `${name}.startOffsetFrame`);
	const endOffsetFrame = nonNegativeInteger(group.endOffsetFrame, `${name}.endOffsetFrame`);
	if (endOffsetFrame <= startOffsetFrame) throw new RangeError(`${name} must have positive extent.`);
	const lanes = denseArray(group.lanes, `${name}.lanes`, TAKE_COMP_MAXIMUM_ENTITIES).map((entry, laneIndex) => {
		const lane = closedRecord(entry, `${name}.lanes[${String(laneIndex)}]`, LANE_KEYS);
		return { key: identity(lane.key, `${name}.lanes[${String(laneIndex)}].key`, identities, countIdentity) };
	});
	const laneOrder = denseArray(group.laneOrder, `${name}.laneOrder`, TAKE_COMP_MAXIMUM_ENTITIES)
		.map((laneKey, laneIndex) => stableId(laneKey, `${name}.laneOrder[${String(laneIndex)}]`));
	const takesByKey = new Map<string, ClipboardTake>();
	const takes = denseArray(group.takes, `${name}.takes`, TAKE_COMP_MAXIMUM_ENTITIES).map((entry, takeIndex) => {
		const takeName = `${name}.takes[${String(takeIndex)}]`;
		const take = closedRecord(entry, takeName, TAKE_KEYS);
		const normalized = {
			key: identity(take.key, `${takeName}.key`, identities, countIdentity),
			laneKey: stableId(take.laneKey, `${takeName}.laneKey`),
			sourceId: stableId(take.sourceId, `${takeName}.sourceId`),
			startOffsetFrame: nonNegativeInteger(take.startOffsetFrame, `${takeName}.startOffsetFrame`),
			endOffsetFrame: nonNegativeInteger(take.endOffsetFrame, `${takeName}.endOffsetFrame`),
			sourceStartFrame: nonNegativeInteger(take.sourceStartFrame, `${takeName}.sourceStartFrame`),
		};
		if (normalized.endOffsetFrame <= normalized.startOffsetFrame
			|| normalized.startOffsetFrame < startOffsetFrame
			|| normalized.endOffsetFrame > endOffsetFrame) {
			throw new RangeError(`${takeName} must have positive extent within its take group.`);
		}
		takesByKey.set(normalized.key, normalized);
		return normalized;
	});
	const regions = denseArray(group.compRegions, `${name}.compRegions`, TAKE_COMP_MAXIMUM_ENTITIES).map((entry, regionIndex) => {
		const regionName = `${name}.compRegions[${String(regionIndex)}]`;
		const region = closedRecord(entry, regionName, REGION_KEYS);
		const normalized = {
			key: identity(region.key, `${regionName}.key`, identities, countIdentity),
			takeKey: stableId(region.takeKey, `${regionName}.takeKey`),
			startOffsetFrame: nonNegativeInteger(region.startOffsetFrame, `${regionName}.startOffsetFrame`),
			endOffsetFrame: nonNegativeInteger(region.endOffsetFrame, `${regionName}.endOffsetFrame`),
		};
		const take = takesByKey.get(normalized.takeKey);
		if (!take || normalized.endOffsetFrame <= normalized.startOffsetFrame
			|| normalized.startOffsetFrame < take.startOffsetFrame
			|| normalized.endOffsetFrame > take.endOffsetFrame) {
			throw new RangeError(`${regionName} must have positive extent within its referenced take.`);
		}
		return normalized;
	});
	const core = normalizeTakeCompGroup({
		id: key, startSample: startOffsetFrame, endSample: endOffsetFrame,
		laneOrder, lanes: lanes.map(({ key: id }) => ({ id })),
		takes: takes.map(({ key: id, laneKey: laneId }) => ({ id, laneId })),
		compRegions: regions.map(({ key: id, takeKey: takeId, startOffsetFrame: startSample, endOffsetFrame: endSample }) => (
			{ id, takeId, startSample, endSample }
		)),
	});
	return Object.freeze({
		key, sourceSequenceId, sourceTrackId, startOffsetFrame, endOffsetFrame,
		laneOrder: core.laneOrder,
		lanes: Object.freeze(core.lanes.map(({ id }) => Object.freeze({ key: id }))),
		takes: Object.freeze(core.takes.map(({ id }) => Object.freeze(takesByKey.get(id)!))),
		compRegions: Object.freeze(core.compRegions.map(({ id }) => Object.freeze(regions.find(({ key: regionKey }) => regionKey === id)!))),
	});
}

function validatePasteMaps(
	project: DataRecord,
	groups: readonly ClipboardTakeGroup[],
	command: MutablePasteCommand,
): Readonly<Record<(typeof PASTE_MAP_FIELDS)[number], Readonly<Record<string, string>>>> {
	const expected = {
		takeGroupIds: groups.map(({ key }) => key),
		takeLaneIds: groups.flatMap(({ lanes }) => lanes.map(({ key }) => key)),
		takeIds: groups.flatMap(({ takes }) => takes.map(({ key }) => key)),
		compRegionIds: groups.flatMap(({ compRegions }) => compRegions.map(({ key }) => key)),
	};
	const maps = {} as Record<(typeof PASTE_MAP_FIELDS)[number], Readonly<Record<string, string>>>;
	const used = new Set<string>(existingIdentities(project));
	for (const field of PASTE_MAP_FIELDS) {
		const map = closedIdMap(command[field], `paste.${field}`, expected[field]);
		for (const id of Object.values(map)) {
			if (used.has(id)) throw new RangeError(`Pasted take identity ${id} is not fresh.`);
			used.add(id);
		}
		maps[field] = map;
	}
	return Object.freeze(maps);
}

function pastedGroup(
	group: ClipboardTakeGroup,
	command: MutablePasteCommand,
	maps: ReturnType<typeof validatePasteMaps>,
	scale: number,
	geometry: PasteGeometry,
): CommandObject {
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Take clipboard scale must be positive.');
	const trackId = stableId(command.trackMap?.[group.sourceTrackId] || group.sourceTrackId, 'target take track ID');
	const sequenceId = stableId(command.sequenceMap?.[group.sourceSequenceId] || group.sourceSequenceId, 'target take sequence ID');
	const anchor = geometry.placementFrameBySequenceId.get(sequenceId);
	if (typeof anchor !== 'number' || !Number.isSafeInteger(anchor) || anchor < 0) {
		throw new RangeError(`Target take sequence ${sequenceId} has no paste anchor.`);
	}
	const scaled = scaledTakeBoundaries(group, anchor, scale);
	const at = (value: number): number => scaled.get(value)!;
	return {
		id: maps.takeGroupIds[group.key], sequenceId, trackId,
		startSample: at(group.startOffsetFrame),
		endSample: at(group.endOffsetFrame),
		laneOrder: group.laneOrder.map((key) => maps.takeLaneIds[key]),
		lanes: group.lanes.map(({ key }) => ({ id: maps.takeLaneIds[key] })),
		takes: group.takes.map((take) => ({
			id: maps.takeIds[take.key], laneId: maps.takeLaneIds[take.laneKey], sourceId: take.sourceId,
			startSample: at(take.startOffsetFrame),
			endSample: at(take.endOffsetFrame),
			sourceStartSample: take.sourceStartFrame,
		})),
		compRegions: group.compRegions.map((region) => ({
			id: maps.compRegionIds[region.key], takeId: maps.takeIds[region.takeKey],
			startSample: at(region.startOffsetFrame),
			endSample: at(region.endOffsetFrame),
		})),
	};
}

/**
 * Scale every boundary of one group through a single strictly increasing map so a
 * downscaling paste keeps the minimum one-frame extent that plain clips already keep.
 */
function scaledTakeBoundaries(
	group: ClipboardTakeGroup,
	anchor: number,
	scale: number,
): ReadonlyMap<number, number> {
	const offsets = [...new Set([
		group.startOffsetFrame, group.endOffsetFrame,
		...group.takes.flatMap(({ startOffsetFrame, endOffsetFrame }) => [startOffsetFrame, endOffsetFrame]),
		...group.compRegions.flatMap(({ startOffsetFrame, endOffsetFrame }) => [startOffsetFrame, endOffsetFrame]),
	])].sort((left, right) => left - right);
	const scaled = new Map<number, number>();
	let previous = -1;
	for (const offset of offsets) {
		const result = Math.max(anchor + Math.round(offset * scale), previous + 1);
		if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Pasted take geometry exceeds the target timeline.');
		scaled.set(offset, result);
		previous = result;
	}
	return scaled;
}

function existingTargetGroups(
	project: DataRecord,
	groups: readonly ClipboardTakeGroup[],
	command: MutablePasteCommand,
): readonly TakeCompDocumentGroup[] {
	const targetIds = new Set(groups.map((group) => command.trackMap?.[group.sourceTrackId] || group.sourceTrackId));
	return createTakeCompDocumentGroupsV17(project.takeGroups, project).filter(({ trackId }) => targetIds.has(trackId));
}

function existingIdentities(project: DataRecord): readonly string[] {
	return createTakeCompDocumentGroupsV17(project.takeGroups, project).flatMap((group) => [
		group.id, ...group.lanes.map(({ id }) => id), ...group.takes.map(({ id }) => id),
		...group.compRegions.map(({ id }) => id),
	]);
}

function closedIdMap(value: unknown, name: string, expectedKeys: readonly string[]): Readonly<Record<string, string>> {
	const map = closedRecord(value, name, new Set(expectedKeys));
	const result: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const key of expectedKeys) result[key] = stableId(map[key], `${name}.${key}`);
	return Object.freeze(result);
}

function identity(value: unknown, name: string, identities: Set<string>, count: () => void): string {
	const id = stableId(value, name);
	count();
	if (identities.has(id)) throw new RangeError(`Duplicate clipboard take identity ${id}.`);
	identities.add(id);
	return id;
}

function closedRecord(value: unknown, name: string, keys: ReadonlySet<string>): DataRecord {
	const result = record(value, name);
	const actual = Reflect.ownKeys(result);
	if (actual.some((key) => typeof key !== 'string') || actual.length !== keys.size) {
		throw new TypeError(`${name} must contain its exact fields.`);
	}
	for (const key of actual) {
		if (typeof key !== 'string' || !keys.has(key)) throw new TypeError(`${name} contains unsupported field ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(result, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
	}
	return result;
}

function denseArray(value: unknown, name: string, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${name} must be a bounded array.`);
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`);
	}
	return value;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value.trim() !== value) {
		throw new TypeError(`${name} must be a canonical stable ID.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return value as number;
}

function nullRecord(): Record<string, string> {
	return Object.create(null) as Record<string, string>;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
