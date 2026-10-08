/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveVideoRetimeExactPictureOrdinal } from '../common/editor/video-retime-exact-ordinal-authority.ts';
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
