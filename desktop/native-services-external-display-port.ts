/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FramescaperExternalDisplayController,
	type FramescaperExternalDisplay,
	type FramescaperExternalDisplayFrame,
	type FramescaperExternalDisplayWindow,
	type FramescaperExternalDisplayWindowOptions,
} from './external-display-controller.ts';
import type { FramescaperNativeExternalDisplayPort } from './native-services-lifecycle.ts';

export interface FramescaperNativeExternalDisplayPortOptions {
	readonly platform: NodeJS.Platform;
	readonly linuxSessionType?: string;
	readonly isEnabled: () => boolean;
	readonly listDisplays: () => readonly FramescaperExternalDisplay[];
	readonly createWindow: (
		options: FramescaperExternalDisplayWindowOptions,
	) => FramescaperExternalDisplayWindow;
	readonly subscribe?: (listener: () => void) => () => void;
	readonly onError?: (error: unknown) => void;
}

export interface FramescaperNativeExternalDisplayLifecyclePort extends FramescaperNativeExternalDisplayPort {
	readonly dispose: () => void;
}

/** Session-only adapter from Electron screen/window seams to the isolated controller. */
export function createFramescaperNativeExternalDisplayPort(
	options: FramescaperNativeExternalDisplayPortOptions,
): FramescaperNativeExternalDisplayLifecyclePort {
	const onError = options.onError ?? (() => undefined);
	let displays = Object.freeze([...options.listDisplays()]);
	const controller = new FramescaperExternalDisplayController({
		platform: options.platform,
		...(options.linuxSessionType === undefined ? {} : { linuxSessionType: options.linuxSessionType }),
		isEnabled: options.isEnabled,
		createWindow: options.createWindow,
		onLoss: (reason) => onError(new Error(
			`Framescaper external display session was lost: ${reason}.`,
		)),
	});
	let disposed = false;
	const refresh = (): void => {
		if (disposed) return;
		displays = Object.freeze([...options.listDisplays()]);
		controller.reconcileDisplays(displays);
	};
	const unsubscribe = options.subscribe?.(() => {
		try {
			refresh();
		} catch (error) {
			onError(error);
		}
	}) ?? (() => undefined);
	return Object.freeze({
		list: () => {
			refresh();
			return displays;
		},
		activeDisplayId: () => controller.snapshot().displayId,
		open: (display: FramescaperExternalDisplay) => controller.open(
			display,
			display.hdrCapable && display.colorManaged ? 'hdr' : 'sdr',
		).then(() => undefined),
		stop: () => controller.stop(),
		present: (frame: FramescaperExternalDisplayFrame) => controller.present(frame),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			controller.stop();
		},
	});
}
