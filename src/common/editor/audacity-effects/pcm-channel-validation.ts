/* Audacity 3.7.7 effect validation contracts. SPDX-License-Identifier: GPL-3.0-only */

declare const VALIDATION_BRAND: unique symbol;
export interface SelectionInputValidation { readonly [VALIDATION_BRAND]: true }
const activeInputs = new WeakMap<SelectionInputValidation, readonly Float32Array[]>();

export function assertAudacityEffectOutput(channels: unknown): Float32Array[] {
	if (!Array.isArray(channels) || channels.length === 0) {
		throw new TypeError('Audacity effect output must be a non-empty array of Float32Array channels.');
	}
	let frameCount: number | null = null;
	const values: unknown[] = channels;
	for (let channelIndex = 0; channelIndex < values.length; channelIndex += 1) {
		const channel = values[channelIndex];
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`Audacity effect output channel ${channelIndex} must be a Float32Array.`);
		}
		if (frameCount == null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('Audacity effect output channels must have matching lengths.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) {
				throw new RangeError(`Audacity effect output channel ${channelIndex} contains a non-finite sample at frame ${frame}.`);
			}
		}
	}
	return channels as Float32Array[];
}

/** A validation proof exists only during immediate synchronous dispatch to trusted DSP. */
export function withValidatedSelectionInput(channels: unknown,
	process: (input: Float32Array[], token: SelectionInputValidation) => Float32Array[]): Float32Array[] {
	const input = assertAudacityEffectOutput(channels);
	const token = Object.freeze({}) as SelectionInputValidation;
	activeInputs.set(token, input);
	try { return process(input, token); } finally { activeInputs.delete(token); }
}

export function isSelectionInputValidated(token: SelectionInputValidation | undefined,
	channels: readonly Float32Array[]): boolean {
	return token !== undefined && activeInputs.get(token) === channels;
}
