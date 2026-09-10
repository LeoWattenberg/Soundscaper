/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAsyncAbsentSubsystemRefusal,
	type AbsentSubsystemContext,
} from '../../shared/absent-subsystem.ts';

/** Replaces the audio generator service when the generator domain is absent. */
export function createAbsentAudioGeneratorService(context: AbsentSubsystemContext) {
	const reject = createAsyncAbsentSubsystemRefusal(context, 'audio generator');
	return Object.freeze({
		generateLabeledSilence: reject,
		generateSelectionSilence: reject,
		generateSignal: reject,
		repeatLast: reject,
	});
}
