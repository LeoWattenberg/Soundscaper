/* SPDX-License-Identifier: AGPL-3.0-only */

interface CaptureSpoolLockIdentity {
	readonly storageKind: 'encoded-media' | 'raw-pcm';
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
}

interface CaptureSessionLockIdentity {
	readonly projectId: string;
	readonly sessionId: string;
}

const localQueues = new Map<string, Promise<void>>();

export function captureSpoolCrossContextLockAvailable(): boolean {
	return typeof globalThis.navigator?.locks?.request === 'function' || isNodeTestRuntime();
}

/**
 * Cross-context exclusion for physical spool mutation and stopped-operation recovery.
 * Browser liveness is owned by Web Locks, which releases the lock when its context exits.
 */
export async function withCaptureSpoolOperationLock<Result>(
	identity: CaptureSpoolLockIdentity,
	operation: () => Promise<Result>,
): Promise<Result> {
	return withCrossContextLock(spoolLockName(identity), operation);
}

/** Session lock is always acquired before any nested per-spool lock. */
export async function withCaptureSessionOperationLock<Result>(
	identity: CaptureSessionLockIdentity,
	operation: () => Promise<Result>,
): Promise<Result> {
	return withCrossContextLock(sessionLockName(identity), operation);
}

async function withCrossContextLock<Result>(
	name: string,
	operation: () => Promise<Result>,
): Promise<Result> {
	const locks = globalThis.navigator?.locks;
	if (locks && typeof locks.request === 'function') {
		return locks.request(name, { mode: 'exclusive' }, operation);
	}
	if (!isNodeTestRuntime()) {
		throw new Error('Durable capture spool mutation requires cross-context Web Locks support.');
	}
	return withLocalLock(name, operation);
}

function isNodeTestRuntime(): boolean {
	const processValue = (globalThis as unknown as {
		readonly process?: { readonly release?: { readonly name?: unknown } };
	}).process;
	return processValue?.release?.name === 'node';
}

async function withLocalLock<Result>(name: string, operation: () => Promise<Result>): Promise<Result> {
	const previous = localQueues.get(name) ?? Promise.resolve();
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	const tail = previous.then(() => held);
	localQueues.set(name, tail);
	await previous;
	try { return await operation(); }
	finally {
		release();
		if (localQueues.get(name) === tail) localQueues.delete(name);
	}
}

function spoolLockName(identity: CaptureSpoolLockIdentity): string {
	return [
		'soundscaper:framescaper-capture-spool-v1',
		identity.storageKind,
		encodeURIComponent(stableId(identity.projectId, 'capture spool lock projectId')),
		encodeURIComponent(stableId(identity.spoolId, 'capture spool lock spoolId')),
		encodeURIComponent(stableText(identity.spoolToken, 'capture spool lock token', 512)),
	].join(':');
}

function sessionLockName(identity: CaptureSessionLockIdentity): string {
	return [
		'soundscaper:framescaper-capture-session-v1',
		encodeURIComponent(stableId(identity.projectId, 'capture session lock projectId')),
		encodeURIComponent(stableId(identity.sessionId, 'capture session lock sessionId')),
	].join(':');
}

function stableId(value: unknown, name: string): string { return stableText(value, name, 256); }
function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
