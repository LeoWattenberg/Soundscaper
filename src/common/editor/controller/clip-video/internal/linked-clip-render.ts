/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import type { EnginePublicApi } from '../../../engine/public-api.ts';
import { clipSourcePreviewWarpMap, type ClipSourceTimingProject } from '../../../clip-source-timing.ts';
import { audioBufferChannels, type AudioBufferLike } from '../../source/source-audio.ts';
import type { ClipSourcePreviewResources } from './clip-source-preview-service.ts';
import type { ClipTransformClip, ClipTransformProject, ClipTransformSource } from './clip/clip-domain-types.ts';

/** Bake only playback rate, direction and marker timing; clip gain and fades remain authored. */
export async function renderLinkedClipAudio(
	resources: Pick<ClipSourcePreviewResources, 'sourceBuffers' | 'sourceChunkProviders' | 'createEngine'>,
	project: ClipTransformProject,
	clip: ClipTransformClip,
	source: ClipTransformSource,
	signal: AbortSignal,
): Promise<AudioBufferLike> {
	signal.throwIfAborted();
	const channelCount = Number(source.channelCount);
	const preview = createAudioPreviewProject({ sampleRate: project.sampleRate, masterChannels: channelCount,
		sources: [source], tracks: [{ id: 'linked-render', type: 'audio', name: 'Clip', channelCount, clipIds: [clip.id] }],
		clips: [{ ...clip, anchor: 'sample', musicalStartBeat: null, musicalDurationBeats: null, musicalExtent: 'fixedSamples',
			timelineStartFrame: 0, gain: 1, inverted: false, envelope: [], fadeInFrames: 0, fadeOutFrames: 0,
			groupId: null, avLinkId: null, binItemId: null, pitchCents: 0, linkPitchAndTempo: true,
			warpMap: clipSourcePreviewWarpMap(project as unknown as ClipSourceTimingProject, clip,
				{ sampleRate: Number(source.sampleRate), frameCount: Number(source.frameCount) }),
		}],
	});
	const engine = resources.createEngine({ onState: () => {} });
	try {
		if (!('renderMix' in engine) || typeof engine.renderMix !== 'function') throw new Error('Clip rendering requires an offline audio engine.');
		engine.loadProject(preview, resources.sourceBuffers, { chunkSources: resources.sourceChunkProviders });
		const renderEngine = engine as typeof engine & Pick<EnginePublicApi, 'renderMix'>;
		const output = await renderEngine.renderMix({ startFrame: 0, endFrame: clip.durationFrames,
			includeTail: false, includeMaster: false, includeTrackPan: false, preRollFrames: 0, signal });
		signal.throwIfAborted();
		if ('getChannelData' in output) return output;
		const channels = audioBufferChannels(output);
		return { length: channels[0]!.length, numberOfChannels: channels.length, sampleRate: project.sampleRate,
			getChannelData: (channel) => channels[channel]!,
		};
	} finally { await engine.dispose(); }
}
