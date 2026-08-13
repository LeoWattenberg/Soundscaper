/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectToken } from './lifecycle.ts';

export const PARAMETER_GESTURE_PREVIEW_SUPERSEDED_CODE = 'PARAMETER_GESTURE_PREVIEW_SUPERSEDED' as const;
export const PARAMETER_GESTURE_AUTHORITY_CHANGED_CODE = 'PARAMETER_GESTURE_AUTHORITY_CHANGED' as const;

export class ParameterGestureAuthorityChangedError extends Error {
	readonly code = PARAMETER_GESTURE_AUTHORITY_CHANGED_CODE;

	constructor() {
		super('The parameter gesture no longer has write authority.');
		this.name = 'ParameterGestureAuthorityChangedError';
	}
}

export class ParameterGesturePreviewSupersededError extends Error {
	readonly code = PARAMETER_GESTURE_PREVIEW_SUPERSEDED_CODE;

	constructor(options?: ErrorOptions) {
		super('The parameter preview was superseded by a newer runtime revision.', options);
		this.name = 'ParameterGesturePreviewSupersededError';
	}
}

export interface ParameterGestureTarget<Value> {
	readonly identity: string;
	readonly revision: string;
	readonly value: Value;
}

export interface ParameterGestureSession<Value, Authority = unknown> {
	readonly project: EditorProjectToken;
	readonly authority: Authority;
	readonly targetIdentity: string;
	readonly targetRevision: string;
	readonly original: Value;
	lastAccepted: Value;
	lastPreviewRevision: number;
}

export interface ParameterGestureAdapterOptions<Value, Result, Authority> {
	readonly sessions: Map<string, ParameterGestureSession<Value, Authority>>;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly captureAuthority: () => Authority;
	readonly assertAuthority: (authority: Authority) => void;
	readonly resolveTarget: (identity: string) => ParameterGestureTarget<Value> | null;
	readonly normalize: (target: ParameterGestureTarget<Value>, value: Value) => Value;
	readonly valuesEqual: (left: Value, right: Value) => boolean;
	readonly applyPreview: (
		target: ParameterGestureTarget<Value>,
		value: Value,
	) => number | false;
	readonly restorePreview?: (
		target: ParameterGestureTarget<Value>,
		value: Value,
	) => number | false;
	readonly commitValue: (
		target: ParameterGestureTarget<Value>,
		value: Value,
		options: Readonly<{ adopted: boolean }>,
	) => Result;
	readonly currentValue: () => Result;
	readonly createTargetMissingError: () => Error;
	readonly createTargetChangedError: () => Error;
}

export interface ParameterGestureAdapter<Value, Result> {
	begin(identity: string): Value;
	preview(identity: string, value: Value): number | false;
	commit(identity: string, value: Value): Result;
	cancel(identity: string): number | false;
	forget(identity: string): boolean;
	revoke(identity: string): number | false;
	revokeAll(): number;
}

/**
 * Runtime-first gesture lifecycle shared by rack controls and future write-mode
 * automation. Document state remains unchanged until commitValue executes.
 */
export function createParameterGestureAdapter<Value, Result, Authority>(
	options: ParameterGestureAdapterOptions<Value, Result, Authority>,
): ParameterGestureAdapter<Value, Result> {
	const {
		applyPreview,
		assertAuthority,
		assertProject,
		captureAuthority,
		captureProject,
		commitValue,
		createTargetChangedError,
		createTargetMissingError,
		currentValue,
		normalize,
		resolveTarget,
		restorePreview = applyPreview,
		sessions,
		valuesEqual,
	} = options;
	const revokedIdentities = new Set<string>();

	function begin(identityValue: string): Value {
		const identity = stableIdentity(identityValue);
		revokedIdentities.delete(identity);
		const current = sessions.get(identity);
		if (current) return clone(assertCurrent(identity, current).session.original);
		const target = resolveTarget(identity);
		if (!target || target.identity !== identity) throw createTargetMissingError();
		const authority = captureAuthority();
		assertAuthority(authority);
		const original = clone(target.value);
		const session: ParameterGestureSession<Value, Authority> = {
			project: captureProject(),
			authority,
			targetIdentity: identity,
			targetRevision: stableRevision(target.revision),
			original,
			lastAccepted: clone(original),
			lastPreviewRevision: 0,
		};
		sessions.set(identity, session);
		return clone(session.original);
	}

	function preview(identityValue: string, value: Value): number | false {
		const identity = stableIdentity(identityValue);
		ensureSession(identity);
		const { session, target } = assertCurrent(identity, sessions.get(identity)!);
		const normalized = clone(normalize(target, clone(value)));
		return applyAndRecord(identity, session, target, normalized);
	}

	function commit(identityValue: string, value: Value): Result {
		const identity = stableIdentity(identityValue);
		ensureSession(identity);
		const { session, target } = assertCurrent(identity, sessions.get(identity)!);
		const normalized = clone(normalize(target, clone(value)));
		sessions.delete(identity);
		if (valuesEqual(session.original, normalized)) {
			if (session.lastPreviewRevision > 0) {
				restoreDetached(target, clone(session.original));
			}
			return currentValue();
		}
		const adopted = applyAndRecordDetached(session, target, normalized);
		try {
			return commitValue(target, clone(normalized), { adopted: adopted !== false });
		} catch (error) {
			if (adopted !== false) restoreDetached(target, clone(session.original));
			throw error;
		}
	}

	function cancel(identityValue: string): number | false {
		const identity = stableIdentity(identityValue);
		const session = sessions.get(identity);
		sessions.delete(identity);
		if (!session) return false;
		let target: ParameterGestureTarget<Value>;
		try {
			target = assertDetachedCurrent(identity, session);
		} catch {
			return false;
		}
		return session.lastPreviewRevision > 0
			? restoreDetached(target, clone(session.original))
			: false;
	}

	function forget(identityValue: string): boolean {
		const identity = stableIdentity(identityValue);
		const deleted = sessions.delete(identity);
		return revokedIdentities.delete(identity) || deleted;
	}

	function revoke(identityValue: string): number | false {
		const identity = stableIdentity(identityValue);
		const session = sessions.get(identity);
		if (!session) return false;
		sessions.delete(identity);
		revokedIdentities.add(identity);
		let target: ParameterGestureTarget<Value>;
		try {
			target = assertDetachedCurrent(identity, session);
		} catch {
			return false;
		}
		return session.lastPreviewRevision > 0
			? restoreDetached(target, clone(session.original))
			: false;
	}

	function revokeAll(): number {
		const identities = [...sessions.keys()];
		const errors: unknown[] = [];
		for (const identity of identities) {
			try {
				revoke(identity);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new AggregateError(errors, 'Parameter gesture rollback failed.');
		return identities.length;
	}

	function ensureSession(identity: string): void {
		if (sessions.has(identity)) return;
		if (revokedIdentities.has(identity)) throw new ParameterGestureAuthorityChangedError();
		begin(identity);
	}

	function assertCurrent(
		identity: string,
		session: ParameterGestureSession<Value, Authority>,
	): { session: ParameterGestureSession<Value, Authority>; target: ParameterGestureTarget<Value> } {
		try {
			return { session, target: assertDetachedCurrent(identity, session) };
		} catch (error) {
			sessions.delete(identity);
			if (error instanceof ParameterGestureAuthorityChangedError) revokedIdentities.add(identity);
			throw error;
		}
	}

	function assertDetachedCurrent(
		identity: string,
		session: ParameterGestureSession<Value, Authority>,
	): ParameterGestureTarget<Value> {
		assertProject(session.project);
		assertAuthority(session.authority);
		const target = resolveTarget(identity);
		if (!target || target.identity !== session.targetIdentity
			|| target.revision !== session.targetRevision) {
			throw createTargetChangedError();
		}
		return target;
	}

	function applyAndRecord(
		identity: string,
		session: ParameterGestureSession<Value, Authority>,
		target: ParameterGestureTarget<Value>,
		value: Value,
	): number | false {
		try {
			return applyAndRecordDetached(session, target, value);
		} catch (error) {
			sessions.delete(identity);
			throw error;
		}
	}

	function applyAndRecordDetached(
		session: ParameterGestureSession<Value, Authority>,
		target: ParameterGestureTarget<Value>,
		value: Value,
	): number | false {
		const lastAccepted = clone(session.lastAccepted);
		const revision = applyPreview(target, clone(value));
		if (revision === false) return false;
		if (!Number.isSafeInteger(revision) || revision <= session.lastPreviewRevision) {
			try {
				restoreDetached(target, lastAccepted);
			} catch (cause) {
				throw new ParameterGesturePreviewSupersededError({ cause });
			}
			throw new ParameterGesturePreviewSupersededError();
		}
		session.lastPreviewRevision = revision;
		session.lastAccepted = clone(value);
		return revision;
	}

	function restoreDetached(target: ParameterGestureTarget<Value>, value: Value): number | false {
		const revision = restorePreview(target, clone(value));
		if (revision === false) return false;
		if (!Number.isSafeInteger(revision) || revision <= 0) {
			throw new TypeError('A parameter preview acknowledgement must be a positive safe integer.');
		}
		return revision;
	}

	return Object.freeze({ begin, cancel, commit, forget, preview, revoke, revokeAll });
}

function stableIdentity(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError('A stable parameter gesture target identity is required.');
	}
	return value;
}

function stableRevision(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError('A stable parameter gesture target revision is required.');
	}
	return value;
}

function clone<Value>(value: Value): Value {
	return typeof globalThis.structuredClone === 'function'
		? structuredClone(value)
		: JSON.parse(JSON.stringify(value)) as Value;
}
