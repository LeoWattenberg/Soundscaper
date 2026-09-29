/* SPDX-License-Identifier: AGPL-3.0-only */

import { useSyncExternalStore } from 'react';
import {
	parallelStackPreferencesRevision,
	readParallelStackPreferences,
	readParallelStackStatus,
	subscribeParallelStackPreferences,
	writeParallelStackPreferences,
	type ParallelStackPreferences,
} from '../../engine/parallel-stack-preferences.ts';

interface ParallelStackMenuController {
	readonly engine?: { getState(): { readonly state: string } } | null;
	getSnapshot?(): { readonly recording?: boolean; readonly recordingScheduling?: boolean; readonly scheduledRecording?: unknown };
}

export function useParallelStackMenuRefresh(): void {
	useSyncExternalStore(subscribeParallelStackPreferences, parallelStackPreferencesRevision, parallelStackPreferencesRevision);
}

export function createParallelStackMenuRuntime(input: Readonly<{
	productId: string;
	desktop: boolean;
	controller?: ParallelStackMenuController;
	recording: boolean;
	run: (operation: () => unknown) => unknown;
}>) {
	if (input.productId !== 'soundscaper' || !input.desktop) return null;
	const activity = () => {
		const snapshot = input.controller?.getSnapshot?.();
		return {
			playing: input.controller?.engine?.getState().state === 'playing',
			recording: snapshot ? Boolean(snapshot.recording || snapshot.recordingScheduling || snapshot.scheduledRecording) : input.recording,
		};
	};
	const current = activity();
	return Object.freeze({
		productId: input.productId,
		desktop: input.desktop,
		blocked: current.playing || current.recording,
		isBlocked: () => { const live = activity(); return live.playing || live.recording; },
		preferences: readParallelStackPreferences(),
		status: readParallelStackStatus(input.controller?.engine),
		change: (patch: Partial<ParallelStackPreferences>) => input.run(() => {
			writeParallelStackPreferences({ ...readParallelStackPreferences(), ...patch }, activity());
		}),
	});
}
