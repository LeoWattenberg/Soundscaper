import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from './project-v2.js';
import { createStableId } from './project.js';

/** Convert structured AUP3 decode output into the V2 materialized model. */
export function convertStructuredAup3ToProjectV2(structure, options = {}) {
	if (!structure || !Array.isArray(structure.tracks)) throw new TypeError('Structured AUP3 data is required.');
	const idFactory = options.idFactory || createStableId;
	const sampleRate = positiveRate(structure.sampleRate);
	const sources = [];
	const sourceAudio = [];
	const clips = [];
	const tracks = [];
	const warnings = [...(structure.warnings || [])];
	for (const [trackIndex, inputTrack] of structure.tracks.entries()) {
		if (inputTrack.type === 'label') {
			tracks.push(createLabelTrackV2({
				id: idFactory('label-track'),
				name: String(inputTrack.name || `Labels ${trackIndex + 1}`),
				labels: (inputTrack.labels || []).map((label) => createLabelV2({
					id: idFactory('label'),
					title: String(label.title || ''),
					startFrame: secondsToFrames(label.startSeconds, sampleRate),
					endFrame: secondsToFrames(Math.max(label.startSeconds, label.endSeconds), sampleRate),
					opaqueExtensions: label.opaqueExtensions || {},
				})),
				opaqueExtensions: inputTrack.opaqueExtensions || {},
			}));
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
			const durationFrames = Math.max(1, Math.round(sourceDurationFrames / trackRate * sampleRate / speedRatio));
			const sourceId = idFactory('source');
			const clipId = idFactory('clip');
			const name = String(inputClip.name || `${inputTrack.name || 'Audio'} ${clipIndex + 1}`);
			const source = createAudioSourceV2({
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/x-audacity-sampleblocks',
				frameCount,
				channelCount: channels.length,
				sampleRate: trackRate,
				originalSampleRate: trackRate,
				sampleFormat: legacySampleFormat(inputTrack.sampleFormat),
				opaqueExtensions: { aup3Source: inputClip.opaqueExtensions || {} },
			});
			const clip = createAudioClipV2({
				id: clipId,
				sourceId,
				title: name,
				timelineStartFrame: secondsToFrames(inputClip.startSeconds, sampleRate),
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
		tracks.push(createAudioTrackV2({
			id: trackId,
			name: String(inputTrack.name || `Track ${trackIndex + 1}`),
			gain: finiteInRange(inputTrack.gain, 0, 4, 1),
			pan: finiteInRange(inputTrack.pan, -1, 1, 0),
			mute: Boolean(inputTrack.mute),
			solo: Boolean(inputTrack.solo),
			channelCount: Math.max(1, Number(inputTrack.channelCount) || sourceAudio.at(-1)?.channels.length || 1),
			channelLayout: inputTrack.channelLayout || (Number(inputTrack.channelCount) === 2 ? 'stereo' : 'mono'),
			sampleRate: trackRate,
			sampleFormat: legacySampleFormat(inputTrack.sampleFormat),
			displayMode: ['waveform', 'spectrogram', 'multiview'].includes(inputTrack.displayMode) ? inputTrack.displayMode : 'waveform',
			spectrogram: inputTrack.spectrogram,
			clipIds,
			opaqueExtensions: inputTrack.opaqueExtensions || {},
		}));
	}
	const laneTracks = spreadLegacyOverlaps(tracks, clips, warnings);
	const metadata = {
		title: String(options.title || structure.metadata?.title || '').replace(/\.aup3$/i, ''),
		artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {},
	};
	const project = createAudioEditorProjectV2({
		id: options.projectId || idFactory('project'),
		title: metadata.title || 'Audacity project',
		now: options.now,
		sampleRate,
		tempo: structure.tempo,
		selection: {
			startFrame: secondsToFrames(structure.selection?.startSeconds, sampleRate),
			endFrame: secondsToFrames(Math.max(structure.selection?.startSeconds || 0, structure.selection?.endSeconds || 0), sampleRate),
		},
		view: structure.view,
		metadata,
		sources,
		clips,
		tracks: laneTracks,
		opaqueExtensions: {
			aup3Project: structure.opaqueExtensions?.aup3Project || null,
			aup3Warnings: warnings,
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
		frame: Math.max(0, Math.min(maximumFrame, Math.round(Number(point.frame) / inputRate * projectRate / speedRatio))),
		value: Math.max(0, Math.min(16, Number(point.value) || 0)),
	})).sort((left, right) => left.frame - right.frame)
		.filter((point, index, values) => !index || point.frame > values[index - 1].frame);
}

function normalizeSourceChannels(channels) {
	if (!Array.isArray(channels) || !channels.length) throw new TypeError('AUP3 clip channels are missing.');
	const frameCount = channels[0]?.length;
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new RangeError('AUP3 clip audio is empty.');
	return channels.map((channel) => {
		if (!(channel instanceof Float32Array)) throw new TypeError('AUP3 clip channels must be Float32Array values.');
		if (channel.length === frameCount) return channel;
		const padded = new Float32Array(frameCount);
		padded.set(channel.subarray(0, frameCount));
		return padded;
	});
}

function legacySampleFormat(value) {
	return Number(value) === 0x00020001 ? 'int16' : Number(value) === 0x00040001 ? 'int24' : Number(value) === 0x0004000f ? 'float32' : 'unknown';
}

function secondsToFrames(seconds, sampleRate) {
	return Math.max(0, Math.round((Number(seconds) || 0) * sampleRate));
}

function positiveRate(value) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 768_000) throw new RangeError('AUP3 sample rate is invalid.');
	return number;
}

function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
