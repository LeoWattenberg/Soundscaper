/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleProductionComposition } from './take-cycle-production-composition.ts';
import type { RecordingControllerLike, RecordingStartScope } from './recording-session-service.ts';

export interface TakeCycleRecordingAppSessionDependencies {
	readonly cycle: Pick<TakeCycleProductionComposition, 'start'>;
	readonly recordingMessage: string;
	setTransportState(state: 'recording'): void;
	setStatus(message: string): void;
}

/** Adapt cycle startup to the ordinary recording session controller contract. */
export function createTakeCycleRecordingAppSession(
	dependencies: TakeCycleRecordingAppSessionDependencies,
): Readonly<{
	begin(scope: RecordingStartScope): Promise<RecordingControllerLike>;
}> {
	return Object.freeze({
		async begin(scope: RecordingStartScope) {
			const recorder = await dependencies.cycle.start(scope);
			dependencies.setTransportState('recording');
			dependencies.setStatus(dependencies.recordingMessage);
			return recorder;
		},
	});
}
