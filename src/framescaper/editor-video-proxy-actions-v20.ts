/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCapturedVideoProxyRequest } from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
	type FramescaperVideoProxyActionRuntime,
	type FramescaperVideoProxyOperationOptions,
	type FramescaperVideoProxyOriginalRelinkCandidate,
} from './editor-video-proxy-action-runtime-v20.ts';
import {
	normalizeVideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import type {
	FramescaperCapturedVideoProxyRuntimeComposition,
	FramescaperCapturedVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler.ts';
import { createFramescaperCapturedVideoProxySchedulerV20 } from './editor-captured-video-proxy-scheduler.ts';
import { createFramescaperExistingVideoProxySchedulerV20 } from './editor-existing-video-proxy-scheduler.ts';
import type { FramescaperEditorProjectEnvironmentV20 } from './editor-project-environment-v20.ts';
import type { FramescaperVideoProxyModeV20 } from './editor-video-proxy-use-policy-v20.ts';
import {
	resolveFramescaperVideoProxyUseV20,
	type FramescaperVideoProxyPressureV20,
} from './editor-video-proxy-use-policy-v20.ts';
import {
	type FramescaperVideoProxyCleanupClaimV20,
	type FramescaperVideoProxyCleanupCoordinatorV20,
} from './editor-video-proxy-cleanup-v20.ts';

type SessionV20 = Parameters<typeof createFramescaperCapturedVideoProxySchedulerV20>[1];
type SchedulerFactory = () => FramescaperCapturedVideoProxyScheduler;
type ExistingSchedulerFactory = (candidate: Blob) => FramescaperCapturedVideoProxyScheduler;

export interface FramescaperVideoProxyActionOwnerV20 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown; undo(): unknown }>;
		readonly video: Readonly<{
			reloadSourceVisual(sourceId: string): unknown;
		}>;
		readonly projectBin: Readonly<{
			canRelinkLinkedVideo(clipId: string): PromiseLike<boolean> | boolean;
			classifyLinkedVideoRelink(
				clipId: string,
				file: File,
			): PromiseLike<'exact-content' | 'changed-content'> | 'exact-content' | 'changed-content';
			relinkLinkedVideo(
				clipId: string,
				file: File,
				locator: Readonly<{ readonly locatorId: string; readonly locatorRevision: string }>,
				options?: Readonly<{ readonly allowChangedContent?: boolean }>,
			): unknown;
		}>;
	}>;
}

export interface FramescaperVideoProxyActionsV20Options {
	readonly owner: FramescaperVideoProxyActionOwnerV20;
	readonly createScheduler: SchedulerFactory;
	readonly createAttachExistingScheduler?: ExistingSchedulerFactory;
	readonly createSessionId?: () => string;
	readonly cleanup: FramescaperVideoProxyCleanupCoordinatorV20;
}

export interface FramescaperVideoProxyActionsOptions extends FramescaperVideoProxyActionsV20Options {
	readonly schemaVersion: 20 | 27;
	readonly createDetachCommand?: (
		sourceId: string,
		expectedAttachment: unknown,
	) => unknown;
}

export interface FramescaperVideoProxyActionsV27Options extends FramescaperVideoProxyActionsV20Options {
	readonly createAttachExistingScheduler: ExistingSchedulerFactory;
	readonly createDetachCommand: NonNullable<FramescaperVideoProxyActionsOptions['createDetachCommand']>;
}

/** Bind selected V20 editorial proxy actions to its authenticated controller. */
export function bindFramescaperVideoProxyActionsV20(
	environment: Readonly<FramescaperEditorProjectEnvironmentV20>,
	session: SessionV20,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	owner: FramescaperVideoProxyActionOwnerV20,
): FramescaperVideoProxyActionRuntime {
	return createFramescaperVideoProxyActionsV20({
		owner,
		cleanup: environment.videoProxyCleanup,
		createScheduler: () => createFramescaperCapturedVideoProxySchedulerV20(
			environment,
			session,
			composition,
		),
		createAttachExistingScheduler: (candidate) => createFramescaperExistingVideoProxySchedulerV20(
			environment,
			session,
			composition,
			candidate,
		),
	});
}

/** Strict factory retained as the focused test and future V27 adapter seam. */
export function createFramescaperVideoProxyActionsV20(
	options: FramescaperVideoProxyActionsV20Options,
): FramescaperVideoProxyActionRuntime {
	return createFramescaperVideoProxyActions({ ...options, schemaVersion: 20 });
}

export function createFramescaperVideoProxyActionsV27(
	options: FramescaperVideoProxyActionsV27Options,
): FramescaperVideoProxyActionRuntime {
	return createFramescaperVideoProxyActions({ ...options, schemaVersion: 27 });
}

/** Shared selected-project seam; V27 injects its exact scheduler and command wire. */
export function createFramescaperVideoProxyActions(
	options: FramescaperVideoProxyActionsOptions,
): FramescaperVideoProxyActionRuntime {
	assertOptions(options);
	const modes = new Map<string, FramescaperVideoProxyModeV20>();
	const pressures = new Map<string, Readonly<FramescaperVideoProxyPressureV20>>();
	const sessionId = (options.createSessionId ?? secureSessionId)();
	if (!/^[\x21-\x7e]{1,256}$/u.test(sessionId)) {
		throw new TypeError('The Framescaper editorial proxy session ID is invalid.');
	}
	const runtime = registerFramescaperVideoProxyActionRuntime(Object.freeze({
		mode(sourceId: string): FramescaperVideoProxyModeV20 {
			return modes.get(identifier(sourceId)) ?? 'auto';
		},
		async setMode(sourceId: string, mode: FramescaperVideoProxyModeV20): Promise<void> {
			const id = identifier(sourceId);
			if (mode !== 'original' && mode !== 'proxy' && mode !== 'auto') {
				throw new RangeError('The Framescaper video-proxy mode is unsupported.');
			}
			if ((modes.get(id) ?? 'auto') === mode) return;
			modes.set(id, mode);
			await refresh(id);
		},
		pressure(sourceId: string): Readonly<FramescaperVideoProxyPressureV20> | null {
			return pressures.get(identifier(sourceId)) ?? null;
		},
		async reportPreviewPressure(
			sourceId: string,
			value: Readonly<FramescaperVideoProxyPressureV20>,
		): Promise<void> {
			const id = identifier(sourceId);
			const captured = snapshotPressure(value);
			const before = pressureSelectsProxy(pressures.get(id) ?? null);
			pressures.set(id, captured);
			if ((modes.get(id) ?? 'auto') === 'auto'
				&& before !== pressureSelectsProxy(captured)) await refresh(id);
		},
		generate: (
			sourceId: string,
			operationOptions: FramescaperVideoProxyOperationOptions = {},
		) => generate(sourceId, operationOptions),
		attachExisting: (
			sourceId: string,
			candidate: Blob,
			operationOptions: FramescaperVideoProxyOperationOptions = {},
		) => attachExisting(sourceId, candidate, operationOptions),
		detach,
		regenerate,
		relinkOriginal,
	}));
	bindFramescaperVideoProxyActionRuntime(options.owner as object, runtime);
	return runtime;

	async function generate(
		sourceIdValue: string,
		operationOptions: FramescaperVideoProxyOperationOptions,
	): Promise<void> {
		return publishCandidate(
			sourceIdValue,
			operationOptions,
			'generating',
			options.createScheduler,
		);
	}

	async function attachExisting(
		sourceIdValue: string,
		candidate: Blob,
		operationOptions: FramescaperVideoProxyOperationOptions,
	): Promise<void> {
		if (!options.createAttachExistingScheduler) {
			throw new Error('This runtime cannot attach an existing video proxy.');
		}
		const createScheduler = options.createAttachExistingScheduler;
		return publishCandidate(
			sourceIdValue,
			operationOptions,
			'validating',
			() => createScheduler(candidate),
		);
	}

	async function publishCandidate(
		sourceIdValue: string,
		operationOptions: FramescaperVideoProxyOperationOptions,
		workPhase: 'generating' | 'validating',
		createScheduler: SchedulerFactory,
	): Promise<void> {
		const sourceId = identifier(sourceIdValue);
		const project = exactProject(options.owner.project, options.schemaVersion);
		const source = videoSource(project, sourceId);
		if (source.proxyAttachment !== null) {
			throw new RangeError(`Source ${sourceId} already has a proxy; use Regenerate.`);
		}
		throwIfAborted(operationOptions.signal);
		progress(operationOptions, 'queued', 0);
		const scheduler = createScheduler();
		let abortDisposal: Promise<void> | null = null;
		const onAbort = (): void => {
			abortDisposal ??= scheduler.dispose();
			void abortDisposal.catch(() => undefined);
		};
		operationOptions.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			progress(operationOptions, workPhase, 0);
			await scheduler(proxyRequest(project, source, sessionId));
			throwIfAborted(operationOptions.signal);
			progress(operationOptions, 'publishing', 0);
			await refresh(sourceId);
			progress(operationOptions, 'complete', 1);
		} finally {
			operationOptions.signal?.removeEventListener('abort', onAbort);
			progress(operationOptions, 'cleaning', 0);
			abortDisposal ??= scheduler.dispose();
			await abortDisposal;
		}
	}

	async function detach(sourceIdValue: string): Promise<void> {
		await detachPointer(sourceIdValue);
	}

	async function detachPointer(sourceIdValue: string): Promise<void> {
		const sourceId = identifier(sourceIdValue);
		const source = videoSource(exactProject(options.owner.project, options.schemaVersion), sourceId);
		if (source.proxyAttachment === null) return;
		const expectedAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		await options.owner.actions.edit.commit(options.createDetachCommand
			? options.createDetachCommand(sourceId, expectedAttachment)
			: {
				type: 'framescaper/video-proxy-detach',
				sourceId,
				expectedAttachment,
			});
		await refresh(sourceId);
	}

	async function regenerate(
		sourceIdValue: string,
		operationOptions: FramescaperVideoProxyOperationOptions = {},
	): Promise<void> {
		const sourceId = identifier(sourceIdValue);
		const before = exactProject(options.owner.project, options.schemaVersion);
		if (videoSource(before, sourceId).proxyAttachment === null) {
			await generate(sourceId, operationOptions);
			return;
		}
		const cleanupClaim = await options.cleanup.prepareReplacement(before, sourceId);
		try {
			await detachPointer(sourceId);
		} catch (error) {
			await cancelCleanupAfterFailedMutation(cleanupClaim, error);
		}
		const detached = options.owner.project;
		try {
			await generate(sourceId, operationOptions);
		} catch (error) {
			// Restore only when no other edit moved the history after our detach.
			if (options.owner.project === detached) {
				try {
					await options.owner.actions.edit.undo();
					await refresh(sourceId);
					await options.cleanup.cancel(cleanupClaim);
				} catch (restoreError) {
					await settleCleanupAfterCommittedMutation(cleanupClaim, new AggregateError(
						[error, restoreError],
						'Proxy regeneration and restoration both failed.',
						{ cause: error },
					));
				}
			} else {
				await settleCleanupAfterCommittedMutation(cleanupClaim, error);
			}
			throw error;
		}
		await options.cleanup.settle(cleanupClaim, options.owner.project);
	}

	async function relinkOriginal(
		sourceIdValue: string,
		candidate: FramescaperVideoProxyOriginalRelinkCandidate,
		relinkOptions: Readonly<{ readonly allowChangedContent?: boolean }> = {},
	): Promise<'relinked' | 'confirmation-required'> {
		const sourceId = identifier(sourceIdValue);
		const project = exactProject(options.owner.project, options.schemaVersion);
		videoSource(project, sourceId);
		const clipId = linkedProjectBinClipId(project, sourceId);
		if (await options.owner.actions.projectBin.canRelinkLinkedVideo(clipId) !== true) {
			throw new Error(`Source ${sourceId} is not an offline linked video original.`);
		}
		const classification = await options.owner.actions.projectBin.classifyLinkedVideoRelink(
			clipId,
			candidate.file,
		);
		if (classification === 'changed-content' && relinkOptions.allowChangedContent !== true) {
			return 'confirmation-required';
		}
		if (classification !== 'exact-content' && classification !== 'changed-content') {
			throw new Error('The selected video is not an admissible original relink candidate.');
		}
		let cleanupClaim: Readonly<FramescaperVideoProxyCleanupClaimV20> | null = null;
		if (classification === 'changed-content'
			&& videoSource(exactProject(options.owner.project, options.schemaVersion), sourceId).proxyAttachment !== null) {
			// A changed original can never retain a proxy bound to the old digest.
			// Durable cleanup is journaled before history invalidates the pointer.
			cleanupClaim = await options.cleanup.prepareReplacement(options.owner.project, sourceId);
			try {
				await detachPointer(sourceId);
			} catch (error) {
				await cancelCleanupAfterFailedMutation(cleanupClaim, error);
			}
		}
		try {
			await options.owner.actions.projectBin.relinkLinkedVideo(
				clipId,
				candidate.file,
				candidate.locator,
				classification === 'changed-content' ? { allowChangedContent: true } : {},
			);
		} catch (error) {
			if (cleanupClaim) await settleCleanupAfterCommittedMutation(cleanupClaim, error);
			throw error;
		}
		if (cleanupClaim) await options.cleanup.settle(cleanupClaim, options.owner.project);
		await refresh(sourceId);
		return 'relinked';
	}

	async function cancelCleanupAfterFailedMutation(
		claim: Readonly<FramescaperVideoProxyCleanupClaimV20>,
		mutationError: unknown,
	): Promise<never> {
		try {
			await options.cleanup.cancel(claim);
		} catch (cleanupError) {
			throw new AggregateError(
				[mutationError, cleanupError],
				'The proxy mutation failed and its cleanup intent could not be cancelled.',
				{ cause: mutationError },
			);
		}
		throw mutationError;
	}

	async function settleCleanupAfterCommittedMutation(
		claim: Readonly<FramescaperVideoProxyCleanupClaimV20>,
		mutationError: unknown,
	): Promise<never> {
		try {
			await options.cleanup.settle(claim, options.owner.project);
		} catch (cleanupError) {
			throw new AggregateError(
				[mutationError, cleanupError],
				'The proxy mutation failed after invalidation and body cleanup remains recoverable.',
				{ cause: mutationError },
			);
		}
		throw mutationError;
	}

	async function refresh(sourceId: string): Promise<void> {
		await options.owner.actions.video.reloadSourceVisual(sourceId);
	}
}

function snapshotPressure(
	value: Readonly<FramescaperVideoProxyPressureV20>,
): Readonly<FramescaperVideoProxyPressureV20> {
	resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	});
	return Object.freeze({
		droppedFrameRatio: value.droppedFrameRatio,
		decodeQueueDepth: value.decodeQueueDepth,
		viewportScale: value.viewportScale,
	});
}

function pressureSelectsProxy(value: Readonly<FramescaperVideoProxyPressureV20> | null): boolean {
	return resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: value,
	}).kind === 'proxy';
}

function proxyRequest(
	project: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>>,
	sessionId: string,
): FramescaperCapturedVideoProxyRequest {
	const revision = project.revision;
	const contentSha256 = source.contentSha256;
	if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
		throw new RangeError('The Framescaper editorial proxy project revision is invalid.');
	}
	if (typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) {
		throw new TypeError('The Framescaper editorial proxy source digest is invalid.');
	}
	return Object.freeze({
		projectId: identifier(String(project.id)),
		sessionId,
		sourceId: identifier(String(source.id)),
		expectedProjectRevision: Number(revision),
		expectedContentSha256: contentSha256,
	});
}

function exactProject(
	value: unknown,
	schemaVersion: 20 | 27,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Readonly<Record<string, unknown>>).schemaVersion !== schemaVersion) {
		throw new Error(`Editorial proxy mutation requires the selected writable Framescaper V${String(schemaVersion)} project.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function videoSource(
	project: Readonly<Record<string, unknown>>,
	sourceId: string,
): Readonly<Record<string, unknown>> & { readonly proxyAttachment: unknown | null } {
	const sources = project.sources;
	if (!Array.isArray(sources)) throw new TypeError('The Framescaper project source list is invalid.');
	const source = sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as Readonly<Record<string, unknown>>).id === sourceId
	)) as (Readonly<Record<string, unknown>> & { readonly proxyAttachment?: unknown }) | undefined;
	if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${sourceId} does not exist.`);
	if (!Object.hasOwn(source, 'proxyAttachment')) {
		throw new TypeError(`Video source ${sourceId} has no proxy-attachment carrier.`);
	}
	return source as Readonly<Record<string, unknown>> & { readonly proxyAttachment: unknown | null };
}

function linkedProjectBinClipId(project: Readonly<Record<string, unknown>>, sourceId: string): string {
	const projectBin = project.projectBin as Readonly<Record<string, unknown>> | null;
	const clips = projectBin?.clips;
	if (!Array.isArray(clips)) throw new Error(`Source ${sourceId} has no Project Bin relink occurrence.`);
	const candidates = clips.filter((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as Readonly<Record<string, unknown>>).kind === 'video'
		&& (candidate as Readonly<Record<string, unknown>>).sourceId === sourceId
	));
	if (candidates.length !== 1 || typeof (candidates[0] as Readonly<Record<string, unknown>>).id !== 'string') {
		throw new Error(`Source ${sourceId} requires one exact Project Bin video occurrence to relink.`);
	}
	return identifier(String((candidates[0] as Readonly<Record<string, unknown>>).id));
}

function progress(
	options: FramescaperVideoProxyOperationOptions,
	phase: 'queued' | 'generating' | 'validating' | 'publishing' | 'cleaning' | 'complete',
	completed: 0 | 1,
): void {
	options.onProgress?.(Object.freeze({ phase, completed, total: 1 }));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Video proxy generation was cancelled.', 'AbortError');
}

function identifier(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Framescaper video-proxy identifier is required.');
	}
	return value;
}

function secureSessionId(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for editorial proxies.');
	return `editorial-proxy-${uuid}`;
}

function assertOptions(options: FramescaperVideoProxyActionsOptions): void {
	if (!options?.owner || typeof options.owner !== 'object'
		|| typeof options.createScheduler !== 'function'
		|| (options.schemaVersion !== 20 && options.schemaVersion !== 27)
		|| (options.schemaVersion === 27 && typeof options.createAttachExistingScheduler !== 'function')
		|| !options.cleanup || typeof options.cleanup.prepareReplacement !== 'function'
		|| typeof options.cleanup.cancel !== 'function' || typeof options.cleanup.settle !== 'function'
		|| !options.owner.actions?.edit || !options.owner.actions.projectBin
		|| typeof options.owner.actions.video?.reloadSourceVisual !== 'function') {
		throw new TypeError('Framescaper V20 proxy actions require their exact controller ports.');
	}
}
