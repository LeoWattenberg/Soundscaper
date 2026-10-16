/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import {
	AUDIO_COM_DEFAULT_SERVER_URL, normalizeAudioComServerUrl,
	type AudioEditorAdvancedPreferences,
} from '../../advanced-preferences.ts';

interface AdvancedPreferencesCopy {
	readonly advancedAudioServer: string;
	readonly advancedAudioServerDescription: string;
	readonly advancedAudioServerInvalid: string;
	readonly advancedAudioServerSave: string;
	readonly advancedAudioServerUrl: string;
	readonly advancedAudioServerUseDefault: string;
}

interface AdvancedPreferencesPageProps {
	readonly controller: { readonly actions: { readonly preferences: {
		readonly update: (changes: { readonly advanced: AudioEditorAdvancedPreferences }) => unknown;
	} } };
	readonly preferences: { readonly advanced: AudioEditorAdvancedPreferences };
	readonly copy: AdvancedPreferencesCopy;
	readonly run: (operation: () => unknown) => unknown;
}

export default function AdvancedPreferencesPage({ controller, preferences, copy, run }: AdvancedPreferencesPageProps) {
	const serverUrl = preferences.advanced.audioComServerUrl;
	const [draft, setDraft] = useState(serverUrl);
	const [invalid, setInvalid] = useState(false);
	const fieldId = useId();
	useEffect(() => { setDraft(serverUrl); setInvalid(false); }, [serverUrl]);
	const save = (value: string) => {
		let audioComServerUrl: string;
		try { audioComServerUrl = normalizeAudioComServerUrl(value); }
		catch { setInvalid(true); return; }
		setInvalid(false);
		setDraft(audioComServerUrl);
		if (audioComServerUrl !== serverUrl) run(() => controller.actions.preferences.update({ advanced: { audioComServerUrl } }));
	};
	return <PreferencePanel title={copy.advancedAudioServer}>
		<label className="kw-audio-editor-preferences__field" htmlFor={fieldId}>
			<span>{copy.advancedAudioServerUrl}</span>
			<input id={fieldId} type="url" value={draft} autoComplete="off" spellCheck={false}
				aria-invalid={invalid || undefined} aria-describedby={`${fieldId}-note${invalid ? ` ${fieldId}-error` : ''}`}
				onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
				onKeyDown={(event) => {
					if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
					event.preventDefault(); save(draft);
				}} />
		</label>
		<p className="kw-audio-editor-preferences__note" id={`${fieldId}-note`}>{copy.advancedAudioServerDescription}</p>
		{invalid && <p role="alert" id={`${fieldId}-error`}>{copy.advancedAudioServerInvalid}</p>}
		<div className="kw-audio-editor__custom-workspace-actions">
			<Button variant="primary" disabled={draft.trim() === serverUrl} onClick={() => save(draft)}>{copy.advancedAudioServerSave}</Button>
			<Button variant="secondary" disabled={draft === AUDIO_COM_DEFAULT_SERVER_URL && serverUrl === AUDIO_COM_DEFAULT_SERVER_URL}
				onClick={() => save(AUDIO_COM_DEFAULT_SERVER_URL)}>{copy.advancedAudioServerUseDefault}</Button>
		</div>
	</PreferencePanel>;
}
