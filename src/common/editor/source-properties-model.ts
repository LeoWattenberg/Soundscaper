/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveVideoDisplayGeometry,
	videoSourcePresentedSize,
	type VideoDisplayGeometry,
} from './video-display-geometry.ts';
import {
	normalizeVideoSourceCharacteristics,
	type VideoSourceAudioStream,
	type VideoSourceCharacteristics,
	type VideoSourceStartTimecode,
} from './video-source-characteristics.ts';
import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import {
	formatSequenceTimecode,
	sequenceTimecodeFromFrameCount,
	sequenceTimecodeToFrameCount,
	type SequenceRationalRate,
} from './sequence-timecode.ts';
import {
	resolveVideoRetimeProgramOrdinal,
	VideoRetimeProgramOrdinalUnavailableError,
	type VideoRetimeProgramOrdinalBridge,
} from './video-retime-program-ordinal-bridge.ts';

/**
 * Project-facing source properties: what a probe reported about a video source,
 * and what the product must disclose because it records a characteristic it
 * does not act on. Nothing here is persisted; every value is derived on demand,
 * and an unreported characteristic stays visibly unknown rather than defaulted.
 */

export type SourcePropertyNote =
	| 'interlaced-presented-as-coded'
	| 'rotation-not-applied'
	| 'geometry-disagrees'
	| 'additional-audio-programs'
	| 'conformed-at-ingest'
	| 'timing-unprobed';

export interface SourcePropertiesView {
	readonly sourceId: string;
	readonly name: string;
	readonly frameRate: SequenceRationalRate;
	readonly frameCount: number;
	readonly videoCodec: string | null;
	readonly audioCodec: string | null;
	readonly presentedWidth: number;
	readonly presentedHeight: number;
	readonly characteristics: VideoSourceCharacteristics;
	readonly geometry: VideoDisplayGeometry;
	readonly startTimecodeLabel: string | null;
	readonly timingMode: string;
	readonly timingBackend: string | null;
	readonly extractedAudioStream: VideoSourceAudioStream | null;
	readonly notes: readonly SourcePropertyNote[];
}

export interface SourceTimecodeReading {
	readonly sourceId: string;
	readonly sourceName: string;
	readonly clipId: string;
	readonly sourceFrame: number;
	readonly label: string;
	readonly originReported: boolean;
}

type DataRecord = Readonly<Record<string, unknown>>;

/** Describe one persisted video source for the properties surface. */
export function resolveVideoSourcePropertiesView(sourceValue: unknown): SourcePropertiesView {
	const source = record(sourceValue, 'source');
	if (source.kind !== 'video') throw new TypeError('Source properties describe a video source.');
	const frameRate = rationalRate(source.frameRate);
	const characteristics = normalizeVideoSourceCharacteristics(
		source.characteristics ?? null,
		{ rate: frameRate },
	);
	const presented = videoSourcePresentedSize(source) ?? { width: 1, height: 1 };
	const geometry = resolveVideoDisplayGeometry(characteristics, presented);
	const decision = record(source.timingDecision ?? {}, 'source.timingDecision');
	const extractedAudioStream = characteristics.audioStreams?.find(
		(stream) => stream.index === characteristics.extractedAudioStreamIndex,
	) ?? null;
	return Object.freeze({
		sourceId: String(source.id ?? ''),
		name: String(source.name ?? ''),
		frameRate,
		frameCount: Number(source.sourceFrameCount ?? 0),
		videoCodec: characteristics.videoCodec ?? optionalText(source.videoCodec),
		audioCodec: extractedAudioStream?.codec ?? optionalText(source.audioCodec),
		presentedWidth: presented.width,
		presentedHeight: presented.height,
		characteristics,
		geometry,
		startTimecodeLabel: characteristics.startTimecode
			? formatSequenceTimecode(
				characteristics.startTimecode,
				frameRate,
				characteristics.startTimecode.dropFrame,
			)
			: null,
		timingMode: String(decision.mode ?? 'conform-cfr-at-ingest'),
		timingBackend: optionalText(decision.backend),
		extractedAudioStream,
		notes: sourceNotes(characteristics, geometry, decision),
	});
}

/**
 * The SMPTE label a source's own recorded origin gives one of its frames. Every
 * surface that names a source frame reads it from here, so a readout and a
 * monitor cannot drift into two labels for the same frame.
 */
export function sourceFrameTimecodeLabel(
	rate: SequenceRationalRate,
	origin: VideoSourceStartTimecode | null,
	sourceFrame: number,
): string {
	const dropFrame = origin?.dropFrame ?? false;
	const originFrames = origin ? sequenceTimecodeToFrameCount(origin, rate, dropFrame) : 0;
	return formatSequenceTimecode(
		sequenceTimecodeFromFrameCount(originFrames + sourceFrame, rate, dropFrame),
		rate,
		dropFrame,
	);
}

/**
 * Read the source timecode under the playhead. The reading belongs to the first
 * video clip in document order whose sequence range contains the position, so a
 * stack of layers resolves the same way on every surface.
 */
export function resolveSourceTimecodeAtSample(
	projectValue: unknown,
	sample: number,
	sequenceId?: string,
	bridgeValue?: VideoRetimeProgramOrdinalBridge,
): SourceTimecodeReading | null {
	const project = record(projectValue, 'project');
	const sampleRate = Number(project.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) return null;
	const sequences = Array.isArray(project.sequences) ? project.sequences : [];
	const targetId = sequenceId ?? String(project.primarySequenceId ?? '');
	const sequence = sequences.find((value) => isRecord(value) && String(value.id) === targetId);
	if (!isRecord(sequence)) return null;
	const frame = sequenceFrameAtSample(
		Math.max(0, Math.trunc(sample)),
		rationalRate(sequence.rate),
		sampleRate,
	);
	const clips = Array.isArray(project.clips) ? project.clips : [];
	const sources = Array.isArray(project.sources) ? project.sources : [];
	for (const value of clips) {
		if (!isRecord(value) || value.kind !== 'video') continue;
		if (String(value.sequenceId ?? '') !== targetId) continue;
		// Persisted clips carry a sequence frame count; the runtime projection
		// carries the resolved end frame instead. Either shape resolves here.
		const start = Number(value.sequenceStartFrame);
		const end = Number(value.sequenceEndFrame ?? Number(value.sequenceStartFrame) + Number(value.sequenceFrameCount));
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
		if (frame < start || frame >= end) continue;
		const source = sources.find((candidate) => isRecord(candidate)
			&& candidate.id === value.sourceId && candidate.kind === 'video');
		if (!isRecord(source)) continue;
		const rate = rationalRate(source.frameRate);
		const characteristics = normalizeVideoSourceCharacteristics(
			source.characteristics ?? null,
			{ rate },
		);
		const origin = characteristics.startTimecode;
		const sourceIn = Number(value.sourceInFrame ?? value.sourceStartFrame ?? 0);
		let retimedSourceFrame: number | null;
		try {
			if (value.retimeMap != null && !bridgeValue) {
				throw new VideoRetimeProgramOrdinalUnavailableError();
			}
			retimedSourceFrame = bridgeValue
				? resolveVideoRetimeProgramOrdinal(bridgeValue, {
					project,
					clip: value,
					source,
					timelineSample: Math.max(0, Math.trunc(sample)),
				})
				: null;
		} catch (error: unknown) {
			if (!(error instanceof VideoRetimeProgramOrdinalUnavailableError)) throw error;
			return null;
		}
		const sourceFrame = retimedSourceFrame
			?? (Number.isSafeInteger(sourceIn) ? sourceIn : 0) + (frame - start);
		return Object.freeze({
			sourceId: String(source.id ?? ''),
			sourceName: String(source.name ?? ''),
			clipId: String(value.id ?? ''),
			sourceFrame,
			label: sourceFrameTimecodeLabel(rate, origin, sourceFrame),
			originReported: origin !== null,
		});
	}
	return null;
}

/**
 * The video source the properties surface describes: the selected video clip's
 * source when there is one - including a Project Bin item, which is where an
 * import lands - and otherwise the source under the playhead.
 */
export function resolveInspectedVideoSource(
	projectValue: unknown,
	sample: number,
	sequenceId?: string,
	bridgeValue?: VideoRetimeProgramOrdinalBridge,
): DataRecord | null {
	const project = record(projectValue, 'project');
	const sources = Array.isArray(project.sources) ? project.sources : [];
	const sourceById = (id: unknown) => sources.find((candidate) => isRecord(candidate)
		&& candidate.id === id && candidate.kind === 'video') ?? null;
	const selection = isRecord(project.selection) ? project.selection : null;
	const selectedIds = Array.isArray(selection?.clipIds) ? selection.clipIds : [];
	const bin = isRecord(project.projectBin) && Array.isArray(project.projectBin.clips)
		? project.projectBin.clips
		: [];
	const clips = [...(Array.isArray(project.clips) ? project.clips : []), ...bin];
	for (const id of selectedIds) {
		const clip = clips.find((candidate) => isRecord(candidate)
			&& candidate.id === id && candidate.kind === 'video');
		const source = isRecord(clip) ? sourceById(clip.sourceId) : null;
		if (isRecord(source)) return source;
	}
	const reading = resolveSourceTimecodeAtSample(project, sample, sequenceId, bridgeValue);
	return reading ? sourceById(reading.sourceId) : null;
}

function sourceNotes(
	characteristics: VideoSourceCharacteristics,
	geometry: VideoDisplayGeometry,
	decision: DataRecord,
): readonly SourcePropertyNote[] {
	const notes: SourcePropertyNote[] = [];
	if (characteristics.fieldOrder && characteristics.fieldOrder !== 'progressive') {
		notes.push('interlaced-presented-as-coded');
	}
	// A residual stretch is applied by the surfaces that present this source; a
	// residual rotation is not, so it stays disclosed instead.
	if (geometry.residualRotationDegrees !== 0) notes.push('rotation-not-applied');
	if (geometry.reconciliation === 'disagreed') notes.push('geometry-disagrees');
	if ((characteristics.audioStreams?.length ?? 0) > 1) notes.push('additional-audio-programs');
	if (decision.mode === 'conform-cfr-at-ingest') {
		notes.push(decision.backend ? 'conformed-at-ingest' : 'timing-unprobed');
	}
	return Object.freeze(notes);
}

function optionalText(value: unknown): string | null {
	return typeof value === 'string' && value.length && value !== 'unknown' ? value : null;
}

function rationalRate(value: unknown): SequenceRationalRate {
	if (!isRecord(value)) throw new TypeError('A source frame rate must be rational.');
	const num = Number(value.num);
	const den = Number(value.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
		throw new RangeError('A source frame rate must be a positive rational.');
	}
	return Object.freeze({ num, den });
}

function record(value: unknown, name: string): DataRecord {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
