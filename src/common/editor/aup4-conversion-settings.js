/* SPDX-License-Identifier: AGPL-3.0-only */

// The project-level and clip-level settings an Audacity document carries beside
// its audio: clip envelopes, metadata tags, snapping, the spectral selection
// and each track's spectrogram view. Split out of aup4-conversion.js; no
// behaviour changes here.

import {
	audacityXmlAttribute,
	audacityXmlChildren,
} from './audacity-binary-xml.js';
import { secondsToSampleFrame } from './timeline-time.ts';
import { normalizeAudioEditorSnapSettings } from './snap-grid.js';
import {
	audacitySpectrogramGain,
	booleanValue,
	finiteInRange,
	integerInRange,
	nativeSpectrogramScale,
	nativeSpectrogramWindow,
	nonNegative,
	powerOfTwo,
} from './aup4-conversion-values.js';

export function readEnvelope(clipNode, projectRate, trimLeftSeconds, durationFrames) {
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
		frame: Math.max(0, Math.min(durationFrames, secondsToSampleFrame(point.time - visibleStart, projectRate))),
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

export function readMetadata(root) {
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

export function readSnap(root) {
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

export function readFrequencyRange(root, sampleRate) {
	const minimum = Number(audacityXmlAttribute(root, 'selLow', Number.NaN));
	const maximum = Number(audacityXmlAttribute(root, 'selHigh', Number.NaN));
	if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum <= minimum) return null;
	return { minimumFrequency: Math.min(sampleRate / 2, minimum), maximumFrequency: Math.min(sampleRate / 2, maximum) };
}

export function readSpectrogram(node, sampleRate) {
	let minimumFrequency = finiteInRange(audacityXmlAttribute(node, 'minFreq', 0), 0, sampleRate / 2, 0);
	let maximumFrequency = finiteInRange(audacityXmlAttribute(node, 'maxFreq', Math.min(20_000, sampleRate / 2)), 0, sampleRate / 2, Math.min(20_000, sampleRate / 2));
	if (maximumFrequency <= minimumFrequency) { minimumFrequency = 0; maximumFrequency = Math.max(1, Math.min(20_000, sampleRate / 2)); }
	const nativeScaleType = integerInRange(audacityXmlAttribute(node, 'scaleType', 2), 0, 0x7fff_ffff, 2);
	const nativeWindowType = integerInRange(audacityXmlAttribute(node, 'windowType', 3), 0, 0x7fff_ffff, 3);
	const scale = nativeSpectrogramScale(nativeScaleType);
	const windowType = nativeSpectrogramWindow(nativeWindowType);
	return {
		scale, minimumFrequency, maximumFrequency, windowSize: powerOfTwo(audacityXmlAttribute(node, 'windowSize', 2048), 2048),
		windowType,
		gain: finiteInRange(audacitySpectrogramGain(node), -120, 120, 20),
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

export function readPitchAndSpeedPreset(node) {
	const value = Number(audacityXmlAttribute(node, 'pitchAndSpeedPreset', 0));
	return Number.isSafeInteger(value) && value >= 0 && value <= 0x7fff_ffff ? value : 0;
}
