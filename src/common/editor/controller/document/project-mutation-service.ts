/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MacroTransactionMetadata } from '../effects/macro-transaction-metadata.ts';

import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { ProjectFlushOptions } from './project-save-service.ts';
import {
	assertEditorCommandCapabilities,
	type EditorCommandCapabilities,
} from './internal/command-capability-policy.ts';

export interface MutationTrack {
	readonly id: string;
}

export interface MutationProject<Track extends MutationTrack = MutationTrack> {
	readonly id: string;
	readonly tracks: readonly Track[];
	readonly clips: readonly Readonly<{ readonly id: string }>[];
}

export interface MutationHistoryEntry<Project> {
	readonly project: Project;
}

export interface MutationHistory<Project extends MutationProject> {
	readonly present: Project;
	readonly undoStack?: readonly MutationHistoryEntry<Project>[];
	/**
	 * How many entries the history's limit has already pushed off the bottom of
	 * the undo stack, for a history that counts them. A macro opens at a position
	 * in the whole sequence of commits rather than at an index into the stack,
	 * because its own steps shift that stack once the history is full.
	 */
	readonly dropped?: number;
}

export interface ProjectMutationState<
	Project extends MutationProject,
	History extends MutationHistory<Project>,
> {
	readOnly: boolean;
	takeCycleRecovery?: unknown;
	takeCycleRecoveryInspecting?: boolean;
	history: History | null;
	selectedTrackId: string | null;
	selectedClipId: string | null;
	projectBinPreview: unknown;
}

interface MutationLifetime<LifetimeToken> {
	capture(): LifetimeToken;
	assertActive(token?: LifetimeToken): void;
}

interface ProjectRetentionPort<History> {
	compactLiveSourceState(dirty?: boolean | null): unknown;
	retainLiveClipIds(): void;
	synchronizeLiveHistory(history: History): History;
}

interface ProjectPublisherPort {
	publishProjectState(): void;
}

interface ProjectSavePort {
	scheduleAutosave(): boolean;
	flushProject(options?: ProjectFlushOptions): PromiseLike<unknown> | unknown;
}

/** What a command is told about the moment it runs. */
export interface EditorCommandMoment {
	readonly playheadFrame?: number;
}

export interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ProjectChangedOptions {
	readonly skipPlaybackEngine?: boolean;
	/**
	 * Where the playhead belongs for the document that just replaced the present
	 * one, when an undo or a redo restored a position along with it.
	 */
	readonly restorePlayheadFrame?: number;
}

export interface ProjectMutationServiceDependencies<
	Project extends MutationProject<Track>,
	History extends MutationHistory<Project>,
	ProjectToken,
	LifetimeToken = Readonly<{ readonly generation: number }>,
	Track extends MutationTrack = MutationTrack,
> {
	readonly lifetime: MutationLifetime<LifetimeToken>;
	readonly state: ProjectMutationState<Project, History>;
	readonly productName: string;
	readonly capabilities: EditorCommandCapabilities;
	readonly projectReadOnlyMessage: string;
	readonly assertEditingAllowed: () => void;
	readonly getProject: () => Project | null;
	readonly setProject: (project: Project | null) => void;
	readonly getHistory: () => History | null;
	readonly setHistory: (history: History) => void;
	readonly executeEditorCommand: (
		history: History, command: unknown, options?: EditorCommandMoment,
	) => History;
	readonly applyEditorCommand: (project: Project, command: AudioEditorCommand) => Project;
	/**
	 * Present only for a product that runs macros. Everything else is fenced out
	 * by the `audioMacros` capability long before a transaction could be opened.
	 */
	readonly collapseEditorHistory?: (
		history: History, depth: number, command: MacroTransactionMetadata,
	) => History;
	readonly rollbackEditorHistory?: (history: History, depth: number) => History;
	readonly retention: ProjectRetentionPort<History>;
	readonly publisher: ProjectPublisherPort;
	readonly saves: ProjectSavePort;
	readonly stopProjectBinPreview: () => unknown;
	readonly clearWaveformPcmWindows: () => void;
	/** Reconcile the recording owner's routing to the active track set. */
	readonly reconcileRecordingRouting: (tracks: readonly Track[]) => boolean;
	readonly persistRecordingRouting: () => Promise<unknown>;
	readonly findClip: (project: Project, clipId: string) => Readonly<{ id: string }> | null;
	readonly findTrack: (project: Project, trackId: string) => Track | null;
	readonly synchronizeMicrophoneMeterTarget: () => void;
	readonly synchronizeAnnotationFocus: () => void;
	readonly getPlaybackState: () => string;
	/**
	 * Where the transport's playhead sits right now, for a runtime that has one.
	 *
	 * Every command carries the position it was run from into the undo stack, so
	 * undoing puts the playhead back where the person left it as well as the
	 * document. A runtime without a transport leaves this out and its history
	 * simply keeps no position.
	 */
	readonly getPlayheadFrame?: () => number | null | undefined;
	/** Move the transport's playhead, answering where it actually landed. */
	readonly seekPlayhead?: (frame: number) => number | null | undefined;
	readonly projectHasTimePitchClips: (project: Project) => boolean;
	readonly beginPlaybackCachePreparation: (project: Project) => PromiseLike<unknown>;
	readonly applyProjectToPlaybackEngine: (project: Project) => PromiseLike<unknown>;
	readonly captureProject: (projectId: string) => ProjectToken;
	readonly assertProject: (token: ProjectToken) => void;
	readonly handleError: (error: unknown) => void;
	readonly isExpectedCancellation: (error: unknown) => boolean;
}

/**
 * One macro run, folded into one undo entry.
 *
 * A macro is one action to the person who ran it, but it cannot be planned as a
 * single command: an effect step writes audio asynchronously and only then knows
 * what it produced. Its steps therefore commit normally and the range they added
 * is settled here — collapsed into one entry, or rolled back to the project the
 * macro began from. Exactly one of the two happens, once.
 */
export interface MacroTransaction<Project> {
	/** Where in the undo stack the macro began. */
	readonly depth: number;
	commit(command: MacroTransactionMetadata): Project;
	rollback(): Project;
}

export interface ProjectMutationService<Project extends MutationProject> {
	commit(command: unknown, selection?: CommitSelection, options?: ProjectChangedOptions): Project;
	beginMacroTransaction(): MacroTransaction<Project>;
	updateSelection(command: AudioEditorCommand): Project;
	projectChanged(options?: ProjectChangedOptions): void;
	scheduleAutosave(): boolean;
	saveNow(): Promise<unknown>;
	flushProject(options?: ProjectFlushOptions): Promise<unknown>;
}

/** Coordinates the one synchronous command/history/project publication path. */
export function createProjectMutationService<
	Project extends MutationProject<Track>,
	History extends MutationHistory<Project>,
	ProjectToken,
	LifetimeToken = Readonly<{ readonly generation: number }>,
	Track extends MutationTrack = MutationTrack,
>(
	dependencies: ProjectMutationServiceDependencies<
		Project, History, ProjectToken, LifetimeToken, Track
	>,
): Readonly<ProjectMutationService<Project>> {
	let openMacroTransactions = 0;
	let pendingPlayheadRestore: Readonly<{ frame: number; landed: unknown }> | null = null;

	return Object.freeze({
		commit,
		beginMacroTransaction,
		updateSelection,
		projectChanged,
		scheduleAutosave,
		saveNow,
		flushProject,
	});

	function commit(
		command: unknown,
		selection: CommitSelection = {},
		options: ProjectChangedOptions = {},
	): Project {
		dependencies.lifetime.assertActive();
		assertWritable();
		assertEditorCommandCapabilities(command, dependencies.capabilities, dependencies.productName);
		const history = requireHistory();
		const nextHistory = dependencies.executeEditorCommand(history, command, commandMoment());
		dependencies.setHistory(nextHistory);
		dependencies.state.history = nextHistory;
		dependencies.setProject(nextHistory.present);
		if (Object.hasOwn(selection, 'selectTrackId')) {
			dependencies.state.selectedTrackId = selection.selectTrackId ?? null;
		}
		if (Object.hasOwn(selection, 'selectClipId')) {
			dependencies.state.selectedClipId = selection.selectClipId ?? null;
		}
		projectChanged(options);
		return requireProject();
	}

	function beginMacroTransaction(): MacroTransaction<Project> {
		dependencies.lifetime.assertActive();
		assertWritable();
		const collapse = dependencies.collapseEditorHistory;
		const rollback = dependencies.rollbackEditorHistory;
		if (!collapse || !rollback) {
			throw new Error('This project runtime does not run macros.');
		}
		const opened = requireHistory();
		const openedProject = dependencies.captureProject(requireProject().id);
		const depth = (opened.dropped ?? 0) + (opened.undoStack?.length ?? 0);
		openMacroTransactions += 1;
		let settled = false;
		const settle = (next: (history: History) => History): Project => {
			const reentered = settled;
			settled = true;
			if (!reentered) openMacroTransactions = Math.max(0, openMacroTransactions - 1);
			// The depth is a position in the history the macro opened against, and
			// there is one history slot for whichever project is active. Settling
			// after a project switch would therefore collapse or revert the project
			// that is open now — and autosave the loss — so the fence is asserted
			// before anything is read or written. It is asserted ahead of the second
			// settlement too: both macro callers roll back in the catch that a
			// refused commit lands in, and that rollback has to be refused for the
			// same reason rather than reported as an internal double settlement.
			dependencies.assertProject(openedProject);
			if (reentered) throw new Error('A macro transaction settles exactly once.');
			const nextHistory = next(requireHistory());
			dependencies.setHistory(nextHistory);
			dependencies.state.history = nextHistory;
			dependencies.setProject(nextHistory.present);
			projectChanged();
			return requireProject();
		};
		return Object.freeze({
			depth,
			commit: (command: MacroTransactionMetadata) => settle((history) => collapse(history, depth, command)),
			rollback: () => settle((history) => rollback(history, depth)),
		});
	}

	function updateSelection(command: AudioEditorCommand): Project {
		dependencies.lifetime.assertActive();
		assertWritable();
		assertEditorCommandCapabilities(command, dependencies.capabilities, dependencies.productName);
		const history = requireHistory();
		const nextProject = dependencies.applyEditorCommand(history.present, command);
		const nextHistory = dependencies.retention.synchronizeLiveHistory({ ...history, present: nextProject });
		dependencies.setHistory(nextHistory);
		dependencies.state.history = nextHistory;
		dependencies.setProject(nextHistory.present);
		dependencies.synchronizeAnnotationFocus();
		dependencies.publisher.publishProjectState();
		return nextHistory.present;
	}

	function projectChanged(options: ProjectChangedOptions = {}): void {
		dependencies.lifetime.assertActive();
		if (dependencies.state.projectBinPreview) void dependencies.stopProjectBinPreview();
		dependencies.clearWaveformPcmWindows();
		// Inside a macro these run once at the end instead of once per step. Both
		// walk every retained history project and every clip in it, so a long
		// macro would otherwise spend most of its time compacting a history it is
		// about to collapse — and would schedule an autosave, and re-queue the
		// playback engine, for each of its own intermediate states.
		const settling = openMacroTransactions === 0;
		if (settling) {
			dependencies.retention.compactLiveSourceState(true);
			dependencies.retention.retainLiveClipIds();
		}
		const project = requireProject();
		if (dependencies.reconcileRecordingRouting(project.tracks)) {
			void dependencies.persistRecordingRouting().catch(() => undefined);
		}
		if (dependencies.state.selectedClipId
			&& !dependencies.findClip(project, dependencies.state.selectedClipId)) {
			dependencies.state.selectedClipId = null;
		}
		if (dependencies.state.selectedTrackId
			&& !dependencies.findTrack(project, dependencies.state.selectedTrackId)) {
			dependencies.state.selectedTrackId = project.tracks[0]?.id ?? null;
		}
		dependencies.synchronizeMicrophoneMeterTarget();
		dependencies.synchronizeAnnotationFocus();
		restorePlayhead(options.restorePlayheadFrame);
		if (settling && !options.skipPlaybackEngine) queuePlaybackProject(project);
		dependencies.publisher.publishProjectState();
		if (settling) dependencies.saves.scheduleAutosave();
	}

	function scheduleAutosave(): boolean {
		dependencies.lifetime.assertActive();
		return dependencies.saves.scheduleAutosave();
	}

	async function saveNow(): Promise<unknown> {
		dependencies.lifetime.assertActive();
		return dependencies.saves.flushProject({
			prepareCurrentSnapshot: true,
			preparationPurpose: 'project-save',
		});
	}

	async function flushProject(options: ProjectFlushOptions = {}): Promise<unknown> {
		dependencies.lifetime.assertActive();
		return dependencies.saves.flushProject(options);
	}

	function queuePlaybackProject(project: Project): void {
		const lifetimeToken = dependencies.lifetime.capture();
		const projectToken = dependencies.captureProject(project.id);
		const prepare = dependencies.getPlaybackState() === 'playing'
			&& dependencies.projectHasTimePitchClips(project);
		void applyWhenCurrent().catch((error: unknown) => {
			if (!dependencies.isExpectedCancellation(error)) dependencies.handleError(error);
		});

		async function applyWhenCurrent(): Promise<void> {
			if (prepare) await dependencies.beginPlaybackCachePreparation(project);
			dependencies.lifetime.assertActive(lifetimeToken);
			dependencies.assertProject(projectToken);
			if (dependencies.getProject() !== project) return;
			await dependencies.applyProjectToPlaybackEngine(project);
			dependencies.lifetime.assertActive(lifetimeToken);
			dependencies.assertProject(projectToken);
			settlePlayheadRestore();
		}
	}

	/**
	 * Put the playhead back where the restored document left it.
	 *
	 * The transport still holds the document as it stood before the restore, so a
	 * position past that document's end clamps short — undoing a delete that
	 * shortened the timeline past the playhead is exactly that case. Where the
	 * seek lands short, it is asked again once the restored document is loaded.
	 */
	function restorePlayhead(frame: number | undefined): void {
		pendingPlayheadRestore = null;
		if (frame === undefined || !dependencies.seekPlayhead) return;
		const landed = dependencies.seekPlayhead(frame);
		if (landed === frame) return;
		pendingPlayheadRestore = { frame, landed };
	}

	/** Ask again after the load, unless something else has moved the playhead since. */
	function settlePlayheadRestore(): void {
		const pending = pendingPlayheadRestore;
		pendingPlayheadRestore = null;
		if (!pending || !dependencies.seekPlayhead) return;
		if (dependencies.getPlayheadFrame?.() !== pending.landed) return;
		dependencies.seekPlayhead(pending.frame);
	}

	/**
	 * Where the playhead is as this command runs, when the runtime can say.
	 *
	 * A position that is not a usable frame is left out rather than passed on:
	 * the history would reject it, and a command is the wrong place to fail over
	 * a transport reading.
	 */
	function commandMoment(): EditorCommandMoment {
		const frame = dependencies.getPlayheadFrame?.();
		if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) return {};
		return { playheadFrame: Math.round(frame) };
	}

	function assertWritable(): void {
		dependencies.assertEditingAllowed();
		if (dependencies.state.readOnly) throw new Error(dependencies.projectReadOnlyMessage);
		if (dependencies.state.takeCycleRecovery || dependencies.state.takeCycleRecoveryInspecting) {
			throw new Error('Resolve pending take cycle recovery before editing.');
		}
	}

	function requireHistory(): History {
		const history = dependencies.getHistory();
		if (!history) throw new Error('An active project history is required.');
		return history;
	}

	function requireProject(): Project {
		const project = dependencies.getProject();
		if (!project) throw new Error('An active project is required.');
		return project;
	}
}
