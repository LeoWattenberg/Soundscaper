const LOCK_PREFIX = 'kw-media-audio-editor-lock:';
const LEASE_DURATION_MS = 15_000;
const HEARTBEAT_MS = 5_000;
const NAVIGATOR_LOCK_HANDOFF_MS = 150;
const LEASE_OWNER_PROBE_MS = 500;
const LEASE_PROTOCOL_VERSION = 1;

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
	if (options.force) {
		const forced = requestForcedNavigatorLock(projectId, locks);
		const writable = await forced.acquired;
		if (!writable) return acquireNavigatorLock(projectId, locks, { ...options, force: false });
		return navigatorLockResult(projectId, forced, options, true);
	}
	const attempt = await requestNavigatorLock(projectId, locks);
	if (attempt.writable) return navigatorLockResult(projectId, attempt, options);
	await attempt.finished;

	const queued = requestQueuedNavigatorLock(projectId, locks);
	const handoffMs = Number.isFinite(options.navigatorLockHandoffMs)
		? Math.max(0, options.navigatorLockHandoffMs)
		: NAVIGATOR_LOCK_HANDOFF_MS;
	const acquiredDuringHandoff = await Promise.race([
		queued.acquired,
		new Promise((resolve) => (options.setTimeout ?? globalThis.setTimeout)(() => resolve(false), handoffMs)),
	]);
	if (acquiredDuringHandoff) return navigatorLockResult(projectId, queued, options);

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
		const available = navigatorLockResult(projectId, queued, options);
		available.handoffFrom = pending;
		return available;
	});
	return pending;
}

function navigatorLockResult(projectId, attempt, options, force = false) {
	let released = false;
	let resolveLost;
	const lost = new Promise((resolve) => { resolveLost = resolve; });
	const owner = createOwner();
	const BroadcastChannelClass = options.BroadcastChannel ?? globalThis.BroadcastChannel;
	let channel = null;
	try {
		channel = BroadcastChannelClass ? new BroadcastChannelClass(`${LOCK_PREFIX}${projectId}`) : null;
		if (channel) {
			channel.onmessage = ({ data = {} }) => {
				if (data.type === 'takeover' && data.owner !== owner) loseLock();
			};
			if (force) channel.postMessage({ type: 'takeover', owner });
		}
	} catch {
		channel = null;
	}
	const result = {
		projectId,
		readOnly: false,
		method: 'navigator-locks',
		retryAt: null,
		lost,
		release() {
			if (released) return;
			released = true;
			channel?.close();
			attempt.release();
		},
		finished: attempt.finished,
	};
	void attempt.finished.then(() => {
		if (released) return;
		released = true;
		channel?.close();
		resolveLost();
	});
	return result;

	function loseLock() {
		if (released) return;
		released = true;
		channel?.close();
		attempt.release();
		resolveLost();
	}
}

function requestForcedNavigatorLock(projectId, locks) {
	let releaseHold;
	let resolveAcquired;
	const acquired = new Promise((resolve) => { resolveAcquired = resolve; });
	const hold = new Promise((resolve) => { releaseHold = resolve; });
	let finished;
	try {
		finished = Promise.resolve(locks.request(`${LOCK_PREFIX}${projectId}`, {
			mode: 'exclusive',
			steal: true,
		}, async (lock) => {
			resolveAcquired(Boolean(lock));
			if (lock) await hold;
		})).catch(() => resolveAcquired(false));
	} catch {
		resolveAcquired(false);
		finished = Promise.resolve();
	}
	return { acquired, finished, release: releaseHold };
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
	let resolveLost;

	if (!storage) return { projectId, readOnly: false, method: 'unavailable', retryAt: null, release() {} };
	const existing = readLease(storage, key);
	if (!options.force && existing && existing.expiresAt > now()) {
		const ownerAlive = existing.protocol === LEASE_PROTOCOL_VERSION
			? await probeLeaseOwner(BroadcastChannelClass, key, existing.owner, setTimeoutFn)
			: null;
		const current = readLease(storage, key);
		const stale = !current
			|| current.expiresAt <= now()
			|| (current.owner === existing.owner && ownerAlive === false);
		if (stale) {
			if (current?.owner === existing.owner) removeLease(storage, key);
		} else {
			return { projectId, readOnly: true, method: 'lease', retryAt: current.expiresAt, release() {} };
		}
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
			if (data.type === 'takeover' && data.owner !== owner) {
				loseLease();
				return;
			}
			if (data.type === 'claimed' && data.owner) claimants.add(data.owner);
			if (data.type === 'probe' && data.owner === owner) {
				try {
					channel.postMessage({ type: 'owned', owner });
				} catch {
					// Teardown can close the channel while a probe is being delivered.
				}
			}
		};
		if (options.force) channel?.postMessage({ type: 'takeover', owner });
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
				removeLifecycleListeners();
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
		lost: new Promise((resolve) => { resolveLost = resolve; }),
		release: releaseLease,
	};

	function handlePageHide() {
		releaseLease();
	}

	function removeLifecycleListeners() {
		lifecycleTarget?.removeEventListener?.('pagehide', handlePageHide);
	}

	function releaseLease() {
		if (released) return;
		released = true;
		if (heartbeat && typeof clearIntervalFn === 'function') clearIntervalFn(heartbeat);
		removeLifecycleListeners();
		const current = readLease(storage, key);
		if (current?.owner === owner) removeLease(storage, key);
		channel?.postMessage({ type: 'released', owner });
		channel?.close();
	}

	function loseLease() {
		if (released) return;
		released = true;
		if (heartbeat && typeof clearIntervalFn === 'function') clearIntervalFn(heartbeat);
		removeLifecycleListeners();
		channel?.close();
		resolveLost?.();
	}
}

async function probeLeaseOwner(BroadcastChannelClass, key, owner, setTimeoutFn) {
	if (!BroadcastChannelClass || typeof setTimeoutFn !== 'function') return null;
	let channel;
	try {
		channel = new BroadcastChannelClass(key);
	} catch {
		return null;
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (alive) => {
			if (settled) return;
			settled = true;
			channel.close();
			resolve(alive);
		};
		channel.onmessage = ({ data = {} }) => {
			if (data.type === 'owned' && data.owner === owner) finish(true);
		};
		try {
			channel.postMessage({ type: 'probe', owner });
		} catch {
			finish(null);
			return;
		}
		setTimeoutFn(() => finish(false), LEASE_OWNER_PROBE_MS);
	});
}

function writeLease(storage, key, owner, timestamp) {
	try {
		storage.setItem(key, JSON.stringify({
			owner,
			expiresAt: timestamp + LEASE_DURATION_MS,
			protocol: LEASE_PROTOCOL_VERSION,
		}));
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
