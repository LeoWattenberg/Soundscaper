/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from './closed-domain-value.ts';
import type {
	EditorHistoryCommandOptions,
	EditorProjectHistoryEntry,
	EditorProjectHistoryRevision,
	EditorProjectHistoryState,
} from './project-history-mechanics.ts';

/**
 * Reading a stored history back, for the mechanics that move its stacks.
 *
 * Everything here answers one question: how much of a record handed in from
 * outside — storage, another session, a test — may be believed. Which fields a
 * product's history carries, how strictly unknown ones are refused, and what a
 * limit, a dropped count, a playhead and a timestamp have to be. The mechanics
 * themselves then work on values that have already been admitted.
 */

type Revision<Command, Options extends EditorHistoryCommandOptions>
	= EditorProjectHistoryRevision<Command, Options>;
type State<Command> = EditorProjectHistoryState<Command>;
type Entry<Command> = EditorProjectHistoryEntry<Command>;

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const HISTORY_FIELDS_WITH_DROPPED = Object.freeze([...HISTORY_FIELDS, 'dropped']);
const HISTORY_FIELDS_WITH_PLAYHEAD = Object.freeze([...HISTORY_FIELDS, 'playheadFrame']);
const HISTORY_FIELDS_WITH_DROPPED_AND_PLAYHEAD = Object.freeze([
	...HISTORY_FIELDS_WITH_DROPPED, 'playheadFrame',
]);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);
const ENTRY_FIELDS_WITH_PLAYHEAD = Object.freeze([...ENTRY_FIELDS, 'playheadFrame']);

/** The fields a stored history of this product carries, without allocating per read. */
function historyFields<Command, Options extends EditorHistoryCommandOptions>(
	revision: Revision<Command, Options>,
): readonly string[] {
	if (revision.tracksDropped === true) {
		return revision.tracksPlayhead === true
			? HISTORY_FIELDS_WITH_DROPPED_AND_PLAYHEAD
			: HISTORY_FIELDS_WITH_DROPPED;
	}
	return revision.tracksPlayhead === true ? HISTORY_FIELDS_WITH_PLAYHEAD : HISTORY_FIELDS;
}

function entryFields<Command, Options extends EditorHistoryCommandOptions>(
	revision: Revision<Command, Options>,
): readonly string[] {
	return revision.tracksPlayhead === true ? ENTRY_FIELDS_WITH_PLAYHEAD : ENTRY_FIELDS;
}

/**
 * Admit the history a command is about to change: the present document only.
 *
 * A stored history is validated whole where it enters the session — created,
 * cloned, or read back from storage — and the entries behind the present
 * document are snapshots the mechanics wrote and never touch again. Walking all
 * of them on every command instead made editing cost grow with how long the
 * session had been open and with project size at once, at up to twice the
 * history limit in full document validations per command. What is still checked
 * is what the mechanics themselves rely on: the record's shape, its limit, its
 * dropped count, the document being edited, and that both stacks are arrays
 * within that limit.
 */
export function admitCommandTarget<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
): State<Command> {
	if (revision.validatesHistory === false) return history as State<Command>;
	const value = readHistory(history, revision, false);
	const limit = historyLimit(value.limit, revision);
	droppedCount(value.dropped, revision);
	playheadPosition(value.playheadFrame, revision);
	revision.validateProject(value.present);
	readStack(value.undoStack, 'undoStack', limit, revision);
	readStack(value.redoStack, 'redoStack', limit, revision);
	return history as State<Command>;
}

export function readHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
	admitStructure = true,
): Partial<State<Command>> {
	if (admitStructure) revision.admitStructure?.(history);
	const fields = historyFields(revision);
	if (revision.shape === 'closed') {
		return readClosedDomainRecord(
			history, `${revision.label} history`, fields,
		) as unknown as Partial<State<Command>>;
	}
	if (!history || typeof history !== 'object' || Array.isArray(history)) {
		throw new TypeError(`A ${revision.label} history is required.`);
	}
	if (revision.shape === 'exact') assertExactFields(history, fields, `${revision.label} history`);
	return history as Partial<State<Command>>;
}

export function validateStack<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	projectId: string,
	revision: Revision<Command, Options>,
): void {
	const stack = readStack(value, name, limit, revision);
	for (const item of stack) {
		const entry = readEntry(item, name, revision);
		playheadPosition(entry.playheadFrame, revision);
		revision.validateProject(entry.project);
		if (entry.project.id !== projectId) {
			throw new RangeError(`Every ${revision.label} history snapshot must have the present project ID.`);
		}
		revision.snapshotCommand(entry.command);
	}
}

/** One stack, read as far as its own shape goes and no further. */
function readStack<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	revision: Revision<Command, Options>,
): readonly unknown[] {
	if (revision.shape === 'closed') {
		return readClosedDomainArray(value, `${revision.label} history ${name}`, 0, limit);
	}
	if (!Array.isArray(value) || value.length > limit) {
		throw new RangeError(`${revision.label} history ${name} is invalid.`);
	}
	return value as readonly unknown[];
}

function readEntry<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	name: 'undoStack' | 'redoStack',
	revision: Revision<Command, Options>,
): Entry<Command> {
	const entryName = `${revision.label} history ${name} entry`;
	if (revision.shape === 'closed') {
		return readClosedDomainRecord(value, entryName, entryFields(revision)) as unknown as Entry<Command>;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${entryName} is invalid.`);
	}
	if (revision.shape === 'exact') assertExactFields(value, entryFields(revision), entryName);
	return value as Entry<Command>;
}

function assertExactFields(value: object, fields: readonly string[], name: string): void {
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
}

export function historyLimit<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	revision: Revision<Command, Options>,
): number {
	const maximum = revision.maximumLimit;
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| (maximum !== undefined && Number(value) > maximum)) {
		throw new RangeError(maximum === undefined
			? `A ${revision.label} history limit must be a positive safe integer.`
			: `A ${revision.label} history limit must be from 1 through ${String(maximum)}.`);
	}
	return Number(value);
}

/** A history written before the count existed simply has not dropped anything yet. */
export function droppedCount<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	revision: Revision<Command, Options>,
): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`A ${revision.label} history dropped count must be a non-negative safe integer.`);
	}
	return Number(value);
}


/** A playhead this history never learned is simply not restored by undo. */
export function playheadPosition<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	revision: Revision<Command, Options>,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`A ${revision.label} history playhead frame must be a non-negative safe integer.`);
	}
	return Number(value);
}


export function timestamp<Command, Options extends EditorHistoryCommandOptions>(
	value: Date | string | undefined,
	revision: Revision<Command, Options>,
): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError(`A valid ${revision.label} history timestamp is required.`);
	return date.toISOString();
}

