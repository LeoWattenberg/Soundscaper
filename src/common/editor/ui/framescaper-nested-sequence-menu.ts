/* SPDX-License-Identifier: AGPL-3.0-only */

import { isFramescaperSequenceProjectSchema } from '../project-schema-version.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface NestedSequenceValue extends DataRecord {
	readonly id: string;
	readonly sequenceId: string;
	readonly sourceSequenceId: string;
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCount: number;
	readonly sourceInFrame: number;
	readonly sourceFrameCount: number;
}

export type FramescaperNestedSequenceMenuCommand =
	| Readonly<{ readonly type: 'sequence/create'; readonly sequence: DataRecord }>
	| Readonly<{ readonly type: 'sequence/delete'; readonly sequenceId: string }>
	| Readonly<{ readonly type: 'subsequence/add'; readonly subsequence: NestedSequenceValue }>
	| Readonly<{
		readonly type: 'subsequence/update';
		readonly subsequenceId: string;
		readonly changes: Readonly<{ readonly sequenceStartFrame: number }>;
	}>
	| Readonly<{ readonly type: 'subsequence/remove'; readonly subsequenceId: string }>;

export interface FramescaperNestedSequenceMenuCopy {
	readonly nestedSequences: string;
	readonly createSequence: string;
	readonly addNestedSequence: string;
	readonly updateNestedSequence: string;
	readonly removeNestedSequence: string;
	readonly deleteSequence: string;
}

export interface FramescaperNestedSequenceMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly editingBlocked: boolean;
	readonly copy: FramescaperNestedSequenceMenuCopy;
}

export interface FramescaperNestedSequenceMenuActions {
	execute(command: FramescaperNestedSequenceMenuCommand): unknown;
}

export interface FramescaperNestedSequenceMenuLeaf {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface FramescaperNestedSequenceMenu {
	readonly id: 'nested-sequences';
	readonly label: string;
	readonly disabled: boolean;
	readonly items: readonly Readonly<FramescaperNestedSequenceMenuLeaf>[];
}

/** Create an empty shared sequence, then author one deterministic opt-in placement. */
export function createFramescaperNestedSequenceMenuItems(
	input: FramescaperNestedSequenceMenuInput,
	actions: FramescaperNestedSequenceMenuActions,
): Readonly<FramescaperNestedSequenceMenu> | null {
	if (input.productId !== 'framescaper') return null;
	const project = record(input.project);
	const exactAuthority = isFramescaperSequenceProjectSchema(project);
	const sequences = records(project?.sequences);
	const subsequences = records(project?.subsequences);
	const primaryId = typeof project?.primarySequenceId === 'string' ? project.primarySequenceId : null;
	const parent = sequences.find(({ id }) => id === primaryId) ?? null;
	const source = sequences.find(({ id }) => id !== primaryId) ?? null;
	const existing = subsequences[0] ?? null;
	const createCommand = exactAuthority && !input.editingBlocked && parent
		? createCommandFor(parent, sequences)
		: null;
	const addCommand = exactAuthority && !input.editingBlocked && parent && source
		? addCommandFor(parent, source, subsequences)
		: null;
	const updateCommand = exactAuthority && !input.editingBlocked && existing
		? updateCommandFor(existing)
		: null;
	const removeCommand = exactAuthority && !input.editingBlocked && existing
		? removeCommandFor(existing)
		: null;
	const deletable = project ? sequences.find((sequence) => (
		sequence.id !== primaryId && canDeleteSequence(project, sequence, subsequences)
	)) ?? null : null;
	const deleteCommand = exactAuthority && !input.editingBlocked && deletable
		? deleteCommandFor(deletable)
		: null;
	const items = Object.freeze([
		leaf('nested-sequence-create', input.copy.createSequence, createCommand, actions),
		leaf('nested-sequence-add', input.copy.addNestedSequence, addCommand, actions),
		leaf('nested-sequence-update', input.copy.updateNestedSequence, updateCommand, actions),
		leaf('nested-sequence-remove', input.copy.removeNestedSequence, removeCommand, actions),
		leaf('nested-sequence-delete', input.copy.deleteSequence, deleteCommand, actions),
	]);
	return Object.freeze({
		id: 'nested-sequences',
		label: input.copy.nestedSequences,
		disabled: items.every(({ disabled }) => disabled),
		items,
	});
}

function createCommandFor(
	primary: DataRecord,
	sequences: readonly DataRecord[],
): FramescaperNestedSequenceMenuCommand | null {
	const primaryRate = rate(primary.rate);
	const startTimecode = timecode(primary.startTimecode);
	if (!primaryRate || typeof primary.dropFrame !== 'boolean' || !startTimecode) return null;
	const ids = new Set(sequences.map(({ id }) => id));
	let suffix = 1;
	let id = `shared-sequence-${String(suffix)}`;
	while (ids.has(id)) { suffix += 1; id = `shared-sequence-${String(suffix)}`; }
	return Object.freeze({
		type: 'sequence/create',
		sequence: Object.freeze({
			id,
			name: `Shared sequence ${String(suffix)}`,
			rate: Object.freeze(primaryRate),
			dropFrame: primary.dropFrame,
			startTimecode: Object.freeze(startTimecode),
			trackIds: Object.freeze([]),
			trackNodes: Object.freeze([]),
		}),
	});
}

function addCommandFor(
	parent: DataRecord,
	source: DataRecord,
	existing: readonly DataRecord[],
): FramescaperNestedSequenceMenuCommand | null {
	const parentId = string(parent.id);
	const sourceId = string(source.id);
	const parentRate = rate(parent.rate);
	const sourceRate = rate(source.rate);
	if (!parentId || !sourceId || !parentRate || !sourceRate) return null;
	const counts = frameCounts(parentRate, sourceRate);
	if (!counts) return null;
	let suffix = 1;
	const ids = new Set(existing.map(({ id }) => id));
	let id = `nested-${parentId}-${sourceId}-${String(suffix)}`;
	while (ids.has(id)) { suffix += 1; id = `nested-${parentId}-${sourceId}-${String(suffix)}`; }
	return Object.freeze({
		type: 'subsequence/add',
		subsequence: Object.freeze({
			id, sequenceId: parentId, sourceSequenceId: sourceId,
			sequenceStartFrame: 0, sequenceFrameCount: counts.parent,
			sourceInFrame: 0, sourceFrameCount: counts.source,
		}),
	});
}

function updateCommandFor(value: DataRecord): FramescaperNestedSequenceMenuCommand | null {
	const id = string(value.id);
	const start = safeInteger(value.sequenceStartFrame, 0);
	const count = safeInteger(value.sequenceFrameCount, 1);
	if (!id || start === null || count === null || !Number.isSafeInteger(start + count)) return null;
	return Object.freeze({
		type: 'subsequence/update', subsequenceId: id,
		changes: Object.freeze({ sequenceStartFrame: start + count }),
	});
}

function removeCommandFor(value: DataRecord): FramescaperNestedSequenceMenuCommand | null {
	const id = string(value.id);
	return id ? Object.freeze({ type: 'subsequence/remove', subsequenceId: id }) : null;
}

function deleteCommandFor(value: DataRecord): FramescaperNestedSequenceMenuCommand | null {
	const sequenceId = string(value.id);
	return sequenceId ? Object.freeze({ type: 'sequence/delete', sequenceId }) : null;
}

function canDeleteSequence(
	project: DataRecord,
	sequence: DataRecord,
	subsequences: readonly DataRecord[],
): boolean {
	const sequenceId = string(sequence.id);
	if (!sequenceId || !emptyArray(sequence.trackIds) || !emptyArray(sequence.trackNodes)) return false;
	if (subsequences.some((placement) => (
		placement.sequenceId === sequenceId || placement.sourceSequenceId === sequenceId
	))) return false;
	for (const field of ['clips', 'timelineAnnotations', 'takeGroups', 'multicameraGroups']) {
		if (records(project[field]).some((value) => value.sequenceId === sequenceId)) return false;
	}
	const bin = record(project.projectBin);
	return !records(bin?.clips).some((clip) => clip.sequenceId === sequenceId);
}

function leaf(
	id: string,
	label: string,
	command: FramescaperNestedSequenceMenuCommand | null,
	actions: FramescaperNestedSequenceMenuActions,
): Readonly<FramescaperNestedSequenceMenuLeaf> {
	return Object.freeze({
		id, label, disabled: command === null,
		onClick: () => command === null ? undefined : actions.execute(command),
	});
}

function frameCounts(
	parent: Readonly<{ readonly num: number; readonly den: number }>,
	source: Readonly<{ readonly num: number; readonly den: number }>,
): Readonly<{ readonly parent: number; readonly source: number }> | null {
	const parentUnit = BigInt(parent.num) * BigInt(source.den);
	const sourceUnit = BigInt(source.num) * BigInt(parent.den);
	const divisor = greatestCommonDivisor(parentUnit, sourceUnit);
	const baseParent = parentUnit / divisor;
	const baseSource = sourceUnit / divisor;
	const oneSecondParentFrames = (BigInt(parent.num) + BigInt(parent.den) - 1n) / BigInt(parent.den);
	const scale = (oneSecondParentFrames + baseParent - 1n) / baseParent;
	const parentFrames = baseParent * scale;
	const sourceFrames = baseSource * scale;
	if (parentFrames > BigInt(Number.MAX_SAFE_INTEGER) || sourceFrames > BigInt(Number.MAX_SAFE_INTEGER)) {
		return null;
	}
	return Object.freeze({ parent: Number(parentFrames), source: Number(sourceFrames) });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left;
	let b = right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

function rate(value: unknown): Readonly<{ readonly num: number; readonly den: number }> | null {
	const candidate = record(value);
	const num = safeInteger(candidate?.num, 1);
	const den = safeInteger(candidate?.den, 1);
	return num === null || den === null ? null : { num, den };
}

function timecode(value: unknown): Readonly<{
	readonly negative: boolean;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly frames: number;
}> | null {
	const candidate = record(value);
	if (!candidate || typeof candidate.negative !== 'boolean') return null;
	const hours = safeInteger(candidate.hours, 0);
	const minutes = safeInteger(candidate.minutes, 0);
	const seconds = safeInteger(candidate.seconds, 0);
	const frames = safeInteger(candidate.frames, 0);
	return hours === null || minutes === null || seconds === null || frames === null
		? null
		: { negative: candidate.negative, hours, minutes, seconds, frames };
}

function emptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0;
}

function string(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeInteger(value: unknown, minimum: number): number | null {
	return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}
