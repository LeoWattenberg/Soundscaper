/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import {
	runAwaitedAudioEditorOperation,
	type AudioEditorWorkspaceRunner,
} from './workspace/audio-editor-workspace-runner.ts';

export interface OwnedDialogOperationHandlers<Result> {
	readonly onStart?: () => void;
	readonly onSuccess?: (result: Awaited<Result>) => void;
	readonly onFailure?: (failure: unknown) => void;
	readonly onSettled?: () => void;
}

export interface OwnedDialogOperationState {
	readonly disabled: boolean;
	readonly pending: string | null;
	/** Revoke UI ownership without claiming to abort the underlying domain work. */
	readonly reset: () => void;
	readonly perform: <Result>(
		name: string,
		operation: () => Result,
		handlers?: OwnedDialogOperationHandlers<Result>,
		admission?: Readonly<{ readonly allowWhenBlocked?: boolean }>,
	) => void;
}

/** Own one asynchronous dialog operation by a stable surface identity. */
export function useOwnedDialogOperation(options: Readonly<{
	owner: unknown;
	blocked: boolean;
	run: AudioEditorWorkspaceRunner;
	onOwnerChange?: () => void;
}>): OwnedDialogOperationState {
	const currentOwnerRef = useRef(options.owner);
	const activeOperationRef = useRef<object | null>(null);
	const onOwnerChangeRef = useRef(options.onOwnerChange);
	onOwnerChangeRef.current = options.onOwnerChange;
	if (!Object.is(currentOwnerRef.current, options.owner)) {
		currentOwnerRef.current = options.owner;
		activeOperationRef.current = null;
	}
	const [pending, setPending] = useState<string | null>(null);

	useEffect(() => {
		activeOperationRef.current = null;
		setPending(null);
		onOwnerChangeRef.current?.();
		return () => { activeOperationRef.current = null; };
	}, [options.owner]);

	const reset = (): void => {
		activeOperationRef.current = null;
		setPending(null);
	};
	const perform = <Result,>(
		name: string,
		operation: () => Result,
		handlers: OwnedDialogOperationHandlers<Result> = {},
		admission?: Readonly<{ readonly allowWhenBlocked?: boolean }>,
	): void => {
		if ((options.blocked && admission?.allowWhenBlocked !== true)
			|| pending !== null
			|| activeOperationRef.current !== null) return;
		const owner = options.owner;
		const ownership = Object.freeze({ owner });
		const ownsOperation = (): boolean => activeOperationRef.current === ownership
			&& Object.is(currentOwnerRef.current, owner);
		activeOperationRef.current = ownership;
		setPending(name);
		handlers.onStart?.();
		void runAwaitedAudioEditorOperation(options.run, () => (
			ownsOperation() ? operation() : undefined
		)).then((result) => {
			if (!ownsOperation()) return;
			handlers.onSuccess?.(result as Awaited<Result>);
		}).catch((failure: unknown) => {
			if (!ownsOperation()) return;
			handlers.onFailure?.(failure);
		}).finally(() => {
			if (!ownsOperation()) return;
			activeOperationRef.current = null;
			handlers.onSettled?.();
			setPending(null);
		});
	};

	return Object.freeze({
		disabled: options.blocked || pending !== null,
		pending,
		reset,
		perform,
	});
}
