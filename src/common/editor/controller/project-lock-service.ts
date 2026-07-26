/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectLifecycleLock,
	ProjectLifecycleTabMetadata,
	ProjectReadOnlyUpdate,
} from './project-lifecycle-types.ts';

export interface ProjectLockState {
	disposed: boolean;
	readOnly: boolean;
	projectLock: ProjectLifecycleLock | null;
	projectLockRetryTimer: number;
}

export interface ProjectLockServiceRuntime {
	readonly state: ProjectLockState;
	readonly getProjectId: () => string | null;
	readonly getProjectMetadata: (projectId: string) => ProjectLifecycleTabMetadata;
	readonly acquireProjectLock: (
		projectId: string,
		options?: Readonly<{ force?: boolean }>,
	) => Promise<ProjectLifecycleLock>;
	readonly setProjectReadOnly: (projectId: string, update: ProjectReadOnlyUpdate) => void;
	readonly publishProjectState: () => void;
	readonly setStatus: (message: string, state: 'error' | 'success') => void;
	readonly handleError: (error: unknown) => void;
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
			}).catch((error: unknown) => handleProjectLockRecoveryError(projectId, lock, error));
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
			runtime.state.readOnly = true;
			scheduleProjectLockRecovery(projectId, nextLock);
			runtime.publishProjectState();
			runtime.setStatus(runtime.copy.projectOpenOtherTab, 'error');
			return false;
		}
		watchProjectLockLoss(projectId, nextLock);
		runtime.state.readOnly = false;
		runtime.setProjectReadOnly(projectId, {
			readOnly: false,
			reason: null,
			lockMethod: nextLock.method,
		});
		runtime.publishProjectState();
		runtime.setStatus(runtime.copy.ready, 'success');
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
			runtime.state.readOnly = true;
			runtime.setProjectReadOnly(projectId, {
				readOnly: true,
				reason: 'project-lock',
				lockMethod: nextLock.method,
			});
			scheduleProjectLockRecovery(projectId, nextLock);
			runtime.publishProjectState();
			runtime.setStatus(runtime.copy.projectOpenOtherTab, 'error');
			return;
		}
		watchProjectLockLoss(projectId, nextLock);

		const metadata = runtime.getProjectMetadata(projectId);
		const intrinsicReadOnly = Boolean(metadata.intrinsicReadOnly);
		const intrinsicReadOnlyReason = metadata.intrinsicReadOnlyReason || null;
		runtime.state.readOnly = intrinsicReadOnly;
		runtime.setProjectReadOnly(projectId, {
			readOnly: intrinsicReadOnly,
			reason: intrinsicReadOnlyReason,
			lockMethod: nextLock.method,
		});
		runtime.publishProjectState();
		runtime.setStatus(
			intrinsicReadOnly ? intrinsicReadOnlyReason || runtime.copy.projectReadOnly : runtime.copy.ready,
			intrinsicReadOnly ? 'error' : 'success',
		);
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
