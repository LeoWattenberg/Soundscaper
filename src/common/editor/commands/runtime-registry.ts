/* SPDX-License-Identifier: AGPL-3.0-only */

import { createClipRangeClipboardRuntimeHandlers } from './clip-range-clipboard-runtime.js';
import { createEffectsVideoRuntimeHandlers } from './effects-video-runtime.js';
import { createProjectSourceBinRuntimeHandlers } from './project-source-bin-runtime.js';
import {
	defineEditorCommandHandlerRegistry,
} from './registry.ts';
import { createTrackMixerLabelRuntimeHandlers } from './track-mixer-label-runtime.js';
import type {
	AudioEditorCommand,
	EditorCommandHandlerRegistry,
	EditorCommandProject,
} from './protocol.ts';

export type ChildCommandDispatcher = (
	project: EditorCommandProject,
	command: AudioEditorCommand,
) => void;

export function createEditorCommandRuntime(
	dispatchChild: ChildCommandDispatcher,
): Readonly<EditorCommandHandlerRegistry> {
	return defineEditorCommandHandlerRegistry({
		projectSourceBin: createProjectSourceBinRuntimeHandlers(dispatchChild),
		trackMixerLabel: createTrackMixerLabelRuntimeHandlers(),
		clipRangeClipboard: createClipRangeClipboardRuntimeHandlers(),
		effectsVideo: createEffectsVideoRuntimeHandlers(),
	});
}
