/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import type { ImageDevelopFramePixels, ImageDevelopFrameProfile, ImageDevelopFrameStageInput } from './image-develop-frame-core.ts';

const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;

/** Pin both host profiles before the repair stage can yield. Actual repair
 * geometry still has its independent, tighter source and working limits. */
export function captureImageDevelopFrameProfileV3(value: unknown): Readonly<ImageDevelopFrameProfile> {
	const profile = record(value, 'repair develop profile', ['source', 'render']);
	const limits = (value: unknown): Readonly<PixelFrameLimitsV1> => {
		const names = ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const;
		const raw = record(value, 'repair develop limits', names);
		const result = { ...PIXEL_FRAME_HARD_LIMITS_V1 };
		for (const name of names) {
			const maximum = field(raw, name, 'repair develop limits');
			if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > result[name]) {
				throw new RangeError('Repair develop limit exceeds the hard pixel interchange ceiling.');
			}
			result[name] = maximum;
		}
		return Object.freeze(result);
	};
	return Object.freeze({ source: limits(field(profile, 'source', 'repair develop profile')), render: limits(field(profile, 'render', 'repair develop profile')) });
}

/** Process3 owns native backing geometry, never metadata exposed to a borrower.
 * Completed stages retire immediately; only live planes remain in this register. */
export class ImageDevelopFrameOwnedPixelsV1 {
	readonly #backings = new Map<ArrayBuffer, Readonly<{ length: number; role: string }>>();

	copy(source: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>, role = 'pixels'): Uint8Array<ArrayBuffer> {
		const buffer = Reflect.apply(BUFFER, source, []) as ArrayBuffer;
		const offset = Number(Reflect.apply(OFFSET, source, [])), length = Number(Reflect.apply(LENGTH, source, []));
		const pixels = new NativeBytes(length), owned = this.buffer(pixels);
		this.#backings.set(owned, Object.freeze({ length, role }));
		Reflect.apply(SET, pixels, [new NativeBytes(buffer, offset, length)]);
		return pixels;
	}
	buffer(pixels: Uint8Array<ArrayBuffer>): ArrayBuffer {
		return Reflect.apply(BUFFER, pixels, []) as ArrayBuffer;
	}
	retire(buffer: ArrayBuffer): void {
		const backing = this.#backings.get(buffer);
		if (backing === undefined) throw new TypeError('Develop backing has no active native owner.');
		this.#backings.delete(buffer);
		if (Reflect.apply(SIZE, buffer, []) !== backing.length) {
			throw new TypeError(`Develop ${backing.role} backing was detached or changed; native wipe retirement cannot be certified.`);
		}
		Reflect.apply(FILL, new NativeBytes(buffer), [0]);
	}
	async stage(run: (accept: (frame: ImageDevelopFrameStageInput) => void) => Promise<void>): Promise<ImageDevelopFramePixels> {
		const staged: { frame?: ImageDevelopFramePixels } = {};
		await run(frame => {
			if (staged.frame) throw new TypeError('Develop stage delivered more than one output.');
			staged.frame = Object.freeze({ descriptor: frame.descriptor, pixels: this.copy(frame.pixels) });
		});
		if (!staged.frame) throw new Error('Develop stage produced no frame.');
		return staged.frame;
	}
	async run<Result>(work: () => Result | Promise<Result>, order: () => readonly (ArrayBuffer | undefined)[]): Promise<Result> {
		let outcome: { value: Result } | { error: unknown };
		try { outcome = { value: await work() }; } catch (error) { outcome = { error }; }
		const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
		const buffers = new Set([...order(), ...this.#backings.keys()]);
		for (const buffer of buffers) {
			if (!buffer || !this.#backings.has(buffer)) continue;
			try { this.retire(buffer); } catch (error) { append(failures, error); }
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Develop operation and native backing cleanup failed.', { cause: failures[0] });
		if ('value' in outcome) return outcome.value;
		throw new Error('Develop retirement has no operation outcome.');
	}
}

/** Preserve a primary failure while still attempting retirement of the rejected stage. */
export function retireImageDevelopFrameFailureV1(owner: ImageDevelopFrameOwnedPixelsV1, buffer: ArrayBuffer, primary: unknown): never {
	let failure: Readonly<{ error: unknown }> | undefined;
	try { owner.retire(buffer); } catch (cleanup) { failure = { error: cleanup }; }
	if (failure && !Object.is(primary, failure.error)) {
		throw new AggregateError([primary, failure.error], 'Develop stage and native cleanup failed.', { cause: primary });
	}
	throw primary;
}

function append(failures: unknown[], error: unknown): void {
	if (!failures.some(reason => Object.is(reason, error))) failures.push(error);
}
