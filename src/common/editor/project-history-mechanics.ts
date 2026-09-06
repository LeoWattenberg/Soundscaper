/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitCommandTarget,
	droppedCount,
	historyLimit,
	playheadPosition,
	readHistory,
	timestamp,
	validateStack,
} from './project-history-admission.ts';

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
 *
 * An entry carries where the playhead was as well as the document, because
 * undoing an edit should hand the person the timeline as they left it — the
 * cursor included — the way Audacity restores the selected region with each of
 * its own undo states. Reading a stored history back lives next door, in
 * project-history-admission.ts.
 */

/** A document, read only as far as the mechanics themselves read it. */
export type EditorHistoryDocument = Record<string, unknown>;

export interface EditorHistoryCommandOptions {
	readonly now?: Date | string;
	/**
	 * Where the playhead sits as this command runs, for a history that keeps it.
	 *
	 * Undo restores the document the person was working on *and* the playhead
	 * they left before the action, so every command records where it was. A
	 * caller that does not know simply leaves it out, and undo then restores the
	 * document without moving the playhead.
	 */
	readonly playheadFrame?: number;
}

export interface EditorProjectHistoryEntry<Command> {
	readonly project: EditorHistoryDocument;
	readonly command: Command;
	/**
	 * Where the playhead sat before the command this entry undoes, present only
	 * where the product tracks it and the caller knew the position.
	 */
	readonly playheadFrame?: number;
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
	/**
	 * Where the playhead belongs for `present`, present only where the product
	 * tracks it: the position an undo or redo restored, and otherwise the
	 * position the last command was run from.
	 */
	readonly playheadFrame?: number;
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
	/** Whether the state and its entries carry the playhead undo restores. */
	readonly tracksPlayhead?: boolean;
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
		playheadFrame: undefined,
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
	playheadPosition(value.playheadFrame, revision);
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
		playheadFrame: playheadPosition(valid.playheadFrame, revision),
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
	const playheadFrame = livePlayhead(valid, options, revision);
	const pushed = [...valid.undoStack, pushedEntry(valid.present, normalized, revision, playheadFrame)];
	const undoStack = pushed.slice(-valid.limit);
	return settle(revision, {
		limit: valid.limit,
		present,
		undoStack,
		redoStack: [],
		dropped: droppedCount(valid.dropped, revision) + (pushed.length - undoStack.length),
		playheadFrame,
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
		pushedEntry(
			valid.present, revision.snapshotCommand(entry.command), revision,
			livePlayhead(valid, options, revision),
		),
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
		pushedEntry(
			valid.present, revision.snapshotCommand(entry.command), revision,
			livePlayhead(valid, options, revision),
		),
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
			entryOf(
				opening.project, revision.snapshotCommand(command),
				playheadPosition(opening.playheadFrame, revision), revision,
			),
		].slice(-valid.limit),
		redoStack: [],
		dropped: droppedCount(valid.dropped, revision),
		playheadFrame: playheadPosition(valid.playheadFrame, revision),
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
	return settle(revision, {
		limit: history.limit,
		present,
		undoStack,
		redoStack,
		dropped,
		playheadFrame: playheadPosition(entry.playheadFrame, revision),
	});
}

/** The document a stack entry keeps, cloned unless the product keeps the live one. */
function pushedEntry<Command, Options extends EditorHistoryCommandOptions>(
	project: EditorHistoryDocument,
	command: Command,
	revision: Revision<Command, Options>,
	playheadFrame: number | undefined,
): Entry<Command> {
	return entryOf(
		revision.snapshotPushedProject === false ? project : revision.cloneProject(project),
		command,
		playheadFrame,
		revision,
	);
}

/** One entry, shaped by whether this product's entries carry a playhead at all. */
function entryOf<Command, Options extends EditorHistoryCommandOptions>(
	project: EditorHistoryDocument,
	command: Command,
	playheadFrame: number | undefined,
	revision: Revision<Command, Options>,
): Entry<Command> {
	if (revision.tracksPlayhead !== true) return { project, command };
	return { project, command, playheadFrame };
}

function cloneEntry<Command, Options extends EditorHistoryCommandOptions>(
	entry: Entry<Command>,
	revision: Revision<Command, Options>,
): Entry<Command> {
	return entryOf(
		revision.cloneProject(entry.project),
		revision.snapshotCommand(entry.command),
		playheadPosition(entry.playheadFrame, revision),
		revision,
	);
}

/** Keep only the state fields this product's history carries. */
function settle<Command, Options extends EditorHistoryCommandOptions>(
	revision: Revision<Command, Options>,
	state: State<Command> & Readonly<{ dropped: number }>,
): State<Command> {
	const settled: Record<string, unknown> = {
		limit: state.limit,
		present: state.present,
		undoStack: state.undoStack,
		redoStack: state.redoStack,
	};
	if (revision.tracksDropped === true) settled.dropped = state.dropped;
	if (revision.tracksPlayhead === true) settled.playheadFrame = state.playheadFrame;
	return settled as unknown as State<Command>;
}

/**
 * Where the playhead is right now, as this command was told it.
 *
 * A caller that did not say falls back to the position the history already
 * carries, so a command issued from somewhere that cannot see the transport does
 * not erase what undo would otherwise put back.
 */
function livePlayhead<Command, Options extends EditorHistoryCommandOptions>(
	history: State<Command>,
	options: Options,
	revision: Revision<Command, Options>,
): number | undefined {
	return playheadPosition(options.playheadFrame, revision)
		?? playheadPosition(history.playheadFrame, revision);
}
