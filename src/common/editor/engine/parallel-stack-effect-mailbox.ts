/* SPDX-License-Identifier: AGPL-3.0-only */

/** One writer on the UI thread, one reader on an effect's owning worker. */
export const PARALLEL_STACK_EFFECT_UPDATE_BYTES = 16_384;
const CONTROL_WORDS_PER_EFFECT = 2; // Even version, encoded byte length.
export const PARALLEL_STACK_EFFECT_MAILBOX_BYTES_PER_EFFECT = PARALLEL_STACK_EFFECT_UPDATE_BYTES
	+ CONTROL_WORDS_PER_EFFECT * Int32Array.BYTES_PER_ELEMENT;

export interface SharedParallelStackEffectMailbox {
	readonly effectCount: number;
	readonly control: SharedArrayBuffer;
	readonly payload: SharedArrayBuffer;
}

export interface ParallelStackEffectUpdate {
	readonly params: Readonly<Record<string, unknown>>;
	readonly transitionFrames?: number;
}

export interface ReadParallelStackEffectUpdate extends ParallelStackEffectUpdate {
	readonly version: number;
}

interface MailboxViews {
	readonly control: Int32Array;
	readonly payload: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cachedViews = new WeakMap<SharedParallelStackEffectMailbox, MailboxViews>();

export function createParallelStackEffectMailbox(effectCount: number): SharedParallelStackEffectMailbox {
	if (!Number.isSafeInteger(effectCount) || effectCount < 0 || effectCount > 4096) {
		throw new RangeError('Invalid parallel effect mailbox count.');
	}
	return {
		effectCount,
		control: new SharedArrayBuffer(effectCount * CONTROL_WORDS_PER_EFFECT * Int32Array.BYTES_PER_ELEMENT),
		payload: new SharedArrayBuffer(effectCount * PARALLEL_STACK_EFFECT_UPDATE_BYTES),
	};
}

function views(mailbox: SharedParallelStackEffectMailbox): MailboxViews {
	let result = cachedViews.get(mailbox);
	if (result) return result;
	const { effectCount, control, payload } = mailbox;
	if (!Number.isSafeInteger(effectCount) || effectCount < 0 || effectCount > 4096
		|| !(control instanceof SharedArrayBuffer) || !(payload instanceof SharedArrayBuffer)
		|| control.byteLength !== effectCount * CONTROL_WORDS_PER_EFFECT * Int32Array.BYTES_PER_ELEMENT
		|| payload.byteLength !== effectCount * PARALLEL_STACK_EFFECT_UPDATE_BYTES) {
		throw new RangeError('Parallel effect mailbox geometry does not match its buffers.');
	}
	result = { control: new Int32Array(control), payload: new Uint8Array(payload) };
	cachedViews.set(mailbox, result);
	return result;
}

function effectOffset(mailbox: SharedParallelStackEffectMailbox, index: number): number {
	if (!Number.isSafeInteger(index) || index < 0 || index >= mailbox.effectCount) {
		throw new RangeError('Invalid parallel effect mailbox index.');
	}
	return index * CONTROL_WORDS_PER_EFFECT;
}

/** Validate the cloned mailbox before a worker announces it is ready. */
export function validateParallelStackEffectMailbox(mailbox: SharedParallelStackEffectMailbox, expectedEffects: number): void {
	views(mailbox);
	if (mailbox.effectCount !== expectedEffects) throw new RangeError('Parallel effect mailbox does not match the graph.');
}

/** A failed publication leaves the previous complete update intact. */
export function publishParallelStackEffectUpdate(
	mailbox: SharedParallelStackEffectMailbox,
	index: number,
	update: ParallelStackEffectUpdate,
): boolean {
	const { control, payload } = views(mailbox);
	const offset = effectOffset(mailbox, index);
	if (!update?.params || typeof update.params !== 'object' || Array.isArray(update.params)) return false;
	if (update.transitionFrames !== undefined && (!Number.isSafeInteger(update.transitionFrames) || update.transitionFrames < 0)) return false;
	let encoded: Uint8Array;
	try { encoded = encoder.encode(JSON.stringify(update)); }
	catch { return false; }
	if (encoded.byteLength > PARALLEL_STACK_EFFECT_UPDATE_BYTES) return false;
	const previous = Atomics.load(control, offset);
	if (previous < 0 || previous > 0x7ffffffd || (previous & 1) !== 0) return false;
	// An odd version fences the byte writes. The worker skips a torn snapshot.
	Atomics.store(control, offset, previous + 1);
	payload.set(encoded, index * PARALLEL_STACK_EFFECT_UPDATE_BYTES);
	Atomics.store(control, offset + 1, encoded.byteLength);
	Atomics.store(control, offset, previous + 2);
	return true;
}

/** Called once per owned effect block; no copies or parsing when unchanged. */
export function readParallelStackEffectUpdate(
	mailbox: SharedParallelStackEffectMailbox,
	index: number,
	lastVersion: number,
): ReadParallelStackEffectUpdate | null {
	const { control, payload } = views(mailbox);
	const offset = effectOffset(mailbox, index);
	const version = Atomics.load(control, offset);
	if (version === lastVersion || version === 0 || (version & 1) !== 0) return null;
	const length = Atomics.load(control, offset + 1);
	if (length < 1 || length > PARALLEL_STACK_EFFECT_UPDATE_BYTES) throw new RangeError('Invalid parallel effect update length.');
	const start = index * PARALLEL_STACK_EFFECT_UPDATE_BYTES;
	const bytes = payload.slice(start, start + length);
	if (Atomics.load(control, offset) !== version) return null;
	const update: unknown = JSON.parse(decoder.decode(bytes));
	if (!update || typeof update !== 'object' || !('params' in update)
		|| !update.params || typeof update.params !== 'object' || Array.isArray(update.params)) {
		throw new TypeError('Invalid parallel effect update.');
	}
	return { ...update, version } as ReadParallelStackEffectUpdate;
}
