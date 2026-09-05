/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDefaultMixerGraphV21 } from '../mixer-graph-v21.ts';
import {
	createAudioClip,
	createAudioMaster,
	createAudioSource,
	createAudioTrack,
} from '../project-media-factory.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import type { EngineProject } from './types.ts';

type DataObject = Readonly<object>;

export interface AudioPreviewProjectOptions {
	readonly title?: string;
	readonly sampleRate: number;
	readonly masterChannels?: number;
	readonly sources: readonly DataObject[];
	readonly clips: readonly DataObject[];
	readonly tracks: readonly DataObject[];
	readonly master?: DataObject;
}

/**
 * Build an audio-only engine model for audition and render work. This object is
 * deliberately schema-less: it is transient engine input, never a saved project.
 *
 * It does carry the production routing surface — a default V21 mixer graph over
 * its own tracks, and an empty automation-lane list — because a preview, an
 * effect-macro step and the take-comp flatten that commits audio must compile
 * through the same graph builder as the playback they stand in for. Routing is
 * engine input; the schema tuple is document identity, and this is not a
 * document.
 */
export function createAudioPreviewProject(
	options: AudioPreviewProjectOptions,
): EngineProject {
	const sampleRate = positiveSafeInteger(options.sampleRate, 'preview project sampleRate');
	const masterChannels = positiveSafeInteger(
		options.masterChannels ?? 2,
		'preview project masterChannels',
	);
	const media = {
		title: String(options.title ?? 'Audio preview'),
		sampleRate,
		masterChannels,
		sources: options.sources.map((source) => createAudioSource({ ...source, kind: 'audio' })),
		clips: options.clips.map((clip) => createAudioClip({ ...clip, kind: 'audio' })),
		tracks: options.tracks.map((track) => createAudioTrack({ ...track, type: 'audio' }, sampleRate)),
		master: createAudioMaster(options.master),
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
	};
	const trackWidths = resolveTerminalChannelWidths(media as never, masterChannels).tracks;
	return {
		...media,
		automationLanes: [],
		mixer: createDefaultMixerGraphV21(
			media.tracks.map((track) => {
				const id = String((track as Readonly<{ id?: unknown }>).id);
				return { id, channelCount: trackWidths.get(id) ?? masterChannels };
			}),
			masterChannels,
		),
	};
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
