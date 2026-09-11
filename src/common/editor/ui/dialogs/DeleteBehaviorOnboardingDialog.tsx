/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import type {
	ConfiguredAudioEditorDeleteBehavior,
} from '../../delete-behavior-onboarding.ts';
import type { AudioEditorCloseGapBehavior } from '../../editing-preferences.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { DeleteBehaviorConfirmation } from './delete-behavior-confirmation.ts';

interface DeleteBehaviorOnboardingCopy {
	readonly channelMappingApply: string;
	readonly editingCloseGapAllTracks: string;
	readonly editingCloseGapBehavior: string;
	readonly editingCloseGapClip: string;
	readonly editingCloseGapRipple: string;
	readonly editingCloseGapTrack: string;
	readonly editingLeaveGap: string;
}

export interface DeleteBehaviorOnboardingDialogProps {
	readonly confirmation: DeleteBehaviorConfirmation;
	readonly copy: DeleteBehaviorOnboardingCopy;
}

/** Render Audacity's first-use delete behavior panel while an edit is parked. */
export default function DeleteBehaviorOnboardingDialog({
	confirmation,
	copy,
}: DeleteBehaviorOnboardingDialogProps) {
	const prompt = useSyncExternalStore(
		confirmation.subscribe,
		confirmation.getSnapshot,
		confirmation.getSnapshot,
	);
	const [deleteBehavior, setDeleteBehavior] = useState<ConfiguredAudioEditorDeleteBehavior>('leave-gap');
	const [closeGapBehavior, setCloseGapBehavior] = useState<AudioEditorCloseGapBehavior>('clip');
	useEffect(() => {
		setDeleteBehavior('leave-gap');
		setCloseGapBehavior(prompt?.initialCloseGapBehavior ?? 'clip');
	}, [prompt?.requestId, prompt?.initialCloseGapBehavior]);
	if (!prompt) return null;
	const dismiss = (): void => { confirmation.settle(prompt, { accepted: false }); };
	const apply = (): void => {
		confirmation.settle(prompt, { accepted: true, deleteBehavior, closeGapBehavior });
	};
	return <AudioEditorDialogShell
		title={prompt.title}
		width={560}
		onClose={dismiss}
		dataAttributes={{ 'data-delete-behavior-onboarding': true }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={
			<Button variant="primary" onClick={apply}>{copy.channelMappingApply}</Button>
		} />}
	>
		<RadioChoices
			name="delete-behavior"
			ariaLabel={prompt.title}
			value={deleteBehavior}
			onChange={setDeleteBehavior}
			choices={[
				{ value: 'leave-gap', label: copy.editingLeaveGap },
				{ value: 'close-gap', label: copy.editingCloseGapRipple },
			]}
		/>
		{deleteBehavior === 'close-gap' && <fieldset>
			<legend>{copy.editingCloseGapBehavior}</legend>
			<RadioChoices
				name="close-gap-behavior"
				ariaLabel={copy.editingCloseGapBehavior}
				value={closeGapBehavior}
				onChange={setCloseGapBehavior}
				choices={[
					{ value: 'clip', label: copy.editingCloseGapClip },
					{ value: 'track', label: copy.editingCloseGapTrack },
					{ value: 'all-tracks', label: copy.editingCloseGapAllTracks },
				]}
			/>
		</fieldset>}
	</AudioEditorDialogShell>;
}

interface RadioChoicesProps<Value extends string> {
	readonly name: string;
	readonly ariaLabel: string;
	readonly value: Value;
	readonly onChange: (value: Value) => void;
	readonly choices: readonly Readonly<{ readonly value: Value; readonly label: string }>[];
}

function RadioChoices<Value extends string>({
	name,
	ariaLabel,
	value,
	onChange,
	choices,
}: RadioChoicesProps<Value>) {
	return <div role="radiogroup" aria-label={ariaLabel}>
		{choices.map((choice) => <label key={choice.value}>
			<input
				type="radio"
				name={name}
				value={choice.value}
				checked={value === choice.value}
				onChange={() => { onChange(choice.value); }}
			/>{' '}{choice.label}
		</label>)}
	</div>;
}
