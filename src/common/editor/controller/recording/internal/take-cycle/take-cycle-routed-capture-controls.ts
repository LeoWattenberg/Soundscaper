/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleRoutedLiveSource } from './take-cycle-routed-capture-state.ts';
import type { TakeCycleRoutedCaptureService } from './take-cycle-routed-capture-types.ts';
import { finiteTakeCycleRoutedGain } from './take-cycle-routed-capture-validation.ts';

/** Live input controls belong only to the currently active microphone capture. */
export function createTakeCycleRoutedCaptureControls(
	activeSources: () => readonly Pick<TakeCycleRoutedLiveSource, 'kind' | 'controller'>[] | null,
	start: TakeCycleRoutedCaptureService['start'],
	stop: TakeCycleRoutedCaptureService['stop'],
): Readonly<TakeCycleRoutedCaptureService> {
	return Object.freeze({
		get active() { return activeSources() !== null; },
		start,
		stop,
		pause() { throw new Error('Take cycle routed capture cannot be paused.'); },
		setInputGain(value: number) {
			const gain = finiteTakeCycleRoutedGain(value);
			for (const source of activeSources() ?? []) if (source.kind === 'device') source.controller?.setInputGain(gain);
		},
		setMonitoring(enabled: boolean) {
			for (const source of activeSources() ?? []) if (source.kind === 'device') source.controller?.setMonitoring(enabled);
		},
	});
}
