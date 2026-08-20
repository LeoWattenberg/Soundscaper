/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClip,
	createAudioMaster,
	createAudioMixerBus,
	createAudioSource,
	createAudioTrack,
} from '../project-media-factory.ts';
import type { EngineMixerRoute, EngineProject } from './types.ts';

type DataObject = Readonly<object>;

export interface AudioPreviewProjectOptions {
	readonly title?: string;
	readonly sampleRate: number;
	readonly masterChannels?: number;
	readonly sources: readonly DataObject[];
	readonly clips: readonly DataObject[];
	readonly tracks: readonly DataObject[];
	readonly master?: DataObject;
	readonly mixer?: Readonly<{
		readonly groups?: readonly DataObject[];
		readonly sends?: readonly DataObject[];
		readonly routes?: Readonly<Record<string, EngineMixerRoute>>;
	}>;
}

/**
 * Build an audio-only engine model for audition and render work. This object is
 * deliberately schema-less: it is transient engine input, never a saved project.
 */
export function createAudioPreviewProject(
	options: AudioPreviewProjectOptions,
): EngineProject {
	const sampleRate = positiveSafeInteger(options.sampleRate, 'preview project sampleRate');
	const masterChannels = positiveSafeInteger(
		options.masterChannels ?? 2,
		'preview project masterChannels',
	);
	const groups = (options.mixer?.groups ?? []).map((bus, index) => (
		createAudioMixerBus(bus, 'group', index)
	));
	const sends = (options.mixer?.sends ?? []).map((bus, index) => (
		createAudioMixerBus(bus, 'send', index)
	));
	return {
		title: String(options.title ?? 'Audio preview'),
		sampleRate,
		masterChannels,
		sources: options.sources.map((source) => createAudioSource({ ...source, kind: 'audio' })),
		clips: options.clips.map((clip) => createAudioClip({ ...clip, kind: 'audio' })),
		tracks: options.tracks.map((track) => createAudioTrack({ ...track, type: 'audio' }, sampleRate)),
		master: createAudioMaster(options.master),
		mixer: {
			groups,
			sends,
			routes: clone(options.mixer?.routes ?? {}),
		},
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
	};
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
