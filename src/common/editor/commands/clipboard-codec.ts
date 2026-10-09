/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoKeyframeCurves } from '../video-keyframe-curves.ts';
import { normalizeAudioEditorClipboardDescriptorCore } from './clipboard-codec-core.ts';
export { collectAudioEditorClipboardSourceIds, clipboardRequiresTimelineAnnotationCapability } from './clipboard-codec-core.ts';
export const AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION = 6;

const OWNER = Object.freeze({ version: 6 as const, normalizeKeyframes: normalizeVideoKeyframeCurves });
/** The existing named owner retains exact descriptor1–6 admission. */
export function normalizeAudioEditorClipboardDescriptor(value: unknown) {
	return normalizeAudioEditorClipboardDescriptorCore(value, OWNER);
}
