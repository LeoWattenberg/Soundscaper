/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2 } from '../../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3 } from '../../../common/editor/imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoDevelopClipboardV1, type PhotoDevelopClipboardV1 } from '../photo-develop-clipboard.ts';
import type { PhotoDevelopClipboardV2 } from '../photo-develop-clipboard-v2.ts';
import type { PhotoDevelopClipboardV3 } from '../photo-develop-clipboard-v3.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../../catalog/types.ts';
import { field, oneOf, record } from '../../catalog/value-validation.ts';

type Profile = 'legacy2' | 'current3';
type Packet = PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2 | PhotoDevelopClipboardV3;

export function createPhotoDevelopClipboardForProfileV1(profile: 'legacy2', value: unknown): PhotoDevelopClipboardV2;
export function createPhotoDevelopClipboardForProfileV1(profile: 'current3', value: unknown): PhotoDevelopClipboardV3;
export function createPhotoDevelopClipboardForProfileV1(profile: Profile, value: unknown): PhotoDevelopClipboardV2 | PhotoDevelopClipboardV3 {
	assertProfile(profile);
	const develop = profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(value) : normalizeImageDevelopStateV3(value);
	if (develop.masks.some(mask => mask.inputs.length > 0)) throw new RangeError('External mask media requires an authenticated clipboard adapter.');
	if (develop.processVersion !== 3) {
		const result: PhotoDevelopClipboardV2 = Object.freeze({ schemaFamily: 'lightscaper', schemaVersion: 2,
			kind: 'photo-develop-clipboard', develop });
		assertPhotoDevelopClipboardBytesV1(JSON.stringify(result)); return result;
	}
	const result: PhotoDevelopClipboardV3 = Object.freeze({ schemaFamily: 'lightscaper', schemaVersion: 3,
		kind: 'photo-develop-clipboard', develop });
	assertPhotoDevelopClipboardBytesV1(JSON.stringify(result)); return result;
}

export function createPhotoDevelopClipboardCurrentForProfileV1(value: unknown): PhotoDevelopClipboardV2 | PhotoDevelopClipboardV3 {
	const develop = normalizeImageDevelopStateCurrentV1(value);
	return develop.processVersion === 3 ? createPhotoDevelopClipboardForProfileV1('current3', develop) : createPhotoDevelopClipboardForProfileV1('legacy2', develop);
}

export function normalizePhotoDevelopClipboardForProfileV1(profile: 'legacy2', value: unknown): PhotoDevelopClipboardV2;
export function normalizePhotoDevelopClipboardForProfileV1(profile: 'current3', value: unknown): PhotoDevelopClipboardV3;
export function normalizePhotoDevelopClipboardForProfileV1(profile: Profile, value: unknown): PhotoDevelopClipboardV2 | PhotoDevelopClipboardV3 {
	assertProfile(profile);
	const input = record(value, 'photo develop clipboard', ['schemaFamily', 'schemaVersion', 'kind', 'develop']);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : 3)) {
		throw new RangeError('Unsupported photo clipboard version.');
	}
	oneOf(field(input, 'kind'), ['photo-develop-clipboard'] as const, 'photo clipboard kind');
	return profile === 'legacy2' ? createPhotoDevelopClipboardForProfileV1('legacy2', field(input, 'develop'))
		: createPhotoDevelopClipboardForProfileV1('current3', field(input, 'develop'));
}

export function normalizePhotoDevelopClipboardCurrentForProfileV1(profile: 'legacy2', value: unknown): PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2;
export function normalizePhotoDevelopClipboardCurrentForProfileV1(profile: 'current3', value: unknown): Packet;
export function normalizePhotoDevelopClipboardCurrentForProfileV1(profile: Profile, value: unknown): Packet {
	assertProfile(profile);
	const input = record(value, 'photo develop clipboard', ['schemaFamily', 'schemaVersion', 'kind', 'develop']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizePhotoDevelopClipboardV1(input);
	if (version === 2) return normalizePhotoDevelopClipboardForProfileV1('legacy2', input);
	if (profile === 'current3' && version === 3) return normalizePhotoDevelopClipboardForProfileV1('current3', input);
	throw new RangeError('Unsupported photo clipboard version.');
}

export function readPhotoDevelopClipboardJsonV1(value: unknown): unknown {
	if (typeof value !== 'string') throw new TypeError('Photo develop clipboard requires JSON text.');
	assertPhotoDevelopClipboardBytesV1(value); return JSON.parse(value) as unknown;
}
function assertPhotoDevelopClipboardBytesV1(value: string): void {
	if (value.length > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes
		|| new TextEncoder().encode(value).byteLength > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) {
		throw new RangeError('Photo develop clipboard exceeds its byte budget.');
	}
}

function assertProfile(value: unknown): asserts value is Profile {
	if (value !== 'legacy2' && value !== 'current3') throw new RangeError('Unsupported fixed Develop profile.');
}
