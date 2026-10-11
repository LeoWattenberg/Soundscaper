/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { id } from './imaging/image-develop-value.ts';

export type PhotoDevelopMaskDisplayModeV1 = 'color' | 'grayscale';
/** Presentation choice only; runtime mask requests retain their two-ID contract. */
export interface PhotoDevelopMaskDisplaySelectionV1 {
	readonly maskId: string;
	readonly effectId: string;
	readonly displayMode?: PhotoDevelopMaskDisplayModeV1;
}

export function preparePhotoDevelopMaskDisplayModeV1(value: unknown): PhotoDevelopMaskDisplayModeV1 {
	if (value === undefined) return 'color';
	if (value !== 'color' && value !== 'grayscale') throw new TypeError('Unsupported mask display mode.');
	return value;
}

/** Closed own-data capture precedes recipe publication or preview awaits. */
export function preparePhotoDevelopMaskDisplaySelectionV1(value: unknown): Readonly<PhotoDevelopMaskDisplaySelectionV1 & { displayMode: PhotoDevelopMaskDisplayModeV1 }> {
	const input = record(value, 'Photo mask display selection', ['maskId', 'effectId', 'displayMode'], ['maskId', 'effectId']);
	return Object.freeze({ maskId: id(field(input, 'maskId', 'Photo mask display selection'), 'mask display mask ID'),
		effectId: id(field(input, 'effectId', 'Photo mask display selection'), 'mask display effect ID'),
		displayMode: preparePhotoDevelopMaskDisplayModeV1(Object.hasOwn(input, 'displayMode') ? field(input, 'displayMode', 'Photo mask display selection') : undefined) });
}
