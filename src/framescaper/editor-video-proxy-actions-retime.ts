/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCapturedVideoProxyRequest } from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
	type FramescaperVideoProxyActionRuntime,
	type FramescaperVideoProxyOperationOptions,
	type FramescaperVideoProxyOriginalRelinkCandidate,
	type FramescaperVideoProxyPreviewTrust,
} from './editor-video-proxy-action-runtime.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import { sameCapturedVideoProxyAttachment as sameAttachment } from './editor-captured-video-proxy-request.ts';
import type {
	FramescaperCapturedVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler.ts';
import type { FramescaperVideoProxyModeRetime } from './editor-video-proxy-use-policy-retime.ts';
import type { FramescaperVideoProxyPressureRetime } from './editor-video-proxy-use-policy-retime.ts';
import {
	type FramescaperVideoProxyCleanupClaimRetime,
	type FramescaperVideoProxyCleanupCoordinatorRetime,
} from './editor-video-proxy-cleanup-retime.ts';
import {
	framescaperVideoProxyPressureSelectsProxyRetime as pressureSelectsProxy,
	snapshotFramescaperVideoProxyPressureRetime as snapshotPressure,
} from './editor-video-proxy-pressure-retime.ts';

type SchedulerFactory = () => FramescaperCapturedVideoProxyScheduler;
type ExistingSchedulerFactory = (candidate: Blob) => FramescaperCapturedVideoProxyScheduler;

export interface FramescaperVideoProxyActionOwnerRetime {
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
				options?: Readonly<{
					readonly allowChangedContent?: boolean;
					readonly changedContentProxyInvalidation?: Readonly<{
						commit(): void;
						confirmBindingPublished(): void;
					}>;
				}>,
			): unknown;
		}>;
	}>;
}

export interface FramescaperVideoProxyActionsRetimeOptions {
	readonly owner: FramescaperVideoProxyActionOwnerRetime;
	readonly createScheduler: SchedulerFactory;
	readonly createAttachExistingScheduler?: ExistingSchedulerFactory;
	readonly createSessionId?: () => string;
	readonly cleanup: FramescaperVideoProxyCleanupCoordinatorRetime;
	readonly previewTrust?: (
		sourceId: string,
		attachment: unknown,
	) => FramescaperVideoProxyPreviewTrust;
}

export interface FramescaperVideoProxyActionsOptions extends FramescaperVideoProxyActionsRetimeOptions {
	readonly createDetachCommand?: (
		sourceId: string,
		expectedAttachment: unknown,
	) => unknown;
}

/** Framescaper 1.0 editorial video-proxy action authority. */
export function createFramescaperVideoProxyActions(
	options: FramescaperVideoProxyActionsOptions,
): FramescaperVideoProxyActionRuntime {
	assertOptions(options);
	const modes = new Map<string, FramescaperVideoProxyModeRetime>();
	const pressures = new Map<string, Readonly<FramescaperVideoProxyPressureRetime>>();
	const sessionId = (options.createSessionId ?? secureSessionId)();
	if (!/^[\x21-\x7e]{1,256}$/u.test(sessionId)) {
		throw new TypeError('The Framescaper editorial proxy session ID is invalid.');
	}
	const runtime = registerFramescaperVideoProxyActionRuntime(Object.freeze({
		mode(sourceId: string): FramescaperVideoProxyModeRetime {
			return modes.get(identifier(sourceId)) ?? 'auto';
		},
		previewTrust(sourceIdValue: string): FramescaperVideoProxyPreviewTrust {
			const sourceId = identifier(sourceIdValue);
			const source = videoSource(exactProject(options.owner.project), sourceId);
			if (source.proxyAttachment === null) return 'unavailable';
			return options.previewTrust?.(sourceId, source.proxyAttachment) ?? 'unverified';
		},
		async setMode(sourceId: string, mode: FramescaperVideoProxyModeRetime): Promise<void> {
			const id = identifier(sourceId);
			if (mode !== 'original' && mode !== 'proxy' && mode !== 'auto') {
				throw new RangeError('The Framescaper video-proxy mode is unsupported.');
			}
			const previous = modes.get(id);
			if ((previous ?? 'auto') === mode) return;
			modes.set(id, mode);
			try {
				await refresh(id);
			} catch (error) {
				if (modes.get(id) === mode) {
					if (previous === undefined) modes.delete(id);
					else modes.set(id, previous);
				}
				throw error;
			}
		},
		pressure(sourceId: string): Readonly<FramescaperVideoProxyPressureRetime> | null {
			return pressures.get(identifier(sourceId)) ?? null;
		},
		async reportPreviewPressure(
			sourceId: string,
			value: Readonly<FramescaperVideoProxyPressureRetime>,
		): Promise<void> {
			const id = identifier(sourceId);
			const captured = snapshotPressure(value);
			const previous = pressures.get(id);
			const before = pressureSelectsProxy(previous ?? null);
			pressures.set(id, captured);
			try {
				if ((modes.get(id) ?? 'auto') === 'auto'
					&& before !== pressureSelectsProxy(captured)) await refresh(id);
			} catch (error) {
				if (pressures.get(id) === captured) {
					if (previous === undefined) pressures.delete(id);
					else pressures.set(id, previous);
				}
				throw error;
			}
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
		expectedAttachment?: Readonly<VideoProxyAttachmentV18>,
	): Promise<void> {
		const sourceId = identifier(sourceIdValue);
		const project = exactProject(options.owner.project);
		const source = videoSource(project, sourceId);
		if (expectedAttachment
			? !sameAttachment(source.proxyAttachment, expectedAttachment)
			: source.proxyAttachment !== null) {
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
			await scheduler(proxyRequest(project, source, sessionId, expectedAttachment));
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
		const source = videoSource(exactProject(options.owner.project), sourceId);
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
		const before = exactProject(options.owner.project);
		const source = videoSource(before, sourceId);
		if (source.proxyAttachment === null) {
			await generate(sourceId, operationOptions);
			return;
		}
		const expectedAttachment = normalizeVideoProxyAttachmentV18(source.proxyAttachment);
		const cleanupClaim = await options.cleanup.prepareReplacement(before, sourceId);
		try {
			await publishCandidate(
				sourceId, operationOptions, 'generating', options.createScheduler, expectedAttachment,
			);
		} catch (error) {
			const current = videoSource(
				exactProject(options.owner.project), sourceId,
			).proxyAttachment;
			if (!sameAttachment(current, expectedAttachment)) {
				await settleCleanupAfterCommittedMutation(cleanupClaim, error);
			}
			await cancelCleanupAfterFailedMutation(cleanupClaim, error);
		}
		await options.cleanup.settle(cleanupClaim, options.owner.project);
	}

	async function relinkOriginal(
		sourceIdValue: string,
		candidate: FramescaperVideoProxyOriginalRelinkCandidate,
		relinkOptions: Readonly<{ readonly allowChangedContent?: boolean }> = {},
	): Promise<'relinked' | 'confirmation-required'> {
		const sourceId = identifier(sourceIdValue);
		const project = exactProject(options.owner.project);
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
		let cleanupClaim: Readonly<FramescaperVideoProxyCleanupClaimRetime> | null = null;
		let expectedProxyAttachment: Readonly<VideoProxyAttachmentV18> | null = null;
		let invalidatedProject: unknown = null;
		let bindingPublished = false;
		const currentSource = videoSource(
			exactProject(options.owner.project), sourceId,
		);
		if (classification === 'changed-content' && currentSource.proxyAttachment !== null) {
			// Journal first; invalidation itself runs only at the binding CAS fence.
			expectedProxyAttachment = normalizeVideoProxyAttachmentV18(currentSource.proxyAttachment);
			cleanupClaim = await options.cleanup.prepareReplacement(options.owner.project, sourceId);
		}
		try {
			await options.owner.actions.projectBin.relinkLinkedVideo(
				clipId,
				candidate.file,
				candidate.locator,
				classification === 'changed-content' ? {
					allowChangedContent: true,
					...(cleanupClaim ? { changedContentProxyInvalidation: {
						commit(): void {
							if (invalidatedProject) return;
							const beforeInvalidation = options.owner.project;
							let result: unknown;
							try {
								result = options.owner.actions.edit.commit(options.createDetachCommand
									? options.createDetachCommand(sourceId, expectedProxyAttachment)
									: { type: 'framescaper/video-proxy-detach', sourceId,
										expectedAttachment: expectedProxyAttachment });
							} finally {
								if (options.owner.project !== beforeInvalidation) {
									invalidatedProject = options.owner.project;
								}
							}
							invalidatedProject ??= options.owner.project;
							if (isPromiseLike(result)) {
								throw new TypeError('Proxy invalidation must commit synchronously at the relink fence.');
							}
							if (videoSource(
								exactProject(invalidatedProject), sourceId,
							).proxyAttachment !== null) {
								throw new Error('Changed-content relink did not atomically invalidate the old proxy.');
							}
						},
						confirmBindingPublished(): void { bindingPublished = true; },
					} } : {}),
				} : {},
			);
		} catch (error) {
			if (cleanupClaim) {
				if (invalidatedProject && !bindingPublished) {
					if (options.owner.project === invalidatedProject) {
						try {
							options.owner.actions.edit.undo();
							await refresh(sourceId);
						} catch (restoreError) {
							await settleCleanupAfterCommittedMutation(cleanupClaim, new AggregateError(
								[error, restoreError], 'Original relink proxy restoration failed.', { cause: error },
							));
						}
						await cancelCleanupAfterFailedMutation(cleanupClaim, error);
					}
					await settleCleanupAfterCommittedMutation(cleanupClaim, error);
				}
				if (bindingPublished) await settleCleanupAfterCommittedMutation(cleanupClaim, error);
				await cancelCleanupAfterFailedMutation(cleanupClaim, error);
			}
			throw error;
		}
		if (cleanupClaim && (!invalidatedProject || !bindingPublished)) {
			await settleCleanupAfterCommittedMutation(
				cleanupClaim, new Error('Changed-content relink did not publish its proxy invalidation fence.'),
			);
		}
		if (cleanupClaim) await options.cleanup.settle(cleanupClaim, options.owner.project);
		await refresh(sourceId);
		return 'relinked';
	}

	async function cancelCleanupAfterFailedMutation(
		claim: Readonly<FramescaperVideoProxyCleanupClaimRetime>,
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
		claim: Readonly<FramescaperVideoProxyCleanupClaimRetime>,
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

function proxyRequest(
	project: Readonly<Record<string, unknown>>,
	source: Readonly<Record<string, unknown>>,
	sessionId: string,
	expectedProxyAttachment?: Readonly<VideoProxyAttachmentV18>,
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
		...(expectedProxyAttachment ? { expectedProxyAttachment } : {}),
	});
}

function exactProject(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Readonly<Record<string, unknown>>).schemaFamily !== 'framescaper'
		|| (value as Readonly<Record<string, unknown>>).schemaVersion !== 1) {
		throw new Error('Editorial proxy mutation requires a writable Framescaper 1.0 project.');
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return Boolean(value && (typeof value === 'object' || typeof value === 'function')
		&& typeof (value as Readonly<{ then?: unknown }>).then === 'function');
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
		|| typeof options.createAttachExistingScheduler !== 'function'
		|| (options.previewTrust !== undefined && typeof options.previewTrust !== 'function')
		|| !options.cleanup || typeof options.cleanup.prepareReplacement !== 'function'
		|| typeof options.cleanup.cancel !== 'function' || typeof options.cleanup.settle !== 'function'
		|| !options.owner.actions?.edit || !options.owner.actions.projectBin
		|| typeof options.owner.actions.video?.reloadSourceVisual !== 'function') {
		throw new TypeError('Framescaper 1.0 proxy actions require their exact controller ports.');
	}
}
