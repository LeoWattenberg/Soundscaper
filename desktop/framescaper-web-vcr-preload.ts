/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateWebVcrCaptureGrantV1,
	validateWebVcrCaptureStateRequestV1,
	validateWebVcrCommandV1,
	validateWebVcrDispatchResultV1,
	validateWebVcrHandshakeV1,
	validateWebVcrOpenRequestV1,
	validateWebVcrSessionReferenceV1,
	validateWebVcrSnapshotV1,
	type WebVcrCaptureGrantV1,
	type WebVcrDispatchResultV1,
	type WebVcrHandshakeV1,
	type WebVcrSnapshot,
} from './framescaper-web-vcr-contract.ts';
import {
	FRAMESCAPER_WEB_VCR_CHANNELS,
} from './framescaper-web-vcr-main-channels.ts';

export interface FramescaperWebVcrDesktopPortV1 {
	handshake(): Promise<Readonly<WebVcrHandshakeV1>>;
	open(value: unknown): Promise<Readonly<WebVcrSnapshot>>;
	dispatch(value: unknown): Promise<Readonly<WebVcrDispatchResultV1>>;
	prepareCapture(value: unknown): Promise<Readonly<WebVcrCaptureGrantV1>>;
	setCaptureState(value: unknown): Promise<boolean>;
	subscribe(listener: (value: Readonly<WebVcrSnapshot>) => void): () => void;
	dispose(value: unknown): Promise<boolean>;
}

interface FramescaperWebVcrPreloadOptions {
	readonly invoke: (channel: string, value?: unknown) => Promise<unknown>;
	readonly on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
	readonly removeListener: (
		channel: string,
		listener: (event: unknown, payload: unknown) => void,
	) => void;
}

/** Double-validating trusted-app bridge. It exposes no paths, handles, or media bytes. */
export function createFramescaperWebVcrPreloadBridgeV1(
	value: FramescaperWebVcrPreloadOptions,
): Readonly<FramescaperWebVcrDesktopPortV1> {
	const options = validateOptions(value);
	return Object.freeze({
		handshake: async () => validateWebVcrHandshakeV1(
			await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.handshake),
		),
		open: async (requestValue: unknown) => {
			const request = validateWebVcrOpenRequestV1(requestValue);
			return validateWebVcrSnapshotV1(
				await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.open, request),
			);
		},
		dispatch: async (commandValue: unknown) => {
			const command = validateWebVcrCommandV1(commandValue);
			return validateWebVcrDispatchResultV1(
				await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.dispatch, command),
			);
		},
		prepareCapture: async (referenceValue: unknown) => {
			const reference = validateWebVcrSessionReferenceV1(referenceValue);
			return validateWebVcrCaptureGrantV1(
				await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture, reference),
				reference,
			);
		},
		setCaptureState: async (requestValue: unknown) => {
			const request = validateWebVcrCaptureStateRequestV1(requestValue);
			const result = await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.setCaptureState, request);
			if (typeof result !== 'boolean') throw new TypeError('Malformed Web VCR capture-state result.');
			return result;
		},
		subscribe(listenerValue: (value: Readonly<WebVcrSnapshot>) => void): () => void {
			if (typeof listenerValue !== 'function') {
				throw new TypeError('Web VCR snapshot subscription requires a listener.');
			}
			let active = true;
			const receive = (_event: unknown, payload: unknown): void => {
				if (active) listenerValue(validateWebVcrSnapshotV1(payload));
			};
			options.on(FRAMESCAPER_WEB_VCR_CHANNELS.snapshot, receive);
			return (): void => {
				if (!active) return;
				active = false;
				options.removeListener(FRAMESCAPER_WEB_VCR_CHANNELS.snapshot, receive);
			};
		},
		dispose: async (referenceValue: unknown) => {
			const reference = validateWebVcrSessionReferenceV1(referenceValue);
			const result = await options.invoke(FRAMESCAPER_WEB_VCR_CHANNELS.dispose, reference);
			if (typeof result !== 'boolean') throw new TypeError('Malformed Web VCR dispose result.');
			return result;
		},
	});
}

function validateOptions(value: FramescaperWebVcrPreloadOptions): FramescaperWebVcrPreloadOptions {
	if (!value || typeof value !== 'object' || typeof value.invoke !== 'function'
		|| typeof value.on !== 'function' || typeof value.removeListener !== 'function') {
		throw new TypeError('Web VCR preload requires bounded IPC seams.');
	}
	return value;
}
