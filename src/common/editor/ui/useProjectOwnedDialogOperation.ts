/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

import { useOwnedDialogOperation } from './useOwnedDialogOperation.ts';

export interface ProjectOwnedDialogOperationState<Operation> {
	readonly disabled: boolean;
	readonly pending: string | null;
	readonly status: string;
	readonly error: string;
	readonly clearFeedback: () => void;
	readonly perform: (
		name: string,
		operation: () => Operation,
		onSuccess?: () => void,
		onSettled?: () => void,
		admission?: Readonly<{ readonly allowWhenBlocked?: boolean }>,
	) => void;
}

/** Own asynchronous dialog work by the project that started it. */
export function useProjectOwnedDialogOperation<Operation>(options: Readonly<{
	project: unknown;
	blocked: boolean;
	success: string;
	execute(operation: Operation): unknown;
	run(operation: () => unknown): unknown;
	onProjectChange(): void;
}>): ProjectOwnedDialogOperationState<Operation> {
	const projectIdentity = projectIdentityOf(options.project);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const operationState = useOwnedDialogOperation({
		owner: projectIdentity,
		blocked: options.blocked,
		run: options.run,
		onOwnerChange: () => {
			setStatus('');
			setError('');
			options.onProjectChange();
		},
	});
	const clearFeedback = (): void => {
		setStatus('');
		setError('');
	};
	const perform = (
		name: string,
		operation: () => Operation,
		onSuccess?: () => void,
		onSettled?: () => void,
		admission?: Readonly<{ readonly allowWhenBlocked?: boolean }>,
	): void => {
		operationState.perform(name, () => options.execute(operation()), {
			onStart: () => { setError(''); },
			onSuccess: () => {
				onSuccess?.();
				setStatus(options.success);
			},
			onFailure: (operationError) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			},
			onSettled,
		}, admission);
	};

	return Object.freeze({
		disabled: operationState.disabled,
		pending: operationState.pending,
		status,
		error,
		clearFeedback,
		perform,
	});
}

function projectIdentityOf(project: unknown): unknown {
	if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
	const id = (project as Readonly<Record<string, unknown>>).id;
	return typeof id === 'string' ? id : project;
}
