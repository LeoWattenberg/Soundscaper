/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectToken } from './lifecycle.ts';

export const PARAMETER_GESTURE_PREVIEW_SUPERSEDED_CODE = 'PARAMETER_GESTURE_PREVIEW_SUPERSEDED' as const;

export class ParameterGesturePreviewSupersededError extends Error {
	readonly code = PARAMETER_GESTURE_PREVIEW_SUPERSEDED_CODE;

	constructor() {
		super('The parameter preview was superseded by a newer runtime revision.');
		this.name = 'ParameterGesturePreviewSupersededError';
	}
}

export interface ParameterGestureTarget<Value> {
	readonly identity: string;
	readonly revision: string;
	readonly value: Value;
}

export interface ParameterGestureSession<Value> {
	readonly project: EditorProjectToken;
	readonly targetIdentity: string;
	readonly targetRevision: string;
	readonly original: Value;
	lastPreviewRevision: number;
}

export interface ParameterGestureAdapterOptions<Value, Result> {
	readonly sessions: Map<string, ParameterGestureSession<Value>>;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
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
}

/**
 * Runtime-first gesture lifecycle shared by rack controls and future write-mode
 * automation. Document state remains unchanged until commitValue executes.
 */
export function createParameterGestureAdapter<Value, Result>(
	options: ParameterGestureAdapterOptions<Value, Result>,
): ParameterGestureAdapter<Value, Result> {
	const {
		applyPreview,
		assertProject,
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

	function begin(identityValue: string): Value {
		const identity = stableIdentity(identityValue);
		const current = sessions.get(identity);
		if (current) return clone(assertCurrent(identity, current).session.original);
		const target = resolveTarget(identity);
		if (!target || target.identity !== identity) throw createTargetMissingError();
		const session: ParameterGestureSession<Value> = {
			project: captureProject(),
			targetIdentity: identity,
			targetRevision: stableRevision(target.revision),
			original: clone(target.value),
			lastPreviewRevision: 0,
		};
		sessions.set(identity, session);
		return clone(session.original);
	}

	function preview(identityValue: string, value: Value): number | false {
		const identity = stableIdentity(identityValue);
		if (!sessions.has(identity)) begin(identity);
		const { session, target } = assertCurrent(identity, sessions.get(identity)!);
		const normalized = clone(normalize(target, clone(value)));
		return applyAndRecord(identity, session, target, normalized);
	}

	function commit(identityValue: string, value: Value): Result {
		const identity = stableIdentity(identityValue);
		if (!sessions.has(identity)) begin(identity);
		const { session, target } = assertCurrent(identity, sessions.get(identity)!);
		const normalized = clone(normalize(target, clone(value)));
		sessions.delete(identity);
		if (valuesEqual(session.original, normalized)) {
			if (session.lastPreviewRevision > 0) {
				applyAndRecordDetached(session, target, clone(session.original), restorePreview);
			}
			return currentValue();
		}
		const adopted = applyAndRecordDetached(session, target, normalized);
		try {
			return commitValue(target, clone(normalized), { adopted: adopted !== false });
		} catch (error) {
			if (adopted !== false) applyAndRecordDetached(
				session, target, clone(session.original), restorePreview,
			);
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
		return applyAndRecordDetached(session, target, clone(session.original), restorePreview);
	}

	function forget(identityValue: string): boolean {
		return sessions.delete(stableIdentity(identityValue));
	}

	function assertCurrent(
		identity: string,
		session: ParameterGestureSession<Value>,
	): { session: ParameterGestureSession<Value>; target: ParameterGestureTarget<Value> } {
		try {
			return { session, target: assertDetachedCurrent(identity, session) };
		} catch (error) {
			sessions.delete(identity);
			throw error;
		}
	}

	function assertDetachedCurrent(
		identity: string,
		session: ParameterGestureSession<Value>,
	): ParameterGestureTarget<Value> {
		assertProject(session.project);
		const target = resolveTarget(identity);
		if (!target || target.identity !== session.targetIdentity
			|| target.revision !== session.targetRevision) {
			throw createTargetChangedError();
		}
		return target;
	}

	function applyAndRecord(
		identity: string,
		session: ParameterGestureSession<Value>,
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
		session: ParameterGestureSession<Value>,
		target: ParameterGestureTarget<Value>,
		value: Value,
		apply: ParameterGestureAdapterOptions<Value, Result>['applyPreview'] = applyPreview,
	): number | false {
		const revision = apply(target, clone(value));
		if (revision === false) return false;
		if (!Number.isSafeInteger(revision) || revision <= session.lastPreviewRevision) {
			throw new ParameterGesturePreviewSupersededError();
		}
		session.lastPreviewRevision = revision;
		return revision;
	}

	return Object.freeze({ begin, cancel, commit, forget, preview });
}

function stableIdentity(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 4_096) {
		throw new TypeError('A stable parameter gesture target identity is required.');
	}
	return value;
}

function stableRevision(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 64 * 1_024) {
		throw new TypeError('A stable parameter gesture target revision is required.');
	}
	return value;
}

function clone<Value>(value: Value): Value {
	return typeof globalThis.structuredClone === 'function'
		? structuredClone(value)
		: JSON.parse(JSON.stringify(value)) as Value;
}
