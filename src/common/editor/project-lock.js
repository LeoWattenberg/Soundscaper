const LOCK_PREFIX = 'kw-media-audio-editor-lock:';
const LEASE_DURATION_MS = 15_000;
const HEARTBEAT_MS = 5_000;
const NAVIGATOR_LOCK_HANDOFF_MS = 150;

/**
 * Acquire a single-writer project lease. Navigator Locks is authoritative;
 * localStorage plus BroadcastChannel is the compatibility fallback.
 */
export async function acquireProjectLock(projectId, options = {}) {
	if (!projectId) throw new Error('A project id is required.');
	const navigatorObject = options.navigator ?? globalThis.navigator;
	if (navigatorObject?.locks?.request) {
		return acquireNavigatorLock(projectId, navigatorObject.locks, options);
	}
	return acquireLease(projectId, options);
}

async function acquireNavigatorLock(projectId, locks, options) {
	const attempt = await requestNavigatorLock(projectId, locks);
	if (attempt.writable) return navigatorLockResult(projectId, attempt);
	await attempt.finished;

	const queued = requestQueuedNavigatorLock(projectId, locks);
	const handoffMs = Number.isFinite(options.navigatorLockHandoffMs)
		? Math.max(0, options.navigatorLockHandoffMs)
		: NAVIGATOR_LOCK_HANDOFF_MS;
	const acquiredDuringHandoff = await Promise.race([
		queued.acquired,
		new Promise((resolve) => (options.setTimeout ?? globalThis.setTimeout)(() => resolve(false), handoffMs)),
	]);
	if (acquiredDuringHandoff) return navigatorLockResult(projectId, queued);

	const pending = {
		projectId,
		readOnly: true,
		method: 'navigator-locks',
		retryAt: null,
		release: queued.release,
		finished: queued.finished,
		available: null,
	};
	pending.available = queued.acquired.then((writable) => {
		if (!writable) return null;
		const available = navigatorLockResult(projectId, queued);
		available.handoffFrom = pending;
		return available;
	});
	return pending;
}

function navigatorLockResult(projectId, attempt) {
	let released = false;
	return {
		projectId,
		readOnly: false,
		method: 'navigator-locks',
		retryAt: null,
		release() {
			if (released) return;
			released = true;
			attempt.release();
		},
		finished: attempt.finished,
	};
}

async function requestNavigatorLock(projectId, locks) {
	let releaseHold;
	let resolveAcquired;
	const acquired = new Promise((resolve) => { resolveAcquired = resolve; });
	const hold = new Promise((resolve) => { releaseHold = resolve; });
	let finished;
	try {
		finished = Promise.resolve(locks.request(`${LOCK_PREFIX}${projectId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
			resolveAcquired(Boolean(lock));
			if (lock) await hold;
		})).catch(() => resolveAcquired(false));
	} catch {
		resolveAcquired(false);
		finished = Promise.resolve();
	}
	const writable = await acquired;
	return {
		writable,
		release: releaseHold,
		finished,
	};
}

function requestQueuedNavigatorLock(projectId, locks) {
	const controller = new AbortController();
	let acquiredLock = false;
	let released = false;
	let releaseHold;
	let resolveAcquired;
	const acquired = new Promise((resolve) => { resolveAcquired = resolve; });
	const hold = new Promise((resolve) => { releaseHold = resolve; });
	let finished;
	try {
		finished = Promise.resolve(locks.request(`${LOCK_PREFIX}${projectId}`, {
			mode: 'exclusive',
			signal: controller.signal,
		}, async (lock) => {
			acquiredLock = Boolean(lock);
			resolveAcquired(acquiredLock);
			if (lock) await hold;
		})).catch(() => resolveAcquired(false));
	} catch {
		resolveAcquired(false);
		finished = Promise.resolve();
	}
	return {
		acquired,
		finished,
		release() {
			if (released) return;
			released = true;
			if (acquiredLock) releaseHold();
			else controller.abort();
		},
	};
}

async function acquireLease(projectId, options) {
	const storage = options.localStorage ?? safeLocalStorage();
	const BroadcastChannelClass = options.BroadcastChannel ?? globalThis.BroadcastChannel;
	const now = options.now ?? (() => Date.now());
	const setIntervalFn = options.setInterval ?? globalThis.setInterval;
	const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
	const setTimeoutFn = options.setTimeout ?? globalThis.setTimeout;
	const lifecycleTarget = options.lifecycleTarget ?? globalThis;
	const key = `${LOCK_PREFIX}${projectId}`;
	const owner = createOwner();
	let channel = null;
	let heartbeat = 0;
	let released = false;

	if (!storage) return { projectId, readOnly: false, method: 'unavailable', retryAt: null, release() {} };
	const existing = readLease(storage, key);
	if (existing && existing.expiresAt > now()) {
		return { projectId, readOnly: true, method: 'lease', retryAt: existing.expiresAt, release() {} };
	}

	writeLease(storage, key, owner, now());
	const verified = readLease(storage, key);
	if (verified?.owner !== owner) {
		return { projectId, readOnly: true, method: 'lease', retryAt: verified?.expiresAt ?? now() + LEASE_DURATION_MS, release() {} };
	}

	const claimants = new Set([owner]);
	try {
		channel = BroadcastChannelClass ? new BroadcastChannelClass(key) : null;
		if (channel) channel.onmessage = ({ data = {} }) => {
			if (data.type === 'claimed' && data.owner) claimants.add(data.owner);
		};
		channel?.postMessage({ type: 'claimed', owner });
	} catch {
		channel = null;
	}
	if (channel && typeof setTimeoutFn === 'function') {
		await new Promise((resolve) => setTimeoutFn(resolve, 60));
		const current = readLease(storage, key);
		if (current?.expiresAt > now()) claimants.add(current.owner);
		const winner = [...claimants].sort()[0];
		if (winner !== owner) {
			if (current?.owner === owner) removeLease(storage, key);
			channel.close();
			return { projectId, readOnly: true, method: 'lease', retryAt: current?.expiresAt ?? now() + LEASE_DURATION_MS, release() {} };
		}
		writeLease(storage, key, owner, now());
	}

	if (typeof setIntervalFn === 'function') {
		heartbeat = setIntervalFn(() => {
			if (released) return;
			const current = readLease(storage, key);
			if (current?.owner !== owner) {
				released = true;
				if (heartbeat && typeof clearIntervalFn === 'function') clearIntervalFn(heartbeat);
				lifecycleTarget?.removeEventListener?.('pagehide', handlePageHide);
				channel?.close();
				return;
			}
			writeLease(storage, key, owner, now());
		}, HEARTBEAT_MS);
	}
	lifecycleTarget?.addEventListener?.('pagehide', handlePageHide, { once: true });

	return {
		projectId,
		readOnly: false,
		method: 'lease',
		retryAt: null,
		release: releaseLease,
	};

	function handlePageHide() {
		releaseLease();
	}

	function releaseLease() {
		if (released) return;
		released = true;
		if (heartbeat && typeof clearIntervalFn === 'function') clearIntervalFn(heartbeat);
		lifecycleTarget?.removeEventListener?.('pagehide', handlePageHide);
		const current = readLease(storage, key);
		if (current?.owner === owner) removeLease(storage, key);
		channel?.postMessage({ type: 'released', owner });
		channel?.close();
	}
}

function writeLease(storage, key, owner, timestamp) {
	try {
		storage.setItem(key, JSON.stringify({ owner, expiresAt: timestamp + LEASE_DURATION_MS }));
	} catch {
		// A failed refresh will naturally expire and never mutates the project.
	}
}

function readLease(storage, key) {
	try {
		const parsed = JSON.parse(storage.getItem(key) || 'null');
		return parsed && typeof parsed.owner === 'string' && Number.isFinite(parsed.expiresAt) ? parsed : null;
	} catch {
		return null;
	}
}

function removeLease(storage, key) {
	try {
		storage.removeItem(key);
	} catch {
		// The lease still expires if storage becomes unavailable during teardown.
	}
}

function safeLocalStorage() {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function createOwner() {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
