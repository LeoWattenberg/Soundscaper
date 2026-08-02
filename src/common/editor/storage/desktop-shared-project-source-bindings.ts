/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import { collectProjectSourceIds } from '../retention.js';

export type CapturedSource = CapturedAudioSource | CapturedVideoSource;

export interface CapturedSourceBase {
	readonly id: string;
	readonly kind: 'audio' | 'video';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
}

export interface CapturedAudioSource extends CapturedSourceBase {
	readonly kind: 'audio';
	readonly channelCount: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
}

export interface CapturedVideoSource extends CapturedSourceBase {
	readonly kind: 'video';
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
}

/** A shared source has no explicitly bound, completely readable recipient-local payload. */
export class DesktopSharedProjectSourceUnavailableError extends Error {
	readonly projectId: string;
	readonly sourceId: string;
	readonly sourceKind: 'audio' | 'video';

	constructor(
		projectId: string,
		sourceId: string,
		sourceKind: 'audio' | 'video',
		cause?: unknown,
	) {
		super(
			`Recipient-local ${sourceKind} source ${sourceId} is unavailable for desktop shared project ${projectId}.`,
			cause === undefined ? undefined : { cause },
		);
		this.name = 'DesktopSharedProjectSourceUnavailableError';
		this.projectId = projectId;
		this.sourceId = sourceId;
		this.sourceKind = sourceKind;
	}
}

export function captureReachableSources(project: AudioEditorProjectV9): readonly CapturedSource[] {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	const captured: CapturedSource[] = [];
	for (const sourceId of collectProjectSourceIds(project)) {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Desktop shared project source ${sourceId} is missing.`);
		captured.push(captureSource(source));
	}
	return Object.freeze(captured);
}

export function captureSource(source: Readonly<Record<string, unknown>>): CapturedSource {
	const base = {
		id: source.id as string,
		kind: source.kind as 'audio' | 'video',
		storageKey: source.storageKey as string,
		mimeType: source.mimeType as string,
		frameCount: source.frameCount as number,
		sampleRate: source.sampleRate as number,
	};
	if (base.kind === 'audio') {
		return Object.freeze({
			...base,
			kind: 'audio',
			channelCount: source.channelCount as number,
			originalSampleRate: source.originalSampleRate as number,
			sampleFormat: source.sampleFormat as string,
			chunkFrames: source.chunkFrames as number,
		});
	}
	return Object.freeze({
		...base,
		kind: 'video',
		width: source.width as number,
		height: source.height as number,
		frameRate: source.frameRate as number,
		videoCodec: source.videoCodec as string,
		audioCodec: source.audioCodec as string | null,
		hasAudio: source.hasAudio as boolean,
	});
}

export function uniqueStorageBindings(sources: readonly CapturedSource[]): readonly CapturedSource[] {
	const ownerByKey = new Map<string, CapturedSource>();
	const unique: CapturedSource[] = [];
	for (const source of sources) {
		const domainKey = `${source.kind}\u0000${source.storageKey}`;
		const owner = ownerByKey.get(domainKey);
		if (owner) {
			if (!sameStorageBinding(owner, source)) {
				throw new RangeError(`Desktop shared project sources ${owner.id} and ${source.id} conflict for one storage key.`);
			}
			continue;
		}
		ownerByKey.set(domainKey, source);
		unique.push(source);
	}
	return Object.freeze(unique);
}

export function sameStorageBinding(left: CapturedSource, right: CapturedSource): boolean {
	if (left.kind !== right.kind) return false;
	const leftRecord = left as unknown as Readonly<Record<string, unknown>>;
	const rightRecord = right as unknown as Readonly<Record<string, unknown>>;
	const leftKeys = Object.keys(leftRecord).filter((key) => key !== 'id');
	const rightKeys = Object.keys(rightRecord).filter((key) => key !== 'id');
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

export function assertPriorBindings(
	projectId: string,
	sources: readonly CapturedSource[],
	priorLocalProject: unknown,
	trustedSourceIds: ReadonlySet<string> | undefined,
): void {
	const unavailable = (source: CapturedSource, cause?: unknown): never => {
		throw new DesktopSharedProjectSourceUnavailableError(projectId, source.id, source.kind, cause);
	};
	const untrusted = sources.filter(({ id }) => !trustedSourceIds?.has(id));
	if (!untrusted.length) return;
	if (priorLocalProject == null) unavailable(untrusted[0] as CapturedSource);
	try {
		validateAudioEditorProjectV9(priorLocalProject);
	} catch (cause) {
		unavailable(untrusted[0] as CapturedSource, cause);
	}
	const prior = priorLocalProject as AudioEditorProjectV9;
	if (prior.id !== projectId) unavailable(untrusted[0] as CapturedSource);
	const priorById = new Map(prior.sources.map((source) => [String(source.id), captureSource(source)]));
	for (const source of untrusted) {
		const bound = priorById.get(source.id);
		if (!bound || !sameRecord(source, bound)) unavailable(source);
	}
}

export function sameRecord(left: object, right: object): boolean {
	const leftRecord = left as Readonly<Record<string, unknown>>;
	const rightRecord = right as Readonly<Record<string, unknown>>;
	const keys = Object.keys(leftRecord);
	if (keys.length !== Object.keys(rightRecord).length) return false;
	return keys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}
