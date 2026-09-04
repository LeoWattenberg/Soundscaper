/* SPDX-License-Identifier: AGPL-3.0-only */

import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';

import { audacitySpectrogramTrackSelected } from '../../audacity-action-enablement.ts';
import AudioEditorSplitButton from '../AudioEditorSplitButton.tsx';
import { formatOptionsLabel } from '../localization-template.ts';

/**
 * Audacity's spectrogram tool button: the button itself turns the timeline's
 * spectrogram on and off, and its options hold the other display it shares a
 * spectrogram with — multi-view — together with the two spectral tools that
 * only mean anything once a track is drawn as one. Those options belong to this
 * button rather than to the customize-toolbar list, which has nowhere to put
 * them when the button itself is hidden.
 */
export default function SpectrogramToolControl({
	actionRuntime,
	blocked,
	controller,
	copy,
	onOpenSpectralSelection,
	run,
	snapshot,
	uiFlags,
}) {
	const selectedTrack = snapshot.project?.tracks.find((track) => (
		track.id === snapshot.selectedTrackId && track.type === 'audio'
	));
	const spectralTrackSelected = audacitySpectrogramTrackSelected(selectedTrack, snapshot);
	const timelineView = snapshot.timeline?.view;
	const setAllTracksView = (view) => run(() => controller.actions.timeline.setAllTracksView(
		timelineView === view ? 'waveform' : view,
	));
	return (
		<AudioEditorSplitButton
			icon="spectrogram"
			toggle
			pressed={timelineView === 'spectrogram'}
			ariaLabel={copy.spectrogramView}
			optionsAriaLabel={formatOptionsLabel(copy, copy.spectrogramView)}
			onClick={() => setAllTracksView('spectrogram')}
		>
			{({ close }) => <div className="kw-audio-editor__split-button-options kw-audio-editor__spectrogram-tool-options">
				<span data-action-id="multiview-view">
					<ContextMenuItem
						label={copy.multiview}
						checked={timelineView === 'multiview'}
						onClick={() => {
							close();
							setAllTracksView('multiview');
						}}
					/>
				</span>
				<span data-action-id="spectral-box-select">
					<ContextMenuItem
						label={copy.spectralBoxSelect}
						disabled={!spectralTrackSelected}
						onClick={() => {
							close();
							onOpenSpectralSelection();
						}}
					/>
				</span>
				<span data-action-id="spectral-brush">
					<ContextMenuItem
						label={copy.spectralBrush}
						checked={uiFlags.spectralBrush}
						disabled={!spectralTrackSelected || blocked}
						onClick={() => {
							close();
							actionRuntime.tools.toggleSpectralBrush();
						}}
					/>
				</span>
			</div>}
		</AudioEditorSplitButton>
	);
}
