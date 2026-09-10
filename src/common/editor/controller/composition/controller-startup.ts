/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isEditorDisposedError,
	type EditorControllerLifetime,
	type EditorControllerPhase,
	type EditorLifetimeToken,
} from '../shared/lifecycle.ts';

export interface ControllerStartupDependencies<Snapshot> {
	readonly lifetime: EditorControllerLifetime;
	readonly state: { phase: EditorControllerPhase; microphoneMetering: boolean };
	readonly bootstrap: (token: EditorLifetimeToken) => PromiseLike<unknown>;
	readonly initializeCapture: () => PromiseLike<unknown> | unknown;
	readonly getSnapshot: () => Snapshot;
	readonly publish: () => void;
	readonly startMicrophoneMeter: () => PromiseLike<unknown>;
	readonly handleError: (error: unknown) => void;
}

/** Startup may settle after disposal; terminal state belongs to the lifetime. */
export async function startController<Snapshot>(dependencies: ControllerStartupDependencies<Snapshot>): Promise<Snapshot> {
	const { lifetime, state, getSnapshot, publish, handleError } = dependencies;
	try {
		await dependencies.bootstrap(lifetime.capture());
		if (lifetime.inactive) return getSnapshot();
		await dependencies.initializeCapture();
		if (lifetime.inactive) return getSnapshot();
		lifetime.markReady();
		state.phase = lifetime.phase;
		publish();
		if (state.microphoneMetering) {
			void Promise.resolve(dependencies.startMicrophoneMeter()).catch((error: unknown) => {
				if (!lifetime.inactive) handleError(error);
			});
		}
		return getSnapshot();
	} catch (error) {
		if (isEditorDisposedError(error) || lifetime.inactive) return getSnapshot();
		lifetime.markError();
		state.phase = lifetime.phase;
		handleError(error);
		publish();
		return getSnapshot();
	}
}
