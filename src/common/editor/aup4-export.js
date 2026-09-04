import { compareCodeUnits } from './code-unit-order.ts';
import { addAup4CompatibilityItem, createAup4CompatibilityReport } from './aup4-profile.js';
import { reportAup4OwnedFeatureOmissions } from './aup4-feature-omissions.ts';
import { isAup4AudioTrack, reportOmittedProjectFeatures } from './aup4-omitted-features.js';
import { flattenAup4MusicalMaps, isCurrentAup4MusicalSnapshot } from './aup4-musical-export.ts';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import { projectTrackFolderMediaStateV12 } from './track-folder-media-runtime.ts';
import { flattenAup4TimelineAnnotations } from './aup4-annotation-interchange.ts';
import { normalizeMaterialTransform } from './aup4-export-material.js';
import {
	scaleBoundary, scaledRangeLength,
	positiveRate,
	positiveChannelCount,
	nonNegativeFrame,
	positiveFrame,
	clone,
	exportError,
} from './aup4-export-values.js';
import {
	automaticAup4CrossfadeRanges,
	createNativeClipEnvelope,
} from './aup4-export-envelopes.js';
import {
	omitVideoContent,
	reportAup4EffectCompatibility,
} from './aup4-export-compatibility.js';
import {
	normalizeAup4ExportSource,
	uniqueVariantId,
} from './aup4-export-variants.js';

export { normalizeAup4ExportSource } from './aup4-export-variants.js';


/**
 * Materialize the fixed-rate, fixed-layout tracks required by AUP4 without
 * changing the browser project. The returned project and PCM are export-only.
 */
export function normalizeAup4ExportSnapshot(project, sourceAudio = []) {
	if (!Array.isArray(sourceAudio)) throw exportError('AUP4 source audio must be an array.', 'INVALID_SNAPSHOT');
	const plan = createAup4ExportPlan(project);
	const audioById = new Map(sourceAudio.map((source) => [source.sourceId, source]));
	const normalizedSources = [];
	for (const sourceId of requiredAup4SourceIds(plan)) {
		const audio = audioById.get(sourceId);
		if (!audio) throw exportError(`PCM for project source ${sourceId} is missing.`, 'MISSING_SOURCE');
		normalizedSources.push(...normalizeAup4ExportSource(plan, audio));
	}
	const normalizedById = new Map(normalizedSources.map((source) => [source.sourceId, source]));
	return {
		project: plan.project,
		sources: plan.sources.map((variant) => normalizedById.get(variant.source.id)),
		compatibilityReport: plan.compatibilityReport,
	};
}

/**
 * Build the project-only part of AUP4 normalization. This deliberately does
 * not touch PCM, so callers can retain the plan while materializing one source
 * at a time from disk.
 */
export function createAup4ExportPlan(project) {
	if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.clips) || !Array.isArray(project.sources)) {
		throw exportError('An audio editor project is required.', 'INVALID_SNAPSHOT');
	}
	// Folder media state first: an AUP4 file states what each track does, and a
	// track inside a muted folder is silent in playback and in every delivery, so
	// an export that wrote its persisted flags would hand Audacity a project that
	// plays something else. The runtime projection then resolves clip coordinates.
	project = projectTrackFolderMediaStateV12(project);
	if (isCurrentAup4MusicalSnapshot(project)) project = projectForRuntimeConsumers(project);
	const projectRate = positiveRate(project.sampleRate, 'project.sampleRate');
	const sourceById = new Map(project.sources.map((source) => [source.id, source]));
	const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const normalizedProject = clone(project);
	const normalizedClipById = new Map(normalizedProject.clips.map((clip) => [clip.id, clip]));
	const normalizedSourceMetadata = [];
	const variants = new Map();
	const variantIds = new Set(sourceById.keys());
	const trackIds = new Set(project.tracks.map((track) => String(track.id)));
	const trackReplacements = new Map();
	const compatibilityReport = createAup4CompatibilityReport('save', {
		discardedCloudMetadata: { discardedEntries: 0, nodeNames: [], attributeNames: [], tagNames: [] },
		missingAudio: [],
		networkAccessAttempted: false,
	});
	reportOmittedProjectFeatures(project, normalizedProject, compatibilityReport);
	// The backstop: anything the document declares that AUP4 cannot carry and
	// nothing above has already reported.
	reportAup4OwnedFeatureOmissions(project, compatibilityReport, addAup4CompatibilityItem);
	reportAup4EffectCompatibility(project, compatibilityReport);
	flattenAup4MusicalMaps(project, normalizedProject, compatibilityReport);
	flattenAup4TimelineAnnotations(project, normalizedProject, compatibilityReport);
	for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
		const track = project.tracks[trackIndex];
		if (!isAup4AudioTrack(track)) continue;
		const normalizedTrack = normalizedProject.tracks[trackIndex];
		const clips = (track.clipIds || []).map((clipId) => {
			const clip = clipById.get(clipId);
			if (!clip) throw exportError(`AUP4 track ${track.id} references missing clip ${clipId}.`, 'INVALID_SNAPSHOT');
			return clip;
		});
		const overlapLanes = assignAup4OverlapLanes(clips);
		const automaticCrossfades = automaticAup4CrossfadeRanges(clips);
		const referencedSources = clips.map((clip) => {
			const source = sourceById.get(clip.sourceId);
			if (!source) throw exportError(`AUP4 clip ${clip.id} references missing source ${clip.sourceId}.`, 'MISSING_SOURCE');
			return source;
		});
		const targetChannels = referencedSources.some((source) => positiveChannelCount(source.channelCount) > 1) ? 2 : 1;
		const rates = new Set(referencedSources.map((source) => positiveRate(source.sampleRate, `source ${source.id} sampleRate`)));
		const targetRate = rates.size === 1 ? rates.values().next().value : projectRate;
		if (Array.isArray(track.envelope) && track.envelope.length) {
			addAup4CompatibilityItem(compatibilityReport, {
				code: clips.length ? 'TRACK_ENVELOPE_MERGED' : 'TRACK_ENVELOPE_OMITTED_EMPTY',
				severity: clips.length ? 'info' : 'warning',
				disposition: clips.length ? 'converted' : 'omitted',
				scope: { kind: 'track', trackId: track.id },
				data: { pointCount: track.envelope.length },
			});
			normalizedTrack.envelope = [];
		}
		if (track.displayMode === 'half-wave') normalizedTrack.displayMode = 'waveform';

		for (const clip of clips) {
			const source = sourceById.get(clip.sourceId);
			const sourceRate = positiveRate(source.sampleRate, `source ${source.id} sampleRate`);
			const sourceChannels = positiveChannelCount(source.channelCount);
			const ratio = targetRate / sourceRate;
			const sourceFrameCount = positiveFrame(source.frameCount, `source ${source.id} frameCount`);
			const sourceStartFrame = nonNegativeFrame(clip.sourceStartFrame, `clip ${clip.id} sourceStartFrame`);
			const sourceDurationFrames = positiveFrame(
				clip.sourceDurationFrames ?? clip.durationFrames,
				`clip ${clip.id} sourceDurationFrames`,
			);
			const sourceEndFrame = sourceStartFrame + sourceDurationFrames;
			const trimStartFrames = nonNegativeFrame(clip.trimStartFrames ?? 0, `clip ${clip.id} trimStartFrames`);
			const trimEndFrames = nonNegativeFrame(clip.trimEndFrames ?? 0, `clip ${clip.id} trimEndFrames`);
			if (
				sourceEndFrame > sourceFrameCount
				|| trimStartFrames > sourceStartFrame
				|| sourceEndFrame + trimEndFrames > sourceFrameCount
			) {
				throw exportError(`AUP4 clip ${clip.id} exceeds source ${source.id}.`, 'INVALID_SNAPSHOT');
			}
			const normalizedClip = normalizedClipById.get(clip.id);
			const envelopeConversion = createNativeClipEnvelope(
				clip,
				track,
				automaticCrossfades.get(String(clip.id)),
			);
			const sliceStartFrame = sourceStartFrame - trimStartFrames;
			const sliceEndFrame = sourceEndFrame + trimEndFrames;
			const transform = {
				sliceStartFrame,
				sliceEndFrame,
				reversed: Boolean(clip.reversed),
				inverted: Boolean(clip.inverted),
				pcmGain: envelopeConversion.pcmGain,
			};
			const variant = materializeVariant(source, targetRate, targetChannels, transform);
			const scaledSliceStart = scaleBoundary(sliceStartFrame, ratio);
			const scaledSliceEnd = scaleBoundary(sliceEndFrame, ratio);
			const scaledSourceStart = scaleBoundary(sourceStartFrame, ratio);
			const scaledSourceEnd = Math.max(scaledSourceStart + 1, scaleBoundary(sourceEndFrame, ratio));
			const rawRelativeSourceStart = clip.reversed
				? scaledSliceEnd - scaledSourceEnd
				: scaledSourceStart - scaledSliceStart;
			const rawRelativeSourceEnd = clip.reversed
				? scaledSliceEnd - scaledSourceStart
				: scaledSourceEnd - scaledSliceStart;
			const relativeSourceStart = Math.max(
				0,
				Math.min(variant.source.frameCount - 1, rawRelativeSourceStart),
			);
			const relativeSourceEnd = Math.min(
				variant.source.frameCount,
				Math.max(relativeSourceStart + 1, rawRelativeSourceEnd),
			);
			normalizedClip.sourceId = variant.source.id;
			normalizedClip.sourceStartFrame = relativeSourceStart;
			normalizedClip.sourceDurationFrames = Math.max(1, relativeSourceEnd - relativeSourceStart);
			normalizedClip.trimStartFrames = Math.min(relativeSourceStart, clip.reversed
				? scaledRangeLength(sourceEndFrame, sliceEndFrame, ratio)
				: scaledRangeLength(sliceStartFrame, sourceStartFrame, ratio));
			normalizedClip.trimEndFrames = Math.min(variant.source.frameCount - relativeSourceEnd, clip.reversed
				? scaledRangeLength(sliceStartFrame, sourceStartFrame, ratio)
				: scaledRangeLength(sourceEndFrame, sliceEndFrame, ratio));
			if (Object.hasOwn(clip, 'gain') || envelopeConversion.converted) normalizedClip.gain = 1;
			if (Object.hasOwn(clip, 'fadeInFrames') || envelopeConversion.converted) normalizedClip.fadeInFrames = 0;
			if (Object.hasOwn(clip, 'fadeOutFrames') || envelopeConversion.converted) normalizedClip.fadeOutFrames = 0;
			if (Object.hasOwn(clip, 'reversed') || clip.reversed) normalizedClip.reversed = false;
			if (Object.hasOwn(clip, 'inverted') || clip.inverted) normalizedClip.inverted = false;
			normalizedClip.envelope = envelopeConversion.points;
			if (sourceRate !== targetRate) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'SOURCE_RESAMPLED',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: { sourceId: source.id, fromRate: sourceRate, toRate: targetRate },
				});
			}
			if (sourceChannels === 1 && targetChannels === 2) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'MONO_DUPLICATED_TO_STEREO',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: { sourceId: source.id },
				});
			} else if (sourceChannels > 2) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'MULTICHANNEL_DOWNMIXED_TO_STEREO',
					severity: 'warning',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: { sourceId: source.id, fromChannels: sourceChannels, toChannels: 2 },
				});
			}
			if (clip.reversed) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'REVERSED_CLIP_RENDERED',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: { sourceId: source.id },
				});
			}
			if (clip.inverted) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'INVERTED_CLIP_RENDERED',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: { sourceId: source.id },
				});
			}
			if (sliceStartFrame !== 0 || sliceEndFrame !== sourceFrameCount) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'CLIP_SOURCE_RANGE_ISOLATED',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: {
						sourceId: source.id,
						fromFrame: sliceStartFrame,
						toFrame: sliceEndFrame,
					},
				});
			}
			if (envelopeConversion.converted) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'CLIP_GAIN_AUTOMATION_MERGED',
					severity: 'info',
					disposition: 'converted',
					scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
					data: {
						pcmGain: envelopeConversion.pcmGain,
						fadeInFrames: Number(clip.fadeInFrames || 0),
						fadeOutFrames: Number(clip.fadeOutFrames || 0),
						automaticCrossfade: envelopeConversion.automaticCrossfade,
					},
				});
			}
		}

		function materializeVariant(source, targetRate, targetChannels, transform) {
			const sourceRate = positiveRate(source.sampleRate, `source ${source.id} sampleRate`);
			const inputFrameCount = positiveFrame(source.frameCount, `source ${source.id} frameCount`);
			const materialTransform = normalizeMaterialTransform(transform, inputFrameCount);
			const key = JSON.stringify([source.id, targetRate, targetChannels, materialTransform]);
			const existing = variants.get(key);
			if (existing) return existing;
			const ratio = targetRate / sourceRate;
			const sliceStartFrame = materialTransform?.sliceStartFrame ?? 0;
			const sliceEndFrame = materialTransform?.sliceEndFrame ?? inputFrameCount;
			const outputFrameCount = Math.max(1, scaledRangeLength(sliceStartFrame, sliceEndFrame, ratio));
			const variantId = uniqueVariantId(source.id, targetRate, targetChannels, variantIds);
			const normalizedSource = {
				...clone(source),
				id: variantId,
				storageKey: variantId,
				frameCount: outputFrameCount,
				channelCount: targetChannels,
				sampleRate: targetRate,
				sampleFormat: 'float32',
			};
			const result = {
				source: normalizedSource,
				inputSourceId: source.id,
				inputSource: clone(source),
				targetRate,
				targetChannels,
				transform: materialTransform,
			};
			variants.set(key, result);
			normalizedSourceMetadata.push(normalizedSource);
			return result;
		}

		if (overlapLanes.length > 1) {
			const laneTracks = overlapLanes.map((clipIds, laneIndex) => {
				if (laneIndex === 0) {
					normalizedTrack.clipIds = clipIds;
					return normalizedTrack;
				}
				const lane = clone(normalizedTrack);
				lane.id = uniqueLaneTrackId(track.id, laneIndex + 1, trackIds);
				lane.name = `${String(track.name || 'Audio Track')} (overlap lane ${laneIndex + 1})`;
				lane.clipIds = clipIds;
				lane.opaqueExtensions = {};
				return lane;
			});
			trackReplacements.set(track.id, laneTracks);
			addAup4CompatibilityItem(compatibilityReport, {
				code: 'OVERLAPPING_CLIPS_SPLIT_TO_LANES',
				severity: 'warning',
				disposition: 'converted',
				scope: { kind: 'track', trackId: track.id },
				data: {
					laneCount: overlapLanes.length,
					clipCount: clips.length,
				},
			});
			if (track.effectsActive !== false && (track.effects || []).some((effect) => effect.enabled !== false)) {
				addAup4CompatibilityItem(compatibilityReport, {
					code: 'TRACK_EFFECT_RACK_DUPLICATED_FOR_OVERLAP',
					severity: 'warning',
					disposition: 'converted',
					scope: { kind: 'track', trackId: track.id },
					data: { laneCount: overlapLanes.length },
				});
			}
		}
	}

	if (trackReplacements.size) {
		normalizedProject.tracks = normalizedProject.tracks.flatMap((track) => (
			trackReplacements.get(track.id) || [track]
		));
		expandSplitTrackSelection(normalizedProject, trackReplacements);
	}
	omitVideoContent(normalizedProject, project);
	normalizedProject.sources = normalizedSourceMetadata;
	return {
		project: normalizedProject,
		sources: [...variants.values()].map((variant) => ({
			inputSourceId: variant.inputSourceId,
			inputSource: variant.inputSource,
			source: variant.source,
			targetRate: variant.targetRate,
			targetChannels: variant.targetChannels,
			transform: variant.transform,
		})),
		compatibilityReport,
	};
}

/** Return the original project-source ids needed by an export plan. */
export function requiredAup4SourceIds(plan) {
	assertExportPlan(plan);
	return [...new Set(plan.sources.map((variant) => variant.inputSourceId))];
}

function assignAup4OverlapLanes(clips) {
	const lanes = [];
	const laneEnds = [];
	for (const clip of clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| compareCodeUnits(String(left.id), String(right.id))
	))) {
		const start = nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id} timelineStartFrame`);
		const end = start + positiveFrame(clip.durationFrames, `clip ${clip.id} durationFrames`);
		let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= start);
		if (laneIndex < 0) {
			laneIndex = lanes.length;
			lanes.push([]);
			laneEnds.push(0);
		}
		lanes[laneIndex].push(clip.id);
		laneEnds[laneIndex] = end;
	}
	return lanes.length ? lanes : [[]];
}

function uniqueLaneTrackId(trackId, laneNumber, usedIds) {
	const base = `${trackId}-aup4-overlap-${laneNumber}`;
	let id = base;
	let suffix = 1;
	while (usedIds.has(id)) id = `${base}-${++suffix}`;
	usedIds.add(id);
	return id;
}

function expandSplitTrackSelection(project, replacements) {
	const expand = (ids) => (Array.isArray(ids) ? ids.flatMap((id) => (
		replacements.get(id)?.map((track) => track.id) || [id]
	)) : ids);
	if (project.selection) project.selection.trackIds = expand(project.selection.trackIds);
	if (project.view) project.view.selectedTrackIds = expand(project.view.selectedTrackIds);
}

function assertExportPlan(plan) {
	if (!plan?.project || !Array.isArray(plan.sources)) throw exportError('An AUP4 export plan is required.', 'INVALID_SNAPSHOT');
}
