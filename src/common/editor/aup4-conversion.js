import { decodeAudacitySampleBlock } from './audacity-sample-block.js';
import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
} from './audacity-binary-xml.js';
import { readAup4EffectsNode } from './aup4-effects.js';
import { cloneAup4OpaqueProjectValue as cloneOpaqueValue } from './aup4-opaque-persistence.ts';
import {
	addAup4CompatibilityItem,
	createAup4CompatibilityReport,
} from './aup4-profile.js';
import { readAup4ClipTiming } from './aup4-clip-timing.ts';
import { sanitizeAup4ProjectRoot } from './aup4-sanitization.js';
import { createCurrentAudioEditorProject } from './project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from './project-media-factory.ts';
import { createStableId } from './project.js';
import { canonicalAudacityMusicalRoot } from './audacity-tempo-import.ts';
import { createAudacityAnnotationImport, readAup4AnnotationTracks } from './audacity-annotation-interchange.ts';
import { secondsToSampleFrame } from './timeline-time.ts';

const DEFAULT_MAX_DECODED_BYTES = 512 * 1024 * 1024;import {
	booleanValue,
	clamp,
	conversionError,
	displayMode,
	finite,
	finiteInRange,
	integerInRange,
	lastAttribute,
	nonNegative,
	nonNegativeInteger,
	positive,
	positiveInteger,
	positiveRate,
	powerOfTwo,
	sampleFormatName,
	trackColor,
	warn,
} from './aup4-conversion-values.js';
import {
	alignWaveClips,
	countUnsupportedWaveClips,
	countWaveBlocks,
	groupWaveTracks,
	resampleMono,
} from './aup4-conversion-wave-clips.js';
import {
	findNodeContentIndex,
	opaqueNode,
	opaqueRootTemplate,
	opaqueWaveClipNode,
	opaqueWaveTrackNode,
} from './aup4-conversion-opaque.js';
import {
	readEnvelope,
	readFrequencyRange,
	readMetadata,
	readPitchAndSpeedPreset,
	readSnap,
	readSpectrogram,
} from './aup4-conversion-settings.js';


export async function decodeAudacityProjectTree(root, loadBlock, options = {}) {
	if (!root || root.name !== 'project') throw conversionError('The Audacity document has no project root.', 'INVALID_PROJECT_XML');
	if (typeof loadBlock !== 'function') throw new TypeError('An Audacity sample-block loader is required.');
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
	compatibilityReport.format = 'audacity-project';
	compatibilityReport.sourceGeneration = options.sourceGeneration === 'aup3' ? 'aup3' : 'aup4';
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
	const annotationTracks = readAup4AnnotationTracks(root, compatibilityReport, opaqueNode);
	const waveTracks = audacityXmlChildren(root, 'wavetrack');
	const channelGroups = groupWaveTracks(waveTracks, state);
	const trackIdByRootNode = new Map();

	for (let trackIndex = 0; trackIndex < channelGroups.length; trackIndex += 1) {
		const group = channelGroups[trackIndex];
		const trackId = idFactory('track');
		const clipIds = [];
		const trackRate = positiveRate(audacityXmlAttribute(group[0], 'rate', projectRate));
		const firstSequence = audacityXmlChildren(audacityXmlChildren(group[0], 'waveclip')[0], 'sequence')[0];
		const sourceSampleFormat = sampleFormatName(audacityXmlAttribute(
			group[0],
			'sampleformat',
			audacityXmlAttribute(firstSequence, 'sampleformat', 0),
		));
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
			const {
				stretchRatio, trimLeftSeconds, trimStartFrames, trimEndFrames,
				sourceDurationFrames, timelineStartFrame, durationFrames,
			} = readAup4ClipTiming(clipNode, frameCount, trackRate, projectRate);
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
			const source = createAudioSource({
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
			const clip = createAudioClip({
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
		const track = createAudioTrack({
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
	const title = String(options.title || metadata.title || 'Audacity project').replace(/\.aup[34]$/i, '') || 'Audacity project';
	const knownRootChildren = new Set(['tags', 'wavetrack', 'labeltrack', 'effects']);
	const masterEffectsNode = audacityXmlChildren(root, 'effects').at(-1);
	const masterEffectsContentIndex = findNodeContentIndex(root, masterEffectsNode);
	let masterEffectsActive = true;
	const masterEffects = readEffectsWithReport(masterEffectsNode, state, {
		kind: 'master',
	}, idFactory, (active) => { masterEffectsActive = active; });
	const importedTempoBpm = finiteInRange(audacityXmlAttribute(root, 'time_signature_tempo', 120), 1, 1000, 120);
	const musicalRoot = canonicalAudacityMusicalRoot(importedTempoBpm, {
		numerator: integerInRange(audacityXmlAttribute(root, 'time_signature_upper', 4), 1, 0x7fff_ffff, 4),
		denominator: powerOfTwo(audacityXmlAttribute(root, 'time_signature_lower', 4), 4),
	});
	const annotationImport = createAudacityAnnotationImport(annotationTracks, {
		sampleRate: projectRate,
		tempoMap: musicalRoot.tempoMap,
		sequenceId: 'main-sequence',
		idFactory,
	});
	const project = createCurrentAudioEditorProject({
		id: options.projectId || idFactory('project'),
		title,
		sampleRate: projectRate,
		masterChannels: 2,
		...musicalRoot,
		snap: readSnap(root),
		timeDisplay: { format: String(audacityXmlAttribute(root, 'selectionformat', 'seconds')) || 'seconds' },
		metadata,
		selection: {
			startFrame: secondsToSampleFrame(nonNegative(audacityXmlAttribute(root, 'sel0', 0)), projectRate),
			endFrame: secondsToSampleFrame(nonNegative(audacityXmlAttribute(root, 'sel1', 0)), projectRate),
			trackIds: selectedTrackIds,
			clipIds: selectedClipIds,
			annotationIds: annotationImport.selectedAnnotationIds,
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
		timelineAnnotations: annotationImport.annotations,
		master: {
			gain: 1,
			pan: 0,
			effectsActive: masterEffectsActive,
			effects: masterEffects,
		},
		opaqueExtensions: {
			aup4RootAttributes: audacityXmlAttributes(root).map(cloneOpaqueValue),
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
	for (const waveBlock of audacityXmlChildren(sequence, 'waveblock')) {
		const blockId = Number(audacityXmlAttribute(waveBlock, 'blockid', 0));
		const start = nonNegativeInteger(audacityXmlAttribute(waveBlock, 'start', 0), 0);
		const declaredLengthValue = audacityXmlAttribute(waveBlock, 'length', null);
		const declaredLength = nonNegativeInteger(
			declaredLengthValue ?? (blockId < 0 ? -blockId : -1),
			-1,
		);
		if (start !== expectedStart) throw conversionError('An Audacity sequence has non-contiguous sample blocks.', 'CORRUPT_SEQUENCE');
		if (blockId <= 0) {
			const length = declaredLength >= 0 ? declaredLength : Math.max(0, -blockId);
			if (blockId === 0) throw conversionError('An Audacity silent block has an invalid zero id.', 'INVALID_SAMPLE_BLOCK');
			if (length !== -blockId) throw conversionError(`Silent Audacity sample block ${blockId} has a mismatched length.`, 'CORRUPT_SEQUENCE');
			expectedStart = start + length;
			completeDecodedBlock(state, blockId);
			continue;
		}
		const block = await state.loadBlock(blockId);
		if (!block) throw conversionError(`Audacity sample block ${blockId} is missing.`, 'MISSING_SAMPLE_BLOCK');
		let samples;
		try { samples = decodeAudacitySampleBlock(block.samples, block.sampleformat); }
		catch (error) { throw conversionError(`Audacity sample block ${blockId} could not be decoded: ${error.message}`, error.code || 'INVALID_SAMPLE_BLOCK'); }
		if (declaredLengthValue != null && (declaredLength < 1 || samples.length !== declaredLength)) {
			throw conversionError(`Audacity sample block ${blockId} does not match its declared length.`, 'CORRUPT_SEQUENCE');
		}
		const usableLength = declaredLength > 0 ? Math.min(samples.length, declaredLength) : samples.length;
		output.set(samples.subarray(0, Math.min(usableLength, Math.max(0, output.length - start))), Math.min(start, output.length));
		expectedStart = start + (declaredLength > 0 ? declaredLength : samples.length);
		completeDecodedBlock(state, blockId);
	}
	if (expectedStart !== sampleCount) throw conversionError('An Audacity sequence sample count does not match its blocks.', 'CORRUPT_SEQUENCE');
	return output;
}

/** @deprecated Use decodeAudacityProjectTree. */
export const decodeAup4ProjectTree = decodeAudacityProjectTree;

function completeDecodedBlock(state, blockId) {
	state.completedBlocks += 1;
	state.onProgress?.({
		value: state.totalBlocks ? state.completedBlocks / state.totalBlocks : 1,
		phase: 'decoding-audio',
		blockId,
	});
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
