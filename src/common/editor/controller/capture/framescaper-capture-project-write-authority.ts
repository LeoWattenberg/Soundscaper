/* SPDX-License-Identifier: AGPL-3.0-only */

type MaybePromise<Value> = PromiseLike<Value> | Value;

export interface FramescaperCaptureProjectLock {
	readonly projectId: string;
	readonly readOnly: boolean;
	readonly lost?: PromiseLike<unknown> | null;
	readonly finished?: PromiseLike<unknown> | null;
	release(): void;
}

export interface FramescaperCaptureProjectWriteLease {
	assertCurrent(): void;
	release(): Promise<void>;
}

export interface FramescaperCaptureProjectWriteAuthorityOptions {
	getProjectAdmission(projectId: string): Readonly<{
		readonly readOnly: boolean;
		readonly intrinsicReadOnly: boolean;
	}> | null;
	getActiveProjectId(): string | null;
	getActiveReadOnly(): boolean;
	getActiveLock(): FramescaperCaptureProjectLock | null;
	acquireProjectLock(projectId: string): MaybePromise<FramescaperCaptureProjectLock>;
}

export interface FramescaperCaptureProjectWriteAuthority {
	assertProjectWritable(projectId: string): void;
	acquireProjectWriteAuthority(projectId: string): Promise<FramescaperCaptureProjectWriteLease>;
}

/** Admit live capture and own the exact project writer across publication CAS. */
export function createFramescaperCaptureProjectWriteAuthority(
	options: FramescaperCaptureProjectWriteAuthorityOptions,
): Readonly<FramescaperCaptureProjectWriteAuthority> {
	assertOptions(options);

	function assertProjectWritable(projectIdValue: string): void {
		const projectId = stableId(projectIdValue);
		assertAdmissionWritable(options, projectId);
		if (options.getActiveProjectId() !== projectId) return;
		const lock = options.getActiveLock();
		if (options.getActiveReadOnly() || !lock || lock.projectId !== projectId || lock.readOnly) {
			throw new Error(`Framescaper capture requires the active write lock for ${projectId}.`);
		}
	}

	async function acquireProjectWriteAuthority(
		projectIdValue: string,
	): Promise<FramescaperCaptureProjectWriteLease> {
		const projectId = stableId(projectIdValue);
		assertProjectWritable(projectId);
		const activeLock = options.getActiveLock();
		if (options.getActiveProjectId() === projectId && activeLock?.projectId === projectId
			&& !options.getActiveReadOnly() && !activeLock.readOnly) {
			return createBorrowedLease(options, projectId, activeLock);
		}
		const acquired = await options.acquireProjectLock(projectId);
		if (!acquired || acquired.projectId !== projectId || acquired.readOnly) {
			if (acquired) await releaseLock(acquired);
			throw new Error(`Framescaper capture could not acquire the write lock for ${projectId}.`);
		}
		return createOwnedLease(options, projectId, acquired);
	}

	return Object.freeze({ assertProjectWritable, acquireProjectWriteAuthority });
}

function createBorrowedLease(
	options: FramescaperCaptureProjectWriteAuthorityOptions,
	projectId: string,
	lock: FramescaperCaptureProjectLock,
): FramescaperCaptureProjectWriteLease {
	let released = false;
	let lost = false;
	if (lock.lost) void Promise.resolve(lock.lost).then(
		() => { lost = true; },
		() => { lost = true; },
	);
	return Object.freeze({
		assertCurrent() {
			assertAdmissionWritable(options, projectId);
			if (released || lost || options.getActiveProjectId() !== projectId
				|| options.getActiveReadOnly() || options.getActiveLock() !== lock || lock.readOnly) {
				throw authorityChanged(projectId);
			}
		},
		async release() { released = true; },
	});
}

function createOwnedLease(
	options: FramescaperCaptureProjectWriteAuthorityOptions,
	projectId: string,
	lock: FramescaperCaptureProjectLock,
): FramescaperCaptureProjectWriteLease {
	let released = false;
	let lost = false;
	if (lock.lost) void Promise.resolve(lock.lost).then(
		() => { lost = true; },
		() => { lost = true; },
	);
	return Object.freeze({
		assertCurrent() {
			assertAdmissionWritable(options, projectId);
			if (released || lost || lock.readOnly) throw authorityChanged(projectId);
		},
		async release() {
			if (released) return;
			released = true;
			await releaseLock(lock);
		},
	});
}

function assertAdmissionWritable(
	options: FramescaperCaptureProjectWriteAuthorityOptions,
	projectId: string,
): void {
	const admission = options.getProjectAdmission(projectId);
	if (!admission) {
		throw new Error(`Framescaper capture requires a writable open project ${projectId}.`);
	}
	if (admission.readOnly || admission.intrinsicReadOnly) {
		throw new Error(`Framescaper capture origin ${projectId} is read-only.`);
	}
}

async function releaseLock(lock: FramescaperCaptureProjectLock): Promise<void> {
	try { lock.release(); }
	finally { await Promise.resolve(lock.finished).catch(() => undefined); }
}

function authorityChanged(projectId: string): Error {
	return new Error(`Framescaper capture project write authority changed for ${projectId}.`);
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError('Framescaper capture project ID is invalid.');
	}
	return value;
}

function assertOptions(options: FramescaperCaptureProjectWriteAuthorityOptions): void {
	if (!options || typeof options !== 'object'
		|| typeof options.getProjectAdmission !== 'function'
		|| typeof options.getActiveProjectId !== 'function'
		|| typeof options.getActiveReadOnly !== 'function'
		|| typeof options.getActiveLock !== 'function'
		|| typeof options.acquireProjectLock !== 'function') {
		throw new TypeError('Framescaper capture project write authority options are invalid.');
	}
}
