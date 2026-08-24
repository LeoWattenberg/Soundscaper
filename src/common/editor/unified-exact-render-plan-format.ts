/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed container/profile normalization shared by unified render generations. */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import type { NativeMediaV14EncodeProfileId } from './native-media-v14-native-dispatch.ts';
import { NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS } from './native-media-v14-support.ts';

export interface UnifiedExactRenderFormat {
	readonly container: 'mp4' | 'webm' | 'mov' | 'mxf' | 'matroska' | 'image2';
	readonly extension: 'mp4' | 'webm' | 'mov' | 'mxf' | 'mkv' | 'png' | 'tiff' | 'exr';
	readonly mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime'
		| 'application/mxf' | 'video/x-matroska' | 'image/png' | 'image/tiff' | 'image/x-exr';
}

const FORMAT_FIELDS = Object.freeze(['container', 'extension', 'mimeType']);

export function normalizeUnifiedExactRenderFormat(
	value: unknown,
	version: number,
): UnifiedExactRenderFormat {
	const record = readClosedDomainRecord(value, 'unified render format', FORMAT_FIELDS);
	const container = field(record, 'container');
	const containers = version === 14 || version === 15
		? ['mp4', 'webm', 'mov', 'mxf', 'matroska', 'image2'] as const
		: ['mp4', 'webm'] as const;
	if (!(containers as readonly unknown[]).includes(container)) {
		throw new RangeError('Unified render container is unsupported.');
	}
	const extension = field(record, 'extension');
	const mimeType = field(record, 'mimeType');
	const canonical = container === 'mov' ? ['mov', 'video/quicktime']
		: container === 'mp4' ? ['mp4', 'video/mp4']
			: container === 'webm' ? ['webm', 'video/webm']
				: container === 'mxf' ? ['mxf', 'application/mxf']
					: container === 'matroska' ? ['mkv', 'video/x-matroska'] : null;
	const image = container === 'image2' && (
		(extension === 'png' && mimeType === 'image/png')
		|| (extension === 'tiff' && mimeType === 'image/tiff')
		|| (extension === 'exr' && mimeType === 'image/x-exr')
	);
	if (!(image || (canonical !== null && extension === canonical[0] && mimeType === canonical[1]))) {
		throw new RangeError('Unified render format metadata is not canonical.');
	}
	return Object.freeze({ container, extension, mimeType }) as UnifiedExactRenderFormat;
}

export function normalizeUnifiedExactRenderDeliveryProfile(
	value: unknown,
): NativeMediaV14EncodeProfileId {
	if (typeof value !== 'string'
		|| !(NATIVE_MEDIA_V14_VIDEO_ENCODE_PROFILE_IDS as readonly string[]).includes(value)) {
		throw new RangeError('Unified V14/V15 delivery profile is outside the closed professional registry.');
	}
	return value as NativeMediaV14EncodeProfileId;
}

function field(record: ClosedDomainRecord, key: string): unknown {
	return readClosedDomainField(record, key, 'unified render format');
}
