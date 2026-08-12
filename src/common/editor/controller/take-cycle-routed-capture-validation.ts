/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineLoop } from '../engine/types.ts';
import { TAKE_COMP_MAXIMUM_ENTITIES } from '../take-comp-domain.ts';
import { TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES } from './take-cycle-capture-spool.ts';
import type {
	RecordingCaptureChunk,
	RecordingRoute,
	RecordingTrack,
} from './recording-transaction-types.ts';
import type { RecordingStartScope } from './recording-session-service.ts';

export interface TakeCycleRoutedCaptureProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sampleRate: number;
	readonly tracks: readonly RecordingTrack[];
	readonly loop: EngineLoop;
	readonly sequences: readonly Readonly<{ readonly id: string; readonly trackIds: readonly string[] }>[];
	readonly takeGroups?: readonly Readonly<{
		readonly id: string;
		readonly sequenceId: string;
		readonly trackId: string;
		readonly startSample: number;
		readonly endSample: number;
		readonly lanes?: readonly unknown[];
		readonly takes?: readonly unknown[];
		readonly compRegions?: readonly unknown[];
	}>[];
}

export type NormalizedTakeCycleRoutedProject = TakeCycleRoutedCaptureProject & {
	readonly loop: Readonly<{ readonly enabled: true; readonly startFrame: number; readonly endFrame: number }>;
};

export function assertTakeCycleRoutedStartRequest(value: unknown): void {
	const request = closedRecord(value, 'take cycle routed start request', ['kind']);
	if (request.kind !== 'take-cycle-routed-capture') {
		throw new TypeError('Take cycle routed start request has an invalid closed shape.');
	}
}

export function assertTakeCycleRoutedStartScope(scope: RecordingStartScope): void {
	if (!scope || typeof scope !== 'object' || !Number.isSafeInteger(scope.generation)
		|| (scope.projectId !== null && typeof scope.projectId !== 'string')
		|| typeof scope.assertCurrent !== 'function') {
		throw new TypeError('Take cycle routed capture requires a recording start scope.');
	}
	scope.assertCurrent();
}

export function takeCycleRoutedStaleProjectError(): Error {
	const error = new Error('Take cycle routed capture belongs to a stale project lifetime.');
	error.name = 'AbortError';
	return error;
}

export function normalizeTakeCycleRoutedProject(
	value: TakeCycleRoutedCaptureProject,
): NormalizedTakeCycleRoutedProject {
	const project = dataRecord(value, 'take cycle routed project') as unknown as TakeCycleRoutedCaptureProject;
	const id = stableTakeCycleRoutedId(project.id, 'take cycle routed project ID');
	const sampleRate = positiveTakeCycleRoutedInteger(project.sampleRate, 768_000, 'project sample rate');
	if (!Array.isArray(project.tracks) || !Array.isArray(project.sequences)) {
		throw new TypeError('Take cycle routed project inventories are invalid.');
	}
	const loop = dataRecord(project.loop, 'take cycle routed project loop');
	const startFrame = nonNegativeTakeCycleRoutedInteger(loop.startFrame, 'loop start');
	const endFrame = nonNegativeTakeCycleRoutedInteger(loop.endFrame, 'loop end');
	if (loop.enabled !== true || endFrame <= startFrame) {
		throw new RangeError('Take cycle routed capture requires one enabled loop with positive extent.');
	}
	return Object.freeze({ ...project, id, sampleRate, loop: Object.freeze({ enabled: true, startFrame, endFrame }) });
}

export function snapshotTakeCycleRoutedRoutes(
	value: Readonly<Record<string, RecordingRoute>>,
	tracks: readonly RecordingTrack[],
): Readonly<Record<string, RecordingRoute>> {
	const routes: Record<string, RecordingRoute> = {};
	for (const track of tracks) {
		const route = dataRecord(value?.[track.id], `take cycle route ${track.id}`);
		if (route.kind !== 'device' && route.kind !== 'display') {
			throw new TypeError(`Take cycle route ${track.id} kind is invalid.`);
		}
		routes[track.id] = Object.freeze({
			kind: route.kind,
			deviceId: typeof route.deviceId === 'string' ? route.deviceId : '',
			channelStart: nonNegativeTakeCycleRoutedInteger(route.channelStart, 'route channel start'),
			channelCount: positiveTakeCycleRoutedInteger(route.channelCount, 64, 'route channel count'),
		});
	}
	return Object.freeze(routes);
}

export function assertTakeCycleRoutedTracksUnlocked(tracks: readonly RecordingTrack[]): void {
	const locked = tracks.find((track) => track.locked === true);
	if (locked) throw new RangeError(`Track ${stableTakeCycleRoutedId(locked.id, 'take cycle track ID')} is locked.`);
}

export function takeCycleRoutedOwningSequence(
	project: TakeCycleRoutedCaptureProject,
	trackId: string,
): string {
	const owners = project.sequences.filter((sequence) => Array.isArray(sequence.trackIds)
		&& sequence.trackIds.includes(trackId));
	if (owners.length !== 1) throw new Error(`Take cycle track ${trackId} must belong to exactly one sequence.`);
	return stableTakeCycleRoutedId(owners[0]!.id, 'take cycle routed sequence ID');
}

/** Reuse an exact group; a distinct group may only be created in an unoccupied extent. */
export function takeCycleRoutedGroupId(
	project: TakeCycleRoutedCaptureProject,
	sequenceIdValue: string,
	trackIdValue: string,
	loopStartSample: number,
	loopEndSample: number,
	createGroupId: () => string,
): string {
	const sequenceId = stableTakeCycleRoutedId(sequenceIdValue, 'take cycle routed sequence ID');
	const trackId = stableTakeCycleRoutedId(trackIdValue, 'take cycle routed track ID');
	const groups = project.takeGroups ?? [];
	if (!Array.isArray(groups)) throw new TypeError('Take cycle routed take-group inventory is invalid.');
	for (const value of groups) {
		const group = dataRecord(value, 'take cycle routed take group');
		if (group.sequenceId !== sequenceId || group.trackId !== trackId) continue;
		const startSample = nonNegativeTakeCycleRoutedInteger(group.startSample, 'take group start');
		const endSample = nonNegativeTakeCycleRoutedInteger(group.endSample, 'take group end');
		if (endSample <= startSample) throw new RangeError('Take cycle routed take-group extent is invalid.');
		if (startSample === loopStartSample && endSample === loopEndSample) {
			return stableTakeCycleRoutedId(group.id, 'take cycle routed group ID');
		}
		if (startSample < loopEndSample && loopStartSample < endSample) {
			throw new RangeError(`Take cycle loop overlaps take group ${String(group.id)} with a different extent.`);
		}
	}
	return stableTakeCycleRoutedId(createGroupId(), 'take cycle routed group ID');
}

/** Admit the minimum one-pass identity cost for every armed routed target. */
export function takeCycleRoutedPassCapacity(
	project: TakeCycleRoutedCaptureProject,
	targets: readonly Readonly<{ readonly sequenceId: string; readonly trackId: string }>[],
	loopStartSample: number,
	loopEndSample: number,
): number {
	const groups = project.takeGroups ?? [];
	if (!Array.isArray(groups)) throw new TypeError('Take cycle routed take-group inventory is invalid.');
	let entityCount = 0;
	for (const value of groups) {
		const group = dataRecord(value, 'take cycle routed take group');
		entityCount += 1
			+ optionalDenseLength(group.lanes, 'take group lanes')
			+ optionalDenseLength(group.takes, 'take group takes')
			+ optionalDenseLength(group.compRegions, 'take group comp regions');
	}
	let fixedEntityCount = entityCount;
	for (const target of targets) {
		const exact = groups.some((value) => {
			const group = dataRecord(value, 'take cycle routed take group');
			return group.sequenceId === target.sequenceId && group.trackId === target.trackId
				&& group.startSample === loopStartSample && group.endSample === loopEndSample;
		});
		fixedEntityCount += exact ? 0 : 2;
	}
	const maximumPasses = Math.floor(
		(TAKE_COMP_MAXIMUM_ENTITIES - fixedEntityCount) / (2 * targets.length),
	);
	if (maximumPasses < 1) {
		throw new RangeError('Take cycle recording exceeds the V17 take/comp identity capacity.');
	}
	return maximumPasses;
}

function optionalDenseLength(value: unknown, name: string): number {
	if (value === undefined) return 0;
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`Take cycle routed ${name} inventory is invalid.`);
	}
	return value.length;
}

export function normalizeTakeCycleRoutedChunk(
	value: RecordingCaptureChunk,
	channelCount: number,
	expectedFrameStart: number | null,
): RecordingCaptureChunk {
	const frameStart = nonNegativeTakeCycleRoutedInteger(value?.frameStart, 'capture frame start');
	const maximumFrames = Math.floor(
		TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES / channelCount / Float32Array.BYTES_PER_ELEMENT,
	);
	const frames = positiveTakeCycleRoutedInteger(
		value?.frames,
		Math.min(1_048_576, maximumFrames),
		'capture frame count',
	);
	if (expectedFrameStart !== null && frameStart !== expectedFrameStart) {
		throw new Error('Take cycle routed capture contains a pause or discontinuity.');
	}
	if (!Array.isArray(value.channels) || value.channels.length !== channelCount
		|| value.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frames)) {
		throw new Error('Take cycle routed capture chunk geometry changed.');
	}
	return Object.freeze({ frameStart, frames, channels: Object.freeze([...value.channels]) });
}

export function takeCycleRoutedLaneChunkFrames(value: unknown, channelCount: number): number {
	const maximum = Math.floor(
		TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES / channelCount / Float32Array.BYTES_PER_ELEMENT,
	);
	return positiveTakeCycleRoutedInteger(value, Math.min(65_536, maximum), 'source chunk frames');
}

export function stableTakeCycleRoutedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

export function stableTakeCycleRoutedName(value: unknown): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim() || value.length > 255) {
		throw new TypeError('Take cycle routed source name is invalid.');
	}
	return value;
}

export function positiveTakeCycleRoutedInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`Take cycle routed ${name} is invalid.`);
	}
	return Number(value);
}

export function finiteTakeCycleRoutedGain(value: unknown): number {
	const gain = Number(value);
	if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Take cycle routed input gain is invalid.');
	return gain;
}

function nonNegativeTakeCycleRoutedInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Take cycle routed ${name} is invalid.`);
	return Number(value);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function closedRecord(
	value: unknown,
	name: string,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	const record = dataRecord(value, name);
	const ownKeys = Reflect.ownKeys(record);
	if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	for (const key of ownKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
	}
	return record;
}
