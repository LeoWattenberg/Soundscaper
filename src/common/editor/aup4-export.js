import { createStreamingWindowedSincResampler } from './resample.js';
import {
	AUP4_REALTIME_EFFECT_PROFILES,
	canEncodeAup4NativeRealtimeEffect,
} from './aup4-effects.js';
import { audioEffectLabel } from './effects.js';
import {
	addAup4CompatibilityItem,
	createAup4CompatibilityReport,
} from './aup4-profile.js';

const AUP4_CLIP_ENVELOPE_MAX = 4;

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
	reportAup4EffectCompatibility(project, compatibilityReport);

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

/**
 * Materialize every native variant derived from one original source. The
 * result can be written and released before the next source is requested.
 */
export function normalizeAup4ExportSource(plan, sourceAudio) {
	assertExportPlan(plan);
	const sourceId = String(sourceAudio?.sourceId || '');
	const variants = plan.sources.filter((variant) => variant.inputSourceId === sourceId);
	if (!variants.length) return [];
	const inputSource = variants[0].inputSource;
	const inputChannels = normalizeInputChannels(sourceAudio.channels, inputSource);
	const sourceRate = positiveRate(inputSource.sampleRate ?? sourceAudio.sampleRate, `source ${sourceId} sampleRate`);
	return variants.map((variant) => {
		const mappedChannels = mapChannels(inputChannels, variant.targetChannels);
		const convertedChannels = sourceRate === variant.targetRate
			? mappedChannels.map((channel) => channel.slice())
			: resampleChannels(mappedChannels, sourceRate, variant.targetRate);
		const channels = applyMaterialTransform(
			convertedChannels,
			variant.transform,
			sourceRate,
			variant.targetRate,
		);
		if (channels.some((channel) => channel.length !== variant.source.frameCount)) {
			throw exportError(`AUP4 source ${sourceId} normalization produced an invalid frame count.`, 'INVALID_SOURCE_AUDIO');
		}
		return { sourceId: variant.source.id, sampleRate: variant.targetRate, channels };
	});
}

function reportOmittedProjectFeatures(project, normalizedProject, report) {
	const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
	const videoTrackIds = new Set((project.tracks || [])
		.filter(isAup4VideoTrack)
		.map((track) => String(track.id)));
	const videoTrackClipIds = new Set((project.tracks || [])
		.filter(isAup4VideoTrack)
		.flatMap((track) => track.clipIds || [])
		.map(String));
	const timelineVideoClips = (project.clips || []).filter((clip) => (
		isAup4VideoClip(clip, sourceById) || videoTrackClipIds.has(String(clip.id))
	));
	const projectBinVideoClips = (project.projectBin?.clips || []).filter((clip) => (
		isAup4VideoClip(clip, sourceById)
	));
	const videoSources = (project.sources || []).filter(isAup4VideoSource);
	if (videoTrackIds.size || timelineVideoClips.length || projectBinVideoClips.length || videoSources.length) {
		addAup4CompatibilityItem(report, {
			code: 'VIDEO_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			message: 'AUP4 is audio-only. Video tracks, clips, and media were omitted from this exported copy.',
			scope: { kind: 'project' },
			data: {
				reason: 'aup4-audio-only',
				trackCount: videoTrackIds.size,
				timelineClipCount: timelineVideoClips.length,
				projectBinClipCount: projectBinVideoClips.length,
				sourceCount: videoSources.length,
			},
		});
	}

	const projectBinClips = Array.isArray(project.projectBin?.clips) ? project.projectBin.clips : [];
	if (projectBinClips.length) {
		addAup4CompatibilityItem(report, {
			code: 'PROJECT_BIN_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {
				clipCount: projectBinClips.length,
				sourceCount: new Set(projectBinClips.map((clip) => clip.sourceId)).size,
			},
		});
	}
	if (Object.hasOwn(normalizedProject, 'projectBin')) normalizedProject.projectBin = { clips: [] };

	const mixer = project.mixer || {};
	for (const [buses, code] of [
		[mixer.groups, 'MIXER_GROUPS_OMITTED'],
		[mixer.sends, 'MIXER_SENDS_OMITTED'],
	]) {
		if (!Array.isArray(buses) || !buses.length) continue;
		const envelopes = buses.map((bus) => Array.isArray(bus?.envelope) ? bus.envelope : []);
		addAup4CompatibilityItem(report, {
			code,
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'mixer' },
			data: {
				count: buses.length,
				envelopeBusCount: envelopes.filter((envelope) => envelope.length > 0).length,
				envelopePointCount: envelopes.reduce((count, envelope) => count + envelope.length, 0),
			},
		});
	}
	for (const [busType, buses] of [['group', mixer.groups], ['send', mixer.sends]]) {
		for (const bus of buses || []) {
			if (!Array.isArray(bus.effects) || !bus.effects.length) continue;
			addAup4CompatibilityItem(report, {
				code: 'BUS_EFFECTS_OMITTED',
				severity: 'warning',
				disposition: 'omitted',
				scope: { kind: 'mixer-bus', busType, busId: bus.id },
				data: { count: bus.effects.length },
			});
		}
	}
	const routeCount = Object.keys(mixer.routes || {}).length;
	if (routeCount) addAup4CompatibilityItem(report, {
		code: 'MIXER_ROUTES_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		scope: { kind: 'mixer' },
		data: { count: routeCount },
	});
	normalizedProject.mixer = { groups: [], sends: [], routes: {} };

	const masterFields = [
		['gain', 1],
		['pan', 0],
		['mute', false],
		['solo', false],
	];
	for (const [field, nativeDefault] of masterFields) {
		const value = project.master?.[field] ?? nativeDefault;
		if (value === nativeDefault) continue;
		addAup4CompatibilityItem(report, {
			code: `MASTER_${field.toUpperCase()}_OMITTED`,
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { value },
		});
		normalizedProject.master[field] = nativeDefault;
	}
	if (Array.isArray(project.master?.envelope) && project.master.envelope.length) {
		addAup4CompatibilityItem(report, {
			code: 'MASTER_ENVELOPE_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { pointCount: project.master.envelope.length },
		});
		normalizedProject.master.envelope = [];
	}
	if (Number(project.masterChannels ?? 2) !== 2) {
		addAup4CompatibilityItem(report, {
			code: 'MASTER_CHANNEL_LAYOUT_OMITTED',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'master' },
			data: { channelCount: Number(project.masterChannels) },
		});
		normalizedProject.masterChannels = 2;
	}
	if (project.loop?.enabled || Number(project.loop?.startFrame || 0) !== 0 || Number(project.loop?.endFrame || 0) !== 0) {
		addAup4CompatibilityItem(report, {
			code: 'LOOP_REGION_OMITTED',
			severity: 'info',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {
				startFrame: project.loop.startFrame,
				endFrame: project.loop.endFrame,
			},
		});
		normalizedProject.loop = { enabled: false, startFrame: 0, endFrame: 0 };
	}
	if (project.view?.panelState && Object.keys(project.view.panelState).length) {
		addAup4CompatibilityItem(report, {
			code: 'EDITOR_PANEL_STATE_OMITTED',
			severity: 'info',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: {},
		});
		normalizedProject.view.panelState = {};
	}
	for (let index = 0; index < project.tracks.length; index += 1) {
		const track = project.tracks[index];
		if (!isAup4AudioTrack(track)) continue;
		if (track.armed) {
			addAup4CompatibilityItem(report, {
				code: 'TRACK_ARMED_STATE_OMITTED',
				severity: 'info',
				disposition: 'omitted',
				scope: { kind: 'track', trackId: track.id },
				data: {},
			});
			normalizedProject.tracks[index].armed = false;
		}
		if (track.displayMode === 'half-wave') addAup4CompatibilityItem(report, {
			code: 'HALF_WAVE_DISPLAY_CONVERTED',
			severity: 'info',
			disposition: 'converted',
			scope: { kind: 'track', trackId: track.id },
			data: { displayMode: 'waveform' },
		});
	}
}

function reportAup4EffectCompatibility(project, report) {
	for (const track of project.tracks || []) {
		if (!isAup4AudioTrack(track)) continue;
		reportRackEffects(track.effects, {
			kind: 'track',
			trackId: track.id,
			name: track.name,
		}, report, track.effectsActive !== false);
	}
	reportRackEffects(
		project.master?.effects,
		{ kind: 'master' },
		report,
		project.master?.effectsActive !== false,
	);
}

function omitVideoContent(normalizedProject, originalProject) {
	const sourceById = new Map((originalProject.sources || []).map((source) => [source.id, source]));
	const videoTrackIds = new Set((originalProject.tracks || [])
		.filter(isAup4VideoTrack)
		.map((track) => String(track.id)));
	const videoClipIds = new Set((originalProject.clips || [])
		.filter((clip) => isAup4VideoClip(clip, sourceById))
		.map((clip) => String(clip.id)));
	for (const track of originalProject.tracks || []) {
		if (!isAup4VideoTrack(track)) continue;
		for (const clipId of track.clipIds || []) videoClipIds.add(String(clipId));
	}

	normalizedProject.clips = (normalizedProject.clips || [])
		.filter((clip) => !videoClipIds.has(String(clip.id)))
		.map((clip) => (
			Object.hasOwn(clip, 'avLinkId') ? { ...clip, avLinkId: null } : clip
		));
	normalizedProject.tracks = (normalizedProject.tracks || [])
		.filter((track) => !videoTrackIds.has(String(track.id)) && !isAup4VideoTrack(track))
		.map((track) => (
			Array.isArray(track.clipIds)
				? {
					...track,
					clipIds: track.clipIds.filter((clipId) => !videoClipIds.has(String(clipId))),
					...(Object.hasOwn(track, 'laneGroupId') ? { laneGroupId: null } : {}),
				}
				: track
		));

	const retainedTrackIds = new Set(normalizedProject.tracks.map((track) => String(track.id)));
	const retainedClipIds = new Set(normalizedProject.clips.map((clip) => String(clip.id)));
	if (normalizedProject.selection) {
		if (Array.isArray(normalizedProject.selection.trackIds)) {
			normalizedProject.selection.trackIds = filterRetainedIds(
				normalizedProject.selection.trackIds,
				retainedTrackIds,
			);
		}
		if (Array.isArray(normalizedProject.selection.clipIds)) {
			normalizedProject.selection.clipIds = filterRetainedIds(
				normalizedProject.selection.clipIds,
				retainedClipIds,
			);
		}
	}
	if (normalizedProject.view) {
		if (Array.isArray(normalizedProject.view.selectedTrackIds)) {
			normalizedProject.view.selectedTrackIds = filterRetainedIds(
				normalizedProject.view.selectedTrackIds,
				retainedTrackIds,
			);
		}
		if (Array.isArray(normalizedProject.view.selectedClipIds)) {
			normalizedProject.view.selectedClipIds = filterRetainedIds(
				normalizedProject.view.selectedClipIds,
				retainedClipIds,
			);
		}
	}
}

function filterRetainedIds(ids, retainedIds) {
	return ids.filter((id) => retainedIds.has(String(id)));
}

function isAup4AudioTrack(track) {
	return !isAup4VideoTrack(track) && (track?.type || track?.kind || 'audio') !== 'label';
}

function isAup4VideoTrack(track) {
	return (track?.type || track?.kind) === 'video';
}

function isAup4VideoClip(clip, sourceById) {
	return clip?.kind === 'video' || isAup4VideoSource(sourceById.get(clip?.sourceId));
}

function isAup4VideoSource(source) {
	return source?.kind === 'video';
}

function reportRackEffects(effects, scope, report, rackActive) {
	for (const [effectIndex, effect] of (effects || []).entries()) {
		const active = rackActive && effect?.enabled !== false;
		if (effect?.type === 'missing') {
			addAup4CompatibilityItem(report, {
				code: 'MISSING_REALTIME_EFFECT',
				severity: active ? 'warning' : 'info',
				disposition: 'missing',
				scope: { ...scope, effectIndex, effectId: effect.id },
				data: {
					name: String(effect.missing?.name || 'Unknown effect'),
					nativeId: String(effect.missing?.nativeId || ''),
					reason: String(effect.missing?.reason || 'plugin-unavailable'),
					active,
				},
			});
			continue;
		}
		const nativeProfile = AUP4_REALTIME_EFFECT_PROFILES[effect?.type];
		if (nativeProfile && canEncodeAup4NativeRealtimeEffect(effect)) continue;
		let name = String(effect?.type || 'Unknown effect');
		try { name = audioEffectLabel(effect.type, 'en'); }
		catch { /* Keep the stable type as a bounded fallback. */ }
		addAup4CompatibilityItem(report, {
			code: nativeProfile
				? 'AUDACITY_EFFECT_UNSUPPORTED_STATE_EXPORTED_AS_MISSING'
				: 'SOUNDSCAPER_EFFECT_EXPORTED_AS_MISSING',
			severity: active ? 'warning' : 'info',
			disposition: 'missing',
			scope: { ...scope, effectIndex, effectId: effect.id },
			data: {
				name,
				type: effect?.type,
				active,
				...(nativeProfile ? {
					hasContext: effect?.context !== undefined,
					hasState: effect?.state !== undefined,
					extraParams: Object.keys(effect?.params || {}).filter((parameter) => {
						const known = new Set(nativeProfile.params
							.filter((descriptor) => descriptor.model)
							.map((descriptor) => descriptor.model));
						if (nativeProfile.curve) known.add('points');
						if (nativeProfile.bands) known.add('gains');
						return !known.has(parameter);
					}),
				} : {}),
			},
		});
	}
}

function createNativeClipEnvelope(clip, track, automaticCrossfade = {}) {
	const duration = positiveFrame(clip.durationFrames, `clip ${clip.id} durationFrames`);
	const gain = finiteNonNegative(clip.gain, 1);
	const fadeIn = boundedFrame(clip.fadeInFrames, duration);
	const fadeOut = boundedFrame(clip.fadeOutFrames, duration);
	const clipEnvelope = normalizedEnvelope(clip.envelope, duration);
	const trackEnvelope = normalizedEnvelope(track.envelope, Number.MAX_SAFE_INTEGER);
	const crossfadeInRanges = normalizedFrameRanges(automaticCrossfade.crossfadeInRanges, duration);
	const crossfadeOutRanges = normalizedFrameRanges(automaticCrossfade.crossfadeOutRanges, duration);
	const hasAutomaticCrossfade = crossfadeInRanges.length > 0 || crossfadeOutRanges.length > 0;
	const converted = gain !== 1 || fadeIn > 0 || fadeOut > 0 || trackEnvelope.length > 0 || hasAutomaticCrossfade;
	if (!converted) {
		const points = envelopeWithBoundaries(clipEnvelope, duration);
		const maximum = Math.max(1, ...points.map((point) => point.value));
		const pcmGain = maximum > AUP4_CLIP_ENVELOPE_MAX ? maximum / AUP4_CLIP_ENVELOPE_MAX : 1;
		return {
			points: pcmGain === 1 ? points : points.map((point) => ({
				frame: point.frame,
				value: point.value / pcmGain,
			})),
			pcmGain,
			converted: pcmGain !== 1,
			automaticCrossfade: false,
		};
	}

	const boundaries = new Set([0, duration]);
	for (const point of clipEnvelope) boundaries.add(point.frame);
	for (const point of trackEnvelope) {
		const localFrame = point.frame - nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id} timelineStartFrame`);
		if (localFrame >= 0 && localFrame <= duration) boundaries.add(localFrame);
	}
	if (fadeIn > 0) boundaries.add(fadeIn);
	if (fadeOut > 0) boundaries.add(duration - fadeOut);
	for (const frame of [...crossfadeInRanges.flat(), ...crossfadeOutRanges.flat()]) boundaries.add(frame);
	const timelineStart = Number(clip.timelineStartFrame || 0);
	const valueAt = (frame) => Math.max(0,
		gain
			* envelopeValueAt(clipEnvelope, frame)
			* envelopeValueAt(trackEnvelope, timelineStart + frame)
			* fadeValueAt(frame, duration, fadeIn, fadeOut, crossfadeInRanges, crossfadeOutRanges));
	const rawPoints = adaptiveEnvelopePoints([...boundaries], valueAt);
	const maximum = Math.max(1, ...rawPoints.map((point) => point.value));
	const pcmGain = maximum > AUP4_CLIP_ENVELOPE_MAX ? maximum / AUP4_CLIP_ENVELOPE_MAX : 1;
	const points = rawPoints.map((point) => ({
		frame: point.frame,
		value: Math.min(AUP4_CLIP_ENVELOPE_MAX, point.value / pcmGain),
	}));
	return { points, pcmGain, converted: true, automaticCrossfade: hasAutomaticCrossfade };
}

function adaptiveEnvelopePoints(boundaries, valueAt) {
	const frames = [...new Set(boundaries)].sort((left, right) => left - right);
	const points = new Map();
	const maximumPoints = 65_536;
	const tolerance = 1e-4;
	for (let index = 1; index < frames.length; index += 1) {
		const left = frames[index - 1];
		const right = frames[index];
		points.set(left, valueAt(left));
		subdivide(left, right, points.get(left), valueAt(right), 0);
	}
	if (frames.length) points.set(frames.at(-1), valueAt(frames.at(-1)));
	return [...points].sort(([left], [right]) => left - right)
		.map(([frame, value]) => ({ frame, value }));

	function subdivide(left, right, leftValue, rightValue, depth) {
		if (right - left <= 1 || depth >= 16 || points.size >= maximumPoints) return;
		const probeFrames = [
			Math.round(left + (right - left) / 4),
			Math.round(left + (right - left) / 2),
			Math.round(left + (right - left) * 3 / 4),
		].filter((frame, index, all) => frame > left && frame < right && all.indexOf(frame) === index);
		let split = false;
		for (const frame of probeFrames) {
			const actual = valueAt(frame);
			const linear = leftValue + (rightValue - leftValue) * (frame - left) / (right - left);
			if (Math.abs(actual - linear) > tolerance) {
				split = true;
				break;
			}
		}
		if (!split) return;
		const middle = Math.round((left + right) / 2);
		if (middle <= left || middle >= right) return;
		const middleValue = valueAt(middle);
		points.set(middle, middleValue);
		subdivide(left, middle, leftValue, middleValue, depth + 1);
		subdivide(middle, right, middleValue, rightValue, depth + 1);
	}
}

function normalizedEnvelope(points, maximumFrame) {
	return (Array.isArray(points) ? points : [])
		.filter((point) => Number.isFinite(Number(point?.frame)) && Number.isFinite(Number(point?.value)))
		.map((point) => ({
			frame: Math.max(0, Math.min(maximumFrame, Math.round(Number(point.frame)))),
			value: Math.max(0, Number(point.value)),
		}))
		.sort((left, right) => left.frame - right.frame)
		.filter((point, index, values) => !index || point.frame > values[index - 1].frame);
}

function envelopeValueAt(points, frame) {
	if (!points.length) return 1;
	let low = 0;
	let high = points.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (points[middle].frame < frame) low = middle + 1;
		else high = middle;
	}
	const right = points[low];
	if (!right) return points.at(-1).value;
	if (right.frame === frame) return right.value;
	const left = low ? points[low - 1] : { frame: 0, value: 1 };
	if (right.frame <= left.frame) return right.value;
	return left.value + (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame);
}

function fadeValueAt(frame, duration, fadeIn, fadeOut, crossfadeInRanges, crossfadeOutRanges) {
	let value = 1;
	if (fadeIn > 0 && frame < fadeIn) value *= frame / fadeIn;
	if (fadeOut > 0 && frame > duration - fadeOut) value *= (duration - frame) / fadeOut;
	value *= crossfadeValueAt(frame, crossfadeInRanges, 'in');
	value *= crossfadeValueAt(frame, crossfadeOutRanges, 'out');
	return Math.max(0, value);
}

function envelopeWithBoundaries(points, duration) {
	if (!points.length) return [];
	const output = points.map((point) => ({ ...point }));
	if (output[0].frame > 0) output.unshift({ frame: 0, value: envelopeValueAt(points, 0) });
	return output;
}

function normalizedFrameRanges(ranges, duration) {
	const ordered = (Array.isArray(ranges) ? ranges : [])
		.map((range) => [
			Math.max(0, Math.min(duration, Math.round(Number(range?.[0])))),
			Math.max(0, Math.min(duration, Math.round(Number(range?.[1])))),
		])
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged = [];
	for (const [start, end] of ordered) {
		const previous = merged.at(-1);
		if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

function crossfadeValueAt(frame, ranges, direction) {
	let gain = 1;
	for (const [start, end] of ranges) {
		if (frame < start || frame > end) continue;
		const progress = end > start ? (frame - start) / (end - start) : 1;
		gain = Math.min(gain, direction === 'in' ? progress : 1 - progress);
	}
	return Math.max(0, Math.min(1, gain));
}

function automaticAup4CrossfadeRanges(clips) {
	const ranges = new Map(clips.map((clip) => [
		String(clip.id),
		{ crossfadeInRanges: [], crossfadeOutRanges: [] },
	]));
	const ordered = clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| String(left.id).localeCompare(String(right.id))
	));
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = Number(left.timelineStartFrame);
		const leftEnd = leftStart + Number(left.durationFrames);
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = Number(right.timelineStartFrame);
			if (rightStart >= leftEnd) break;
			const overlapStart = Math.max(leftStart, rightStart);
			const overlapEnd = Math.min(leftEnd, rightStart + Number(right.durationFrames));
			if (overlapEnd <= overlapStart) continue;
			ranges.get(String(left.id)).crossfadeOutRanges.push([
				overlapStart - leftStart,
				overlapEnd - leftStart,
			]);
			ranges.get(String(right.id)).crossfadeInRanges.push([
				overlapStart - rightStart,
				overlapEnd - rightStart,
			]);
		}
	}
	for (const value of ranges.values()) {
		value.crossfadeInRanges = normalizedFrameRanges(value.crossfadeInRanges, Number.MAX_SAFE_INTEGER);
		value.crossfadeOutRanges = normalizedFrameRanges(value.crossfadeOutRanges, Number.MAX_SAFE_INTEGER);
	}
	return ranges;
}

function assignAup4OverlapLanes(clips) {
	const lanes = [];
	const laneEnds = [];
	for (const clip of clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| String(left.id).localeCompare(String(right.id))
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

function normalizeMaterialTransform(transform, inputFrameCount) {
	const reversed = Boolean(transform?.reversed);
	const pcmGain = finiteNonNegative(transform?.pcmGain, 1);
	const sliceStartFrame = nonNegativeFrame(transform?.sliceStartFrame ?? 0, 'AUP4 material transform sliceStartFrame');
	const sliceEndFrame = nonNegativeFrame(
		transform?.sliceEndFrame ?? inputFrameCount,
		'AUP4 material transform sliceEndFrame',
	);
	if (sliceEndFrame <= sliceStartFrame || sliceEndFrame > inputFrameCount) {
		throw exportError('AUP4 material transform range is invalid.', 'INVALID_SNAPSHOT');
	}
	if (!reversed && pcmGain === 1 && sliceStartFrame === 0 && sliceEndFrame === inputFrameCount) return null;
	return {
		sliceStartFrame,
		sliceEndFrame,
		reversed,
		pcmGain,
	};
}

function applyMaterialTransform(channels, transform, inputRate, outputRate) {
	if (!transform) return channels;
	const ratio = outputRate / inputRate;
	const start = Math.min(channels[0].length - 1, scaleBoundary(transform.sliceStartFrame, ratio));
	const end = Math.min(channels[0].length, Math.max(start + 1, scaleBoundary(transform.sliceEndFrame, ratio)));
	return channels.map((input) => {
		const channel = input.slice(start, end);
		if (transform.reversed) {
			for (let left = 0, right = channel.length - 1; left < right; left += 1, right -= 1) {
				const value = channel[left];
				channel[left] = channel[right];
				channel[right] = value;
			}
		}
		if (transform.pcmGain !== 1) {
			for (let frame = 0; frame < channel.length; frame += 1) channel[frame] *= transform.pcmGain;
		}
		return channel;
	});
}

function assertExportPlan(plan) {
	if (!plan?.project || !Array.isArray(plan.sources)) throw exportError('An AUP4 export plan is required.', 'INVALID_SNAPSHOT');
}

function normalizeInputChannels(values, source) {
	if (!Array.isArray(values) || !values.length) {
		throw exportError(`PCM for project source ${source.id} has no channels.`, 'INVALID_SOURCE_AUDIO');
	}
	const channels = values.map((channel) => {
		if (channel instanceof Float32Array) return channel;
		if (ArrayBuffer.isView(channel) || Array.isArray(channel)) return Float32Array.from(channel);
		throw exportError(`PCM for project source ${source.id} must contain Float32 samples.`, 'INVALID_SOURCE_AUDIO');
	});
	const frameCount = channels[0].length;
	if (!frameCount || channels.some((channel) => channel.length !== frameCount)) {
		throw exportError(`PCM channels for project source ${source.id} must have the same positive length.`, 'INVALID_SOURCE_AUDIO');
	}
	if (frameCount !== positiveFrame(source.frameCount, `source ${source.id} frameCount`)) {
		throw exportError(`PCM frame count for project source ${source.id} does not match its metadata.`, 'INVALID_SOURCE_AUDIO');
	}
	const declaredChannels = positiveChannelCount(source.channelCount);
	if (channels.length !== declaredChannels) {
		throw exportError(`PCM channel count for project source ${source.id} does not match its metadata.`, 'INVALID_SOURCE_AUDIO');
	}
	return channels;
}

function mapChannels(channels, targetChannels) {
	if (targetChannels === 1) return [channels[0]];
	if (channels.length === 1) return [channels[0], channels[0]];
	if (channels.length === 2) return channels;
	const frameCount = channels[0].length;
	const left = channels[0].slice();
	const right = channels[1].slice();
	if (channels.length === 3) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
	} else if (channels.length === 4) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[3], Math.SQRT1_2);
	} else if (channels.length === 5) {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], Math.SQRT1_2);
		mixInto(right, channels[4], Math.SQRT1_2);
	} else {
		mixInto(left, channels[2], Math.SQRT1_2);
		mixInto(right, channels[2], Math.SQRT1_2);
		mixInto(left, channels[3], 0.5);
		mixInto(right, channels[3], 0.5);
		mixInto(left, channels[4], Math.SQRT1_2);
		mixInto(right, channels[5], Math.SQRT1_2);
		for (let channel = 6; channel < channels.length; channel += 1) {
			mixInto(channel % 2 ? right : left, channels[channel], 0.5);
		}
	}
	if (left.length !== frameCount || right.length !== frameCount) throw exportError('AUP4 channel downmix failed.', 'INVALID_SOURCE_AUDIO');
	return [left, right];
}

function mixInto(output, input, gain) {
	for (let frame = 0; frame < output.length; frame += 1) output[frame] += input[frame] * gain;
}

function resampleChannels(channels, inputRate, outputRate) {
	const outputFrames = Math.max(1, Math.round(channels[0].length * outputRate / inputRate));
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, channels.length);
	const head = resampler.push(channels);
	const tail = resampler.finish(outputFrames);
	return head.map((values, channel) => {
		const output = new Float32Array(values.length + tail[channel].length);
		output.set(values);
		output.set(tail[channel], values.length);
		return output.length === outputFrames ? output : output.slice(0, outputFrames);
	});
}

function uniqueVariantId(sourceId, sampleRate, channelCount, usedIds) {
	const base = `${sourceId}-aup4-${sampleRate}-${channelCount}ch`;
	let id = base;
	let suffix = 1;
	while (usedIds.has(id)) id = `${base}-${++suffix}`;
	usedIds.add(id);
	return id;
}

function scaleBoundary(frame, ratio) {
	return Math.max(0, Math.round(frame * ratio));
}

function scaledRangeLength(startFrame, endFrame, ratio) {
	return Math.max(0, scaleBoundary(endFrame, ratio) - scaleBoundary(startFrame, ratio));
}

function positiveRate(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || number > 768_000) throw exportError(`${name} is invalid.`, 'INVALID_SAMPLE_RATE');
	return Math.round(number);
}

function positiveChannelCount(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 64) throw exportError('AUP4 source channelCount is invalid.', 'INVALID_SOURCE_AUDIO');
	return number;
}

function finiteNonNegative(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedFrame(value, maximum) {
	const number = Number(value);
	return Number.isSafeInteger(number) ? Math.max(0, Math.min(maximum, number)) : 0;
}

function nonNegativeFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

function positiveFrame(value, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw exportError(`${name} is invalid.`, 'INVALID_SNAPSHOT');
	return number;
}

function clone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function exportError(message, code) {
	const error = new Error(message);
	error.name = 'Aup4ExportError';
	error.code = code;
	return error;
}
