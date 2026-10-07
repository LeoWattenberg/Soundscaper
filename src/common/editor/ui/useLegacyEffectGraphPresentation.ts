/* SPDX-License-Identifier: GPL-3.0-only */
import { useMemo } from 'react';
import { audacityAutoDuckEnvelope, audacityLegacyCompressorResponse, prepareAudacityClassicFilterResponse, projectAudacityClassicFilterResponse } from './audacity-legacy-effect-graphs.ts';

export function useDuckEnvelope(parameters: Readonly<Record<string, unknown>>) {
	return useMemo(() => audacityAutoDuckEnvelope(parameters), [parameters]);
}
export function useLegacyCompressorCurve(parameters: Readonly<Record<string, unknown>>) {
	return useMemo(() => audacityLegacyCompressorResponse(parameters), [parameters]);
}
export interface LegacyGraphTick { readonly position: number; readonly label: string; readonly minor?: boolean }
export function useClassicFilterPlot(parameters: Readonly<Record<string, unknown>>, sampleRate: number | undefined, minimumDb: number, maximumDb: number) {
	const gains = useMemo(() => prepareAudacityClassicFilterResponse(parameters, sampleRate), [parameters, sampleRate]);
	const response = useMemo(() => projectAudacityClassicFilterResponse(gains, { minimumDb, maximumDb }), [gains, maximumDb, minimumDb]);
	const frequencies = useMemo(() => {
		const label = (frequency: number) => frequency >= 1000 ? `${String(frequency / 1000)}k` : String(frequency);
		const ticks: LegacyGraphTick[] = [{ position: 0, label: '20 Hz' }];
		for (let decade = 10; decade < gains.maximumFrequency; decade *= 10) for (let multiplier = 1; multiplier < 10; multiplier++) {
			const value = decade * multiplier;
			if (value <= gains.minimumFrequency || value >= gains.maximumFrequency) continue;
			ticks.push({ position: Math.log(value / gains.minimumFrequency) / Math.log(gains.maximumFrequency / gains.minimumFrequency) * 100, label: multiplier === 1 ? label(value) : '', minor: multiplier !== 1 });
		}
		ticks.push({ position: 100, label: `${label(gains.maximumFrequency)} Hz` });
		return ticks;
	}, [gains.minimumFrequency, gains.maximumFrequency]);
	return useMemo(() => ({ response, frequencies }), [frequencies, response]);
}
