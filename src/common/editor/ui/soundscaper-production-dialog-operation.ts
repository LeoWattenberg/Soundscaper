/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import { runAwaitedAudioEditorOperation } from './workspace/audio-editor-workspace-runner.ts';

export interface SoundscaperProductionDialogOperationState<Operation> {
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
	) => void;
}

/** Own transient production-dialog work by the project that started it. */
export function useSoundscaperProductionDialogOperation<Operation>(options: Readonly<{
	project: unknown;
	blocked: boolean;
	success: string;
	execute(operation: Operation): unknown;
	run(operation: () => unknown): unknown;
	onProjectChange(): void;
}>): SoundscaperProductionDialogOperationState<Operation> {
	const projectIdentity = soundscaperProductionProjectIdentity(options.project);
	const currentProjectIdentityRef = useRef(projectIdentity);
	const activeOperationRef = useRef<object | null>(null);
	const onProjectChangeRef = useRef(options.onProjectChange);
	onProjectChangeRef.current = options.onProjectChange;
	if (currentProjectIdentityRef.current !== projectIdentity) {
		currentProjectIdentityRef.current = projectIdentity;
		activeOperationRef.current = null;
	}
	const [pending, setPending] = useState<string | null>(null);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		activeOperationRef.current = null;
		setPending(null);
		setStatus('');
		setError('');
		onProjectChangeRef.current();
		return () => { activeOperationRef.current = null; };
	}, [projectIdentity]);

	const disabled = options.blocked || pending !== null;
	const clearFeedback = (): void => {
		setStatus('');
		setError('');
	};
	const perform = (
		name: string,
		operation: () => Operation,
		onSuccess?: () => void,
		onSettled?: () => void,
	): void => {
		if (disabled || activeOperationRef.current !== null) return;
		const ownership = Object.freeze({ projectIdentity });
		const ownsOperation = (): boolean => activeOperationRef.current === ownership
			&& currentProjectIdentityRef.current === projectIdentity;
		activeOperationRef.current = ownership;
		setPending(name);
		setError('');
		void runAwaitedAudioEditorOperation(options.run, () => ownsOperation()
			? options.execute(operation())
			: undefined)
			.then(() => {
				if (!ownsOperation()) return;
				onSuccess?.();
				setStatus(options.success);
			})
			.catch((operationError: unknown) => {
				if (!ownsOperation()) return;
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => {
				if (!ownsOperation()) return;
				activeOperationRef.current = null;
				onSettled?.();
				setPending(null);
			});
	};

	return Object.freeze({ disabled, pending, status, error, clearFeedback, perform });
}

function soundscaperProductionProjectIdentity(project: unknown): unknown {
	if (project === null || typeof project !== 'object' || Array.isArray(project)) return null;
	const id = (project as Readonly<Record<string, unknown>>).id;
	return typeof id === 'string' ? id : project;
}
