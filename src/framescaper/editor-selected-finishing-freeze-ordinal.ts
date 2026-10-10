/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveVideoRetimeExactOutputOrdinal, resolveVideoRetimeExactPictureOrdinal,
} from '../common/editor/video-retime-exact-ordinal-authority.ts';
import type { VideoRetimeExactPictureOrdinal } from '../common/editor/video-retime-exact-ordinal-oracle.ts';
import { createRegisteredVideoRetimeWebCorePreviewResolver } from '../common/editor/video-retime-web-core-preview.ts';

/** The caller supplies the selected product's runtime view, retaining native visual bystanders. */
export function resolveFramescaperSelectedFreezeSourceOrdinalFinishing(
	runtimeProject: unknown,
	clipId: string,
	sourceId: string,
	timelineSample: number,
): number {
	const resolver = createRegisteredVideoRetimeWebCorePreviewResolver(runtimeProject);
	return resolveVideoRetimeExactPictureOrdinal(resolver.authority, {
		outputOrdinal: timelineSample, clipId, sourceId,
	}).sourceOrdinal;
}

/** Select the displayed camera by the authority's authored clip identity. */
export function resolveFramescaperSelectedFreezePictureFinishing(
	runtimeProject: unknown,
	clipId: string,
	timelineSample: number,
): VideoRetimeExactPictureOrdinal {
	const resolver = createRegisteredVideoRetimeWebCorePreviewResolver(runtimeProject);
	const frame = resolveVideoRetimeExactOutputOrdinal(resolver.authority, timelineSample);
	const pictures = frame.pictures.filter(picture => picture.clipId === clipId);
	if (pictures.length !== 1) {
		throw new ReferenceError('An exact freeze requires one authority-owned clip picture.');
	}
	return resolveVideoRetimeExactPictureOrdinal(resolver.authority, {
		outputOrdinal: timelineSample, clipId, sourceId: pictures[0]!.sourceId,
	});
}
