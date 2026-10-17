/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NativeWheelAxisSample {
	readonly trusted: boolean;
	readonly buttons: number;
	readonly clientX: number;
	readonly clientY: number;
	readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}

/** Exact same-event native geometry proof for the literal center/right/up drags. */
export function requireNativeWheelAxis(sample: NativeWheelAxisSample, axis: 'center' | 'horizontal' | 'vertical'): void {
	const { left, top, width, height } = sample.rect;
	if (![left, top, width, height, sample.clientX, sample.clientY].every(Number.isFinite) || width <= 0 || height <= 0) throw Error('Native wheel geometry must be finite and positive.');
	const x = left + width / 2, y = top + height / 2;
	if (!Number.isInteger(x) || !Number.isInteger(y)) throw Error('The literal wheel gesture requires an integral center.');
	if (!sample.trusted) throw Error('The wheel gesture must be a trusted native event.');
	if (sample.buttons !== 1) throw Error('The wheel gesture must have its active native button.');
	if (axis === 'center' && (sample.clientX !== x || sample.clientY !== y)) throw Error('Native wheel center coordinates differ.');
	if (axis === 'horizontal' && (sample.clientX !== x + width || sample.clientY !== y)) throw Error('Native wheel horizontal axis coordinates differ.');
	if (axis === 'vertical' && (sample.clientX !== x || sample.clientY !== y - height)) throw Error('Native wheel vertical axis coordinates differ.');
}
