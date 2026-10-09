/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import { LOCAL_ASSISTANCE_ADDITIONAL_COPY } from '../../../i18n/editor-local-assistance-additional-copy.ts';

type TranscriptSettings = Extract<AssistanceWorkflowSettingsV1, { workflowId: 'transcribe-captions' }>;
type Copy = Readonly<Record<string, string | undefined>>;

/** Keep the existing task recognizer choice available before admitting inference. */
export default function AssistanceRecognizerPrerequisite({ settings, copy, disabled, onChange }: Readonly<{
	settings: TranscriptSettings;
	copy: Copy;
	disabled: boolean;
	onChange(settings: TranscriptSettings): void;
}>) {
	const label = text(copy, 'localAssistanceRecognizer');
	return <label>{label}<select aria-label={label} value={settings.recognizer} disabled={disabled}
		onChange={(event) => onChange({ ...settings,
			recognizer: event.currentTarget.value === 'whisper' ? 'whisper' : 'parakeet' })}>
		<option value="parakeet">{text(copy, 'localAssistanceRecognizerParakeet')}</option>
		<option value="whisper">{text(copy, 'localAssistanceRecognizerWhisper')}</option>
	</select></label>;
}

function text(copy: Copy, key: 'localAssistanceRecognizer' | 'localAssistanceRecognizerParakeet'
	| 'localAssistanceRecognizerWhisper'): string {
	return copy[`ui.localAssistance.${key}`] || copy[key] || LOCAL_ASSISTANCE_ADDITIONAL_COPY[key];
}
