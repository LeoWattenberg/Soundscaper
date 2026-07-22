import { decodeAup3SampleBlock } from '../aup3.js';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
} from './audacity-binary-xml.js';
import { readAup4EffectsNode } from './aup4-effects.js';
import {
	addAup4CompatibilityItem,
	createAup4CompatibilityReport,
} from './aup4-profile.js';
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
import { createStreamingWindowedSincResampler } from './resample.js';
import { normalizeAudioEditorSnapSettings } from './snap-grid.js';

const DEFAULT_MAX_DECODED_BYTES = 512 * 1024 * 1024;

export async function decodeAup4ProjectTree(root, loadBlock, options = {}) {
	if (!root || root.name !== 'project') throw conversionError('The AUP4 document has no project root.', 'INVALID_PROJECT_XML');
	if (typeof loadBlock !== 'function') throw new TypeError('An AUP4 sample-block loader is required.');
	const sanitization = sanitizeAup4ProjectRoot(root);
	root = sanitization.node;
	const idFactory = options.idFactory || createStableId;
	const projectRate = positiveRate(audacityXmlAttribute(root, 'rate', 44_100));
	const maxDecodedBytes = positiveInteger(options.maxDecodedBytes, DEFAULT_MAX_DECODED_BYTES);
	const compatibilityReport = createAup4CompatibilityReport('open', {
		discardedCloudMetadata: sanitization.report,
		missingAudio: [],
		networkAccessAttempted: false,
	});
	const state = {
		decodedBytes: 0,
		maxDecodedBytes,
		warnings: [],
		compatibilityReport,
		loadBlock,
		onProgress: options.onProgress,
		totalBlocks: countWaveBlocks(root),
		completedBlocks: 0,
	};
	const unsupportedNestedWaveClips = countUnsupportedWaveClips(root);
	if (unsupportedNestedWaveClips) {
		warn(state, `${unsupportedNestedWaveClips} unsupported nested wave ${unsupportedNestedWaveClips === 1 ? 'clip was' : 'clips were'} discarded.`);
		addAup4CompatibilityItem(compatibilityReport, {
			code: 'UNSUPPORTED_NESTED_WAVECLIP',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: { count: unsupportedNestedWaveClips },
		});
	}
	if (sanitization.report.discardedEntries) {
		state.warnings.push(`${sanitization.report.discardedEntries} excluded cloud/account metadata ${sanitization.report.discardedEntries === 1 ? 'entry was' : 'entries were'} discarded.`);
		addAup4CompatibilityItem(compatibilityReport, {
			code: 'EXCLUDED_CLOUD_METADATA',
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: { discardedEntries: sanitization.report.discardedEntries },
		});
	}
	const sources = [];
	const clips = [];
	const tracks = [];
	const sourceAudio = [];
	const selectedTrackIds = [];
	const selectedClipIds = [];
	const waveTracks = audacityXmlChildren(root, 'wavetrack');
	const channelGroups = groupWaveTracks(waveTracks, state);
	const trackIdByRootNode = new Map();

	for (let trackIndex = 0; trackIndex < channelGroups.length; trackIndex += 1) {
		const group = channelGroups[trackIndex];
		const trackId = idFactory('track');
		const clipIds = [];
		const trackRate = positiveRate(audacityXmlAttribute(group[0], 'rate', projectRate));
		const sourceSampleFormat = sampleFormatName(audacityXmlAttribute(group[0], 'sampleformat', 0));
		const channelRates = group.map((node) => positiveRate(audacityXmlAttribute(node, 'rate', trackRate)));
		const alignedClipNodes = alignWaveClips(group, channelRates, state, trackIndex);
		if (channelRates.some((rate) => rate !== trackRate)) {
			warn(state, `Linked channels in track ${trackIndex + 1} use different sample rates; the first channel rate was used.`);
			addAup4CompatibilityItem(compatibilityReport, {
				code: 'LINKED_CHANNEL_RATE_CONVERTED',
				severity: 'warning',
				disposition: 'converted',
				scope: { kind: 'track', trackId, trackIndex },
				data: { channelRates, targetRate: trackRate },
			});
		}
		for (let clipIndex = 0; clipIndex < alignedClipNodes.length; clipIndex += 1) {
			const alignedChannels = alignedClipNodes[clipIndex];
			const channelNodes = alignedChannels.filter(Boolean);
			if (!channelNodes.length) continue;
			const channels = [];
			for (let channel = 0; channel < group.length; channel += 1) {
				const clipNode = alignedChannels[channel];
				const decoded = clipNode ? await decodeClipSequence(clipNode, state) : new Float32Array(0);
				channels.push(channelRates[channel] === trackRate
					? decoded
					: resampleMono(decoded, channelRates[channel], trackRate));
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
			const pitchAndSpeedPreset = readPitchAndSpeedPreset(clipNode);
			const envelope = readEnvelope(
				clipNode,
				projectRate,
				trimLeftSeconds,
				durationFrames,
			);
			const nativeEnvelopeNode = audacityXmlChildren(clipNode, 'envelope')[0];
			const source = createAudioSourceV2({
				id: sourceId,
				name: String(audacityXmlAttribute(clipNode, 'name', `Audio ${clipIndex + 1}`)),
				mimeType: 'audio/x-audacity-sampleblocks',
				storageKey: sourceId,
				frameCount,
				channelCount: channels.length,
				sampleRate: trackRate,
				originalSampleRate: trackRate,
				sampleFormat: sourceSampleFormat,
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
				envelope,
				groupId: Number(groupId) >= 0 ? `aup4-group-${groupId}` : null,
				color: String(audacityXmlAttribute(clipNode, 'colorindex', audacityXmlAttribute(clipNode, 'color', 'auto'))) || 'auto',
				pitchCents: clamp(finite(audacityXmlAttribute(clipNode, 'centShift', 0), 0), -1200, 1200),
				speedRatio: 1 / stretchRatio,
				preserveFormants: pitchAndSpeedPreset === 1,
				stretchToTempo: Boolean(audacityXmlAttribute(clipNode, 'clipStretchToMatchTempo', false)),
				opaqueExtensions: {
					aup4WaveClip: opaqueWaveClipNode(clipNode),
					aup4WaveClips: alignedChannels.map(opaqueWaveClipNode),
					aup4PitchAndSpeedPreset: {
						value: pitchAndSpeedPreset,
						preserveFormants: pitchAndSpeedPreset === 1,
					},
					aup4Envelope: nativeEnvelopeNode ? {
						node: opaqueNode(nativeEnvelopeNode),
						model: cloneOpaqueValue(envelope),
						trimLeftSeconds,
						durationFrames,
					} : null,
				},
			});
			if (channelNodes.some((node) => Boolean(audacityXmlAttribute(node, 'isSelected', false)))) selectedClipIds.push(clipId);
			sources.push(source);
			clips.push(clip);
			clipIds.push(clip.id);
			sourceAudio.push({ sourceId, sampleRate: trackRate, channels });
		}
		const selected = group.some((node) => Boolean(audacityXmlAttribute(node, 'isSelected', false)));
		if (selected) selectedTrackIds.push(trackId);
		const trackEffectsNode = audacityXmlChildren(group[0], 'effects')[0];
		let effectsActive = true;
		const trackEffects = readEffectsWithReport(trackEffectsNode, state, {
			kind: 'track',
			trackId,
			trackIndex,
			name: String(audacityXmlAttribute(group[0], 'name', `Track ${trackIndex + 1}`)),
		}, idFactory, (active) => { effectsActive = active; });
		for (let channel = 1; channel < group.length; channel += 1) {
			if (!audacityXmlChildren(group[channel], 'effects').length) continue;
			addAup4CompatibilityItem(compatibilityReport, {
				code: 'FOLLOWER_CHANNEL_EFFECT_RACK_PRESERVED',
				severity: 'warning',
				disposition: 'preserved',
				scope: { kind: 'track-channel', trackId, trackIndex, channel },
				data: {},
			});
		}
		const track = createAudioTrackV2({
			id: trackId,
			name: String(audacityXmlAttribute(group[0], 'name', `Track ${trackIndex + 1}`)),
			color: trackColor(audacityXmlAttribute(group[0], 'colorindex', 0)),
			gain: finiteInRange(lastAttribute(group[0], 'gain', 1), 0, 4, 1),
			pan: finiteInRange(audacityXmlAttribute(group[0], 'pan', 0), -1, 1, 0),
			mute: Boolean(audacityXmlAttribute(group[0], 'mute', false)),
			solo: Boolean(audacityXmlAttribute(group[0], 'solo', false)),
			displayMode: displayMode(audacityXmlAttribute(group[0], 'trackViewType', 0)),
			spectrogram: readSpectrogram(group[0], trackRate),
			effectsActive,
			effects: trackEffects,
			clipIds,
			collapsed: Number(audacityXmlAttribute(group[0], 'height', 160)) > 0 && Number(audacityXmlAttribute(group[0], 'height', 160)) < 60,
			height: Math.max(40, Math.round(positive(audacityXmlAttribute(group[0], 'height', 160), 160))),
			opaqueExtensions: {
				aup4WaveTracks: group.map(opaqueWaveTrackNode),
				aup4TrackColor: {
					value: integerInRange(audacityXmlAttribute(group[0], 'colorindex', 0), 0, 0x7fff_ffff, 0),
					color: trackColor(audacityXmlAttribute(group[0], 'colorindex', 0)),
				},
				// Preserve channel positions. Filtering null entries would move a rare
				// follower-channel rack onto the leader during a browser rewrite.
				effects: group.map((node) => opaqueNode(audacityXmlChildren(node, 'effects')[0])),
			},
		}, projectRate);
		tracks.push(track);
		for (const node of group) trackIdByRootNode.set(node, track.id);
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
		const track = createLabelTrackV2({
			id: trackId,
			name: String(audacityXmlAttribute(labelNode, 'name', `Labels ${index + 1}`)),
			labels,
			collapsed: Number(audacityXmlAttribute(labelNode, 'height', 96)) > 0
				&& Number(audacityXmlAttribute(labelNode, 'height', 96)) < 60,
			height: Math.max(40, Math.round(positive(audacityXmlAttribute(labelNode, 'height', 96), 96))),
			opaqueExtensions: { aup4LabelTrack: opaqueNode(labelNode) },
		});
		tracks.push(track);
		trackIdByRootNode.set(labelNode, track.id);
	}

	const orderedTrackIds = [];
	for (const entry of root.content || []) {
		const trackId = entry.kind === 'node' ? trackIdByRootNode.get(entry.node) : null;
		if (trackId && !orderedTrackIds.includes(trackId)) orderedTrackIds.push(trackId);
	}
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	tracks.splice(0, tracks.length,
		...orderedTrackIds.map((trackId) => trackById.get(trackId)),
		...tracks.filter((track) => !orderedTrackIds.includes(track.id)));

	const metadata = readMetadata(root);
	const title = String(options.title || metadata.title || 'Audacity project').replace(/\.aup4$/i, '') || 'Audacity project';
	const knownRootChildren = new Set(['tags', 'wavetrack', 'labeltrack', 'effects']);
	const masterEffectsNode = audacityXmlChildren(root, 'effects').at(-1);
	const masterEffectsContentIndex = findNodeContentIndex(root, masterEffectsNode);
	let masterEffectsActive = true;
	const masterEffects = readEffectsWithReport(masterEffectsNode, state, {
		kind: 'master',
	}, idFactory, (active) => { masterEffectsActive = active; });
	const project = createAudioEditorProjectV2({
		id: options.projectId || idFactory('project'),
		title,
		sampleRate: projectRate,
		masterChannels: 2,
		tempo: {
			bpm: finiteInRange(audacityXmlAttribute(root, 'time_signature_tempo', 120), 1, 1000, 120),
			timeSignature: {
				numerator: integerInRange(audacityXmlAttribute(root, 'time_signature_upper', 4), 1, 0x7fff_ffff, 4),
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
			clipIds: selectedClipIds,
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
		tracks,
		master: {
			gain: 1,
			pan: 0,
			effectsActive: masterEffectsActive,
			effects: masterEffects,
		},
		opaqueExtensions: {
			aup4RootAttributes: audacityXmlAttributes(root).map((entry) => ({ ...entry })),
			aup4RootTemplate: opaqueRootTemplate(root, masterEffectsNode),
			aup4MasterEffectsContentIndex: masterEffectsContentIndex,
			aup4UnknownNodes: root.content.filter((entry) => entry.kind === 'node' && !knownRootChildren.has(entry.node.name)).map((entry) => opaqueNode(entry.node)),
			aup4MasterEffects: opaqueNode(masterEffectsNode),
		},
	});
	return {
		project,
		sources: sourceAudio,
		warnings: state.warnings,
		compatibilityReport,
	};
}

async function decodeClipSequence(clipNode, state) {
	const sequence = audacityXmlChildren(clipNode, 'sequence')[0];
	if (!sequence) return new Float32Array(0);
	const sampleCount = nonNegativeInteger(audacityXmlAttribute(sequence, 'numsamples', 0), 0);
	if (sampleCount * 4 + state.decodedBytes > state.maxDecodedBytes) throw conversionError('The AUP4 project exceeds the browser decode-memory limit.', 'PROJECT_TOO_LARGE');
	const output = new Float32Array(sampleCount);
	state.decodedBytes += output.byteLength;
	let expectedStart = 0;
	let lastBlockId = 0;
	for (const waveBlock of audacityXmlChildren(sequence, 'waveblock')) {
		const blockId = Number(audacityXmlAttribute(waveBlock, 'blockid', 0));
		const start = nonNegativeInteger(audacityXmlAttribute(waveBlock, 'start', 0), 0);
		const declaredLengthValue = audacityXmlAttribute(waveBlock, 'length', null);
		const declaredLength = nonNegativeInteger(
			declaredLengthValue ?? (blockId < 0 ? -blockId : -1),
			-1,
		);
		lastBlockId = blockId;
		if (start !== expectedStart) {
			warn(state, 'An AUP4 sequence has non-contiguous sample blocks.');
			recordUnavailablePcm(state, blockId, 'non-contiguous-sample-blocks');
		}
		if (blockId <= 0) {
			const length = declaredLength >= 0 ? declaredLength : Math.max(0, -blockId);
			if (blockId === 0) {
				warn(state, 'An invalid zero-id silent AUP4 sample block was replaced with silence.');
				recordUnavailablePcm(state, blockId, 'invalid-zero-sample-block');
			} else if (length !== -blockId) {
				warn(state, `Silent AUP4 sample block ${blockId} has a mismatched length.`);
				recordUnavailablePcm(state, blockId, 'mismatched-silent-block-length');
			}
			expectedStart = start + length;
			completeDecodedBlock(state, blockId);
			continue;
		}
		const block = await state.loadBlock(blockId);
		if (!block) {
			warn(state, `AUP4 sample block ${blockId} is missing.`);
			recordUnavailablePcm(state, blockId, 'missing-local-sample-block');
			expectedStart = start + Math.max(0, declaredLength);
			completeDecodedBlock(state, blockId);
			continue;
		}
		let samples;
		try { samples = decodeAup3SampleBlock(block.samples, block.sampleformat); }
		catch (error) {
			warn(state, `AUP4 sample block ${blockId} could not be decoded: ${error.message}`);
			recordUnavailablePcm(state, blockId, 'undecodable-sample-block');
			expectedStart = start + Math.max(0, declaredLength);
			completeDecodedBlock(state, blockId);
			continue;
		}
		if (declaredLengthValue != null && (declaredLength < 1 || samples.length !== declaredLength)) {
			warn(state, `AUP4 sample block ${blockId} does not match its declared length.`);
			recordUnavailablePcm(state, blockId, 'mismatched-sample-block-length');
		}
		const usableLength = declaredLength > 0 ? Math.min(samples.length, declaredLength) : samples.length;
		output.set(samples.subarray(0, Math.min(usableLength, Math.max(0, output.length - start))), Math.min(start, output.length));
		expectedStart = start + (declaredLength > 0 ? declaredLength : samples.length);
		completeDecodedBlock(state, blockId);
	}
	if (expectedStart !== sampleCount) {
		warn(state, 'An AUP4 sequence sample count does not match its blocks.');
		recordUnavailablePcm(state, lastBlockId, 'mismatched-sequence-sample-count');
	}
	return output;
}

function completeDecodedBlock(state, blockId) {
	state.completedBlocks += 1;
	state.onProgress?.({
		value: state.totalBlocks ? state.completedBlocks / state.totalBlocks : 1,
		phase: 'decoding-audio',
		blockId,
	});
}

function recordUnavailablePcm(state, blockId, reason) {
	const missingAudio = state.compatibilityReport.missingAudio;
	if (!missingAudio.some((entry) => entry.blockId === blockId && entry.reason === reason)) {
		missingAudio.push({
			blockId,
			reason,
			possiblyCloudBacked: Boolean(state.compatibilityReport.discardedCloudMetadata?.discardedEntries),
			networkAccessAttempted: false,
		});
	}
	if (!state.compatibilityReport.items.some((item) => (
		item.code === 'MISSING_LOCAL_AUDIO'
		&& item.data?.blockId === blockId
		&& item.data?.reason === reason
	))) addAup4CompatibilityItem(state.compatibilityReport, {
		code: 'MISSING_LOCAL_AUDIO',
		severity: 'warning',
		disposition: 'missing',
		scope: { kind: 'sampleblock', blockId },
		data: { blockId, reason },
	});
}

function groupWaveTracks(nodes, state) {
	const groups = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const first = nodes[index];
		const linked = Number(audacityXmlAttribute(first, 'linked', 0)) !== 0;
		const channel = Number(audacityXmlAttribute(first, 'channel', 0));
		const nextChannel = Number(audacityXmlAttribute(nodes[index + 1], 'channel', -1));
		if (linked && nodes[index + 1] && channel === 0 && nextChannel === 1) {
			groups.push([first, nodes[++index]]);
			continue;
		}
		if (linked) {
			warn(state, `Audacity wave track ${index + 1} declares a linked channel without a matching follower and was imported separately.`);
			addAup4CompatibilityItem(state.compatibilityReport, {
				code: 'LINKED_CHANNEL_MISMATCH',
				severity: 'warning',
				disposition: 'converted',
				scope: { kind: 'track', trackIndex: index },
				data: { reason: 'missing-follower', channel, nextChannel },
			});
		}
		groups.push([first]);
	}
	return groups;
}

function alignWaveClips(group, channelRates, state, trackIndex) {
	const clipsByChannel = group.map((node) => audacityXmlChildren(node, 'waveclip'));
	if (group.length === 1) return clipsByChannel[0].map((node) => [node]);
	const rows = clipsByChannel[0].map((node) => [node, null]);
	const leaderTimelines = clipsByChannel[0].map((node) => waveClipTimeline(node, channelRates[0]));
	const unmatchedLeaderIndexes = new Set(rows.map((_row, index) => index));
	let mismatch = clipsByChannel[0].length !== clipsByChannel[1].length;
	for (const follower of clipsByChannel[1]) {
		const followerTimeline = waveClipTimeline(follower, channelRates[1]);
		const candidates = [...unmatchedLeaderIndexes]
			.filter((index) => clipStartsAlign(leaderTimelines[index], followerTimeline))
			.sort((left, right) => (
				Math.abs(leaderTimelines[left].duration - followerTimeline.duration)
				- Math.abs(leaderTimelines[right].duration - followerTimeline.duration)
			));
		const rowIndex = candidates[0];
		if (rowIndex == null) {
			rows.push([null, follower]);
			mismatch = true;
		} else {
			unmatchedLeaderIndexes.delete(rowIndex);
			rows[rowIndex][1] = follower;
			const leaderTimeline = leaderTimelines[rowIndex];
			const tolerance = clipTimelineTolerance(leaderTimeline, followerTimeline);
			if (Math.abs(leaderTimeline.duration - followerTimeline.duration) > tolerance
				|| waveClipSemanticKey(rows[rowIndex][0]) !== waveClipSemanticKey(follower)) {
				mismatch = true;
			}
		}
	}
	if (rows.some((row) => !row[0] || !row[1])) mismatch = true;
	if (mismatch) {
		warn(state, `Linked channels in track ${trackIndex + 1} had mismatched clip timelines; absent channel regions were replaced with silence.`);
		addAup4CompatibilityItem(state.compatibilityReport, {
			code: 'LINKED_CHANNEL_MISMATCH',
			severity: 'warning',
			disposition: 'converted',
			scope: { kind: 'track', trackIndex },
			data: {
				leaderClipCount: clipsByChannel[0].length,
				followerClipCount: clipsByChannel[1].length,
			},
		});
	}
	return rows;
}

function waveClipTimeline(node, rate) {
	const sequence = audacityXmlChildren(node, 'sequence')[0];
	const storedStretchRatio = positive(audacityXmlAttribute(node, 'clipStretchRatio', 1), 1);
	const clipTempo = optionalPositive(audacityXmlAttribute(node, 'clipTempo', null));
	const rawAudioTempo = optionalPositive(audacityXmlAttribute(node, 'rawAudioTempo', null));
	const stretchRatio = storedStretchRatio * (clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1);
	const trimLeft = nonNegative(audacityXmlAttribute(node, 'trimLeft', 0));
	const trimRight = nonNegative(audacityXmlAttribute(node, 'trimRight', 0));
	const sampleCount = nonNegativeInteger(audacityXmlAttribute(sequence, 'numsamples', 0), 0);
	return {
		rate,
		start: finite(audacityXmlAttribute(node, 'offset', 0), 0) + trimLeft,
		duration: Math.max(0, sampleCount * stretchRatio / rate - trimLeft - trimRight),
	};
}

function clipStartsAlign(left, right) {
	return Math.abs(left.start - right.start) <= clipTimelineTolerance(left, right);
}

function clipTimelineTolerance(left, right) {
	return Math.max(1 / left.rate, 1 / right.rate) * 1.5 + 1e-9;
}

function waveClipSemanticKey(node) {
	return JSON.stringify([
		String(audacityXmlAttribute(node, 'name', '')),
		finite(audacityXmlAttribute(node, 'trimLeft', 0), 0),
		finite(audacityXmlAttribute(node, 'trimRight', 0), 0),
		finite(audacityXmlAttribute(node, 'clipStretchRatio', 1), 1),
		optionalPositive(audacityXmlAttribute(node, 'clipTempo', null)),
		optionalPositive(audacityXmlAttribute(node, 'rawAudioTempo', null)),
		finite(audacityXmlAttribute(node, 'centShift', 0), 0),
		readPitchAndSpeedPreset(node),
		booleanValue(audacityXmlAttribute(node, 'clipStretchToMatchTempo', false), false),
		String(audacityXmlAttribute(node, 'groupId', -1)),
		String(audacityXmlAttribute(node, 'colorindex', audacityXmlAttribute(node, 'color', 'auto'))),
		audacityXmlChildren(node, 'envelope')[0] || null,
	]);
}

function readEffectsWithReport(node, state, scope, idFactory, onRackActive) {
	let rackActive = true;
	return readAup4EffectsNode(node, {
		idFactory,
		onRackActive(active) {
			rackActive = active;
			onRackActive(active);
		},
		onMissingEffect(effect, index) {
			const active = rackActive && effect.enabled !== false;
			const name = String(effect.missing?.name || 'Unknown effect');
			addAup4CompatibilityItem(state.compatibilityReport, {
				code: 'MISSING_REALTIME_EFFECT',
				severity: active ? 'warning' : 'info',
				disposition: 'missing',
				scope: { ...scope, effectIndex: index, effectId: effect.id },
				data: {
					name,
					nativeId: effect.missing?.nativeId || '',
					reason: effect.missing?.reason || 'plugin-unavailable',
					active,
					effectEnabled: effect.enabled !== false,
					rackActive,
				},
			});
			if (active) warn(state, `Missing realtime effect "${name}" was bypassed.`);
		},
		onOpaqueEffect(effectNode, index, reason) {
			const effectEnabled = booleanValue(audacityXmlAttribute(effectNode, 'active', true), true);
			addAup4CompatibilityItem(state.compatibilityReport, {
				code: 'INERT_REALTIME_EFFECT_RECORD',
				severity: rackActive && effectEnabled ? 'warning' : 'info',
				disposition: 'preserved',
				scope: { ...scope, effectIndex: index },
				data: {
					nativeId: String(audacityXmlAttribute(effectNode, 'id', '')),
					reason,
					active: rackActive && effectEnabled,
					effectEnabled,
					rackActive,
				},
			});
		},
	});
}

function readEnvelope(clipNode, projectRate, trimLeftSeconds, durationFrames) {
	const envelope = audacityXmlChildren(clipNode, 'envelope')[0];
	if (!envelope) return [];
	const nativePoints = audacityXmlChildren(envelope, 'controlpoint').map((point) => ({
		time: nonNegative(audacityXmlAttribute(point, 't', 0)),
		value: finiteInRange(audacityXmlAttribute(point, 'val', 1), 0, 16, 1),
	})).sort((left, right) => left.time - right.time)
		.filter((point, index, all) => !index || point.time > all[index - 1].time);
	if (!nativePoints.length) return [];
	const visibleStart = nonNegative(trimLeftSeconds);
	const visibleEnd = visibleStart + durationFrames / projectRate;
	const points = [
		{ time: visibleStart, value: nativeEnvelopeValueAt(nativePoints, visibleStart) },
		...nativePoints.filter((point) => point.time > visibleStart && point.time < visibleEnd),
		...(nativePoints.at(-1).time > visibleEnd ? [{
			time: visibleEnd,
			value: nativeEnvelopeValueAt(nativePoints, visibleEnd),
		}] : []),
	].map((point) => ({
		frame: Math.max(0, Math.min(durationFrames, Math.round((point.time - visibleStart) * projectRate))),
		value: point.value,
	}));
	return points.filter((point, index, all) => !index || point.frame > all[index - 1].frame);
}

function nativeEnvelopeValueAt(points, time) {
	if (time <= points[0].time) return points[0].value;
	for (let index = 1; index < points.length; index += 1) {
		const right = points[index];
		if (time > right.time) continue;
		const left = points[index - 1];
		if (right.time <= left.time) return right.value;
		const fraction = (time - left.time) / (right.time - left.time);
		return left.value + (right.value - left.value) * fraction;
	}
	return points.at(-1).value;
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
	const enabled = booleanValue(audacityXmlAttribute(root, 'snap_enabled', false), false);
	const triplets = booleanValue(audacityXmlAttribute(root, 'snap_triplets', false), false);
	const type = integerInRange(audacityXmlAttribute(root, 'snap_type', 8), 0, 255, 8);
	try {
		return normalizeAudioEditorSnapSettings({ enabled, upstreamType: type, triplets, mode: 'nearest' });
	} catch {
		// Future grids remain identifiable for an unchanged interchange rewrite
		// while seconds provides a safe local editing fallback.
		return {
			...normalizeAudioEditorSnapSettings({ enabled, division: 'seconds', mode: 'nearest' }),
			triplets,
			opaqueType: type,
		};
	}
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
	const nativeScaleType = integerInRange(audacityXmlAttribute(node, 'scaleType', 2), 0, 0x7fff_ffff, 2);
	const nativeWindowType = integerInRange(audacityXmlAttribute(node, 'windowType', 3), 0, 0x7fff_ffff, 3);
	const scale = nativeSpectrogramScale(nativeScaleType);
	const windowType = nativeSpectrogramWindow(nativeWindowType);
	return {
		scale, minimumFrequency, maximumFrequency,
		windowSize: powerOfTwo(audacityXmlAttribute(node, 'windowSize', 2048), 2048),
		windowType,
		gain: finiteInRange(audacityXmlAttributes(node, 'gain')[0]?.value, -120, 120, 20),
		range: finiteInRange(audacityXmlAttribute(node, 'range', 80), 1, 240, 80),
		syncWithGlobal: booleanValue(audacityXmlAttribute(node, 'syncWithGlobalSettings', true), true),
		frequencyGainDb: finiteInRange(audacityXmlAttribute(node, 'frequencyGain', 0), -120, 120, 0),
		zeroPaddingFactor: integerInRange(audacityXmlAttribute(node, 'zeroPaddingFactor', 2), 1, 8, 2),
		colorScheme: integerInRange(audacityXmlAttribute(node, 'colorScheme', 0), 0, 0x7fff_ffff, 0),
		scaleType: nativeScaleType,
		algorithm: integerInRange(audacityXmlAttribute(node, 'algorithm', 0), 0, 0x7fff_ffff, 0),
		aup4ScaleType: { value: nativeScaleType, model: scale },
		aup4WindowType: { value: nativeWindowType, model: windowType },
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
function opaqueWaveTrackNode(node) {
	if (!node) return null;
	return {
		kind: 'node',
		node: {
			...node,
			content: (node.content || []).map((entry) => (
				entry?.kind === 'node' && entry.node?.name === 'waveclip'
					? { kind: 'node', node: { name: 'waveclip', content: [] } }
					: cloneOpaqueEntryWithoutWaveClips(entry)
			)),
		},
	};
}
function opaqueWaveClipNode(node) {
	if (!node) return null;
	return {
		kind: 'node',
		node: {
			...node,
			content: (node.content || [])
				.map(cloneOpaqueEntryWithoutWaveClips)
				.filter(Boolean),
		},
	};
}
function opaqueRootTemplate(root, masterEffectsNode) {
	return {
		kind: 'node',
		node: {
			name: 'project',
			content: (root.content || [])
				.filter((entry) => entry.kind !== 'attribute')
				.map((entry) => {
					if (entry?.kind !== 'node') return cloneOpaqueValue(entry);
					if (entry.node === masterEffectsNode) return { kind: 'node', node: { name: 'effects', content: [] } };
					if (entry.node?.name === 'wavetrack' || entry.node?.name === 'labeltrack') {
						return { kind: 'node', node: { name: entry.node.name, content: [] } };
					}
					return cloneOpaqueEntryWithoutWaveClips(entry);
				})
				.filter(Boolean),
		},
	};
}
function findNodeContentIndex(parent, node) {
	if (!node) return -1;
	return (parent.content || [])
		.filter((entry) => entry.kind !== 'attribute')
		.findIndex((entry) => entry.kind === 'node' && entry.node === node);
}
function cloneOpaqueValue(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}
function cloneOpaqueEntryWithoutWaveClips(entry) {
	if (entry?.kind !== 'node') return cloneOpaqueValue(entry);
	if (entry.node?.name === 'waveclip') return null;
	return {
		kind: 'node',
		node: {
			...entry.node,
			content: (entry.node.content || [])
				.map(cloneOpaqueEntryWithoutWaveClips)
				.filter(Boolean),
		},
	};
}
function countUnsupportedWaveClips(root) {
	let count = 0;
	const visit = (node, parent = null) => {
		if (node?.name === 'waveclip' && parent?.name !== 'wavetrack') count += 1;
		for (const child of audacityXmlChildren(node)) visit(child, node);
	};
	visit(root);
	return count;
}
function resampleMono(input, inputRate, outputRate) {
	if (!input.length || inputRate === outputRate) return input;
	const outputFrames = Math.max(1, Math.round(input.length * outputRate / inputRate));
	const resampler = createStreamingWindowedSincResampler(inputRate, outputRate, 1);
	const head = resampler.push([input])[0];
	const tail = resampler.finish(outputFrames)[0];
	const output = new Float32Array(head.length + tail.length);
	output.set(head);
	output.set(tail, head.length);
	return output.length === outputFrames ? output : output.slice(0, outputFrames);
}
function readPitchAndSpeedPreset(node) {
	const value = Number(audacityXmlAttribute(node, 'pitchAndSpeedPreset', 0));
	return Number.isSafeInteger(value) && value >= 0 && value <= 0x7fff_ffff ? value : 0;
}
function nativeSpectrogramScale(value) { return ['linear', 'log', 'mel', 'bark', 'erb', 'period'][value] || 'mel'; }
function nativeSpectrogramWindow(value) { return ({ 2: 'hamming', 3: 'hann', 4: 'blackman' })[value] || 'hann'; }
function trackColor(value) { return ['#66a3ff', '#9996fc', '#b5b5b5', '#ffad51'][Number(value)] || '#66a3ff'; }
function booleanValue(value, fallback) {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	const text = String(value).trim().toLowerCase();
	if (text === '1' || text === 'true') return true;
	if (text === '0' || text === 'false') return false;
	return fallback;
}
function lastAttribute(node, name, fallback) { return audacityXmlAttributes(node, name).at(-1)?.value ?? fallback; }
function sampleFormatName(value) { return Number(value) === 0x00020001 ? 'int16' : Number(value) === 0x00040001 ? 'int24' : Number(value) === 0x0004000f ? 'float32' : 'unknown'; }
function displayMode(value) { return Number(value) === 1 ? 'spectrogram' : Number(value) === 2 ? 'multiview' : 'waveform'; }
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
function powerOfTwo(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && Number.isInteger(Math.log2(number)) ? number : fallback;
}
function secondsToFrames(seconds, sampleRate) { return Math.max(0, Math.round(Number(seconds) * sampleRate)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function conversionError(message, code) { const error = new Error(message); error.name = 'Aup4ConversionError'; error.code = code; return error; }
