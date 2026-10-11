/* SPDX-License-Identifier: AGPL-3.0-only */
import { createVideoSource } from '../common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes, VIDEO_TIMING_ASSET_MAXIMUM_FRAMES, VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE } from '../common/editor/video-timing-asset.ts';
import { normalizeMotionCompositionOffer, createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts';
import { motionCompositionHasAudio } from '../common/editor/motion-composition-audio.ts';
import { secondsToSampleFrame, divideRationals } from '../common/editor/timeline-time.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperCompositionLink } from './editor-project-successor-link.ts';

const MIME = 'application/vnd.motionscaper.composition';
const CODEC = 'Motion composition';
/** The video leaf describes exact timeline placement; the typed link alone owns its unencoded scene. */
export function createFramescaperCompositionSource(options: Readonly<{ sourceId: string; offer: unknown; sampleRate: number; name?: string }>) {
	const offer = normalizeMotionCompositionOffer(options.offer); const output = offer.output;
	if (output.durationFrames > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES || output.frameRate.num > VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE) throw new RangeError('Linked composition exceeds the exact Framescaper timing-index admission.');
	const contentSha256 = digestScapeBytes(new TextEncoder().encode(JSON.stringify({ kind: MIME, compositionId: offer.compositionId, revisionDigest: offer.revision.digest })));
	const duration = divideRationals(output.durationFrames, output.frameRate);
	const publication = createVideoTimingAssetPublication(contentSha256, { timescale: output.frameRate.num,
		presentationTicks: Array.from({ length: output.durationFrames }, (_, index) => BigInt(index) * BigInt(output.frameRate.den)), finalFrameDurationTicks: BigInt(output.frameRate.den) });
	const source = createVideoSource({ id: options.sourceId, name: options.name ?? offer.revision.project.compositions.find(entry => entry.id === offer.compositionId)!.name,
		mimeType: MIME, videoCodec: CODEC, storageKey: `motion-composition:${options.sourceId}:${contentSha256}`, contentSha256,
		sampleRate: options.sampleRate, sampleFrameCount: secondsToSampleFrame(duration, options.sampleRate, 'enclosingEnd'), sourceFrameCount: output.durationFrames,
		frameRate: output.frameRate, width: output.width, height: output.height, hasAudio: motionCompositionHasAudio(offer.revision.project, offer.compositionId),
		timingAsset: publication.reference, timingDecision: { mode: 'exact', rate: output.frameRate }, proxyAttachment: null }, options.sampleRate);
	return Object.freeze({ source: Object.freeze(source), link: createFramescaperCompositionLink(options.sourceId, offer.compositionId, offer.revision),
		timing: Object.freeze({ ...publication, index: validateVideoTimingAssetBytes(publication.reference, publication.bytes) }), offer });
}

/** Resolve before any encoded-media loader. A virtual marker without authenticated link intent is a refusal. */
export function resolveFramescaperCompositionSource(value: unknown, sourceValue: Readonly<{ id: string }>) {
	const project = normalizeFramescaperSuccessorProject(value); const source = project.sources.find(entry => entry.id === sourceValue.id);
	const link = project.compositionLinks.find(entry => entry.sourceId === sourceValue.id);
	if (!link) {
		if (source && source.videoCodec === CODEC) throw new RangeError('Motion composition source requires its retained typed link authority.');
		return null;
	}
	if (!source || source.kind !== 'video') throw new RangeError('Composition link requires its exact video placement descriptor.');
	const expected = createFramescaperCompositionSource({ sourceId: source.id, offer: createMotionCompositionOffer(link.compositionId, link.snapshot), sampleRate: Number(source.sampleRate), name: String(source.name) });
	for (const key of ['kind', 'id', 'mimeType', 'videoCodec', 'storageKey', 'contentSha256', 'sampleRate', 'sampleFrameCount', 'sourceFrameCount', 'frameRate', 'width', 'height', 'hasAudio', 'timingAsset', 'timingDecision'] as const) {
		if (JSON.stringify(Reflect.get(sourceValue, key)) !== JSON.stringify(expected.source[key]) || JSON.stringify(source[key]) !== JSON.stringify(expected.source[key])) throw new RangeError(`Composition source descriptor differs from its retained contract: ${key}.`);
	}
	return expected;
}
