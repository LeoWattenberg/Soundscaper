/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioClip, createVideoClip, createAudioTrack, createVideoTrack } from '../common/editor/project-media-factory.ts';
import { divideRationals, multiplyRationals, roundRational, secondsToSampleFrame } from '../common/editor/timeline-time.ts';
import { createFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { framescaperSuccessorBaselineProject, type FramescaperSuccessorLinkCommand } from './editor-project-successor-commands.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
/** Insert an explicit paired placement as one owner/history action. The caller supplies deterministic IDs. */
export function createFramescaperCompositionPlacement(options: Readonly<{
	project: unknown; offer: unknown; sourceId: string; audioSourceId: string;
	videoTrackId: string; audioTrackId: string; videoClipId: string; audioClipId: string; avLinkId: string;
	sequenceId?: string; positionFrame?: number;
}>): FramescaperSuccessorLinkCommand {
	const project = normalizeFramescaperSuccessorProject(options.project); const baseline = framescaperSuccessorBaselineProject(project);
	const sequence = baseline.sequences.find(entry => entry.id === (options.sequenceId ?? baseline.primarySequenceId));
	if (!sequence) throw new RangeError('Select an existing sequence before inserting a composition.');
	const sampleRate = baseline.sampleRate; const linked = createFramescaperCompositionSource({ sourceId: options.sourceId, audioSourceId: options.audioSourceId, offer: options.offer, sampleRate });
	const duration = divideRationals(linked.offer.output.durationFrames, linked.offer.output.frameRate);
	const exactFrames = multiplyRationals(duration, sequence.rate);
	const sequenceFrameCount = Math.max(1, roundRational(exactFrames.num, exactFrames.den, 'point'));
	const sequenceStartFrame = options.positionFrame ?? 0;
	const video = createVideoClip({ id: options.videoClipId, sourceId: options.sourceId, trackId: options.videoTrackId, title: linked.source.name,
		sequenceId: sequence.id, sequenceStartFrame, sequenceFrameCount, sourceInFrame: 0, sourceFrameCount: linked.source.sourceFrameCount,
		avLinkId: options.avLinkId }, { projectSampleRate: sampleRate, sequence, source: linked.source });
	const audio = createAudioClip({ id: options.audioClipId, sourceId: options.audioSourceId, trackId: options.audioTrackId, title: linked.source.name,
		timelineStartFrame: secondsToSampleFrame(divideRationals(sequenceStartFrame, sequence.rate), sampleRate, 'point'),
		durationFrames: linked.source.sampleFrameCount, sourceStartFrame: 0, sourceDurationFrames: linked.audioSource!.frameCount, avLinkId: options.avLinkId });
	return { type: 'composition-link/replace', sourceId: options.sourceId, expectedDigest: null, link: linked.link, commands: [
		{ type: 'source/add', source: linked.source }, { type: 'source/add', source: linked.audioSource! },
		{ type: 'track/add', sequenceId: sequence.id, track: createVideoTrack({ id: options.videoTrackId, name: linked.source.name, laneGroupId: options.avLinkId }) },
		{ type: 'track/add', sequenceId: sequence.id, track: createAudioTrack({ id: options.audioTrackId, name: linked.source.name, laneGroupId: options.avLinkId, channelCount: 2 }, sampleRate) },
		{ type: 'clip/add', trackId: options.videoTrackId, clip: video }, { type: 'clip/add', trackId: options.audioTrackId, clip: audio },
	] };
}
