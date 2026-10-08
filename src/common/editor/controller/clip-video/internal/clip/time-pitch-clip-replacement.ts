/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddClipCommand } from '../../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';

/** Temporarily isolate one replacement from removal's related-clip expansion. */
export function timePitchClipReplacementCommands(
	project: ClipTransformProject,
	trackId: string,
	clip: ClipTransformClip,
	replacement: ClipTransformClip,
): AudioEditorCommand[] {
	const groupId = typeof clip.groupId === 'string' && clip.groupId ? clip.groupId : null;
	const avLinkId = typeof clip.avLinkId === 'string' && clip.avLinkId ? clip.avLinkId : null;
	const video = avLinkId ? project.clips.find(candidate => candidate.id !== clip.id
		&& candidate.kind === 'video' && candidate.avLinkId === avLinkId) : null;
	if (avLinkId && !video) throw new RangeError(`A/V link ${avLinkId} is incomplete.`);
	return [
		...(groupId ? [{ type: 'clip/ungroup' as const, clipIds: [clip.id] }] : []),
		...(avLinkId ? [{ type: 'clip/unlink-av' as const, clipId: clip.id }] : []),
		{ type: 'clip/remove', clipId: clip.id },
		createAddClipCommand(trackId, { ...replacement, ...(avLinkId ? { avLinkId: null } : {}) }),
		...(avLinkId && video ? [{ type: 'clip/link-av' as const,
			videoClipId: video.id, audioClipId: clip.id, avLinkId }] : []),
	];
}
