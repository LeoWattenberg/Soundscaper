/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';

import '../audio-editor-design-system/28-take-cycle-recovery.css';

import type { TakeCyclePendingOpenRecovery } from '../../controller/take-cycle-capture-orchestrator.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface TakeCycleRecoveryActions {
	recover(pending: TakeCyclePendingOpenRecovery): unknown;
	discard(pending: TakeCyclePendingOpenRecovery): unknown;
}

interface TakeCycleRecoveryDialogProps {
	readonly productId: string;
	readonly pending: TakeCyclePendingOpenRecovery;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly recording: Readonly<{ readonly cycle: TakeCycleRecoveryActions }>;
		}>;
	}>;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

/** Explicit recover/discard choice. Closing never mutates durable authority. */
export default function TakeCycleRecoveryDialog({
	productId,
	pending,
	controller,
	copy,
	run,
	onClose,
}: TakeCycleRecoveryDialogProps) {
	const [pendingAction, setPendingAction] = useState<'recover' | 'discard' | null>(null);
	const [error, setError] = useState('');
	if (productId !== 'soundscaper') return null;
	const perform = (decision: 'recover' | 'discard'): void => {
		setPendingAction(decision);
		setError('');
		void Promise.resolve()
			.then(() => run(() => controller.actions.recording.cycle[decision](pending)))
			.then(onClose)
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => setPendingAction(null));
	};
	const descriptionId = 'take-cycle-recovery-description';
	const summary = copy.takeCycleRecoverySummary
		.replace('{generation}', String(pending.publicationGeneration))
		.replace('{count}', String(pending.draftCount));
	return <AudioEditorDialogShell
		title={copy.takeCycleRecoveryTitle}
		onClose={onClose}
		initialFocus="[data-take-cycle-recover]"
		ariaDescribedBy={descriptionId}
		dataAttributes={{ 'data-take-cycle-recovery-dialog': 'true' }}
		width={560}
	>
		<div className="audio-editor-take-cycle-recovery">
			<p id={descriptionId}>{copy.takeCycleRecoveryDescription}</p>
			<p className="audio-editor-take-cycle-recovery__summary">{summary}</p>
			<p>{copy.takeCycleRecoveryCloseHint}</p>
			<div className="audio-editor-take-cycle-recovery__actions">
				<button
					type="button"
					data-take-cycle-recover="true"
					disabled={pendingAction !== null}
					onClick={() => perform('recover')}
				>{pendingAction === 'recover' ? copy.takeCycleRecovering : copy.takeCycleRecover}</button>
				<button
					type="button"
					disabled={pendingAction !== null}
					onClick={() => perform('discard')}
				>{pendingAction === 'discard' ? copy.takeCycleDiscarding : copy.takeCycleDiscard}</button>
			</div>
			<div role="status" aria-live="polite" aria-atomic="true">
				{error || (pendingAction ? copy.takeCycleRecoveryWorking : '')}
			</div>
		</div>
	</AudioEditorDialogShell>;
}
