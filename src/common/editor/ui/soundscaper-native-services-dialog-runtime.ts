/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Workspace-owned state for the menu-only native-services surface.
 *
 * A dialog is only a view onto this runtime. Closing that view cannot own or
 * release the audio device and project effect sessions it displays; reopening
 * the menu therefore recovers the same projections and explicit close controls.
 */

import type { SoundscaperNativeServicesBridge } from './soundscaper-native-services-bridge.ts';
import { soundscaperNativeServicesStoreFor } from './soundscaper-native-services-bridge.ts';
import {
	EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	reduceSoundscaperNativeServicesDialog,
	runSoundscaperNativeServicesAction,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from './soundscaper-native-services-dialog-model.ts';

export interface SoundscaperNativeServicesDialogRuntime {
	getState(): SoundscaperNativeServicesDialogState;
	subscribe(listener: () => void): () => void;
	perform(action: SoundscaperNativeServicesDialogAction): Promise<SoundscaperNativeServicesDialogState>;
}

export function createSoundscaperNativeServicesDialogRuntime(
	bridge: SoundscaperNativeServicesBridge,
	initialState: SoundscaperNativeServicesDialogState = EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
): SoundscaperNativeServicesDialogRuntime {
	let state = initialState;
	let operationTail: Promise<SoundscaperNativeServicesDialogState> | null = null;
	const listeners = new Set<() => void>();
	const publish = (next: SoundscaperNativeServicesDialogState): void => {
		if (next === state) return;
		state = next;
		for (const listener of listeners) listener();
	};
	const perform = (
		action: SoundscaperNativeServicesDialogAction,
	): Promise<SoundscaperNativeServicesDialogState> => {
		const execute = async (): Promise<SoundscaperNativeServicesDialogState> => {
			publish(reduceSoundscaperNativeServicesDialog(state, { type: 'begin', action }));
			const event = await runSoundscaperNativeServicesAction(bridge, action);
			publish(reduceSoundscaperNativeServicesDialog(state, event));
			if (event.type === 'settled' && action.type !== 'refresh' && action.type !== 'describe-devices') {
				await soundscaperNativeServicesStoreFor(bridge).refresh().catch(() => null);
			}
			return state;
		};
		const operation = operationTail === null
			? execute()
			: operationTail.then(execute, execute);
		operationTail = operation;
		void operation.then(clearTail, clearTail);
		return operation;

		function clearTail(): void {
			if (operationTail === operation) operationTail = null;
		}
	};
	return Object.freeze({
		getState: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		perform,
	});
}
