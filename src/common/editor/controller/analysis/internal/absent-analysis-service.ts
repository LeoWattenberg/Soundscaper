/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAsyncAbsentSubsystemRefusal,
	type AbsentSubsystemContext,
} from '../../shared/absent-subsystem.ts';

/** Replaces the deferred analysis service when the analysis domain is absent. */
export function createAbsentAnalysisService(context: AbsentSubsystemContext) {
	const reject = createAsyncAbsentSubsystemRefusal(context, 'analysis');
	return Object.freeze({
		run: reject,
		plotSpectrum: reject,
		findClipping: reject,
		captureContrast: reject,
		measureLoudness: reject,
		repeatLast: reject,
		cancel: (): void => undefined,
	});
}
