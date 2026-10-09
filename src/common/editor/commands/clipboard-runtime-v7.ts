/* SPDX-License-Identifier: AGPL-3.0-only */

import { createClipboardRuntimeOwner } from './clipboard-runtime-core.js';
import { createStableId } from '../stable-id.js';
import { normalizeVideoEffectsV2 } from '../video-effects-v2.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from './clipboard-codec-v7.ts';
import { FRAME_VIDEO_KEYFRAME_CARRIERS_V2 } from './video-keyframe-carrier-v2.ts';
import { isFrameResourceCommandProjectV2 } from './frame-resource-command-carriers-v2.ts';
import type { AudioEditorClipboardPasteCommandV2 } from './clipboard-command-v2.ts';

const CURRENT = createClipboardRuntimeOwner(Object.freeze({ version: 7,
	normalizeClipboard: normalizeAudioEditorClipboardDescriptorV7,
	cloneEffects: (effects: unknown) => normalizeVideoEffectsV2(effects).map(effect => ({ ...effect, params: structuredClone(effect.params) })),
	cloneKeyframes: FRAME_VIDEO_KEYFRAME_CARRIERS_V2.cloneVideoKeyframeCarrierFields,
}));

/** Only a named, fully admitted Frame projection can select current capture.
 * Persisted envelopes or a spread of a projection carry no admission marker. */
export function createClipboardDescriptorV7(project: Parameters<typeof CURRENT.createClipboardDescriptor>[0],
	options: Parameters<typeof CURRENT.createClipboardDescriptor>[1] = {}) {
	assertCurrent(project);
	return CURRENT.createClipboardDescriptor(project, options);
}
export function preparePasteCommandV7(clipboard: unknown,
	options: Parameters<typeof CURRENT.preparePasteCommand>[1] = {}, idFactory = createStableId): AudioEditorClipboardPasteCommandV2 {
	return CURRENT.preparePasteCommand(clipboard, options, idFactory);
}
export function pasteClipboardV7(project: Parameters<typeof CURRENT.pasteClipboard>[0],
	command: Parameters<typeof CURRENT.pasteClipboard>[1]): void {
	assertCurrent(project);
	CURRENT.pasteClipboard(project, command);
}
function assertCurrent(project: unknown): void {
	if (!isFrameResourceCommandProjectV2(project)) throw new TypeError('A fully admitted current Frame clipboard projection is required.');
}
