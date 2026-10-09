/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneVideoEffects } from '../video-effects.js';
import { normalizeAudioEditorClipboardDescriptor } from './clipboard-codec.ts';
import { cloneVideoKeyframeCarrierFields } from './video-keyframe-carrier.ts';
import { createClipboardRuntimeOwner } from './clipboard-runtime-core.js';

const LEGACY = createClipboardRuntimeOwner(Object.freeze({ version: 6,
	normalizeClipboard: normalizeAudioEditorClipboardDescriptor, cloneEffects: cloneVideoEffects,
	cloneKeyframes: cloneVideoKeyframeCarrierFields }));
export const { createClipboardDescriptor, preparePasteCommand, prepareCut, pasteClipboard } = LEGACY;
