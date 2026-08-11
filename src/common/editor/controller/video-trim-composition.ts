/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import type { VideoEdgeTrimFeedbackCopy } from './video-edge-trim-feedback.ts';
import { createVideoEdgeTrimResultReporter } from './video-edge-trim-feedback.ts';
import { createVideoEdgeTrimService, type VideoEdgeTrimService } from './video-edge-trim-service.ts';
import type { VideoRollRippleTrimFeedbackCopy } from './video-roll-ripple-trim-feedback.ts';
import { createVideoRollRippleTrimResultReporter } from './video-roll-ripple-trim-feedback.ts';
import {
	createVideoRollRippleTrimService,
	type VideoRollRippleTrimService,
} from './video-roll-ripple-trim-service.ts';

export interface VideoTrimCompositionCopy
	extends VideoEdgeTrimFeedbackCopy, VideoRollRippleTrimFeedbackCopy {}

export interface VideoTrimCompositionDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly copy: VideoTrimCompositionCopy;
	getProject(): unknown;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	label(sample: number, sequenceId?: string): string;
	setStatus(message: string, state: 'info' | 'success'): void;
}

export interface VideoTrimServices {
	readonly edge: Readonly<VideoEdgeTrimService>;
	readonly rollRipple: Readonly<VideoRollRippleTrimService>;
}

/** Compose both frame-canonical trim services without growing the application root. */
export function createVideoTrimServices(
	dependencies: VideoTrimCompositionDependencies,
): Readonly<VideoTrimServices> {
	const common = {
		lifetime: dependencies.lifetime,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
	};
	return Object.freeze({
		edge: createVideoEdgeTrimService({
			...common,
			reportResult: createVideoEdgeTrimResultReporter(dependencies),
		}),
		rollRipple: createVideoRollRippleTrimService({
			...common,
			reportResult: createVideoRollRippleTrimResultReporter(dependencies),
		}),
	});
}
