/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { Separator } from '@soundscaper/design-system/Separator';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';
import WaveformPreferencesPage from './WaveformPreferencesPage.tsx';

export default function TrackDisplayPreferencesPage({ controller, snapshot, copy, run }) {
	const preferences = snapshot.preferences;
	const spectralAvailable = snapshot.capabilities?.audioSpectralEditing === true;
	const selectedSpectrogramTrack = snapshot.project?.tracks.find((track) => (
		track.id === snapshot.selectedTrackId && track.type === 'audio'
	)) || null;
	const defaultSpectrogram = preferences.spectrogram;
	const spectrogram = { ...defaultSpectrogram, ...(selectedSpectrogramTrack?.spectrogram || {}) };
	const spectrogramSettingsDisabled = Boolean(selectedSpectrogramTrack && snapshot.readOnly);
	const spectrogramNyquist = Math.max(1, (snapshot.project?.sampleRate || 48_000) / 2);
	const updateSpectrogram = (changes) => run(() => selectedSpectrogramTrack
		? controller.actions.track.update(selectedSpectrogramTrack.id, {
			spectrogram: { ...spectrogram, ...changes },
		})
		: controller.actions.preferences.update({ spectrogram: changes }));
	const updateSpectrogramFrequency = (name, requestedValue) => {
		const value = Number(requestedValue);
		if (!Number.isFinite(value) || value < 0 || value > spectrogramNyquist) return;
		const next = { ...spectrogram, [name]: value };
		if (next.maximumFrequency <= next.minimumFrequency) return;
		updateSpectrogram({ [name]: value });
	};
	return <>
		<PreferencePanel title={copy.defaultTrackView}>
			<PreferenceDropdownField
				label={copy.defaultTrackView}
				visuallyHiddenLabel
				value={preferences.appearance.defaultView ?? 'waveform'}
				disabled={snapshot.preferencesReadOnly === true}
				onChange={(value) => run(() => controller.actions.preferences.setDefaultView(value))}
				options={[
					{ value: 'waveform', label: copy.waveformView },
					{ value: 'half-wave', label: copy.halfWave },
					...(spectralAvailable ? [
						{ value: 'waveform-three-band', label: copy.threeBandWaveformView },
						{ value: 'waveform-rainbow', label: copy.rainbowWaveformView },
						{ value: 'spectrogram', label: copy.spectrogramView },
						{ value: 'multiview', label: copy.multiview },
					] : []),
				]}
			/>
			<p className="kw-audio-editor-preferences__note">{copy.defaultTrackViewNote}</p>
		</PreferencePanel>
		{spectralAvailable && <>
			<Separator />
			<WaveformPreferencesPage controller={controller} preferences={preferences}
				copy={copy} run={run} disabled={snapshot.preferencesReadOnly === true} />
			<Separator />
			<PreferencePanel title={copy.panelSpectrogram}>
				<div className="kw-audio-editor__spectrogram-settings" data-spectrogram-settings data-spectrogram-target={selectedSpectrogramTrack?.id || 'defaults'}>
					<p data-spectrogram-target-name>{selectedSpectrogramTrack?.name || copy.spectrogramDefaults}</p>
					<label><span>{copy.spectrogramScale}</span>
						<select aria-label={copy.spectrogramScale} disabled={spectrogramSettingsDisabled} value={spectrogram.scale} onChange={(event) => updateSpectrogram({ scale: event.currentTarget.value })}>
							<option value="mel">{copy.spectrogramMel}</option><option value="linear">{copy.linear}</option><option value="log">{copy.logarithmic}</option>
						</select>
					</label>
					<label><span>{copy.minimumFrequency}</span><input aria-label={copy.minimumFrequency} disabled={spectrogramSettingsDisabled} type="number" min="0" max={Math.max(0, spectrogram.maximumFrequency - 1)} step="1" value={spectrogram.minimumFrequency} onChange={(event) => updateSpectrogramFrequency('minimumFrequency', event.currentTarget.value)} /></label>
					<label><span>{copy.maximumFrequency}</span><input aria-label={copy.maximumFrequency} disabled={spectrogramSettingsDisabled} type="number" min={Math.min(spectrogramNyquist, spectrogram.minimumFrequency + 1)} max={spectrogramNyquist} step="1" value={spectrogram.maximumFrequency} onChange={(event) => updateSpectrogramFrequency('maximumFrequency', event.currentTarget.value)} /></label>
					<label><span>{copy.spectrogramRange}</span><input aria-label={copy.spectrogramRange} disabled={spectrogramSettingsDisabled} type="number" min="1" max="240" value={spectrogram.range} onChange={(event) => {
						const value = Number(event.currentTarget.value);
						if (Number.isFinite(value) && value >= 1 && value <= 240) updateSpectrogram({ range: value });
					}} /></label>
					<label><span>{copy.spectrogramWindow}</span>
						<select aria-label={copy.spectrogramWindow} disabled={spectrogramSettingsDisabled} value={spectrogram.windowSize} onChange={(event) => updateSpectrogram({ windowSize: Number(event.currentTarget.value) })}>
							{[512, 1024, 2048, 4096, 8192].map((value) => <option key={value} value={value}>{value}</option>)}
						</select>
					</label>
					<label><span>{copy.spectrogramWindowType}</span>
						<select aria-label={copy.spectrogramWindowType} disabled={spectrogramSettingsDisabled} value={spectrogram.windowType} onChange={(event) => updateSpectrogram({ windowType: event.currentTarget.value })}>
							<option value="hann">{copy.spectrogramWindowHann}</option><option value="hamming">{copy.spectrogramWindowHamming}</option><option value="blackman">{copy.spectrogramWindowBlackman}</option>
						</select>
					</label>
				</div>
			</PreferencePanel>
		</>}
	</>;
}
