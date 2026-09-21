/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_CARRIER_MIME =
	'video/x-soundscaper-image-sequence' as const;

/** Give only the inherited keyed carrier a canonical video MIME for native sequence packs. */
export function framescaperNativeRenderCarrierProjectNativeMedia(
	project: FramescaperProjectNativeMedia,
): FramescaperProjectFinishing {
	const sequenceSourceIds = new Set(project.sources.flatMap((source) => (
		source.kind === 'video' && source.imageSequence !== null ? [source.id] : []
	)));
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(project);
	if (sequenceSourceIds.size === 0) return foundation;
	const remaining = new Set(sequenceSourceIds);
	const sources = (foundation.sources as unknown as readonly Readonly<Record<string, unknown>>[])
		.map((source) => {
			const sourceId = String(source.id);
			if (!sequenceSourceIds.has(sourceId)) return source;
			if (source.kind !== 'video') {
				throw new TypeError(`Native sequence carrier source ${sourceId} is not video.`);
			}
			remaining.delete(sourceId);
			return Object.freeze({ ...source, mimeType: FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_CARRIER_MIME });
		});
	if (remaining.size !== 0) {
		throw new ReferenceError(`Native sequence carrier source ${[...remaining][0]!} has no V13 foundation.`);
	}
	return { ...foundation, sources } as unknown as FramescaperProjectFinishing;
}
