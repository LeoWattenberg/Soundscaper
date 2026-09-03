/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import { attribute, childElements, integerAttribute, numberAttribute } from './dawproject-xml.ts';
import { clamp, rationalFromDouble } from './dawproject-format.ts';
import type { DawprojectDocument } from './dawproject-import.ts';
import type { HoldTempoMap, Rational } from './timeline-time.ts';

/**
 * The tempo and signature maps a DAWproject states, as the project holds them.
 *
 * DAWproject positions tempo automation in beats and lets it ramp; the project
 * holds a hold-only tempo map, so a ramp becomes a step at its start and says
 * so. Time signatures change on bar lines here, so a point between bars moves
 * to the nearest one, also reported. Both maps must exist before any clip can
 * be placed, which is why they are built first and apart from the arrangement.
 */

type Draft = ReturnType<typeof createDeliveryReport>;
type DataRecord = Record<string, unknown>;

export function buildTempoMap(document: DawprojectDocument, draft: Draft): HoldTempoMap {
	const transport = document.transport.tempo;
	let rootBpm = transport?.value ?? 120;
	if (transport && transport.unit !== null && transport.unit !== 'bpm') {
		addDeliveryReportItem(draft, {
			code: 'dawproject.tempo-unit-converted', disposition: 'converted', severity: 'warning',
			data: { unit: transport.unit }, message: 'The transport tempo is not stated in BPM; 120 BPM is used.',
		});
		rootBpm = 120;
	}
	const points: { beat: number; bpm: number }[] = [];
	let ramps = 0;
	const automation = document.arrangement?.tempoAutomation;
	if (automation) {
		const unit = attribute(automation, 'timeUnit') ?? 'beats';
		if (unit !== 'beats') {
			addDeliveryReportItem(draft, {
				code: 'dawproject.tempo-automation-omitted', disposition: 'omitted', severity: 'warning',
				data: { timeUnit: unit }, message: 'Tempo automation positioned in seconds cannot be placed before the tempo map exists; only the transport tempo is used.',
			});
		} else {
			for (const point of childElements(automation, 'RealPoint')) {
				const beat = numberAttribute(point, 'time');
				const bpm = numberAttribute(point, 'value');
				if (beat === null || bpm === null || beat < 0 || !Number.isFinite(bpm)) continue;
				if (attribute(point, 'interpolation') === 'linear') ramps += 1;
				points.push({ beat, bpm });
			}
		}
	}
	points.sort((left, right) => left.beat - right.beat);
	const events: { id: string; beat: Rational; bpm: Rational }[] = [];
	let clamped = 0;
	const push = (beat: number, bpm: number, index: number): void => {
		const bounded = clamp(bpm, 1, 999);
		if (bounded !== bpm) clamped += 1;
		events.push({ id: `tempo-${String(index)}`, beat: rationalFromDouble(beat), bpm: rationalFromDouble(bounded) });
	};
	push(0, points[0]?.beat === 0 ? points[0].bpm : rootBpm, 1);
	for (const point of points) {
		if (point.beat <= (events.at(-1)?.beat.num ?? 0) / (events.at(-1)?.beat.den ?? 1)) continue;
		push(point.beat, point.bpm, events.length + 1);
	}
	if (clamped > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.tempo-range-converted', disposition: 'converted', severity: 'warning',
			data: { events: clamped }, message: 'Tempo values outside 1–999 BPM are clamped to that range.',
		});
	}
	if (ramps > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.tempo-ramps-converted', disposition: 'converted', severity: 'warning',
			data: { ramps }, message: 'The tempo map holds tempo between events; a linear tempo ramp becomes a step at its start.',
		});
	}
	if (events.length > 1) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.tempo-automation-preserved', disposition: 'preserved', severity: 'info',
			data: { events: events.length }, message: 'Tempo automation points become tempo map events at their beats.',
		});
	}
	return { mode: 'musical', events };
}

export function buildSignatureMap(document: DawprojectDocument, draft: Draft): DataRecord {
	const root = document.transport.timeSignature ?? { numerator: 4, denominator: 4 };
	const events: { id: string; bar: number; numerator: number; denominator: number }[] = [
		{ id: 'signature-1', bar: 0, numerator: root.numerator, denominator: root.denominator },
	];
	const automation = document.arrangement?.timeSignatureAutomation;
	if (!automation) return { events };
	const points = childElements(automation, 'TimeSignaturePoint')
		.map((point) => ({
			beat: numberAttribute(point, 'time') ?? Number.NaN,
			numerator: integerAttribute(point, 'numerator') ?? 0,
			denominator: integerAttribute(point, 'denominator') ?? 0,
		}))
		.filter((point) => Number.isFinite(point.beat) && point.beat >= 0 && point.numerator > 0 && point.denominator > 0)
		.sort((left, right) => left.beat - right.beat);
	let previousBeat = 0;
	let offBar = 0;
	for (const point of points) {
		const previous = events.at(-1)!;
		const barsSince = (point.beat - previousBeat) / (previous.numerator * 4 / previous.denominator);
		const bar = previous.bar + Math.round(barsSince);
		if (Math.abs(barsSince - Math.round(barsSince)) > 1e-6) offBar += 1;
		if (bar === 0 && events.length === 1) {
			events[0] = { ...events[0]!, numerator: point.numerator, denominator: point.denominator };
			continue;
		}
		if (bar <= previous.bar) continue;
		previousBeat = previousBeat + (bar - previous.bar) * (previous.numerator * 4 / previous.denominator);
		events.push({ id: `signature-${String(events.length + 1)}`, bar, numerator: point.numerator, denominator: point.denominator });
	}
	if (offBar > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.signature-points-converted', disposition: 'converted', severity: 'warning',
			data: { points: offBar }, message: 'Time signatures change on bar lines here; a change between bars moves to the nearest bar.',
		});
	}
	if (events.length > 1) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.signature-automation-preserved', disposition: 'preserved', severity: 'info',
			data: { events: events.length }, message: 'Time-signature automation points become signature map events at their bars.',
		});
	}
	return { events };
}
