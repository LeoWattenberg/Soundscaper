/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import {
	normalizeWaveformVisualizationPreferences,
	WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ,
	WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ,
	type WaveformVisualizationPreferences,
} from '../../waveform-visualization-preferences.ts';

interface WaveformPreferencesPageProps {
	readonly controller: Readonly<{
		readonly actions: Readonly<{
			readonly preferences: Readonly<{
				update(patch: Readonly<Record<string, unknown>>): unknown;
			}>;
		}>;
	}>;
	readonly preferences: Readonly<{
		readonly waveformVisualization: WaveformVisualizationPreferences;
	}>;
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly disabled?: boolean;
}

export default function WaveformPreferencesPage({
	controller,
	preferences,
	copy,
	run,
	disabled = false,
}: WaveformPreferencesPageProps) {
	const saved = preferences.waveformVisualization;
	const [lowMid, setLowMid] = useState(String(saved.lowMidCrossoverHz));
	const [midHigh, setMidHigh] = useState(String(saved.midHighCrossoverHz));
	const lastCommitted = useRef(saved);
	const draft = normalizedDraft(lowMid, midHigh);

	useEffect(() => {
		setLowMid(String(saved.lowMidCrossoverHz));
		setMidHigh(String(saved.midHighCrossoverHz));
		lastCommitted.current = saved;
	}, [saved]);

	const commit = () => {
		if (!draft) return;
		if (draft.lowMidCrossoverHz === lastCommitted.current.lowMidCrossoverHz
			&& draft.midHighCrossoverHz === lastCommitted.current.midHighCrossoverHz) return;
		lastCommitted.current = draft;
		run(() => controller.actions.preferences.update({ waveformVisualization: draft }));
	};
	const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		commit();
	};

	return (
		<PreferencePanel title={copy.waveformVisualization}>
			<div className="kw-audio-editor-preferences__waveform" data-waveform-visualization-settings>
				<p>{copy.waveformVisualizationDescription}</p>
				<label>
					<span>{copy.waveformLowMidCrossover}</span>
					<input
						aria-label={copy.waveformLowMidCrossover}
						aria-invalid={!draft}
						disabled={disabled}
						type="number"
						min={WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ}
						max={WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ}
						step="1"
						value={lowMid}
						onChange={(event) => setLowMid(event.currentTarget.value)}
						onBlur={() => commit()}
						onKeyDown={commitOnEnter}
					/>
				</label>
				<label>
					<span>{copy.waveformMidHighCrossover}</span>
					<input
						aria-label={copy.waveformMidHighCrossover}
						aria-invalid={!draft}
						disabled={disabled}
						type="number"
						min={WAVEFORM_VISUALIZATION_MINIMUM_CROSSOVER_HZ}
						max={WAVEFORM_VISUALIZATION_MAXIMUM_CROSSOVER_HZ}
						step="1"
						value={midHigh}
						onChange={(event) => setMidHigh(event.currentTarget.value)}
						onBlur={() => commit()}
						onKeyDown={commitOnEnter}
					/>
				</label>
			</div>
		</PreferencePanel>
	);
}

function normalizedDraft(lowMid: string, midHigh: string): WaveformVisualizationPreferences | null {
	try {
		return normalizeWaveformVisualizationPreferences({
			lowMidCrossoverHz: lowMid,
			midHighCrossoverHz: midHigh,
		});
	} catch {
		return null;
	}
}
