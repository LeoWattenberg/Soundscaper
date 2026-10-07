/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../../src/common/editor/project-current.ts';
import { projectForCommandConsumers } from '../../src/common/editor/project-current-runtime.ts';
import { brandRuntimeProjectProjection } from '../../src/common/editor/runtime-clip-projection.ts';

export interface CommandClip extends Record<string, unknown> {
	id: string;
	sourceId: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartFrame: number;
	sourceDurationFrames: number;
	avLinkId?: string | null;
	groupId?: string | null;
}
export interface CommandTrack extends Record<string, unknown> { id: string; clipIds: string[] }
export interface CommandFixture extends Record<string, unknown> {
	clips: CommandClip[];
	tracks: CommandTrack[];
	sources: (Record<string, unknown> & { id: string })[];
	projectBin: { clips: CommandClip[] };
}

export function commandFixture(count = 120, tracks = 1): CommandFixture {
	const clips = Array.from({ length: count }, (_, index) => createAudioClip({
		id: `clip-${String(index)}`, sourceId: 'source', timelineStartFrame: index * 100,
		sourceStartFrame: index * 20, sourceDurationFrames: 20, durationFrames: 20,
	}));
	const owners = Array.from({ length: tracks }, (_, index) => createAudioTrack({
		id: `track-${String(index)}`, clipIds: clips.filter((_, ordinal) => ordinal % tracks === index).map(clip => clip.id),
	}));
	const project = createCurrentAudioEditorProject({
		id: 'round3-command-project', now: '2026-10-07T00:00:00.000Z',
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: count * 100 + 1000, channelCount: 1, sampleRate: 48_000 })],
		clips, tracks: owners,
	});
	return brandRuntimeProjectProjection(structuredClone(projectForCommandConsumers(project))) as unknown as CommandFixture;
}

export function countPropertyReads<T extends object, Key extends keyof T>(items: T[], key: Key): () => number {
	let reads = 0;
	for (let index = 0; index < items.length; index += 1) {
		items[index] = new Proxy(items[index]!, {
			get: (item, property, receiver) => {
				if (property === key) reads += 1;
				return Reflect.get(item, property, receiver) as unknown;
			},
		});
	}
	return () => reads;
}

export function countArrayReads<Item>(items: Item[]): { array: Item[]; reads: () => number } {
	let reads = 0;
	return {
		array: new Proxy(items, { get: (array, key, receiver) => {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
			return Reflect.get(array, key, receiver) as unknown;
		} }),
		reads: () => reads,
	};
}
