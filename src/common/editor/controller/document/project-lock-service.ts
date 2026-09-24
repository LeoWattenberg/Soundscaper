/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectLifecycleLock,
	ProjectLifecycleTabMetadata,
	ProjectReadOnlyUpdate,
} from './project-lifecycle-types.ts'; import { setLocalizedStatus } from '../../../i18n/presentation-message.ts';
import type { ScapeReplaceWriteAuthority } from '../../scape-import-transaction.ts';
import { publishProjectReadOnlyStatus } from './project-read-only-status.ts';
import { PROJECT_BIN_LINKED_VIDEO_RELINK_TASK } from '../import/project-bin-linked-video-relink-service.ts';
import { TAKE_CYCLE_RECORDING_TASK } from '../recording/take-cycle-recording-service.ts';

export interface ProjectLockState {
	disposed: boolean;
	readOnly: boolean;
	projectLock: ProjectLifecycleLock | null;
	projectLockRetryTimer: number;
}

export interface ProjectLockServiceRuntime {
	readonly state: ProjectLockState;
	readonly cancelTask: (name: string, reason?: unknown) => void;
	readonly getProjectId: () => string | null;
	readonly getProjectMetadata: (projectId: string) => ProjectLifecycleTabMetadata;
	readonly acquireProjectLock: (
		projectId: string,
		options?: Readonly<{ force?: boolean }>,
	) => Promise<ProjectLifecycleLock>;
	readonly setProjectReadOnly: (projectId: string, update: ProjectReadOnlyUpdate) => void;
	readonly publishProjectState: () => void;
	readonly isPersistedSnapshotCurrent?: (projectId: string) => Promise<boolean>;
	readonly setStatus: (message: string, state: 'error' | 'success', localization?: import('../../../i18n/presentation-message.ts').LocalizedPresentationMessage) => void;
	readonly handleError: (error: unknown) => void;
	readonly invalidateRecordingAuthority?: (reason: unknown) => PromiseLike<unknown> | unknown;
	readonly revokeWriteAuthority?: (reason: unknown) => void;
	readonly copy: Readonly<{
		ready: string;
		projectOpenOtherTab: string;
		projectReadOnly: string;
	}>;
	readonly retryMaximumMs?: number;
	readonly currentTimeMs?: () => number;
	readonly scheduleTimer?: (callback: () => void, delayMs: number) => number;
	readonly clearTimer?: (timer: number) => void;
}

/** Attach the durable token before a physical lock can enter the writable controller state. */
export async function claimProjectLockWriteFence(
	lock: ProjectLifecycleLock,
	claim: (projectId: string) => Promise<string>,
): Promise<ProjectLifecycleLock> {
	if (lock.readOnly) {
		if (lock.available) lock.available = lock.available.then(async (available) => available
			? await claimProjectLockWriteFence(available, claim) : null);
		return lock;
	}
	let lost = false;
	void lock.lost?.then(
		() => { lost = true; lock.readOnly = true; lock.writeFence = undefined; },
		() => { lost = true; lock.readOnly = true; lock.writeFence = undefined; },
	);
	try {
		const writeFence = await claim(lock.projectId);
		if (lost || lock.readOnly) throw new DOMException('Project write access was lost during its claim.', 'AbortError');
		lock.writeFence = writeFence;
		return lock;
	} catch (error) {
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
		throw error;
	}
}

export function createFencedProjectLockAcquisition(
	acquire: ProjectLockServiceRuntime['acquireProjectLock'],
	store: Readonly<{ claimProjectWriteFence?: (projectId: string) => Promise<string> }>,
): ProjectLockServiceRuntime['acquireProjectLock'] {
	return async (projectId, options) => {
		const lock = await acquire(projectId, options);
		return store.claimProjectWriteFence
			? claimProjectLockWriteFence(lock, (id) => store.claimProjectWriteFence!(id)) : lock;
	};
}

interface ScapeReplaceLockOptions {
	getActiveProjectId(): string | null;
	getActiveReadOnly(): boolean;
	getActiveLock(): ProjectLifecycleLock | null;
	acquireProjectLock(projectId: string): Promise<ProjectLifecycleLock>;
}

/** Hold the physical project lock and its durable write token across replacement. */
export function createScapeReplaceWriteAuthority(options: ScapeReplaceLockOptions) {
	return async (projectId: string): Promise<ScapeReplaceWriteAuthority> => {
		const active = options.getActiveProjectId() === projectId;
		const lock = active ? options.getActiveLock() : await options.acquireProjectLock(projectId);
		const owned = !active;
		if (!lock || lock.projectId !== projectId || lock.readOnly || active && options.getActiveReadOnly()
			|| typeof lock.writeFence !== 'string' || !lock.writeFence) {
			if (owned && lock) await releaseScapeReplaceLock(lock);
			throw new Error(`Scape replace could not acquire write authority for ${projectId}.`);
		}
		const writeFence = lock.writeFence;
		let released = false;
		let lost = false;
		if (lock.lost) void lock.lost.then(() => { lost = true; }, () => { lost = true; });
		return Object.freeze({
			writeFence,
			assertCurrent() {
				if (released || lost || lock.readOnly || lock.writeFence !== writeFence
					|| active && (options.getActiveProjectId() !== projectId || options.getActiveReadOnly()
						|| options.getActiveLock() !== lock)) {
					throw new Error(`Scape replace lost write authority for ${projectId}.`);
				}
			},
			async release() {
				if (released) return;
				released = true;
				if (owned) await releaseScapeReplaceLock(lock);
			},
		});
	};
}

async function releaseScapeReplaceLock(lock: ProjectLifecycleLock): Promise<void> {
	try { lock.release(); }
	finally { await Promise.resolve(lock.finished).catch(() => undefined); }
}

/**
 * Owns the single-writer project lease and all recovery callbacks. Every async
 * completion rechecks both lock identity and project identity before publishing.
 */
export function createProjectLockService(runtime: ProjectLockServiceRuntime) {
	const retryMaximumMs = runtime.retryMaximumMs ?? 30_000;
	const currentTimeMs = runtime.currentTimeMs ?? Date.now;
	const scheduleTimer = runtime.scheduleTimer
		?? ((callback: () => void, delayMs: number) => Number(globalThis.setTimeout(callback, delayMs)));
	const clearTimer = runtime.clearTimer ?? ((timer: number) => globalThis.clearTimeout(timer));

	return Object.freeze({
		claimProjectLock,
		recoverProjectLock,
		releaseProjectLock,
		scheduleProjectLockRecovery,
		watchProjectLockLoss,
	});

	async function releaseProjectLock(
		lock: ProjectLifecycleLock | null = runtime.state.projectLock,
	): Promise<void> {
		clearTimer(runtime.state.projectLockRetryTimer);
		runtime.state.projectLockRetryTimer = 0;
		if (!lock) return;
		if (runtime.state.projectLock === lock) runtime.state.projectLock = null;
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
	}

	function scheduleProjectLockRecovery(projectId: string, lock: ProjectLifecycleLock): void {
		clearTimer(runtime.state.projectLockRetryTimer);
		runtime.state.projectLockRetryTimer = 0;
		if (!lock.readOnly || !ownsLock(projectId, lock)) return;
		if (lock.available) {
			void lock.available.then(async (availableLock) => {
				if (availableLock) {
					await recoverProjectLock(projectId, lock, availableLock);
					return;
				}
				if (ownsLock(projectId, lock)) {
					lock.available = null;
					lock.retryAt = currentTimeMs() + 1_000;
					scheduleProjectLockRecovery(projectId, lock);
				}
			}).catch((error: unknown) => {
				lock.available = null;
				handleProjectLockRecoveryError(projectId, lock, error);
			});
			return;
		}
		const now = currentTimeMs();
		const retryAt = Number.isFinite(lock.retryAt) ? Number(lock.retryAt) : now + 1_000;
		const delay = Math.max(100, Math.min(retryMaximumMs, retryAt - now + 25));
		runtime.state.projectLockRetryTimer = scheduleTimer(() => {
			runtime.state.projectLockRetryTimer = 0;
			void recoverProjectLock(projectId, lock)
				.catch((error: unknown) => handleProjectLockRecoveryError(projectId, lock, error));
		}, delay);
	}

	function watchProjectLockLoss(projectId: string, lock: ProjectLifecycleLock): void {
		if (!lock.lost) return;
		void lock.lost.then(async () => {
			if (!ownsLock(projectId, lock)) return;
			const reason = new DOMException('Project write access was lost.', 'AbortError');
			enterReadOnly(reason);
			runtime.setProjectReadOnly(projectId, {
				readOnly: true, reason: 'project-lock', lockMethod: lock.method,
			});
			runtime.cancelTask(
				PROJECT_BIN_LINKED_VIDEO_RELINK_TASK,
				reason,
			);
			runtime.cancelTask(TAKE_CYCLE_RECORDING_TASK, reason);
			await runtime.invalidateRecordingAuthority?.(reason);
			runtime.publishProjectState();
			await recoverProjectLock(projectId, lock);
		}).catch((error: unknown) => handleProjectLockRecoveryError(projectId, lock, error));
	}

	async function claimProjectLock(): Promise<boolean> {
		const projectId = runtime.getProjectId();
		const previousLock = runtime.state.projectLock;
		const metadata = projectId ? runtime.getProjectMetadata(projectId) : {};
		if (!projectId || !previousLock?.readOnly || metadata.intrinsicReadOnly) return false;
		await releaseProjectLock(previousLock);
		const nextLock = await runtime.acquireProjectLock(projectId, { force: true });
		if (runtime.state.disposed || runtime.getProjectId() !== projectId) {
			await discardLock(nextLock);
			return false;
		}
		runtime.state.projectLock = nextLock;
		if (nextLock.readOnly) {
			enterReadOnly(new DOMException('Project write access is unavailable.', 'AbortError'));
			scheduleProjectLockRecovery(projectId, nextLock);
			runtime.publishProjectState();
			setLocalizedStatus(runtime.setStatus, runtime.copy, "projectOpenOtherTab", undefined, 'error');
			return false;
		}
		watchProjectLockLoss(projectId, nextLock);
		if (runtime.isPersistedSnapshotCurrent && !await mayResumeWritable(projectId, nextLock)) return false;
		runtime.state.readOnly = false;
		runtime.setProjectReadOnly(projectId, {
			readOnly: false,
			reason: null,
			lockMethod: nextLock.method,
		});
		runtime.publishProjectState();
		setLocalizedStatus(runtime.setStatus, runtime.copy, "ready", undefined, 'success');
		return true;
	}

	async function recoverProjectLock(
		projectId: string,
		previousLock: ProjectLifecycleLock,
		availableLock: ProjectLifecycleLock | null = null,
	): Promise<void> {
		if (!ownsLock(projectId, previousLock)) return;
		const nextLock = availableLock || await runtime.acquireProjectLock(projectId);
		if (!ownsLock(projectId, previousLock)) {
			await discardLock(nextLock);
			return;
		}
		if (previousLock !== nextLock && nextLock.handoffFrom !== previousLock) previousLock.release();
		runtime.state.projectLock = nextLock;
		if (nextLock.readOnly) {
			enterReadOnly(new DOMException('Project write access is unavailable.', 'AbortError'));
			runtime.setProjectReadOnly(projectId, {
				readOnly: true,
				reason: 'project-lock',
				lockMethod: nextLock.method,
			});
			scheduleProjectLockRecovery(projectId, nextLock);
			runtime.publishProjectState();
			setLocalizedStatus(runtime.setStatus, runtime.copy, "projectOpenOtherTab", undefined, 'error');
			return;
		}
		watchProjectLockLoss(projectId, nextLock);
		if (runtime.isPersistedSnapshotCurrent && !await mayResumeWritable(projectId, nextLock)) return;

		const metadata = runtime.getProjectMetadata(projectId);
		const intrinsicReadOnly = Boolean(metadata.intrinsicReadOnly);
		const intrinsicReadOnlyReason = metadata.intrinsicReadOnlyReason || null;
		if (intrinsicReadOnly) {
			enterReadOnly(new DOMException(intrinsicReadOnlyReason || runtime.copy.projectReadOnly, 'AbortError'));
		} else {
			runtime.state.readOnly = false;
		}
		runtime.setProjectReadOnly(projectId, {
			readOnly: intrinsicReadOnly,
			reason: intrinsicReadOnlyReason,
			lockMethod: nextLock.method,
		});
		runtime.publishProjectState();
		if (intrinsicReadOnly) publishProjectReadOnlyStatus(runtime.copy, runtime.setStatus, intrinsicReadOnlyReason);
		else setLocalizedStatus(runtime.setStatus, runtime.copy, 'ready', undefined, 'success');
	}

	function handleProjectLockRecoveryError(
		projectId: string,
		lock: ProjectLifecycleLock,
		error: unknown,
	): void {
		if (!ownsLock(projectId, lock)) return;
		scheduleProjectLockRecovery(projectId, lock);
		runtime.handleError(error);
	}

	async function mayResumeWritable(projectId: string, lock: ProjectLifecycleLock): Promise<boolean> {
		let current = false;
		try { current = await runtime.isPersistedSnapshotCurrent?.(projectId) ?? true; }
		catch (error) { runtime.handleError(error); }
		if (current) {
			return ownsLock(projectId, lock) && !lock.readOnly;
		}
		if (!ownsLock(projectId, lock)) return false;
		enterReadOnly(new DOMException('The stored project changed while write access was unavailable.', 'AbortError'));
		runtime.setProjectReadOnly(projectId, {
			readOnly: true, reason: 'project-lock', lockMethod: lock.method,
		});
		runtime.publishProjectState();
		setLocalizedStatus(runtime.setStatus, runtime.copy, 'projectReadOnly', undefined, 'error');
		return false;
	}

	function enterReadOnly(reason: unknown): void {
		if (!runtime.state.readOnly) {
			try {
				runtime.revokeWriteAuthority?.(reason);
			} catch (error) {
				runtime.handleError(error);
			}
		}
		runtime.state.readOnly = true;
	}

	function ownsLock(projectId: string, lock: ProjectLifecycleLock): boolean {
		return !runtime.state.disposed
			&& runtime.state.projectLock === lock
			&& runtime.getProjectId() === projectId;
	}

	async function discardLock(lock: ProjectLifecycleLock): Promise<void> {
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
	}
}
