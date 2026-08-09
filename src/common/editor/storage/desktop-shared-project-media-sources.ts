/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectCurrent } from '../project-current.ts';
import { collectProjectSourceIds } from '../retention.js';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import { scapeAudioSourceLayout, type ScapeAudioSource } from '../scape-archive-media.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';
import {
	normalizeVideoTimingAssetReference,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../video-timing-asset.ts';

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
	readonly frameCount?: number;
	readonly sampleFrameCount?: number;
	readonly sourceFrameCount?: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number | Readonly<{ readonly num: number; readonly den: number }>;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
	readonly timingAsset?: Readonly<Record<string, unknown>> | null;
	readonly contentSha256?: string;
}

export type ManagedSource = ManagedAudioSource | ManagedVideoSource;

export interface ManagedTimingAsset extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'video-timing';
	readonly storageKey: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceSha256: string;
	readonly frameCount: number;
	readonly timescale: number;
	readonly finalFrameDurationTicks: string;
	readonly encoding: string;
	readonly mimeType: typeof VIDEO_TIMING_ASSET_MIME_TYPE;
}

export type ManagedTransfer = ManagedSource | ManagedTimingAsset;

export function reachableProjectSources(project: AudioEditorProjectCurrent): readonly ManagedSource[] {
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

export function reachableAudioSources(project: AudioEditorProjectCurrent): readonly ManagedAudioSource[] {
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

export function managedSourceBinding(source: ManagedTransfer): string {
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
		: source.kind === 'video' ? JSON.stringify([
			source.storageKey,
			source.mimeType,
			managedVideoSampleFrameCount(source),
			managedVideoSourceFrameCount(source),
			source.sampleRate,
			source.width,
			source.height,
			managedVideoFrameRate(source).num,
			managedVideoFrameRate(source).den,
			source.videoCodec,
			source.audioCodec,
			source.hasAudio,
			source.contentSha256 ?? null,
			source.timingAsset ?? null,
		]) : JSON.stringify([
			source.storageKey, source.byteLength, source.sha256,
			source.frameCount, source.timescale, source.finalFrameDurationTicks, source.encoding,
		]);
}

function managedVideoSampleFrameCount(source: ManagedVideoSource): number {
	return source.sampleFrameCount ?? source.frameCount ?? Number.NaN;
}

function managedVideoSourceFrameCount(source: ManagedVideoSource): number {
	return source.sourceFrameCount ?? Math.ceil(
		managedVideoSampleFrameCount(source) * managedVideoFrameRate(source).num
		/ (source.sampleRate * managedVideoFrameRate(source).den),
	);
}

function managedVideoFrameRate(
	source: ManagedVideoSource,
): Readonly<{ readonly num: number; readonly den: number }> {
	return typeof source.frameRate === 'number'
		? { num: source.frameRate, den: 1 }
		: source.frameRate;
}

export function managedTimingAssetForSource(source: ManagedSource): ManagedTimingAsset | null {
	if (source.kind !== 'video' || source.timingAsset == null) return null;
	const reference = normalizeVideoTimingAssetReference(source.timingAsset);
	return Object.freeze({
		id: source.id,
		kind: 'video-timing',
		storageKey: reference.storageKey,
		byteLength: reference.byteLength,
		sha256: reference.sha256,
		sourceSha256: reference.sourceSha256,
		frameCount: reference.frameCount,
		timescale: reference.timescale,
		finalFrameDurationTicks: reference.finalFrameDurationTicks,
		encoding: reference.encoding,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
	});
}
