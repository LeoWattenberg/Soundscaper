/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from './closed-domain-value.ts';

/**
 * One implementation of the undo stack, for every document a product edits.
 *
 * Undo here restores a whole snapshot rather than inverting a command, so the
 * mechanics are the same wherever the model is: push the outgoing document as an
 * entry, keep the newest `limit` of them, restore an entry by cloning it and
 * taking a fresh revision. What differs between documents is only how to
 * validate, clone, snapshot and apply — and a handful of policies each product
 * settled for itself, declared on the revision rather than reimplemented.
 *
 * A revision descriptor is cheap to build, so a product that threads a runtime
 * profile through its validators builds one per call around that profile.
 */

/** A document, read only as far as the mechanics themselves read it. */
export type EditorHistoryDocument = Record<string, unknown>;

export interface EditorHistoryCommandOptions {
	readonly now?: Date | string;
}

export interface EditorProjectHistoryEntry<Command> {
	readonly project: EditorHistoryDocument;
	readonly command: Command;
}

export interface EditorProjectHistoryState<Command> {
	readonly limit: number;
	readonly present: EditorHistoryDocument;
	readonly undoStack: readonly EditorProjectHistoryEntry<Command>[];
	readonly redoStack: readonly EditorProjectHistoryEntry<Command>[];
	/**
	 * How many entries the limit has pushed off the bottom of the undo stack over
	 * this history's life, present only where the product tracks it.
	 *
	 * A depth handed to `collapse` or `rollback` is a position in the whole
	 * sequence of commits — `dropped + undoStack.length` — rather than an index
	 * into the bounded stack, because a macro's own steps shift that stack out
	 * from under an index as soon as the history is full.
	 */
	readonly dropped?: number;
}

/**
 * How strictly a stored history is read back.
 *
 * `open` accepts any object carrying the fields; `exact` additionally refuses
 * unknown keys; `closed` refuses unknown keys, inherited state and accessors
 * through the closed-domain readers. Each product picked one, and the choice is
 * a validation policy rather than a mechanic.
 */
export type EditorProjectHistoryShape = 'open' | 'exact' | 'closed';

export interface EditorProjectHistoryRevision<
	Command,
	Options extends EditorHistoryCommandOptions = EditorHistoryCommandOptions,
> {
	/** Names the document in every message this history throws. */
	readonly label: string;
	readonly shape?: EditorProjectHistoryShape;
	/** An upper bound on the stored limit, where the product declares one. */
	readonly maximumLimit?: number;
	/** Whether the state carries the dropped count that macro depths need. */
	readonly tracksDropped?: boolean;
	/** Whether a command that returns the present document unchanged is dropped. */
	readonly suppressNoOpCommands?: boolean;
	/** Whether the outgoing document is cloned as it becomes an entry (default true). */
	readonly snapshotPushedProject?: boolean;
	/** Whether a command validates the history it was handed (default true). */
	readonly validatesHistory?: boolean;
	validateProject(project: unknown): void;
	cloneProject(project: unknown): EditorHistoryDocument;
	snapshotCommand(command: unknown): Command;
	applyCommand(project: EditorHistoryDocument, command: Command, options: Options): EditorHistoryDocument;
	/** Settles derived state on a restored document before it is validated. */
	reconcileRestoredProject?(project: EditorHistoryDocument): void;
	/** Bounds the whole stored graph once before per-entry validation. */
	admitStructure?(history: unknown): void;
}

type Revision<Command, Options extends EditorHistoryCommandOptions>
	= EditorProjectHistoryRevision<Command, Options>;
type State<Command> = EditorProjectHistoryState<Command>;
type Entry<Command> = EditorProjectHistoryEntry<Command>;

const HISTORY_FIELDS = Object.freeze(['limit', 'present', 'undoStack', 'redoStack']);
const HISTORY_FIELDS_WITH_DROPPED = Object.freeze([...HISTORY_FIELDS, 'dropped']);
const ENTRY_FIELDS = Object.freeze(['project', 'command']);

export function createEditorProjectHistory<Command, Options extends EditorHistoryCommandOptions>(
	project: unknown,
	revision: Revision<Command, Options>,
	defaultLimit: number,
	options: Readonly<{ limit?: number }> = {},
): State<Command> {
	revision.validateProject(project);
	const limit = historyLimit(options.limit ?? defaultLimit, revision);
	return settle(revision, {
		limit,
		present: revision.cloneProject(project),
		undoStack: [],
		redoStack: [],
		dropped: 0,
	});
}

/** Validate a whole stored history: the present document and every entry. */
export function validateEditorProjectHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
): history is State<Command> {
	const value = readHistory(history, revision);
	const limit = historyLimit(value.limit, revision);
	droppedCount(value.dropped, revision);
	revision.validateProject(value.present);
	const projectId = String((value.present as EditorHistoryDocument).id);
	validateStack(value.undoStack, 'undoStack', limit, projectId, revision);
	validateStack(value.redoStack, 'redoStack', limit, projectId, revision);
	return true;
}

export function cloneEditorProjectHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
): State<Command> {
	validateEditorProjectHistory(history, revision);
	const valid = history as State<Command>;
	return settle(revision, {
		limit: valid.limit,
		present: revision.cloneProject(valid.present),
		undoStack: valid.undoStack.map((entry) => cloneEntry(entry, revision)),
		redoStack: valid.redoStack.map((entry) => cloneEntry(entry, revision)),
		dropped: droppedCount(valid.dropped, revision),
	});
}

export function executeEditorProjectCommand<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	command: unknown,
	revision: Revision<Command, Options>,
	options: Options,
): State<Command> {
	const valid = admitCommandTarget(history, revision);
	const normalized = revision.snapshotCommand(command);
	const present = revision.applyCommand(valid.present, normalized, options);
	if (revision.suppressNoOpCommands === true && present === valid.present) return valid;
	const pushed = [...valid.undoStack, pushedEntry(valid.present, normalized, revision)];
	const undoStack = pushed.slice(-valid.limit);
	return settle(revision, {
		limit: valid.limit,
		present,
		undoStack,
		redoStack: [],
		dropped: droppedCount(valid.dropped, revision) + (pushed.length - undoStack.length),
	});
}

export function undoEditorProjectCommand<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
	options: Options,
): State<Command> {
	const valid = admitCommandTarget(history, revision);
	if (valid.undoStack.length === 0) return valid;
	const entry = valid.undoStack.at(-1)!;
	const redoStack = [
		...valid.redoStack,
		pushedEntry(valid.present, revision.snapshotCommand(entry.command), revision),
	].slice(-valid.limit);
	return restore(valid, entry, valid.undoStack.slice(0, -1), redoStack, revision, options);
}

export function redoEditorProjectCommand<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
	options: Options,
): State<Command> {
	const valid = admitCommandTarget(history, revision);
	if (valid.redoStack.length === 0) return valid;
	const entry = valid.redoStack.at(-1)!;
	const pushed = [
		...valid.undoStack,
		pushedEntry(valid.present, revision.snapshotCommand(entry.command), revision),
	];
	const undoStack = pushed.slice(-valid.limit);
	return restore(valid, entry, undoStack, valid.redoStack.slice(0, -1), revision, options,
		droppedCount(valid.dropped, revision) + (pushed.length - undoStack.length));
}

/**
 * Fold everything committed since a depth into one entry.
 *
 * A macro is one action to the person who ran it, so it has to be one undo. Its
 * steps commit normally — an effect step writes audio asynchronously and only
 * then knows what it produced — and the range they added is replaced here by a
 * single entry holding the project as it stood before the macro began. That is
 * exactly what undo restores, because undo restores a whole snapshot.
 */
export function collapseEditorProjectHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	depth: number,
	command: unknown,
	revision: Revision<Command, Options>,
): State<Command> {
	const valid = admitCommandTarget(history, revision);
	const undoDepth = boundedDepth(valid, depth, revision);
	if (valid.undoStack.length <= undoDepth) return valid;
	const opening = valid.undoStack[undoDepth]!;
	return settle(revision, {
		limit: valid.limit,
		present: valid.present,
		undoStack: [
			...valid.undoStack.slice(0, undoDepth),
			{ project: opening.project, command: revision.snapshotCommand(command) },
		].slice(-valid.limit),
		redoStack: [],
		dropped: droppedCount(valid.dropped, revision),
	});
}

/** Put the project back as it stood at a depth and drop what was committed since. */
export function rollbackEditorProjectHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	depth: number,
	revision: Revision<Command, Options>,
	options: Options,
): State<Command> {
	const valid = admitCommandTarget(history, revision);
	const undoDepth = boundedDepth(valid, depth, revision);
	if (valid.undoStack.length <= undoDepth) return valid;
	const opening = valid.undoStack[undoDepth]!;
	return restore(valid, opening, valid.undoStack.slice(0, undoDepth), [], revision, options);
}

/**
 * Turn the depth a macro opened at into an index into the stack as it stands now.
 *
 * The depth counts commits, not slots: a macro's own steps push the entries
 * below it off the bottom once the history is full, so an index captured when
 * the macro began would name a mid-macro snapshot — or, on a stack that was
 * already full, name nothing at all and settle the macro into a no-op. Taking
 * the entries the limit has dropped since then back off keeps it naming the
 * entry the macro opened with. A macro longer than the whole limit has pushed
 * that entry off the end too, and clamps to the oldest one left.
 */
function boundedDepth<Command, Options extends EditorHistoryCommandOptions>(
	history: State<Command>,
	depth: number,
	revision: Revision<Command, Options>,
): number {
	if (!Number.isInteger(depth) || depth < 0) {
		throw new RangeError('A history depth must be a non-negative integer.');
	}
	const index = depth - droppedCount(history.dropped, revision);
	return Math.min(Math.max(index, 0), history.undoStack.length);
}

function restore<Command, Options extends EditorHistoryCommandOptions>(
	history: State<Command>,
	entry: Entry<Command>,
	undoStack: readonly Entry<Command>[],
	redoStack: readonly Entry<Command>[],
	revision: Revision<Command, Options>,
	options: Options,
	dropped: number = droppedCount(history.dropped, revision),
): State<Command> {
	const present = revision.cloneProject(entry.project);
	const next = Number(history.present.revision) + 1;
	if (!Number.isSafeInteger(next)) throw new RangeError(`${revision.label} history revision overflowed.`);
	present.revision = next;
	present.updatedAt = timestamp(options.now, revision);
	revision.reconcileRestoredProject?.(present);
	revision.validateProject(present);
	return settle(revision, { limit: history.limit, present, undoStack, redoStack, dropped });
}

/** The document a stack entry keeps, cloned unless the product keeps the live one. */
function pushedEntry<Command, Options extends EditorHistoryCommandOptions>(
	project: EditorHistoryDocument,
	command: Command,
	revision: Revision<Command, Options>,
): Entry<Command> {
	return {
		project: revision.snapshotPushedProject === false ? project : revision.cloneProject(project),
		command,
	};
}

function cloneEntry<Command, Options extends EditorHistoryCommandOptions>(
	entry: Entry<Command>,
	revision: Revision<Command, Options>,
): Entry<Command> {
	return { project: revision.cloneProject(entry.project), command: revision.snapshotCommand(entry.command) };
}

/** Drop the dropped count from a state whose product does not carry one. */
function settle<Command, Options extends EditorHistoryCommandOptions>(
	revision: Revision<Command, Options>,
	state: State<Command> & Readonly<{ dropped: number }>,
): State<Command> {
	if (revision.tracksDropped === true) return state;
	return {
		limit: state.limit,
		present: state.present,
		undoStack: state.undoStack,
		redoStack: state.redoStack,
	};
}

/**
 * Admit the history a command is about to change: the present document only.
 *
 * A stored history is validated whole where it enters the session — created,
 * cloned, or read back from storage — and the entries behind the present
 * document are snapshots this module wrote and never touches again. Walking all
 * of them on every command instead made editing cost grow with how long the
 * session had been open and with project size at once, at up to twice the
 * history limit in full document validations per command. What is still checked
 * is what the mechanics themselves rely on: the record's shape, its limit, its
 * dropped count, the document being edited, and that both stacks are arrays
 * within that limit.
 */
function admitCommandTarget<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
): State<Command> {
	if (revision.validatesHistory === false) return history as State<Command>;
	const value = readHistory(history, revision, false);
	const limit = historyLimit(value.limit, revision);
	droppedCount(value.dropped, revision);
	revision.validateProject(value.present);
	readStack(value.undoStack, 'undoStack', limit, revision);
	readStack(value.redoStack, 'redoStack', limit, revision);
	return history as State<Command>;
}

function readHistory<Command, Options extends EditorHistoryCommandOptions>(
	history: unknown,
	revision: Revision<Command, Options>,
	admitStructure = true,
): Partial<State<Command>> {
	if (admitStructure) revision.admitStructure?.(history);
	const fields = revision.tracksDropped === true ? HISTORY_FIELDS_WITH_DROPPED : HISTORY_FIELDS;
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

function validateStack<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	name: 'undoStack' | 'redoStack',
	limit: number,
	projectId: string,
	revision: Revision<Command, Options>,
): void {
	const stack = readStack(value, name, limit, revision);
	for (const item of stack) {
		const entry = readEntry(item, name, revision);
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
		return readClosedDomainRecord(value, entryName, ENTRY_FIELDS) as unknown as Entry<Command>;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${entryName} is invalid.`);
	}
	if (revision.shape === 'exact') assertExactFields(value, ENTRY_FIELDS, entryName);
	return value as Entry<Command>;
}

function assertExactFields(value: object, fields: readonly string[], name: string): void {
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be exact.`);
	}
}

function historyLimit<Command, Options extends EditorHistoryCommandOptions>(
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
function droppedCount<Command, Options extends EditorHistoryCommandOptions>(
	value: unknown,
	revision: Revision<Command, Options>,
): number {
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`A ${revision.label} history dropped count must be a non-negative safe integer.`);
	}
	return Number(value);
}

function timestamp<Command, Options extends EditorHistoryCommandOptions>(
	value: Date | string | undefined,
	revision: Revision<Command, Options>,
): string {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (Number.isNaN(date.getTime())) throw new TypeError(`A valid ${revision.label} history timestamp is required.`);
	return date.toISOString();
}
