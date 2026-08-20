/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { FramescaperCaptureProjectFenceV1 } from '../framescaper-capture-session-manifest.ts';
import { digestScapeBytes } from '../scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import type {
	FramescaperCaptureAtomicCommitResult,
	FramescaperCaptureFenceAssertion,
	FramescaperCaptureFenceAssertionContext,
} from './framescaper-capture-publication-service.ts';

const TEXT_ENCODER = new TextEncoder();

interface CapturePublicationProject extends Record<string, unknown> {
	readonly id: string;
	readonly revision?: unknown;
	readonly updatedAt?: unknown;
}

interface CapturePublicationHistory<Project extends CapturePublicationProject> {
	readonly present: Project;
}

interface CapturePublicationProjectRepository<Project extends CapturePublicationProject> {
	load(
		projectId: string,
		options?: Readonly<{ readonly revision?: number }>,
	): PromiseLike<Project | null> | Project | null;
	saveIfCurrent(
		expected: Project,
		project: Project,
	): PromiseLike<Project | null> | Project | null;
}

interface CapturePublicationReservation {
	readonly token: unknown;
	release(): boolean;
}

interface CapturePublicationSession<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
> {
	captureProjectHistory(projectId: string): Readonly<{ readonly history: History; readonly token: unknown }>;
	beginProjectActivation(
		projectId: string,
		options: Readonly<{ readonly expectedHistoryToken: unknown }>,
	): CapturePublicationReservation;
	installCommittedProjectHistory(
		projectId: string,
		history: History,
		options: Readonly<{
			readonly expectedHistoryToken: unknown;
			readonly activationToken: unknown;
			readonly readOnly: false;
			readonly dirty: false;
		}>,
	): unknown;
	getProjectHistory(projectId: string): History;
	markProjectSaved(projectId: string): unknown;
}

interface CapturePublicationProjectRuntime<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
> {
	createHistory(project: Project): History;
	executeCommand(
		history: History,
		command: AudioEditorCommand,
		options?: Readonly<{ readonly now?: Date | string }>,
	): History;
}

export interface FramescaperCaptureProjectPublicationOptions<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
> {
	readonly projects: CapturePublicationProjectRepository<Project>;
	readonly session: CapturePublicationSession<Project, History>;
	readonly projectRuntime: CapturePublicationProjectRuntime<Project, History>;
	isActiveProject(projectId: string): boolean;
	setActiveProject(project: Project): void;
	setActiveHistory(history: History): void;
	synchronizeProject(project: Project): PromiseLike<void> | void;
}

export interface FramescaperCaptureProjectPublicationPort {
	assertProjectFence(
		fence: FramescaperCaptureProjectFenceV1,
		context: FramescaperCaptureFenceAssertionContext,
	): Promise<FramescaperCaptureFenceAssertion>;
	commitAtomic(
		command: AudioEditorCommand,
		fence: FramescaperCaptureProjectFenceV1,
	): Promise<FramescaperCaptureAtomicCommitResult>;
}

/**
 * Owns the short origin-project reservation around one background CAS and
 * installs an already-durable target into its active or inactive session tab.
 */
export function createFramescaperCaptureProjectPublicationPort<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
>(
	options: FramescaperCaptureProjectPublicationOptions<Project, History>,
): Readonly<FramescaperCaptureProjectPublicationPort> {
	assertOptions(options);

	async function assertProjectFence(
		fence: FramescaperCaptureProjectFenceV1,
		context: FramescaperCaptureFenceAssertionContext,
	): Promise<FramescaperCaptureFenceAssertion> {
		const base = await loadExactBase(options.projects, fence);
		const captured = options.session.captureProjectHistory(fence.projectId);
		if (captured.history.present.id !== base.id) {
			throw new Error('Framescaper capture origin project is no longer open.');
		}
		const durable = await options.projects.load(fence.projectId);
		if (!durable || durable.id !== fence.projectId) {
			throw new Error('Framescaper capture origin project is no longer durable.');
		}
		if (context.phase === 'before-assets') {
			return Object.freeze({
				status: sameProject(captured.history.present, base) && sameProject(durable, base)
					? 'base-current' as const
					: 'reconcile-only' as const,
			});
		}
		const targetHistory = deriveTargetHistory(options.projectRuntime, base, context.command);
		const target = targetHistory.present;
		assertBaseOrTarget(captured.history.present, base, target, 'session');
		assertBaseOrTarget(durable, base, target, 'durable project');
		return Object.freeze({
			status: sameProject(captured.history.present, target) || sameProject(durable, target)
				? 'reconcile-only' as const
				: 'base-current' as const,
		});
	}

	async function commitAtomic(
		command: AudioEditorCommand,
		fence: FramescaperCaptureProjectFenceV1,
	): Promise<FramescaperCaptureAtomicCommitResult> {
		const captured = options.session.captureProjectHistory(fence.projectId);
		const reservation = options.session.beginProjectActivation(fence.projectId, {
			expectedHistoryToken: captured.token,
		});
		try {
			const base = await loadExactBase(options.projects, fence);
			const targetHistory = sameProject(captured.history.present, base)
				? deriveTargetHistory(options.projectRuntime, base, command, captured.history)
				: deriveTargetHistory(options.projectRuntime, base, command);
			const target = targetHistory.present;
			if (!sameProject(captured.history.present, base)
				&& !sameProject(captured.history.present, target)) return Object.freeze({ status: 'cas-mismatch' });

			const durable = await options.projects.load(fence.projectId);
			if (!durable) return Object.freeze({ status: 'cas-mismatch' });
			if (sameProject(durable, base)) {
				const committed = await options.projects.saveIfCurrent(base, target);
				if (!committed) {
					const concurrent = await options.projects.load(fence.projectId);
					if (!sameProject(concurrent, target)) return Object.freeze({ status: 'cas-mismatch' });
				} else if (!sameProject(committed, target)) {
					throw new Error('Framescaper capture project CAS returned a different target.');
				}
			} else if (!sameProject(durable, target)) return Object.freeze({ status: 'cas-mismatch' });

			if (!sameProject(captured.history.present, target)) {
				options.session.installCommittedProjectHistory(fence.projectId, targetHistory, {
					expectedHistoryToken: captured.token,
					activationToken: reservation.token,
					readOnly: false,
					dirty: false,
				});
			}
			options.session.markProjectSaved(fence.projectId);
			const installed = options.session.getProjectHistory(fence.projectId);
			if (!sameProject(installed.present, target)) {
				throw new Error('Framescaper capture session normalized the committed target.');
			}
			if (options.isActiveProject(fence.projectId)) {
				options.setActiveHistory(installed);
				options.setActiveProject(installed.present);
				await options.synchronizeProject(installed.present);
			}
			return Object.freeze({
				status: 'committed' as const,
				value: Object.freeze({ project: installed.present, history: installed }),
			});
		} finally {
			reservation.release();
		}
	}

	return Object.freeze({ assertProjectFence, commitAtomic });
}

function deriveTargetHistory<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
>(
	runtime: CapturePublicationProjectRuntime<Project, History>,
	base: Project,
	command: AudioEditorCommand,
	baseHistory: History = runtime.createHistory(base),
): History {
	const targetHistory = runtime.executeCommand(baseHistory, command, deterministicCommandTime(base));
	const target = targetHistory.present;
	const revision = Number(base.revision);
	if (target.id !== base.id || !Number.isSafeInteger(revision)
		|| Number(target.revision) !== revision + 1 || sameProject(target, base)) {
		throw new Error('Framescaper capture command did not produce one new origin revision.');
	}
	return targetHistory;
}

function assertBaseOrTarget(
	value: CapturePublicationProject,
	base: CapturePublicationProject,
	target: CapturePublicationProject,
	owner: string,
): void {
	if (!sameProject(value, base) && !sameProject(value, target)) {
		throw new Error(`Framescaper capture ${owner} changed beyond the exact publication target.`);
	}
}

export function framescaperCaptureProjectFence(
	project: CapturePublicationProject,
): Readonly<FramescaperCaptureProjectFenceV1> {
	if (!project || typeof project.id !== 'string' || !project.id) {
		throw new TypeError('Framescaper capture requires an origin project.');
	}
	const revision = Number(project.revision);
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new RangeError('Framescaper capture origin revision is invalid.');
	}
	return Object.freeze({
		projectId: project.id,
		baseRevision: revision,
		baseSha256: projectDigest(project),
	});
}

async function loadExactBase<Project extends CapturePublicationProject>(
	projects: CapturePublicationProjectRepository<Project>,
	fence: FramescaperCaptureProjectFenceV1,
): Promise<Project> {
	const base = await projects.load(fence.projectId, { revision: fence.baseRevision });
	if (!base || base.id !== fence.projectId || Number(base.revision) !== fence.baseRevision
		|| projectDigest(base) !== fence.baseSha256) {
		throw new Error('Framescaper capture project fence does not name an exact durable revision.');
	}
	return base;
}

function projectDigest(project: CapturePublicationProject): string {
	return digestScapeBytes(TEXT_ENCODER.encode(serializeScapeProjectDocument(project)));
}

function sameProject(left: CapturePublicationProject | null, right: CapturePublicationProject): boolean {
	return Boolean(left) && serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function deterministicCommandTime(
	base: CapturePublicationProject,
): Readonly<{ readonly now?: Date | string }> {
	return typeof base.updatedAt === 'string' && base.updatedAt
		? Object.freeze({ now: base.updatedAt })
		: Object.freeze({});
}

function assertOptions<
	Project extends CapturePublicationProject,
	History extends CapturePublicationHistory<Project>,
>(options: FramescaperCaptureProjectPublicationOptions<Project, History>): void {
	if (!options || typeof options !== 'object'
		|| typeof options.projects?.load !== 'function'
		|| typeof options.projects?.saveIfCurrent !== 'function'
		|| typeof options.session?.captureProjectHistory !== 'function'
		|| typeof options.session?.beginProjectActivation !== 'function'
		|| typeof options.session?.installCommittedProjectHistory !== 'function'
		|| typeof options.projectRuntime?.createHistory !== 'function'
		|| typeof options.projectRuntime?.executeCommand !== 'function') {
		throw new TypeError('Framescaper capture project publication dependencies are incomplete.');
	}
}
