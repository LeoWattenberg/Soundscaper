import { createCurrentAudioEditorProject } from './project-current.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from './project-v10.ts';
import { createStableId } from './project.js';
import { canonicalAudacityMusicalRoot } from './audacity-tempo-import.ts';
import { createAudacityAnnotationImport } from './audacity-annotation-interchange.ts';
import {
	divideRationals,
	normalizeRational,
	secondsToSampleFrame,
} from './timeline-time.ts';

/** Convert structured legacy XML AUP output directly into the current project model. */
export function convertLegacyAupToProject(structure, options = {}) {
	if (!structure || !Array.isArray(structure.tracks)) throw new TypeError('Structured legacy AUP data is required.');
	const idFactory = options.idFactory || createStableId;
	const sampleRate = positiveRate(structure.sampleRate);
	const sources = [];
	const sourceAudio = [];
	const clips = [];
	const tracks = [];
	const annotationTracks = [];
	const warnings = [...(structure.warnings || [])];
	for (const [trackIndex, inputTrack] of structure.tracks.entries()) {
		if (inputTrack.type === 'label') {
			annotationTracks.push({
				name: String(inputTrack.name || `Labels ${trackIndex + 1}`),
				labels: (inputTrack.labels || []).map((label) => ({
					title: String(label.title || ''),
					startSeconds: nonNegative(label.startSeconds),
					endSeconds: nonNegative(Math.max(label.startSeconds, label.endSeconds)),
					opaqueExtensions: label.opaqueExtensions || {},
				})),
				opaqueExtensions: inputTrack.opaqueExtensions || {},
			});
			continue;
		}
		const trackId = idFactory('track');
		const trackRate = positiveRate(inputTrack.rate || sampleRate);
		const clipIds = [];
		for (const [clipIndex, inputClip] of (inputTrack.clips || []).entries()) {
			const channels = normalizeSourceChannels(inputClip.channels);
			const frameCount = channels[0].length;
			const sourceStartFrame = boundedInteger(inputClip.sourceStart, 0, frameCount - 1, 0);
			const sourceEndFrame = boundedInteger(inputClip.sourceEnd, sourceStartFrame + 1, frameCount, frameCount);
			const sourceDurationFrames = sourceEndFrame - sourceStartFrame;
			const stretch = positive(inputClip.stretch, 1);
			const legacySpeed = positive(inputClip.speedRatio, 1);
			const speedRatio = legacySpeed / stretch;
			const sourceSeconds = divideRationals(
				divideRationals(sourceDurationFrames, normalizeRational(trackRate)),
				normalizeRational(speedRatio),
			);
			const durationFrames = Math.max(1, secondsToSampleFrame(sourceSeconds, sampleRate));
			const sourceId = idFactory('source');
			const clipId = idFactory('clip');
			const name = String(inputClip.name || `${inputTrack.name || 'Audio'} ${clipIndex + 1}`);
		const source = createAudioSourceV10({
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/x-audacity-sampleblocks',
				frameCount,
				channelCount: channels.length,
				sampleRate: trackRate,
				originalSampleRate: trackRate,
				sampleFormat: legacySampleFormat(inputTrack.sampleFormat),
				opaqueExtensions: { legacyAupSource: inputClip.opaqueExtensions || {} },
			});
			const clip = createAudioClipV10({
				id: clipId,
				sourceId,
				title: name,
				timelineStartFrame: secondsToSampleFrame(nonNegative(inputClip.startSeconds), sampleRate),
				sourceStartFrame,
				sourceDurationFrames,
				durationFrames,
				trimStartFrames: sourceStartFrame,
				trimEndFrames: frameCount - sourceEndFrame,
				envelope: convertEnvelope(inputClip.envelope, trackRate, sampleRate, speedRatio, durationFrames),
				groupId: inputClip.groupId || null,
				color: String(inputClip.color || 'auto'),
				pitchCents: Math.max(-1_200, Math.min(1_200, Number(inputClip.pitchCents) || 0)),
				speedRatio,
				preserveFormants: Boolean(inputClip.preserveFormants),
				opaqueExtensions: inputClip.opaqueExtensions || {},
			});
			sources.push(source);
			sourceAudio.push({ sourceId, sampleRate: trackRate, channels });
			clips.push(clip);
			clipIds.push(clip.id);
		}
		tracks.push(createAudioTrackV10({
			id: trackId,
			name: String(inputTrack.name || `Track ${trackIndex + 1}`),
			gain: finiteInRange(inputTrack.gain, 0, 4, 1),
			pan: finiteInRange(inputTrack.pan, -1, 1, 0),
			mute: Boolean(inputTrack.mute),
			solo: Boolean(inputTrack.solo),
			displayMode: ['waveform', 'spectrogram', 'multiview'].includes(inputTrack.displayMode) ? inputTrack.displayMode : 'waveform',
			spectrogram: inputTrack.spectrogram,
			clipIds,
			opaqueExtensions: inputTrack.opaqueExtensions || {},
		}, sampleRate));
	}
	const laneTracks = spreadLegacyOverlaps(tracks, clips, warnings);
	const metadata = {
		title: String(options.title || structure.metadata?.title || '').replace(/\.aup$/i, ''),
		artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {},
	};
	const importedTempoBpm = finiteInRange(structure.tempo?.bpm, 1, 1_000, 120);
	const musicalRoot = canonicalAudacityMusicalRoot(importedTempoBpm, structure.tempo?.timeSignature);
	const annotationImport = createAudacityAnnotationImport(annotationTracks, {
		sampleRate,
		tempoMap: musicalRoot.tempoMap,
		sequenceId: 'main-sequence',
		idFactory,
	});
	const project = createCurrentAudioEditorProject({
		id: options.projectId || idFactory('project'),
		title: metadata.title || 'Audacity project',
		now: options.now,
		sampleRate,
		...musicalRoot,
		selection: {
			startFrame: secondsToSampleFrame(nonNegative(structure.selection?.startSeconds), sampleRate),
			endFrame: secondsToSampleFrame(nonNegative(Math.max(structure.selection?.startSeconds || 0, structure.selection?.endSeconds || 0)), sampleRate),
			annotationIds: annotationImport.selectedAnnotationIds,
		},
		view: structure.view,
		metadata,
		sources,
		clips,
		tracks: laneTracks,
		timelineAnnotations: annotationImport.annotations,
		opaqueExtensions: {
			legacyAupProject: structure.opaqueExtensions?.legacyAupProject || null,
			legacyAupWarnings: warnings,
		},
	});
	return { project, sources: sourceAudio, warnings };
}

function spreadLegacyOverlaps(tracks, clips, warnings) {
	const clipById = new Map(clips.map((clip) => [clip.id, clip]));
	const output = [];
	for (const track of tracks) {
		if (track.type === 'label') { output.push(track); continue; }
		const lanes = [];
		for (const clipId of track.clipIds) {
			const clip = clipById.get(clipId);
			let lane = lanes.find((candidate) => candidate.endFrame <= clip.timelineStartFrame);
			if (!lane) { lane = { clipIds: [], endFrame: 0 }; lanes.push(lane); }
			lane.clipIds.push(clipId);
			lane.endFrame = clip.timelineStartFrame + clip.durationFrames;
		}
		for (let index = 0; index < lanes.length; index += 1) output.push({
			...track,
			id: index ? `${track.id}-lane-${index + 1}` : track.id,
			name: index ? `${track.name} (${index + 1})` : track.name,
			clipIds: lanes[index].clipIds,
		});
		if (lanes.length > 1) warnings.push(`Overlapping clips on ${track.name} were preserved on ${lanes.length} lanes.`);
	}
	return output;
}

function convertEnvelope(points = [], inputRate, projectRate, speedRatio, maximumFrame) {
	return points.map((point) => ({
		frame: Math.max(0, Math.min(maximumFrame, secondsToSampleFrame(
			divideRationals(
				divideRationals(nonNegative(point.frame), normalizeRational(inputRate)),
				normalizeRational(speedRatio),
			),
			projectRate,
		))),
		value: Math.max(0, Math.min(16, Number(point.value) || 0)),
	})).sort((left, right) => left.frame - right.frame)
		.filter((point, index, values) => !index || point.frame > values[index - 1].frame);
}

function normalizeSourceChannels(channels) {
	if (!Array.isArray(channels) || !channels.length) throw new TypeError('Legacy AUP clip channels are missing.');
	const frameCount = channels[0]?.length;
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new RangeError('Legacy AUP clip audio is empty.');
	return channels.map((channel) => {
		if (!(channel instanceof Float32Array)) throw new TypeError('Legacy AUP clip channels must be Float32Array values.');
		if (channel.length === frameCount) return channel;
		const padded = new Float32Array(frameCount);
		padded.set(channel.subarray(0, frameCount));
		return padded;
	});
}

function legacySampleFormat(value) {
	return Number(value) === 0x00020001 ? 'int16' : Number(value) === 0x00040001 ? 'int24' : Number(value) === 0x0004000f ? 'float32' : 'unknown';
}

function positiveRate(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 768_000) throw new RangeError('Legacy AUP sample rate is invalid.');
	return number;
}

function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
