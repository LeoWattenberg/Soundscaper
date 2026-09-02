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
 * Audacity's "Getting started" layout page: picking a card switches the
 * workspace immediately, and leaving the dialog by any route records that
 * setup happened so it never returns uninvited.
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
		isOption(activeId) ? `[data-workspace-onboarding-option="${activeId}"]` : 'first'
	));
	if (productId !== 'soundscaper') return null;
	const finish = (): void => {
		markFirstLaunchSetupComplete(productId, preferences.workspace.activeId, storage);
		onClose();
	};
	const choose = (workspaceId: WorkspaceOnboardingOption): void => {
		setError('');
		void runAwaitedAudioEditorOperation(run, () => controller.actions.preferences.setWorkspace(workspaceId))
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			});
	};
	const questionId = 'workspace-onboarding-question';
	return <AudioEditorDialogShell
		title={copy.workspaceOnboardingTitle}
		onClose={finish}
		initialFocus={initialFocus}
		ariaDescribedBy={questionId}
		dataAttributes={{ 'data-workspace-onboarding-dialog': 'true' }}
		width={640}
		footer={<div className="kw-audio-editor-dialog__actions">
			<button type="button" data-workspace-onboarding-done="true" onClick={finish}>
				{copy.workspaceOnboardingDone}
			</button>
		</div>}
	>
		<div className="audio-editor-workspace-onboarding">
			<p id={questionId}>{copy.workspaceOnboardingQuestion}</p>
			<div
				className="audio-editor-workspace-onboarding__options"
				role="radiogroup"
				aria-label={copy.workspaceOnboardingSelect}
			>
				{OPTIONS.map((workspaceId) => {
					const checked = activeId === workspaceId;
					const titleId = `workspace-onboarding-${workspaceId}-title`;
					const descriptionId = `workspace-onboarding-${workspaceId}-description`;
					return <label
						key={workspaceId}
						className={[
							'audio-editor-workspace-onboarding__option',
							checked ? 'audio-editor-workspace-onboarding__option--selected' : '',
						].filter(Boolean).join(' ')}
					>
						<input
							type="radio"
							name="workspace-onboarding"
							value={workspaceId}
							data-workspace-onboarding-option={workspaceId}
							aria-labelledby={titleId}
							aria-describedby={descriptionId}
							checked={checked}
							onChange={() => choose(workspaceId)}
						/>
						<span id={titleId} className="audio-editor-workspace-onboarding__option-title">
							{workspaceId === 'audacity' ? copy.workspaceAudacity : copy.workspaceModern}
						</span>
						<span id={descriptionId} className="audio-editor-workspace-onboarding__option-description">
							{workspaceId === 'audacity'
								? copy.workspaceOnboardingAudacityDescription
								: copy.workspaceOnboardingSoundscaperDescription}
						</span>
					</label>;
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
