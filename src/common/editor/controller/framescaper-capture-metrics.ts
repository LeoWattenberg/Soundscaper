/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CaptureMetricObservation,
	CapturePacket,
	CaptureSourceRole,
	CaptureStreamMetrics,
} from '../framescaper-capture-domain.ts';

interface CaptureMetricStreamIdentity {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
}

interface MutableCaptureStreamMetrics {
	readonly streamId: string;
	readonly role: CaptureSourceRole;
	packetCount: number;
	capturedDurationUs: number;
	capturedUnits: number;
	droppedUnits: number;
	droppedConfidence: 'exact' | 'estimated' | 'unavailable';
	hasDropEvidence: boolean;
	currentDriftUs: number | null;
	maximumAbsoluteDriftUs: number | null;
	driftConfidence: 'exact' | 'estimated' | 'unavailable';
}

export interface FramescaperCaptureMetrics {
	readonly snapshot: readonly Readonly<CaptureStreamMetrics>[];
	observe(packet: Readonly<CapturePacket>, activeTimeUs: number): Readonly<CaptureStreamMetrics>;
}

/** Aggregates only observed packet evidence; missing measurements stay unavailable. */
export function createFramescaperCaptureMetrics(
	streamsValue: readonly Readonly<CaptureMetricStreamIdentity>[],
): FramescaperCaptureMetrics {
	const streams = normalizeStreams(streamsValue);
	const byId = new Map(streams.map((stream) => [stream.streamId, stream]));

	function snapshot(): readonly Readonly<CaptureStreamMetrics>[] {
		return Object.freeze(streams.map(metricSnapshot));
	}

	function observe(
		packet: Readonly<CapturePacket>,
		activeTimeUsValue: number,
	): Readonly<CaptureStreamMetrics> {
		const activeTimeUs = nonNegativeFinite(activeTimeUsValue, 'Capture active time');
		const stream = byId.get(stableId(packet?.streamId, 'Capture packet streamId'));
		if (!stream) throw new Error('Capture metric packet belongs to an unknown stream.');
		if (packet.role !== stream.role) throw new Error('Capture metric packet role changed.');
		if (!Number.isSafeInteger(packet.sequence) || packet.sequence !== stream.packetCount) {
			throw new Error('Capture metric packets must be contiguous.');
		}
		const durationUs = positiveInteger(packet.durationUs, 'Capture packet duration');
		const presentationTimeUs = nonNegativeInteger(
			packet.presentationTimeUs,
			'Capture packet presentation time',
		);
		const capturedUnits = packet.kind === 'pcm-audio'
			? positiveInteger(packet.frameCount, 'Capture PCM frame count')
			: 1;
		const dropped = normalizeObservation(packet.droppedBefore, 'Capture dropped-unit evidence');
		if (dropped.value !== null && (!Number.isFinite(dropped.value) || dropped.value < 0)) {
			throw new RangeError('Capture dropped units must be finite and non-negative.');
		}
		stream.packetCount = exactSum(stream.packetCount, 1, 'Capture metric packet count');
		stream.capturedDurationUs = exactSum(
			stream.capturedDurationUs,
			durationUs,
			'Capture metric duration',
		);
		stream.capturedUnits = exactSum(stream.capturedUnits, capturedUnits, 'Capture metric units');
		mergeDroppedEvidence(stream, dropped);
		const packetEndUs = exactSum(
			presentationTimeUs,
			durationUs,
			'Capture packet end time',
		);
		const driftUs = packetEndUs - activeTimeUs;
		if (!Number.isSafeInteger(driftUs)) throw new RangeError('Capture packet drift exceeds the safe range.');
		stream.currentDriftUs = driftUs;
		stream.maximumAbsoluteDriftUs = Math.max(
			stream.maximumAbsoluteDriftUs ?? 0,
			Math.abs(driftUs),
		);
		stream.driftConfidence = packet.kind === 'pcm-audio' ? 'exact' : 'estimated';
		return metricSnapshot(stream);
	}

	return Object.freeze({
		get snapshot() { return snapshot(); },
		observe,
	});
}

function normalizeStreams(
	value: readonly Readonly<CaptureMetricStreamIdentity>[],
): readonly MutableCaptureStreamMetrics[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
		throw new RangeError('Capture metrics require one through four streams.');
	}
	const ids = new Set<string>();
	const roles = new Set<CaptureSourceRole>();
	const streams = value.map(({ streamId: streamIdValue, role }): MutableCaptureStreamMetrics => {
		const streamId = stableId(streamIdValue, 'Capture metric streamId');
		if (ids.has(streamId) || roles.has(role)) {
			throw new RangeError('Capture metric stream identities must be unique.');
		}
		if (!['camera', 'microphone', 'display', 'system-audio'].includes(role)) {
			throw new TypeError('Capture metric source role is invalid.');
		}
		ids.add(streamId);
		roles.add(role);
		const exactAudioDrops = role === 'microphone' || role === 'system-audio';
		return {
			streamId,
			role,
			packetCount: 0,
			capturedDurationUs: 0,
			capturedUnits: 0,
			droppedUnits: 0,
			droppedConfidence: exactAudioDrops ? 'exact' : 'unavailable',
			hasDropEvidence: exactAudioDrops,
			currentDriftUs: null,
			maximumAbsoluteDriftUs: null,
			driftConfidence: 'unavailable',
		};
	});
	if (roles.has('system-audio') && !roles.has('display')) {
		throw new RangeError('Capture system-audio metrics require a display stream.');
	}
	return streams;
}

function mergeDroppedEvidence(
	stream: MutableCaptureStreamMetrics,
	observation: CaptureMetricObservation,
): void {
	if (observation.value === null) {
		if (!stream.hasDropEvidence) stream.droppedConfidence = 'unavailable';
		return;
	}
	stream.hasDropEvidence = true;
	stream.droppedUnits += observation.value;
	if (!Number.isFinite(stream.droppedUnits)) {
		throw new RangeError('Capture dropped-unit total exceeds the finite range.');
	}
	if (stream.droppedConfidence === 'unavailable') {
		stream.droppedConfidence = observation.confidence;
	} else if (observation.confidence === 'estimated') {
		stream.droppedConfidence = 'estimated';
	}
}

function metricSnapshot(stream: MutableCaptureStreamMetrics): Readonly<CaptureStreamMetrics> {
	const droppedUnits = stream.hasDropEvidence
		? observation(stream.droppedUnits, measuredConfidence(stream.droppedConfidence))
		: unavailable();
	const denominator = stream.capturedUnits + stream.droppedUnits;
	const droppedRatio = stream.hasDropEvidence && denominator > 0
		? observation(stream.droppedUnits / denominator, measuredConfidence(stream.droppedConfidence))
		: unavailable();
	return Object.freeze({
		streamId: stream.streamId,
		role: stream.role,
		packetCount: stream.packetCount,
		capturedDurationUs: stream.capturedDurationUs,
		droppedUnits,
		droppedRatio,
		currentDriftUs: stream.currentDriftUs === null
			? unavailable()
			: observation(stream.currentDriftUs, measuredConfidence(stream.driftConfidence)),
		maximumAbsoluteDriftUs: stream.maximumAbsoluteDriftUs === null
			? unavailable()
			: observation(stream.maximumAbsoluteDriftUs, measuredConfidence(stream.driftConfidence)),
	});
}

function normalizeObservation(value: unknown, name: string): CaptureMetricObservation {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	const candidate = value as Partial<CaptureMetricObservation>;
	if (candidate.confidence === 'unavailable' && candidate.value === null) return unavailable();
	if ((candidate.confidence === 'exact' || candidate.confidence === 'estimated')
		&& typeof candidate.value === 'number') {
		return observation(candidate.value, candidate.confidence);
	}
	throw new TypeError(`${name} is invalid.`);
}

function observation(
	value: number,
	confidence: 'exact' | 'estimated',
): CaptureMetricObservation {
	return Object.freeze({ value, confidence });
}

function unavailable(): CaptureMetricObservation {
	return Object.freeze({ value: null, confidence: 'unavailable' });
}

function measuredConfidence(
	value: 'exact' | 'estimated' | 'unavailable',
): 'exact' | 'estimated' {
	if (value === 'unavailable') throw new Error('Unavailable capture evidence has no measured confidence.');
	return value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function nonNegativeFinite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be finite and non-negative.`);
	}
	return value;
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe range.`);
	return result;
}
