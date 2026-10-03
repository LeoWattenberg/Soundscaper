/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import {
	DEFAULT_WAVEFORM_DISPLAY_PREFERENCES,
	type WaveformDisplayPreferences,
} from '../../waveform-display-preferences.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

interface WaveformDisplayPreferencesPanelProps {
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly preferences: Readonly<{
				update(patch: Readonly<Record<string, unknown>>): unknown;
				setDefaultView(view: string): unknown;
			}>;
			readonly timeline: Readonly<{ toggleRms(): unknown }>;
		}>;
	}>;
	readonly preferences: Readonly<{
		waveformDisplay?: WaveformDisplayPreferences;
		appearance?: Readonly<{ defaultView?: string }>;
	}>;
	readonly showRms: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly disabled?: boolean;
}

export default function WaveformDisplayPreferencesPanel({
	controller, preferences, showRms, copy, run, disabled = false,
}: WaveformDisplayPreferencesPanelProps) {
	const waveform = preferences.waveformDisplay ?? DEFAULT_WAVEFORM_DISPLAY_PREFERENCES;
	return <PreferencePanel title={copy.preferencesWaveform}>
		<div data-waveform-display-settings>
			<PreferenceCheckbox
				label={copy.waveformShowRms}
				checked={showRms}
				disabled={disabled}
				onChange={() => { run(() => controller.actions.timeline.toggleRms()); }}
			/>
			<PreferenceDropdownField
				label={copy.waveformRulerFormat}
				value={waveform.rulerFormat}
				disabled={disabled}
				onChange={(rulerFormat: string) => run(() => controller.actions.preferences.update({
					waveformDisplay: { rulerFormat },
				}))}
				options={[
					{ value: 'linear-db', label: copy.waveformLinearDb },
					{ value: 'linear-amp', label: copy.waveformLinearAmp },
					{ value: 'logarithmic-db', label: copy.waveformLogarithmicDb },
				]}
			/>
			<PreferenceCheckbox
				label={copy.halfWave}
				checked={waveform.halfWave || preferences.appearance?.defaultView === 'half-wave'}
				disabled={disabled}
				onChange={(halfWave) => {
					if (!halfWave && preferences.appearance?.defaultView === 'half-wave') {
						run(() => controller.actions.preferences.setDefaultView('waveform'));
					}
					run(() => controller.actions.preferences.update({ waveformDisplay: { halfWave } }));
				}}
			/>
		</div>
	</PreferencePanel>;
}
