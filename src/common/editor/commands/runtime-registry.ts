/* SPDX-License-Identifier: AGPL-3.0-only */

import { createClipRangeClipboardRuntimeHandlers } from './clip-range-clipboard-runtime.js';
import { createAudioWarpRuntimeHandlers } from './audio-warp-runtime.ts';
import { createAudioProductionRuntimeHandlers } from './audio-production.ts';
import { createMasteringSequenceRuntimeHandlers } from './mastering-sequence-runtime.ts';
import { createEffectsVideoRuntimeHandlers } from './effects-video-runtime.js';
import { createProjectSourceBinRuntimeHandlers } from './project-source-bin-runtime.js';
import { createSequenceTimingRuntimeHandlers } from './sequence-timing-runtime.ts';
import { createTempoSignatureRuntimeHandlers } from './tempo-signature-runtime.ts';
import { createTakeCompRuntimeHandlers } from './take-comp-runtime.ts';
import { createTimelineAnnotationRuntimeHandlers } from './timeline-annotation-runtime.ts';
import { createVideoCompositionRuntimeHandlers } from './video-composition-runtime.ts';
import { createVideoKeyframesRuntimeHandlers } from './video-keyframes-runtime.ts';
import {
	defineEditorCommandHandlerRegistry,
} from './registry.ts';
import { createTrackFolderRuntimeHandlers } from './track-folder-runtime.ts';
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
		tempoSignature: createTempoSignatureRuntimeHandlers(),
		sequenceTiming: createSequenceTimingRuntimeHandlers(),
		trackMixerLabel: createTrackMixerLabelRuntimeHandlers(),
		trackFolder: createTrackFolderRuntimeHandlers(),
		takeComp: createTakeCompRuntimeHandlers(dispatchChild),
		audioWarp: createAudioWarpRuntimeHandlers(),
		clipRangeClipboard: createClipRangeClipboardRuntimeHandlers(),
		effectsVideo: createEffectsVideoRuntimeHandlers(),
		timelineAnnotation: createTimelineAnnotationRuntimeHandlers(),
		videoComposition: createVideoCompositionRuntimeHandlers(),
		videoKeyframes: createVideoKeyframesRuntimeHandlers(),
		audioProduction: createAudioProductionRuntimeHandlers(),
		masteringSequence: createMasteringSequenceRuntimeHandlers(),
	});
}
