/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import { AudioDevicesFlyout } from '../toolbar/AudioEditorMeterControls.jsx';
import { recordingOffsetSources } from './editor-dialog-model.js';

/**
 * Audacity's Audio settings preferences page: the playback and recording
 * devices, reached from Preferences as well as from the transport's Audio
 * setup button.
 *
 * Audacity's page leads with an audio API choice. This editor has none to
 * offer — the browser has only Web Audio, and the desktop backend chain is
 * discovered rather than chosen — so the page begins at the devices.
 */
export default function AudioSettingsPreferencesPage({ controller, snapshot, copy, run, displayAudioSupported = true }) {
	const [sourceKey, setSourceKey] = useState('global');
	const sourceOffset = sourceKey === 'global'
		? snapshot.monitor?.latencyOffsetMs ?? 0
		: snapshot.recordingInputs?.offsets?.[sourceKey] ?? 0;
	const [offsetDraft, setOffsetDraft] = useState(String(sourceOffset));
	useEffect(() => setOffsetDraft(String(sourceOffset)), [sourceKey, sourceOffset]);
	const saveOffset = () => {
		const offset = Number(offsetDraft);
		if (!offsetDraft.trim() || !Number.isFinite(offset)) {
			setOffsetDraft(String(sourceOffset));
			return;
		}
		const boundedOffset = Math.max(-500, Math.min(500, offset));
		setOffsetDraft(String(boundedOffset));
		if (boundedOffset === sourceOffset) return;
		run(() => sourceKey === 'global'
			? controller.actions.recording.setLatencyOffset(boundedOffset)
			: controller.actions.recording.setSourceOffset(sourceKey, boundedOffset));
	};
	return (
		<>
			<PreferencePanel title={copy.preferencesAudioSettings}>
				<AudioDevicesFlyout
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
					displayAudioSupported={displayAudioSupported}
					heading={false}
				/>
			</PreferencePanel>
			<PreferencePanel title={copy.recordingOffset}>
				<div className="kw-audio-editor-preferences__grid">
					<label className="kw-audio-editor-preferences__field">
						<span>{copy.recordingOffsetSource}</span>
						<select value={sourceKey} disabled={Boolean(snapshot.readOnly)} onChange={(event) => setSourceKey(event.currentTarget.value)}>
							{recordingOffsetSources(snapshot, copy).map((source) => (
								<option key={source.key} value={source.key}>{source.label}</option>
							))}
						</select>
					</label>
					<label className="kw-audio-editor-preferences__field">
						<span>{copy.latencyOffset}</span>
						<input type="number" min="-500" max="500" step="1" value={offsetDraft}
							disabled={Boolean(snapshot.readOnly)} onChange={(event) => setOffsetDraft(event.currentTarget.value)}
							onBlur={saveOffset} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
					</label>
				</div>
			</PreferencePanel>
		</>
	);
}
