/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { Separator } from '@soundscaper/design-system/Separator';

import EditorHelpTooltip from '../EditorHelpTooltip.tsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import SoundActivationPreferences from '../SoundActivationPreferences.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

/**
 * Audacity's Playback/Recording preferences page. Audacity lists the page but
 * ships no content for it yet, so it collects what this editor already had:
 * the play-at-speed pitch behaviour, and the recording settings that used to
 * sit under Editing, sound-activated recording included.
 */
export default function PlaybackRecordingPreferencesPage({
	controller,
	snapshot,
	copy,
	locale,
	productId,
	run,
}) {
	const preferences = snapshot.preferences;
	return (
		<>
			<PreferencePanel title={copy.playAtSpeed}>
				<div className="kw-audio-editor-preferences__grid">
					<PreferenceDropdownField
						label={copy.playAtSpeedMode}
						value={preferences.playback?.playAtSpeedMode || 'naive'}
						onChange={(value) => run(() => controller.actions.preferences.update({ playback: { playAtSpeedMode: value } }))}
						options={[
							{ value: 'naive', label: copy.playAtSpeedNaive },
							{ value: 'staffpad', label: copy.playAtSpeedStaffPad },
						]}
					/>
				</div>
			</PreferencePanel>
			<Separator />
			<PreferencePanel title={copy.recordingPreferences}>
				<div className="kw-audio-editor-preferences__checks kw-audio-editor-preferences__recording">
					<span className="audio-editor-help-label">
						<PreferenceCheckbox
							label={copy.recordingKeepInputsOpen}
							checked={snapshot.recordingInputs?.retainInputs ?? preferences.recording?.retainInputs ?? true}
							onChange={(checked) => run(() => controller.actions.recording.setRetainInputs(checked))}
						/>
						<EditorHelpTooltip
							subject={copy.recordingKeepInputsOpen}
							description={copy.recordingKeepInputsOpenDescription}
							helpLabel={copy.helpMenu}
							hook="recording-keep-inputs-open"
						/>
					</span>
				</div>
				{snapshot.recordingInputs?.soundActivation && <SoundActivationPreferences
					productId={productId}
					locale={locale}
					readOnly={Boolean(snapshot.readOnly)}
					soundActivation={snapshot.recordingInputs.soundActivation}
					copy={copy}
					controller={controller}
					run={run}
				/>}
			</PreferencePanel>
		</>
	);
}
