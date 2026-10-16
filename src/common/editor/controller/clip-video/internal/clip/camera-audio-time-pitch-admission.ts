/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../../i18n/presentation-message.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';

/** Independent audio pitch is safe; changing a camera's audio extent requires
 * the existing explicit Unlink command rather than silently retiming picture. */
export function assertCameraAudioDurationChange(
	project: ClipTransformProject,
	clip: ClipTransformClip,
	durationFrames: number,
	copy: object,
): void {
	if (durationFrames === clip.durationFrames || !clip.avLinkId) return;
	if (project.clips.some(peer => peer.kind === 'video' && peer.avLinkId === clip.avLinkId)) {
		throw createLocalizedError(RangeError, copy, 'clipLinkedAudioDurationRequiresUnlink');
	}
}
