/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_SAVED_FILE_CHANNELS, normalizeMotionSavedFileWatch, normalizeMotionSavedFileDiscovery, normalizeMotionSavedFilePoll, normalizeMotionSavedFileRead, normalizeMotionSavedFileRelease, normalizeMotionSavedFileCancel, type MotionSavedFileCapabilities } from '../src/common/editor/motion-saved-file-contract.ts';
/** Explicit successor bootstrap exposes this bridge; no path or generic file operation crosses it. */
export function createMotionSavedFilePreload(options: Readonly<{ invoke(channel: string, value: unknown): Promise<unknown> }>): MotionSavedFileCapabilities {
	return Object.freeze({
		async select() { const value = await options.invoke(MOTION_SAVED_FILE_CHANNELS.select, {}); return value === null ? null : normalizeMotionSavedFileWatch(value); },
		async poll(value) { return normalizeMotionSavedFileDiscovery(await options.invoke(MOTION_SAVED_FILE_CHANNELS.poll, normalizeMotionSavedFilePoll(value))); },
		async read(value) {
			const request = normalizeMotionSavedFileRead(value), result = await options.invoke(MOTION_SAVED_FILE_CHANNELS.read, request);
			if (!(result instanceof Uint8Array) || !(result.buffer instanceof ArrayBuffer) || result.byteLength !== request.length) throw new TypeError('Motion saved-file byte response has an invalid type or length.'); return new Uint8Array(result);
		},
		async release(value) { acknowledgement(await options.invoke(MOTION_SAVED_FILE_CHANNELS.release, normalizeMotionSavedFileRelease(value))); },
		async cancel(value) { acknowledgement(await options.invoke(MOTION_SAVED_FILE_CHANNELS.cancel, normalizeMotionSavedFileCancel(value))); },
	} satisfies MotionSavedFileCapabilities);
}
function acknowledgement(value: unknown): void { if (value !== undefined) throw new TypeError('Invalid Motion saved-file acknowledgement.'); }
