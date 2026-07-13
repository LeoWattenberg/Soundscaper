import { decodeAup3SampleBlock } from '../aup3.js';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
} from './audacity-binary-xml.js';
import { readAup4EffectsNode } from './aup4-effects.js';
import { sanitizeAup4ProjectRoot } from './aup4-sanitization.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from './project-v2.js';
import { createStableId } from './project.js';

const DEFAULT_MAX_DECODED_BYTES = 512 * 1024 * 1024;

export async function decodeAup4ProjectTree(root, loadBlock, options = {}) {
	if (!root || root.name !== 'project') throw conversionError('The AUP4 document has no project root.', 'INVALID_PROJECT_XML');
	if (typeof loadBlock !== 'function') throw new TypeError('An AUP4 sample-block loader is required.');
	const sanitization = sanitizeAup4ProjectRoot(root);
	root = sanitization.node;
	const idFactory = options.idFactory || createStableId;
	const projectRate = positiveRate(audacityXmlAttribute(root, 'rate', 44_100));
	const maxDecodedBytes = positiveInteger(options.maxDecodedBytes, DEFAULT_MAX_DECODED_BYTES);
	const state = { decodedBytes: 0, maxDecodedBytes, warnings: [], loadBlock, onProgress: options.onProgress, totalBlocks: countWaveBlocks(root), completedBlocks: 0 };
	if (sanitization.report.discardedEntries) {
		state.warnings.push(`${sanitization.report.discardedEntries} excluded cloud/account metadata ${sanitization.report.discardedEntries === 1 ? 'entry was' : 'entries were'} discarded.`);
	}
	const sources = [];
	const clips = [];
	const tracks = [];
	const sourceAudio = [];
	const selectedTrackIds = [];
	const waveTracks = audacityXmlChildren(root, 'wavetrack');
	const channelGroups = groupWaveTracks(waveTracks, state.warnings);

	for (let trackIndex = 0; trackIndex < channelGroups.length; trackIndex += 1) {
		const group = channelGroups[trackIndex];
		const trackId = idFactory('track');
		const clipIds = [];
		const clipNodesByChannel = group.map((node) => audacityXmlChildren(node, 'waveclip'));
		const clipCount = Math.max(0, ...clipNodesByChannel.map((items) => items.length));
		const trackRate = positiveRate(audacityXmlAttribute(group[0], 'rate', projectRate));
		if (group.some((node) => positiveRate(audacityXmlAttribute(node, 'rate', trackRate)) !== trackRate)) {
			warn(state, `Linked channels in track ${trackIndex + 1} use different sample rates; the first channel rate was used.`);
		}
		for (let clipIndex = 0; clipIndex < clipCount; clipIndex += 1) {
			const channelNodes = clipNodesByChannel.map((items) => items[clipIndex]).filter(Boolean);
			if (!channelNodes.length) continue;
			const channels = [];
			for (let channel = 0; channel < group.length; channel += 1) {
				const clipNode = clipNodesByChannel[channel]?.[clipIndex];
				channels.push(clipNode ? await decodeClipSequence(clipNode, state) : new Float32Array(0));
			}
			const frameCount = Math.max(...channels.map((channel) => channel.length));
			if (!frameCount) {
				warn(state, `Clip ${clipIndex + 1} on track ${trackIndex + 1} contains no readable samples.`);
				continue;
			}
			for (let channel = 0; channel < channels.length; channel += 1) {
				if (channels[channel].length === frameCount) continue;
				const padded = new Float32Array(frameCount);
				padded.set(channels[channel]);
				channels[channel] = padded;
				warn(state, `Clip ${clipIndex + 1} on track ${trackIndex + 1} had mismatched channel lengths and was padded.`);
			}
			const clipNode = channelNodes[0];
			const storedStretchRatio = positive(audacityXmlAttribute(clipNode, 'clipStretchRatio', 1), 1);
			const clipTempo = optionalPositive(audacityXmlAttribute(clipNode, 'clipTempo', null));
			const rawAudioTempo = optionalPositive(audacityXmlAttribute(clipNode, 'rawAudioTempo', null));
			const stretchRatio = storedStretchRatio * (clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1);
			const trimLeftSeconds = nonNegative(audacityXmlAttribute(clipNode, 'trimLeft', 0));
			const trimRightSeconds = nonNegative(audacityXmlAttribute(clipNode, 'trimRight', 0));
			const trimStartFrames = secondsToFrames(trimLeftSeconds / stretchRatio, trackRate);
			const trimEndFrames = secondsToFrames(trimRightSeconds / stretchRatio, trackRate);
			const sourceDurationFrames = Math.max(1, frameCount - trimStartFrames - trimEndFrames);
			const offsetSeconds = finite(audacityXmlAttribute(clipNode, 'offset', 0), 0);
			const timelineStartFrame = Math.max(0, secondsToFrames(offsetSeconds + trimLeftSeconds, projectRate));
			const durationFrames = Math.max(1, Math.round(sourceDurationFrames / trackRate * projectRate * stretchRatio));
			const sourceId = idFactory('source');
			const clipId = idFactory('clip');
			const source = createAudioSourceV2({
				id: sourceId,
				name: String(audacityXmlAttribute(clipNode, 'name', `Audio ${clipIndex + 1}`)),
				mimeType: 'audio/x-audacity-sampleblocks',
				storageKey: sourceId,
				frameCount,
				channelCount: channels.length,
				sampleRate: trackRate,
				originalSampleRate: trackRate,
				sampleFormat: 'float32',
				opaqueExtensions: { aup4Sequence: opaqueNode(audacityXmlChildren(clipNode, 'sequence')[0]) },
			});
			const groupId = audacityXmlAttribute(clipNode, 'groupId', -1);
			const clip = createAudioClipV2({
				id: clipId,
				sourceId,
				title: String(audacityXmlAttribute(clipNode, 'name', `Audio ${clipIndex + 1}`)),
				timelineStartFrame,
				sourceStartFrame: trimStartFrames,
				sourceDurationFrames,
				durationFrames,
				trimStartFrames,
				trimEndFrames,
				gain: 1,
				envelope: readEnvelope(clipNode, projectRate),
				groupId: Number(groupId) >= 0 ? `aup4-group-${groupId}` : null,
				color: String(audacityXmlAttribute(clipNode, 'colorindex', audacityXmlAttribute(clipNode, 'color', 'auto'))) || 'auto',
				pitchCents: clamp(finite(audacityXmlAttribute(clipNode, 'centShift', 0), 0), -1200, 1200),
				speedRatio: 1 / stretchRatio,
				preserveFormants: Boolean(audacityXmlAttribute(clipNode, 'preserveFormants', false)),
				stretchToTempo: Boolean(audacityXmlAttribute(clipNode, 'clipStretchToMatchTempo', false)),
				opaqueExtensions: { aup4WaveClip: opaqueNode(clipNode), aup4WaveClips: channelNodes.map(opaqueNode) },
			});
			sources.push(source);
			clips.push(clip);
			clipIds.push(clip.id);
			sourceAudio.push({ sourceId, sampleRate: trackRate, channels });
		}
		const selected = group.some((node) => Boolean(audacityXmlAttribute(node, 'isSelected', false)));
		if (selected) selectedTrackIds.push(trackId);
		const trackEffectsNode = audacityXmlChildren(group[0], 'effects')[0];
		tracks.push(createAudioTrackV2({
			id: trackId,
			name: String(audacityXmlAttribute(group[0], 'name', `Track ${trackIndex + 1}`)),
			gain: finiteInRange(lastAttribute(group[0], 'gain', 1), 0, 4, 1),
			pan: finiteInRange(audacityXmlAttribute(group[0], 'pan', 0), -1, 1, 0),
			mute: Boolean(audacityXmlAttribute(group[0], 'mute', false)),
			solo: Boolean(audacityXmlAttribute(group[0], 'solo', false)),
			channelCount: group.length,
			channelLayout: group.length === 1 ? 'mono' : group.length === 2 ? 'stereo' : 'custom',
			sampleRate: trackRate,
			sampleFormat: sampleFormatName(audacityXmlAttribute(group[0], 'sampleformat', 0)),
			displayMode: displayMode(audacityXmlAttribute(group[0], 'trackViewType', 0)),
			spectrogram: readSpectrogram(group[0], trackRate),
			effects: readAup4EffectsNode(trackEffectsNode, { idFactory }),
			clipIds,
			collapsed: Number(audacityXmlAttribute(group[0], 'height', 160)) > 0 && Number(audacityXmlAttribute(group[0], 'height', 160)) < 60,
			height: Math.max(40, Math.round(positive(audacityXmlAttribute(group[0], 'height', 160), 160))),
			opaqueExtensions: {
				aup4WaveTracks: group.map(opaqueNode),
				// Preserve channel positions. Filtering null entries would move a rare
				// follower-channel rack onto the leader during a browser rewrite.
				effects: group.map((node) => opaqueNode(audacityXmlChildren(node, 'effects')[0])),
			},
		}));
	}

	for (const [index, labelNode] of audacityXmlChildren(root, 'labeltrack').entries()) {
		const trackId = idFactory('label-track');
		const labels = audacityXmlChildren(labelNode, 'label').map((node) => createLabelV2({
			id: idFactory('label'),
			title: String(audacityXmlAttribute(node, 'title', '')),
			startFrame: secondsToFrames(nonNegative(audacityXmlAttribute(node, 't', 0)), projectRate),
			endFrame: secondsToFrames(nonNegative(audacityXmlAttribute(node, 't1', audacityXmlAttribute(node, 't', 0))), projectRate),
			opaqueExtensions: { aup4Label: opaqueNode(node) },
		}));
		if (Boolean(audacityXmlAttribute(labelNode, 'isSelected', false))) selectedTrackIds.push(trackId);
		tracks.push(createLabelTrackV2({
			id: trackId,
			name: String(audacityXmlAttribute(labelNode, 'name', `Labels ${index + 1}`)),
			labels,
			opaqueExtensions: { aup4LabelTrack: opaqueNode(labelNode) },
		}));
	}

	const metadata = readMetadata(root);
	const title = String(options.title || metadata.title || 'Audacity project').replace(/\.aup4$/i, '') || 'Audacity project';
	const knownRootChildren = new Set(['tags', 'wavetrack', 'labeltrack', 'effects']);
	const masterEffectsNode = audacityXmlChildren(root, 'effects').at(-1);
	const project = createAudioEditorProjectV2({
		id: options.projectId || idFactory('project'),
		title,
		sampleRate: projectRate,
		masterChannels: 2,
		tempo: {
			bpm: finiteInRange(audacityXmlAttribute(root, 'time_signature_tempo', 120), 1, 1000, 120),
			timeSignature: {
				numerator: integerInRange(audacityXmlAttribute(root, 'time_signature_upper', 4), 1, 32, 4),
				denominator: powerOfTwo(audacityXmlAttribute(root, 'time_signature_lower', 4), 4),
			},
		},
		snap: readSnap(root),
		timeDisplay: { format: String(audacityXmlAttribute(root, 'selectionformat', 'seconds')) || 'seconds' },
		metadata,
		selection: {
			startFrame: secondsToFrames(nonNegative(audacityXmlAttribute(root, 'sel0', 0)), projectRate),
			endFrame: secondsToFrames(nonNegative(audacityXmlAttribute(root, 'sel1', 0)), projectRate),
			trackIds: selectedTrackIds,
			clipIds: [],
			frequencyRange: readFrequencyRange(root, projectRate),
		},
		view: {
			zoom: positive(audacityXmlAttribute(root, 'viewstate_zoom', audacityXmlAttribute(root, 'zoom', 86.1328125)), 86.1328125),
			horizontalPosition: nonNegative(audacityXmlAttribute(root, 'viewstate_hpos', audacityXmlAttribute(root, 'h', 0))),
			verticalPosition: Math.max(0, Math.round(finite(audacityXmlAttribute(root, 'viewstate_vpos', audacityXmlAttribute(root, 'vpos', 0)), 0))),
			selectedTrackIds,
		},
		sources,
		clips,
		tracks: spreadOverlappingTracks(tracks, clips, state.warnings),
		master: { gain: 1, pan: 0, effects: readAup4EffectsNode(masterEffectsNode, { idFactory }) },
		opaqueExtensions: {
			aup4RootAttributes: audacityXmlAttributes(root).map((entry) => ({ ...entry })),
				aup4UnknownNodes: root.content.filter((entry) => entry.kind === 'node' && !knownRootChildren.has(entry.node.name)).map((entry) => opaqueNode(entry.node)),
			aup4MasterEffects: opaqueNode(masterEffectsNode),
		},
	});
	return {
		project,
		sources: sourceAudio,
		warnings: state.warnings,
		compatibilityReport: {
			discardedCloudMetadata: sanitization.report,
			missingAudio: [],
			networkAccessAttempted: false,
		},
	};
}

async function decodeClipSequence(clipNode, state) {
	const sequence = audacityXmlChildren(clipNode, 'sequence')[0];
	if (!sequence) return new Float32Array(0);
	const sampleCount = nonNegativeInteger(audacityXmlAttribute(sequence, 'numsamples', 0), 0);
	if (sampleCount * 4 + state.decodedBytes > state.maxDecodedBytes) throw conversionError('The AUP4 project exceeds the browser decode-memory limit.', 'PROJECT_TOO_LARGE');
	const output = new Float32Array(sampleCount);
	state.decodedBytes += output.byteLength;
	for (const waveBlock of audacityXmlChildren(sequence, 'waveblock')) {
		const blockId = Number(audacityXmlAttribute(waveBlock, 'blockid', 0));
		const start = nonNegativeInteger(audacityXmlAttribute(waveBlock, 'start', 0), 0);
		if (blockId <= 0) {
			const length = nonNegativeInteger(audacityXmlAttribute(waveBlock, 'length', -blockId), Math.max(0, -blockId));
			if (blockId === 0 && length) warn(state, 'An invalid zero-id silent AUP4 sample block was replaced with silence.');
			state.completedBlocks += 1;
			state.onProgress?.({ value: state.totalBlocks ? state.completedBlocks / state.totalBlocks : 1, phase: 'decoding-audio', blockId });
			continue;
		}
		const block = await state.loadBlock(blockId);
		if (!block) {
			warn(state, `AUP4 sample block ${blockId} is missing.`);
			continue;
		}
		let samples;
		try { samples = decodeAup3SampleBlock(block.samples, block.sampleformat); }
		catch (error) {
			warn(state, `AUP4 sample block ${blockId} could not be decoded: ${error.message}`);
			continue;
		}
		output.set(samples.subarray(0, Math.max(0, output.length - start)), Math.min(start, output.length));
		state.completedBlocks += 1;
		state.onProgress?.({ value: state.totalBlocks ? state.completedBlocks / state.totalBlocks : 1, phase: 'decoding-audio', blockId });
	}
	return output;
}

function groupWaveTracks(nodes, warnings) {
	const groups = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const first = nodes[index];
		const linked = Number(audacityXmlAttribute(first, 'linked', 0)) !== 0;
		const channel = Number(audacityXmlAttribute(first, 'channel', 0));
		const nextChannel = Number(audacityXmlAttribute(nodes[index + 1], 'channel', -1));
		if ((linked || (channel === 0 && nextChannel === 1)) && nodes[index + 1]) groups.push([first, nodes[++index]]);
		else groups.push([first]);
	}
	for (const group of groups) if (group.length > 2) warnings.push('A multichannel Audacity track was imported with a custom layout.');
	return groups;
}

function spreadOverlappingTracks(tracks, clips, warnings) {
	const result = [];
	const clipById = new Map(clips.map((clip) => [clip.id, clip]));
	for (const track of tracks) {
		if (track.type === 'label') {
			result.push(track);
			continue;
		}
		const lanes = [];
		for (const clipId of track.clipIds) {
			const clip = clipById.get(clipId);
			let lane = lanes.find((candidate) => candidate.endFrame <= clip.timelineStartFrame);
			if (!lane) {
				lane = { ids: [], endFrame: 0 };
				lanes.push(lane);
			}
			lane.ids.push(clipId);
			lane.endFrame = clip.timelineStartFrame + clip.durationFrames;
		}
		for (let index = 0; index < lanes.length; index += 1) result.push({
			...track,
			id: index ? `${track.id}-lane-${index + 1}` : track.id,
			name: index ? `${track.name} (${index + 1})` : track.name,
			clipIds: lanes[index].ids,
		});
		if (lanes.length > 1) warnings.push(`Overlapping clips on ${track.name} were placed on ${lanes.length} browser lanes; their native nodes remain preserved.`);
	}
	return result;
}

function readEnvelope(clipNode, projectRate) {
	const envelope = audacityXmlChildren(clipNode, 'envelope')[0];
	if (!envelope) return [];
	return audacityXmlChildren(envelope, 'controlpoint').map((point) => ({
		frame: Math.max(0, Math.round(nonNegative(audacityXmlAttribute(point, 't', 0)) * projectRate)),
		value: finiteInRange(audacityXmlAttribute(point, 'val', 1), 0, 16, 1),
	})).sort((left, right) => left.frame - right.frame).filter((point, index, all) => !index || point.frame > all[index - 1].frame);
}

function readMetadata(root) {
	const metadata = { title: '', artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {} };
	const known = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', TRACK: 'trackNumber', TRACKNUMBER: 'trackNumber', YEAR: 'year', COMMENTS: 'comments', COMMENT: 'comments' };
	for (const tag of audacityXmlChildren(audacityXmlChildren(root, 'tags')[0], 'tag')) {
		const name = String(audacityXmlAttribute(tag, 'name', '')).toUpperCase();
		const value = String(audacityXmlAttribute(tag, 'value', ''));
		if (known[name]) metadata[known[name]] = value;
		else if (name) metadata.tags[name] = value;
	}
	return metadata;
}

function readSnap(root) {
	const enabled = Boolean(audacityXmlAttribute(root, 'snap_enabled', false));
	const type = Number(audacityXmlAttribute(root, 'snap_type', 0));
	return { enabled, unit: snapUnit(type), mode: 'nearest', triplets: Boolean(audacityXmlAttribute(root, 'snap_triplets', false)), opaqueType: type };
}

function readFrequencyRange(root, sampleRate) {
	const minimum = Number(audacityXmlAttribute(root, 'selLow', Number.NaN));
	const maximum = Number(audacityXmlAttribute(root, 'selHigh', Number.NaN));
	if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum <= minimum) return null;
	return { minimumFrequency: Math.min(sampleRate / 2, minimum), maximumFrequency: Math.min(sampleRate / 2, maximum) };
}

function readSpectrogram(node, sampleRate) {
	let minimumFrequency = finiteInRange(audacityXmlAttribute(node, 'minFreq', 0), 0, sampleRate / 2, 0);
	let maximumFrequency = finiteInRange(audacityXmlAttribute(node, 'maxFreq', Math.min(20_000, sampleRate / 2)), 0, sampleRate / 2, Math.min(20_000, sampleRate / 2));
	if (maximumFrequency <= minimumFrequency) { minimumFrequency = 0; maximumFrequency = Math.max(1, Math.min(20_000, sampleRate / 2)); }
	return {
		scale: 'mel', minimumFrequency, maximumFrequency,
		windowSize: powerOfTwo(audacityXmlAttribute(node, 'windowSize', 2048), 2048),
		windowType: 'hann',
		gain: finiteInRange(audacityXmlAttributes(node, 'gain')[0]?.value, -120, 120, 20),
		range: finiteInRange(audacityXmlAttribute(node, 'range', 80), 1, 240, 80),
	};
}

function countWaveBlocks(root) {
	let count = 0;
	for (const track of audacityXmlChildren(root, 'wavetrack')) for (const clip of audacityXmlChildren(track, 'waveclip')) {
		for (const sequence of audacityXmlChildren(clip, 'sequence')) count += audacityXmlChildren(sequence, 'waveblock').length;
	}
	return count;
}

function opaqueNode(node) { return node ? { kind: 'node', node } : null; }
function lastAttribute(node, name, fallback) { return audacityXmlAttributes(node, name).at(-1)?.value ?? fallback; }
function sampleFormatName(value) { return Number(value) === 0x00020001 ? 'int16' : Number(value) === 0x00040001 ? 'int24' : Number(value) === 0x0004000f ? 'float32' : 'unknown'; }
function displayMode(value) { return Number(value) === 1 ? 'spectrogram' : Number(value) === 2 ? 'multiview' : 'waveform'; }
function snapUnit(type) { return type > 0 && type <= 12 ? 'beats' : type >= 13 && type <= 25 ? 'seconds' : type >= 26 ? 'frames' : 'seconds'; }
function warn(state, message) { if (!state.warnings.includes(message)) state.warnings.push(message); }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function optionalPositive(value) { const number = Number(value); return value != null && value !== '' && Number.isFinite(number) && number > 0 ? number : null; }
function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function finiteInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback; }
function integerInRange(value, minimum, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback; }
function nonNegativeInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : fallback; }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
function positiveRate(value) { const rate = Number(value); if (!Number.isFinite(rate) || rate < 1 || rate > 768_000) throw conversionError('The AUP4 project contains an invalid sample rate.', 'INVALID_SAMPLE_RATE'); return Math.round(rate); }
function powerOfTwo(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 && (number & (number - 1)) === 0 ? number : fallback; }
function secondsToFrames(seconds, sampleRate) { return Math.max(0, Math.round(Number(seconds) * sampleRate)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function conversionError(message, code) { const error = new Error(message); error.name = 'Aup4ConversionError'; error.code = code; return error; }
