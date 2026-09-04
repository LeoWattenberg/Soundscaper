/* SPDX-License-Identifier: AGPL-3.0-only */

// The Audacity 4 document nodes a project's tracks become: wave tracks and the
// clips, sample sequences and envelopes hung off them, label tracks, and the
// metadata tag block. Each builder lays its generated attributes and children
// back over whatever the imported file carried in the same position. Split out
// of aup4-profile.js; no behaviour changes here.

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from './audacity-binary-xml.js';
import { createAup4EffectsNode } from './aup4-effects.js';
import {
	OMIT_OPAQUE_CHILD,
	attribute,
	cloneXmlEntry,
	mergeAttributes,
	mergeOpaqueChildren,
	opaqueChildren,
} from './aup4-opaque-merge.js';
import {
	AUP4_MAX_BLOCK_SAMPLES,
	AUP4_SAMPLE_FORMAT_FLOAT32,
	colorIndex,
	displayType,
	finite,
	finiteInRange,
	integerInRange,
	inverseRatio,
	nonNegativeInteger,
	optionalFiniteInRange,
	positiveRate,
} from './aup4-profile-values.js';
import { sampleFrameToSeconds as framesToSeconds } from './timeline-time.ts';

export function createWaveTrackNode(project, track, channel, channelBlocks, projectRate, selectedTrackIds, selectedClipIds, groupNumbers) {
	const channelCount = trackChannelCount(project, track);
	const trackRate = trackSampleRate(project, track, projectRate);
	const opaqueTrack = track.opaqueExtensions?.aup4WaveTracks?.[channel]?.node;
	const importedColor = track.opaqueExtensions?.aup4TrackColor;
	const nativeColorIndex = Number.isSafeInteger(importedColor?.value)
		&& track.color === importedColor.color
		? importedColor.value
		: colorIndex(track.color, audacityXmlAttribute(opaqueTrack, 'colorindex', 0));
	const attributes = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Audio Track')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('colorindex', 'int', nativeColorIndex),
		attribute('height', 'int', track.collapsed ? 40 : Math.max(40, Math.round(finite(track.height, 160)))),
		attribute('rulerType', 'int', 0),
		attribute('trackViewType', 'int', displayType(track.displayMode || track.display)),
		attribute('syncWithGlobalSettings', 'bool', track.spectrogram?.syncWithGlobal !== false),
		// Audacity 4 stores the frequency bounds as doubles, even though its
		// settings UI currently presents whole-Hz values.
		attribute('minFreq', 'double', Math.max(0, finite(track.spectrogram?.minimumFrequency, 0)), -1),
		attribute('maxFreq', 'double', Math.max(1, finite(track.spectrogram?.maximumFrequency, 20_000)), -1),
		attribute('range', 'int', Math.round(finite(track.spectrogram?.rangeDb ?? track.spectrogram?.range, 80))),
		attribute('gain', 'int', Math.round(finite(track.spectrogram?.gainDb ?? track.spectrogram?.gain, 20))),
		attribute('frequencyGain', 'int', Math.round(finite(track.spectrogram?.frequencyGainDb, 0))),
		attribute('windowType', 'int', nativeSpectrogramWindowType(track.spectrogram)),
		attribute('windowSize', 'int', integerInRange(track.spectrogram?.windowSize, 128, 131_072, 2048)),
		attribute('zeroPaddingFactor', 'int', integerInRange(track.spectrogram?.zeroPaddingFactor, 1, 8, 2)),
		attribute('colorScheme', 'int', integerInRange(track.spectrogram?.colorScheme, 0, 0x7fff_ffff, 0)),
		attribute('scaleType', 'int', nativeSpectrogramScaleType(track.spectrogram)),
		attribute('algorithm', 'int', integerInRange(track.spectrogram?.algorithm, 0, 0x7fff_ffff, 0)),
		attribute('channel', 'int', channel),
		attribute('linked', 'int', channelCount > 1 && channel === 0 ? 1 : 0),
		attribute('mute', 'bool', Boolean(track.mute)),
		attribute('solo', 'bool', Boolean(track.solo)),
		attribute('rate', 'double', trackRate, -1),
		attribute('gain', 'double', finiteInRange(track.gain, 0, 4, 1), -1),
		attribute('pan', 'double', finiteInRange(track.pan, -1, 1, 0), -1),
		attribute('sampleformat', 'long', AUP4_SAMPLE_FORMAT_FLOAT32),
	], opaqueTrack?.content);
	const generatedChildren = [];
	const opaqueEffects = track.opaqueExtensions?.effects?.[channel];
	if (channel === 0) {
		generatedChildren.push({
			key: 'effects',
			entry: {
				kind: 'node',
				node: createAup4EffectsNode(track.effects, opaqueEffects?.node, {
					effectsActive: track.effectsActive,
				}),
			},
		});
	} else if (opaqueEffects?.kind === 'node') {
		// Native files normally attach the group rack to the leader channel. Keep
		// an unexpected follower-channel rack opaque instead of shifting or losing it.
		generatedChildren.push({ key: 'effects', entry: cloneXmlEntry(opaqueEffects) });
	}
	for (const clipId of track.clipIds || []) {
		const clip = project.clips.find((candidate) => candidate.id === clipId);
		if (clip) generatedChildren.push({
			key: 'waveclip',
			entry: { kind: 'node', node: createWaveClipNode(project, clip, channel, channelBlocks, trackRate, projectRate, selectedClipIds, groupNumbers) },
		});
	}
	let matchedEffects = false;
	const children = mergeOpaqueChildren(opaqueTrack, generatedChildren, (entry) => {
		if (entry.kind !== 'node') return null;
		if (entry.node?.name === 'waveclip') return 'waveclip';
		if (entry.node?.name !== 'effects' || matchedEffects) return null;
		matchedEffects = true;
		return 'effects';
	});
	const content = [...attributes, ...children];
	return createAudacityXmlNode('wavetrack', [], content);
}

function createWaveClipNode(project, clip, channel, channelBlocks, rate, projectRate, selectedClipIds, groupNumbers) {
	const blocks = channelBlocks.get(`${clip.id}:${channel}`)
		|| channelBlocks.get(`${clip.sourceId}:${channel}`)
		|| channelBlocks.get(clip.id)
		|| channelBlocks.get(clip.sourceId)
		|| [];
	const opaqueChannelClips = clip.opaqueExtensions?.aup4WaveClips;
	const opaqueClip = Array.isArray(opaqueChannelClips)
		? opaqueChannelClips[channel]?.node
		: clip.opaqueExtensions?.aup4WaveClip?.node;
	const source = project.sources?.find((candidate) => candidate.id === clip.sourceId);
	const duration = Math.max(0, Number(clip.durationFrames || 0));
	const sourceDuration = Math.max(0, Number(clip.sourceDurationFrames || duration));
	const sequenceSamples = blocks.reduce((total, block) => total + Number(block.sampleCount || 0), 0) || Number(source?.frameCount || duration);
	const trimStartFrames = Math.max(0, Number(clip.sourceStartFrame ?? clip.trimStartFrames ?? 0));
	const trimEndFrames = Math.max(0, sequenceSamples - trimStartFrames - sourceDuration);
	const modelStretchRatio = sourceDuration > 0 && duration > 0
		? duration / projectRate * rate / sourceDuration
		: Number.NaN;
	const stretchRatio = finiteInRange(modelStretchRatio, 0.001, 1000,
		finiteInRange(clip.stretchRatio ?? clip.timeRatio ?? inverseRatio(clip.speedRatio), 0.001, 1000, 1));
	const clipTempo = optionalFiniteInRange(clip.tempo, 1, 999)
		?? optionalFiniteInRange(audacityXmlAttribute(opaqueClip, 'clipTempo', null), 1, 999);
	const rawAudioTempo = optionalFiniteInRange(clip.rawAudioTempo, 1, 999)
		?? optionalFiniteInRange(audacityXmlAttribute(opaqueClip, 'rawAudioTempo', null), 1, 999);
	const tempoStretchRatio = clipTempo != null && rawAudioTempo != null ? rawAudioTempo / clipTempo : 1;
	const storedStretchRatio = stretchRatio / tempoStretchRatio;
	const trimLeftSeconds = trimStartFrames * stretchRatio / rate;
	const trimRightSeconds = trimEndFrames * stretchRatio / rate;
	const visibleStartSeconds = framesToSeconds(clip.timelineStartFrame, projectRate);
	const opaqueSequence = audacityXmlChildren(opaqueClip, 'sequence')[0];
	const sequenceAttributes = [
		attribute('maxsamples', 'size-t', AUP4_MAX_BLOCK_SAMPLES),
		attribute('sampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('effectivesampleformat', 'size-t', AUP4_SAMPLE_FORMAT_FLOAT32),
		attribute('numsamples', 'long-long', sequenceSamples),
	];
	const generatedWaveBlocks = [];
	let start = 0;
	for (const block of blocks) {
		const sampleCount = nonNegativeInteger(block.sampleCount, 0);
		generatedWaveBlocks.push({
			key: 'waveblock',
			entry: { kind: 'node', node: createAudacityXmlNode('waveblock', [
				attribute('start', 'long-long', Number(block.start ?? start)),
				attribute('length', 'long-long', sampleCount),
				attribute('blockid', 'long-long', block.blockId),
			]) },
		});
		start += sampleCount;
	}
	const sequenceNode = createAudacityXmlNode(
		'sequence',
		mergeAttributes(sequenceAttributes, opaqueSequence?.content),
		mergeOpaqueChildren(opaqueSequence, generatedWaveBlocks, (entry) => (
			entry.kind === 'node' && entry.node?.name === 'waveblock' ? 'waveblock' : null
		)),
	);
	const modelEnvelopePoints = Array.isArray(clip.envelope) ? clip.envelope : [];
	const opaqueEnvelope = audacityXmlChildren(opaqueClip, 'envelope')[0];
	const importedEnvelope = clip.opaqueExtensions?.aup4Envelope;
	const preserveImportedEnvelope = importedEnvelope?.node?.kind === 'node'
		&& envelopePointsEqual(modelEnvelopePoints, importedEnvelope.model)
		&& Math.abs(trimLeftSeconds - Number(importedEnvelope.trimLeftSeconds)) <= 1e-9
		&& Number(clip.durationFrames) === Number(importedEnvelope.durationFrames);
	const envelopePoints = nativeLinearEnvelopePoints(modelEnvelopePoints, duration);
	const envelopeNode = preserveImportedEnvelope
		? cloneXmlEntry(importedEnvelope.node).node
		: createAudacityXmlNode(
			'envelope',
			mergeAttributes([
				attribute('numpoints', 'size-t', envelopePoints.length),
			], opaqueEnvelope?.content),
			mergeOpaqueChildren(opaqueEnvelope, envelopePoints.map((point) => ({
				key: 'controlpoint',
				entry: { kind: 'node', node: createAudacityXmlNode('controlpoint', [
					attribute('t', 'double', trimLeftSeconds + framesToSeconds(point.frame, projectRate), 12),
					attribute('val', 'double', Math.max(0, Math.min(4, finite(point.value, 1))), 12),
				]) },
			})), (entry) => (
				entry.kind === 'node' && entry.node?.name === 'controlpoint' ? 'controlpoint' : null
			)),
		);
	const importedPitchPreset = clip.opaqueExtensions?.aup4PitchAndSpeedPreset;
	const preserveImportedPitchPreset = Number.isSafeInteger(importedPitchPreset?.value)
		&& importedPitchPreset.value >= 0
		&& importedPitchPreset.value <= 0x7fff_ffff
		&& Boolean(clip.preserveFormants) === Boolean(importedPitchPreset.preserveFormants);
	const pitchAndSpeedPreset = preserveImportedPitchPreset
		? importedPitchPreset.value
		: (clip.preserveFormants ? 1 : 0);
	const clipAttributes = [
		attribute('offset', 'double', visibleStartSeconds - trimLeftSeconds, 8),
		attribute('trimLeft', 'double', trimLeftSeconds, 8),
		attribute('trimRight', 'double', trimRightSeconds, 8),
		attribute('centShift', 'double', finiteInRange(clip.pitchCents, -1200, 1200, 0), -1),
		attribute('pitchAndSpeedPreset', 'long', pitchAndSpeedPreset),
		attribute('clipStretchRatio', 'double', storedStretchRatio, 8),
		attribute('clipStretchToMatchTempo', 'bool', clip.stretchToTempo == null
			? Boolean(audacityXmlAttribute(opaqueClip, 'clipStretchToMatchTempo', false))
			: Boolean(clip.stretchToTempo)),
		attribute('name', 'string', String(clip.name || clip.title || 'Audio')),
		attribute('groupId', 'long', groupNumbers.get(clip.groupId) ?? -1),
		attribute('colorindex', 'int', colorIndex(clip.color, audacityXmlAttribute(opaqueClip, 'colorindex', 0))),
		attribute('isSelected', 'bool', selectedClipIds.has(clip.id)),
	];
	if (clipTempo != null) clipAttributes.push(attribute('clipTempo', 'double', clipTempo, 8));
	if (rawAudioTempo != null) clipAttributes.push(attribute('rawAudioTempo', 'double', rawAudioTempo, 8));
	const clipContent = mergeOpaqueChildren(opaqueClip, [
		{ key: 'sequence', entry: { kind: 'node', node: sequenceNode } },
		{ key: 'envelope', entry: { kind: 'node', node: envelopeNode } },
	], (entry) => {
		if (entry.kind !== 'node') return null;
		if (entry.node?.name === 'waveclip') return OMIT_OPAQUE_CHILD;
		if (entry.node?.name === 'sequence') return 'sequence';
		if (entry.node?.name === 'envelope') return 'envelope';
		return null;
	});
	return createAudacityXmlNode('waveclip', mergeAttributes(clipAttributes, opaqueClip?.content), clipContent);
}

export function createLabelTrackNode(track, sampleRate, selectedTrackIds) {
	const opaqueTrack = track.opaqueExtensions?.aup4LabelTrack?.node;
	const attributes = mergeAttributes([
		attribute('name', 'string', String(track.name || 'Labels')),
		attribute('isSelected', 'bool', selectedTrackIds.has(track.id)),
		attribute('isFocused', 'bool', false),
		attribute('height', 'int', track.collapsed ? 40 : Math.max(40, Math.round(finite(track.height, 96)))),
		attribute('numlabels', 'int', (track.labels || []).length),
	], opaqueTrack?.content);
	const generatedLabels = [];
	for (const label of track.labels || []) {
		const opaqueLabel = label.opaqueExtensions?.aup4Label?.node;
		generatedLabels.push({
			key: 'label',
			entry: { kind: 'node', node: createAudacityXmlNode('label', mergeAttributes([
				attribute('t', 'double', framesToSeconds(label.startFrame, sampleRate), 10),
				attribute('t1', 'double', framesToSeconds(label.endFrame ?? label.startFrame, sampleRate), 10),
				attribute('title', 'string', String(label.text || label.title || '')),
				attribute('isSelected', 'bool', label.selected == null
					? Boolean(audacityXmlAttribute(opaqueLabel, 'isSelected', false))
					: Boolean(label.selected)),
			], opaqueLabel?.content), opaqueChildren(opaqueLabel)) },
		});
	}
	const content = [
		...attributes,
		...mergeOpaqueChildren(opaqueTrack, generatedLabels, (entry) => (
			entry.kind === 'node' && entry.node?.name === 'label' ? 'label' : null
		)),
	];
	return createAudacityXmlNode('labeltrack', [], content);
}

export function createMetadataNode(metadata = {}, opaqueTags = null) {
	const generatedTags = [];
	const standard = {
		TITLE: metadata.title,
		ARTIST: metadata.artist,
		ALBUM: metadata.album,
		TRACKNUMBER: metadata.trackNumber,
		YEAR: metadata.year,
		COMMENTS: metadata.comments,
	};
	const entries = new Map(Object.entries(metadata.tags || {}).map(([name, value]) => [String(name).toUpperCase(), value]));
	for (const [name, value] of Object.entries(standard)) if (value != null && value !== '') entries.set(name, value);
	for (const [name, value] of entries) {
		if (value == null || value === '') continue;
		const canonicalName = String(name).toUpperCase();
		generatedTags.push({
			key: `tag:${canonicalName}`,
			entry: { kind: 'node', node: createAudacityXmlNode('tag', [
				attribute('name', 'string', canonicalName),
				attribute('value', 'string', String(value)),
			]) },
		});
	}
	const content = mergeOpaqueChildren(opaqueTags, generatedTags, (entry) => {
		if (entry.kind !== 'node' || entry.node?.name !== 'tag') return null;
		return `tag:${String(audacityXmlAttribute(entry.node, 'name', '')).toUpperCase()}`;
	});
	return {
		kind: 'node',
		node: createAudacityXmlNode('tags', mergeAttributes([], opaqueTags?.content), content),
	};
}

function envelopePointsEqual(left, right) {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
	return left.every((point, index) => (
		Number(point?.frame) === Number(right[index]?.frame)
		&& Number(point?.value) === Number(right[index]?.value)
	));
}
function nativeLinearEnvelopePoints(points, durationFrames) {
	if (!points.length) return [];
	const output = points.map((point) => ({
		frame: Math.max(0, Math.min(durationFrames, Math.round(Number(point.frame)))),
		value: finite(point.value, 1),
	})).sort((left, right) => left.frame - right.frame);
	if (output[0].frame > 0) output.unshift({ frame: 0, value: 1 });
	return output.filter((point, index, all) => !index || point.frame > all[index - 1].frame);
}

function nativeSpectrogramScaleType(spectrogram = {}) {
	const imported = spectrogram.aup4ScaleType;
	if (Number.isSafeInteger(imported?.value) && spectrogram.scale === imported.model) return imported.value;
	return new Map([
		['linear', 0],
		['log', 1],
		['logarithmic', 1],
		['mel', 2],
		['bark', 3],
		['erb', 4],
		['period', 5],
	]).get(String(spectrogram.scale || '').toLowerCase()) ?? 2;
}
function nativeSpectrogramWindowType(spectrogram = {}) {
	const imported = spectrogram.aup4WindowType;
	if (Number.isSafeInteger(imported?.value) && spectrogram.windowType === imported.model) return imported.value;
	return new Map([
		['hamming', 2],
		['hann', 3],
		['hanning', 3],
		['blackman', 4],
	]).get(String(spectrogram.windowType || '').toLowerCase()) ?? 3;
}

export function trackChannelCount(project, track) {
	for (const clipId of track.clipIds || []) {
		const clip = project.clips?.find((candidate) => candidate.id === clipId);
		const source = project.sources?.find((candidate) => candidate.id === clip?.sourceId);
		if (Number(source?.channelCount) > 1) return 2;
	}
	const importedChannels = track.opaqueExtensions?.aup4WaveTracks?.length;
	if (Number.isSafeInteger(importedChannels) && importedChannels > 1) return 2;
	return 1;
}

function trackSampleRate(project, track, projectRate) {
	const rates = new Set();
	for (const clipId of track.clipIds || []) {
		const clip = project.clips?.find((candidate) => candidate.id === clipId);
		const source = project.sources?.find((candidate) => candidate.id === clip?.sourceId);
		if (source?.sampleRate != null) rates.add(positiveRate(source.sampleRate));
	}
	if (rates.size === 1) return rates.values().next().value;
	const importedRate = audacityXmlAttribute(
		track.opaqueExtensions?.aup4WaveTracks?.[0]?.node,
		'rate',
		null,
	);
	return importedRate == null ? projectRate : positiveRate(importedRate);
}
