/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectV9 } from '../project-v9.ts';
import { collectProjectSourceIds } from '../retention.js';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import { scapeAudioSourceLayout, type ScapeAudioSource } from '../scape-archive-media.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';

const MAXIMUM_REACHABLE_SOURCE_COUNT = SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2;

export interface ManagedAudioSource extends ScapeAudioSource, Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly sampleRate: number;
}

export interface ManagedVideoSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'video';
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec?: string;
	readonly hasAudio: boolean;
}

export type ManagedSource = ManagedAudioSource | ManagedVideoSource;

export function reachableProjectSources(project: AudioEditorProjectV9): readonly ManagedSource[] {
	const sourceIds = collectProjectSourceIds(project);
	if (sourceIds.size > MAXIMUM_REACHABLE_SOURCE_COUNT) {
		throw new RangeError('Desktop shared project source references exceed the managed handoff limit.');
	}
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	return Object.freeze([...sourceIds].map((sourceId) => {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Desktop shared project source ${sourceId} is missing.`);
		return source as ManagedSource;
	}));
}

export function reachableAudioSources(project: AudioEditorProjectV9): readonly ManagedAudioSource[] {
	return Object.freeze(reachableProjectSources(project).filter(
		(source): source is ManagedAudioSource => source.kind === 'audio',
	));
}

export function preflightAudioTransfer(
	sources: readonly ManagedAudioSource[],
): readonly ManagedAudioSource[] {
	const byteBudget = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes);
	const chunkBudget = new ScapeAudioChunkBudget();
	const admittedBindings = new Set<string>();
	const admitted: ManagedAudioSource[] = [];
	for (const source of sources) {
		const binding = managedSourceBinding(source);
		if (admittedBindings.has(binding)) continue;
		admittedBindings.add(binding);
		const layout = scapeAudioSourceLayout(source);
		byteBudget.consume(layout.archiveBytes, source.id);
		chunkBudget.consumeMany(layout.chunkCount, source.id);
		admitted.push(source);
	}
	return Object.freeze(admitted);
}

export function managedSourceBinding(source: ManagedSource): string {
	return source.kind === 'audio'
		? JSON.stringify([
			source.storageKey,
			source.frameCount,
			source.channelCount,
			source.sampleRate,
			source.originalSampleRate,
			source.sampleFormat,
			source.chunkFrames,
		])
		: JSON.stringify([
			source.storageKey,
			source.mimeType,
			source.frameCount,
			source.sampleRate,
			source.width,
			source.height,
			source.frameRate,
			source.videoCodec,
			source.audioCodec,
			source.hasAudio,
		]);
}
