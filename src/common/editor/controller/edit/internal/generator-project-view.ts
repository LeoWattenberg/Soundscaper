/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from '../../../project-current-runtime.ts';
import type { RuntimePersistedClip } from '../../../runtime-clip-projection.ts';

export interface AudioGeneratorSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
}

export interface AudioGeneratorTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds?: readonly string[];
}

export interface AudioGeneratorClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

export interface AudioGeneratorSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly channelCount?: number;
}

export interface AudioGeneratorDocument extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly title: string;
	readonly sampleRate: number;
	readonly masterChannels?: number;
	readonly selection?: AudioGeneratorSelection | null;
	readonly tracks: readonly AudioGeneratorTrack[];
	readonly clips: readonly (RuntimePersistedClip & Readonly<{ id: string; sourceId: string }>)[];
	readonly sources: readonly AudioGeneratorSource[];
}

export interface AudioGeneratorProject extends AudioGeneratorDocument {
	readonly clips: readonly AudioGeneratorClip[];
}

/** Keep document identity outside this transient view, including when no product hook is installed. */
export function projectForAudioGeneratorCommands(
	project: AudioGeneratorDocument,
	getCommandProject?: () => AudioGeneratorProject,
): AudioGeneratorProject {
	return projectForRuntimeConsumers(getCommandProject?.() ?? project);
}
