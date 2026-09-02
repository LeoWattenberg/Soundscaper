/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';

import '../audio-editor-design-system/33-workspace-onboarding.css';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { markFirstLaunchSetupComplete, type FirstLaunchSetupStorage } from '../first-launch-setup.ts';
import {
	runAwaitedAudioEditorOperation,
	type AudioEditorWorkspaceRunner,
} from '../workspace/audio-editor-workspace-runner.ts';

const OPTIONS = Object.freeze(['audacity', 'modern'] as const);
type WorkspaceOnboardingOption = typeof OPTIONS[number];

interface WorkspaceOnboardingDialogProps {
	readonly productId: string;
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly preferences: Readonly<{ setWorkspace(workspaceId: string): unknown }>;
		}>;
	}>;
	readonly preferences: Readonly<{ readonly workspace: Readonly<{ readonly activeId: string }> }>;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: AudioEditorWorkspaceRunner;
	readonly onClose: () => void;
	/** Test seam; the browser default is `localStorage`. */
	readonly storage?: FirstLaunchSetupStorage;
}

/**
 * Audacity's "Getting started" layout page. The page asks for one thing, so
 * one click answers it: picking a card switches the workspace and finishes
 * setup, without a radio to select and a Done button to confirm afterwards.
 * A card that fails to apply keeps the dialog open with the reason. Leaving by
 * any other route records that setup happened so it never returns uninvited.
 */
export default function WorkspaceOnboardingDialog({
	productId,
	controller,
	preferences,
	copy,
	run,
	onClose,
	storage,
}: WorkspaceOnboardingDialogProps) {
	const [error, setError] = useState('');
	const activeId = preferences.workspace.activeId;
	const [initialFocus] = useState(() => (
		isOption(activeId) ? `[data-workspace-onboarding-option="${activeId}"]` : '[data-workspace-onboarding-option]'
	));
	if (productId !== 'soundscaper') return null;
	const finish = (workspaceId: string): void => {
		markFirstLaunchSetupComplete(productId, workspaceId, storage);
		onClose();
	};
	const choose = (workspaceId: WorkspaceOnboardingOption): void => {
		setError('');
		void runAwaitedAudioEditorOperation(run, () => controller.actions.preferences.setWorkspace(workspaceId))
			.then(() => finish(workspaceId))
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			});
	};
	const questionId = 'workspace-onboarding-question';
	return <AudioEditorDialogShell
		title={copy.workspaceOnboardingTitle}
		onClose={() => finish(activeId)}
		initialFocus={initialFocus}
		ariaDescribedBy={questionId}
		dataAttributes={{ 'data-workspace-onboarding-dialog': 'true' }}
		width={640}
	>
		<div className="audio-editor-workspace-onboarding">
			<p id={questionId}>{copy.workspaceOnboardingQuestion}</p>
			<div
				className="audio-editor-workspace-onboarding__options"
				role="group"
				aria-label={copy.workspaceOnboardingSelect}
			>
				{OPTIONS.map((workspaceId) => {
					const current = activeId === workspaceId;
					const titleId = `workspace-onboarding-${workspaceId}-title`;
					const descriptionId = `workspace-onboarding-${workspaceId}-description`;
					return <button
						key={workspaceId}
						type="button"
						className={[
							'audio-editor-workspace-onboarding__option',
							current ? 'audio-editor-workspace-onboarding__option--selected' : '',
						].filter(Boolean).join(' ')}
						data-workspace-onboarding-option={workspaceId}
						aria-labelledby={titleId}
						aria-describedby={descriptionId}
						aria-current={current ? 'true' : undefined}
						onClick={() => choose(workspaceId)}
					>
						<span id={titleId} className="audio-editor-workspace-onboarding__option-title">
							{workspaceId === 'audacity' ? copy.workspaceAudacity : copy.workspaceModern}
						</span>
						<span id={descriptionId} className="audio-editor-workspace-onboarding__option-description">
							{workspaceId === 'audacity'
								? copy.workspaceOnboardingAudacityDescription
								: copy.workspaceOnboardingSoundscaperDescription}
						</span>
					</button>;
				})}
			</div>
			<p className="audio-editor-workspace-onboarding__hint">{copy.workspaceOnboardingHint}</p>
			<div role="status" aria-live="polite" aria-atomic="true">{error}</div>
		</div>
	</AudioEditorDialogShell>;
}

function isOption(value: string): value is WorkspaceOnboardingOption {
	return (OPTIONS as readonly string[]).includes(value);
}
