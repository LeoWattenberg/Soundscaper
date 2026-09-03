/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveAutomationLanePointFramesV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import { compareCodeUnits } from './code-unit-order.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { interchangeClipTimeEffect } from './interchange-omission-inventory.ts';
import { barStartBeat } from './musical-grid.ts';
import { xmlElement, type XmlElement } from './dawproject-xml.ts';
import { isHexColor, panToNormalized, rationalToNumber } from './dawproject-format.ts';
import {
	type DataRecord,
	type DawprojectExportContext,
	type DawprojectStructureNode,
	finite,
	parameterIdFor,
	record,
	records,
	stripKey,
} from './dawproject-export-context.ts';

/**
 * The Arrangement half of the DAWproject writer: one `Lanes` per track holding
 * its clips and automation, then markers, tempo, and signature automation.
 *
 * Every timeline here is in seconds except the two tempo-domain automations,
 * which state their own `timeUnit="beats"`; the schema lets each timeline
 * choose, and a tempo change is a statement about a beat, not a second.
 */

interface MarkerEntry {
	readonly time: number;
	readonly name: string;
	readonly comment: string | null;
}

interface WarpPoint {
	readonly time: number;
	readonly contentTime: number;
}

export function buildArrangement(
	context: DawprojectExportContext,
	structure: readonly DawprojectStructureNode[],
): XmlElement {
	const lanes = xmlElement('Lanes', { timeUnit: 'seconds', id: context.ids.id('arrangement-lanes') }, [
		...structure.map((node) => buildNodeLanes(node, context)),
		...buildMixerNodeLanes(context),
		wrapLanes(context, 'track:master', buildStripAutomation('master', record(context.project.master), context)),
	]);
	const arrangement = xmlElement('Arrangement', { id: context.ids.id('arrangement') }, [
		lanes,
		buildMarkers(context),
		buildTempoAutomation(context),
		buildSignatureAutomation(context),
	]);
	reportUnconsumedLanes(context);
	return arrangement;
}

function buildNodeLanes(node: DawprojectStructureNode, context: DawprojectExportContext): XmlElement | null {
	if (node.kind === 'folder') {
		const bus = context.routing.groups.find((group) => group.id === node.id);
		return xmlElement('Lanes', {
			track: context.ids.id(`folder:${node.id}`), id: context.ids.id(`lanes:folder:${node.id}`),
		}, [
			...(bus ? buildStripAutomation(`mixer-node:${bus.id}`, { envelope: bus.envelope }, context) : []),
			...node.children.map((child) => buildNodeLanes(child, context)),
		]);
	}
	const track = node.track ?? {};
	const type = String(track.type ?? '');
	if (type !== 'audio' && type !== 'video') return null;
	const trackId = String(track.id);
	const clips = orderedClips(track, context);
	const clipElements = clips
		.map((clip) => (type === 'audio' ? buildAudioClip(clip, context) : buildVideoClip(clip, context)));
	return xmlElement('Lanes', { track: context.ids.id(`track:${trackId}`), id: context.ids.id(`lanes:${trackId}`) }, [
		xmlElement('Clips', { id: context.ids.id(`clips:${trackId}`) }, clipElements),
		...(type === 'audio' ? buildStripAutomation(`track:${trackId}`, track, context) : []),
	]);
}

function buildMixerNodeLanes(context: DawprojectExportContext): XmlElement[] {
	const folderIds = new Set(records(context.project.trackFolders).map((folder) => String(folder.id)));
	const result: XmlElement[] = [];
	for (const strip of [...context.routing.groups, ...context.routing.sends]) {
		if (folderIds.has(strip.id)) continue;
		const wrapped = wrapLanes(
			context,
			`strip-track:${strip.id}`,
			buildStripAutomation(`mixer-node:${strip.id}`, { envelope: strip.envelope }, context),
		);
		if (wrapped) result.push(wrapped);
	}
	return result;
}

function wrapLanes(context: DawprojectExportContext, trackKey: string, points: readonly XmlElement[]): XmlElement | null {
	if (points.length === 0) return null;
	return xmlElement('Lanes', { track: context.ids.id(trackKey), id: context.ids.id(`lanes:${trackKey}`) }, points);
}

function orderedClips(track: DataRecord, context: DawprojectExportContext): readonly DataRecord[] {
	return (Array.isArray(track.clipIds) ? track.clipIds : [])
		.map((clipId) => context.clipById.get(String(clipId)))
		.filter((clip): clip is DataRecord => Boolean(clip))
		.sort((left, right) => (
			finite(left.timelineStartFrame, 0) - finite(right.timelineStartFrame, 0)
			|| compareCodeUnits(String(left.id), String(right.id))
		));
}

function buildAudioClip(clip: DataRecord, context: DawprojectExportContext): XmlElement | null {
	const { sampleRate, draft } = context;
	const clipId = String(clip.id);
	const sourceId = String(clip.sourceId ?? '');
	const source = context.sourceById.get(sourceId);
	if (!source) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.media-reference-missing',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'clip', id: clipId },
			data: { sourceId },
			message: 'The clip references a source the project does not contain.',
		});
		return null;
	}
	if (source.kind === 'video') {
		addDeliveryReportItem(draft, {
			code: 'dawproject.video-audio-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: clipId },
			data: { sourceId },
			message: 'An audio clip that plays a video source\'s soundtrack has no embeddable PCM of its own.',
		});
		return null;
	}
	const start = nonNegativeInteger(clip.timelineStartFrame ?? 0, 'clip.timelineStartFrame');
	const durationFrames = positiveInteger(clip.durationFrames, 'clip.durationFrames');
	const sourceRate = finite(source.sampleRate, sampleRate) > 0 ? finite(source.sampleRate, sampleRate) : sampleRate;
	const sourceStart = nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame');
	const sourceDurationFrames = clip.sourceDurationFrames == null
		? Math.round(durationFrames * sourceRate / sampleRate)
		: positiveInteger(clip.sourceDurationFrames, 'clip.sourceDurationFrames');
	const durationSeconds = durationFrames / sampleRate;
	const playStart = sourceStart / sourceRate;
	const sourceSpan = sourceDurationFrames / sourceRate;
	const stretched = Math.abs(sourceSpan - durationSeconds) * sampleRate > 0.5;

	const entry = context.media.register(source, 'audio');
	const audio = xmlElement('Audio', {
		channels: Math.max(1, finite(source.channelCount, 1)),
		duration: finite(source.frameCount, sourceDurationFrames) / sourceRate,
		sampleRate: sourceRate,
		timeUnit: 'seconds',
		id: context.ids.id(`audio:${clipId}`),
	}, [xmlElement('File', { path: entry.path, external: false })]);

	const timeEffect = interchangeClipTimeEffect(clip);
	const warpPoints = records(record(clip.warpMap).points);
	let content = audio;
	let contentPlayStart = playStart;
	if (warpPoints.length >= 2 && warpPoints.every((point) => point.mode === undefined || point.mode === 'forward')) {
		content = buildWarps(context, clipId, audio, warpPoints.map((point) => ({
			time: rationalValue(point.outer) / sampleRate,
			contentTime: rationalValue(point.source) / sourceRate,
		})));
		contentPlayStart = 0;
		addDeliveryReportItem(draft, {
			code: 'dawproject.audio-warp-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'clip', id: clipId },
			data: { warpPoints: warpPoints.length },
			message: 'The warp map is written as DAWproject Warp events from clip time to source time.',
		});
	} else if (stretched) {
		content = buildWarps(context, clipId, audio, [
			{ time: 0, contentTime: playStart },
			{ time: durationSeconds, contentTime: playStart + sourceSpan },
		]);
		contentPlayStart = 0;
		addDeliveryReportItem(draft, {
			code: 'dawproject.speed-change-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'clip', id: clipId },
			data: { speedRatio: sourceSpan / durationSeconds, ...(timeEffect?.data ?? {}) },
			message: 'The clip\'s speed change is written as a two-point Warp, which the receiving DAW renders with its own stretch algorithm.',
		});
	} else if (timeEffect) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.time-effect-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: clipId },
			data: { kind: timeEffect.kind, ...timeEffect.data },
			message: 'The clip states a time effect its rendered duration does not reflect; the clip is written at that duration.',
		});
	}
	reportOmittedClipFeatures(clip, clipId, stretched, context);

	const fadeIn = Math.min(durationFrames, nonNegativeInteger(clip.fadeInFrames ?? 0, 'clip.fadeInFrames'));
	const fadeOut = Math.min(durationFrames, nonNegativeInteger(clip.fadeOutFrames ?? 0, 'clip.fadeOutFrames'));
	return xmlElement('Clip', {
		time: start / sampleRate,
		duration: durationSeconds,
		contentTimeUnit: 'seconds',
		playStart: contentPlayStart,
		fadeTimeUnit: 'seconds',
		fadeInTime: fadeIn / sampleRate,
		fadeOutTime: fadeOut / sampleRate,
		enable: true,
		name: String(clip.title ?? source.name ?? clipId),
		color: isHexColor(clip.color) ? clip.color : null,
	}, [content]);
}

function buildWarps(
	context: DawprojectExportContext,
	clipId: string,
	content: XmlElement,
	points: readonly WarpPoint[],
): XmlElement {
	return xmlElement('Warps', {
		contentTimeUnit: 'seconds', timeUnit: 'seconds', id: context.ids.id(`warps:${clipId}`),
	}, [
		content,
		...points.map((point) => xmlElement('Warp', { time: point.time, contentTime: point.contentTime })),
	]);
}

function reportOmittedClipFeatures(
	clip: DataRecord,
	clipId: string,
	stretched: boolean,
	context: DawprojectExportContext,
): void {
	const features: string[] = [];
	if (finite(clip.gain, 1) !== 1) features.push('gain');
	if (records(clip.envelope).length > 0) features.push('envelope');
	if (finite(clip.pitchCents, 0) !== 0) features.push('pitchCents');
	if (clip.reversed === true) features.push('reversed');
	if (clip.preserveFormants === true && stretched) features.push('preserveFormants');
	if (features.length === 0) return;
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.clip-features-omitted',
		disposition: 'omitted',
		severity: 'warning',
		scope: { kind: 'clip', id: clipId },
		data: { features },
		message: 'A DAWproject clip carries fades and warping but no gain, envelope, pitch shift, reverse, or formant setting; the clip is written without them.',
	});
}

function buildVideoClip(clip: DataRecord, context: DawprojectExportContext): XmlElement | null {
	const { sampleRate, draft } = context;
	const clipId = String(clip.id);
	const sourceId = String(clip.sourceId ?? '');
	const source = context.sourceById.get(sourceId);
	if (!source) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.media-reference-missing',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'clip', id: clipId },
			data: { sourceId },
			message: 'The clip references a source the project does not contain.',
		});
		return null;
	}
	if (!context.embeddableVideoSourceIds.has(sourceId)) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.video-media-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: clipId },
			data: { sourceId },
			message: 'The video source\'s original container is not available to embed, so the clip is not written.',
		});
		return null;
	}
	const timeEffect = interchangeClipTimeEffect(clip);
	if (timeEffect) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.video-time-effect-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: clipId },
			data: { kind: timeEffect.kind, ...timeEffect.data },
			message: 'DAWproject video has no retime vocabulary; the clip is written at its rendered duration.',
		});
	}
	const entry = context.media.register(source, 'video');
	const sourceRate = finite(source.sampleRate, sampleRate) > 0 ? finite(source.sampleRate, sampleRate) : sampleRate;
	const durationFrames = positiveInteger(clip.durationFrames, 'clip.durationFrames');
	return xmlElement('Clip', {
		time: nonNegativeInteger(clip.timelineStartFrame ?? 0, 'clip.timelineStartFrame') / sampleRate,
		duration: durationFrames / sampleRate,
		contentTimeUnit: 'seconds',
		playStart: nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame') / sampleRate,
		enable: true,
		name: String(clip.title ?? source.name ?? clipId),
	}, [
		xmlElement('Video', {
			channels: source.hasAudio === true ? 2 : 0,
			duration: finite(source.sampleFrameCount, durationFrames) / sourceRate,
			sampleRate: sourceRate,
			timeUnit: 'seconds',
			id: context.ids.id(`video:${clipId}`),
		}, [xmlElement('File', { path: entry.path, external: false })]),
	]);
}

/**
 * Volume, pan, and mute automation for one strip as `Points` timelines.
 *
 * A V21 lane is the authority when one exists for the parameter; the legacy
 * volume envelope stands in otherwise. Both target the channel parameter the
 * structure declared, by the same id.
 */
export function buildStripAutomation(key: string, strip: DataRecord, context: DawprojectExportContext): XmlElement[] {
	const lanes = records(context.project.automationLanes).filter((lane) => {
		const address = record(lane.address);
		return address.kind === 'strip' && stripKey(record(address.strip)) === key;
	});
	const byParameter = new Map(lanes.map((lane) => [String(record(lane.address).parameterId), lane]));
	const result: XmlElement[] = [];
	const gainLane = byParameter.get('gain');
	if (gainLane) {
		const points = lanePoints(gainLane, context);
		if (points) result.push(pointsElement(context, key, 'volume', 'linear', points, (value) => Math.max(0, value)));
	} else {
		const envelope: ResolvedPoint[] = records(strip.envelope)
			.map((point) => ({ frame: finite(point.frame, Number.NaN), value: finite(point.value, Number.NaN), interpolation: 'linear' as const }))
			.filter((point) => Number.isFinite(point.frame) && Number.isFinite(point.value));
		// The envelope is linear between points and flat after the last one.
		const last = envelope.at(-1);
		if (last) envelope[envelope.length - 1] = { ...last, interpolation: 'hold' };
		if (envelope.length > 0) result.push(pointsElement(context, key, 'volume', 'linear', envelope, (value) => Math.max(0, value)));
	}
	const panLane = byParameter.get('pan');
	if (panLane) {
		const points = lanePoints(panLane, context);
		if (points) result.push(pointsElement(context, key, 'pan', 'normalized', points, panToNormalized));
	}
	const muteLane = byParameter.get('mute');
	if (muteLane) {
		const points = lanePoints(muteLane, context);
		if (points) {
			result.push(xmlElement('Points', { id: context.ids.id(`points:${key}:mute`) }, [
				xmlElement('Target', { parameter: parameterIdFor(context, key, 'mute') }),
				...points.map((point) => xmlElement('BoolPoint', {
					time: point.frame / context.sampleRate, value: point.value >= 0.5,
				})),
			]));
		}
	}
	return result;
}

interface ResolvedPoint {
	readonly frame: number;
	readonly value: number;
	readonly interpolation: 'hold' | 'linear';
}

function lanePoints(lane: DataRecord, context: DawprojectExportContext): readonly ResolvedPoint[] | null {
	const laneId = String(lane.id);
	context.consumedLaneIds.add(laneId);
	let resolved: readonly Readonly<{ frame: number; value: number }>[];
	try {
		resolved = resolveAutomationLanePointFramesV21(lane as unknown as AutomationLaneV21, {
			sampleRate: context.sampleRate,
			...(context.tempoMap ? { tempoMap: context.tempoMap } : {}),
		});
	} catch (error) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'automation-lane', id: laneId },
			data: { reason: error instanceof Error ? error.message : String(error) },
			message: 'The automation lane could not be resolved to sample positions and is not written.',
		});
		return null;
	}
	const segments = records(lane.segments);
	let approximated = 0;
	const points = resolved.map((point, index) => {
		const kind = index < segments.length ? String(segments[index]!.kind ?? 'linear') : 'hold';
		if (kind !== 'hold' && kind !== 'linear') approximated += 1;
		return { frame: point.frame, value: point.value, interpolation: kind === 'hold' ? 'hold' as const : 'linear' as const };
	});
	if (approximated > 0) {
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-curve-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'automation-lane', id: laneId },
			data: { segments: approximated },
			message: 'DAWproject automation interpolates by hold or line; eased and bezier segments are written as lines between their anchors.',
		});
	}
	return points;
}

function pointsElement(
	context: DawprojectExportContext,
	key: string,
	parameter: 'volume' | 'pan',
	unit: 'linear' | 'normalized',
	points: readonly ResolvedPoint[],
	convert: (value: number) => number,
): XmlElement {
	return xmlElement('Points', { unit, id: context.ids.id(`points:${key}:${parameter}`) }, [
		xmlElement('Target', { parameter: parameterIdFor(context, key, parameter) }),
		...points.map((point) => xmlElement('RealPoint', {
			time: point.frame / context.sampleRate,
			value: convert(point.value),
			interpolation: point.interpolation,
		})),
	]);
}

function reportUnconsumedLanes(context: DawprojectExportContext): void {
	for (const lane of records(context.project.automationLanes)) {
		const laneId = String(lane.id);
		if (context.consumedLaneIds.has(laneId)) continue;
		const address = record(lane.address);
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.automation-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'automation-lane', id: laneId },
			data: { addressKind: String(address.kind ?? ''), parameterId: String(address.parameterId ?? '') },
			message: 'Only volume, pan, and mute of a written channel have a DAWproject parameter to target; this lane\'s parameter has none.',
		});
	}
}

function buildMarkers(context: DawprojectExportContext): XmlElement | null {
	const { project, sampleRate, draft } = context;
	const markers: MarkerEntry[] = [];
	const regionIds: string[] = [];
	for (const annotation of records(project.timelineAnnotations)) {
		const start = finite(annotation.timelineStartFrame ?? annotation.positionFrame ?? annotation.startFrame, Number.NaN);
		if (!Number.isFinite(start)) continue;
		const end = finite(annotation.timelineEndFrame ?? annotation.endFrame, start);
		markers.push({ time: start / sampleRate, name: String(annotation.name ?? ''), comment: null });
		if (annotation.kind === 'region' && end > start) regionIds.push(String(annotation.id));
	}
	if (regionIds.length > 0) {
		addDeliveryReportItem(draft, {
			code: 'dawproject.region-extents-converted',
			disposition: 'converted',
			severity: 'warning',
			data: { regions: regionIds.length, annotationIds: regionIds },
			message: 'A DAWproject marker is a point in time; each region is written as a marker at its start and its end is not carried.',
		});
	}
	for (const track of records(project.tracks)) {
		if (track.type !== 'label') continue;
		const labels = records(track.labels);
		if (labels.length === 0) continue;
		let extents = 0;
		for (const label of labels) {
			const start = finite(label.startFrame, Number.NaN);
			if (!Number.isFinite(start)) continue;
			if (finite(label.endFrame, start) > start) extents += 1;
			markers.push({ time: start / sampleRate, name: String(label.title ?? ''), comment: String(track.name ?? '') || null });
		}
		addDeliveryReportItem(draft, {
			code: 'dawproject.label-track-converted',
			disposition: 'converted',
			severity: extents > 0 ? 'warning' : 'info',
			scope: { kind: 'track', id: String(track.id) },
			data: { labels: labels.length, regions: extents },
			message: 'Labels are written as arrangement markers named after the label, with the track name as the marker comment; a label\'s end is not carried.',
		});
	}
	if (markers.length === 0) return null;
	markers.sort((left, right) => left.time - right.time || compareCodeUnits(left.name, right.name));
	return xmlElement('Markers', { timeUnit: 'seconds', id: context.ids.id('markers') }, markers.map((marker) => (
		xmlElement('Marker', { time: marker.time, name: marker.name, comment: marker.comment })
	)));
}

function buildTempoAutomation(context: DawprojectExportContext): XmlElement | null {
	const events = records(record(context.project.tempoMap).events);
	if (events.length < 2) return null;
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.tempo-map-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: { events: events.length },
		message: 'Every tempo event is written as a hold point of the transport tempo, positioned in beats.',
	});
	return xmlElement('TempoAutomation', {
		timeUnit: 'beats', unit: 'bpm', id: context.ids.id('tempo-automation'),
	}, [
		xmlElement('Target', { parameter: context.ids.id('tempo') }),
		...events.map((event) => xmlElement('RealPoint', {
			time: rationalValue(event.beat), value: rationalValue(event.bpm), interpolation: 'hold',
		})),
	]);
}

function buildSignatureAutomation(context: DawprojectExportContext): XmlElement | null {
	const events = records(record(context.project.signatureMap).events);
	if (events.length < 2) return null;
	const map = {
		events: events.map((event) => ({
			bar: finite(event.bar, 0), numerator: finite(event.numerator, 4), denominator: finite(event.denominator, 4),
		})),
	};
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.signature-map-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: { events: events.length },
		message: 'Every time-signature event is written as a point of the transport signature, positioned at its bar\'s beat.',
	});
	return xmlElement('TimeSignatureAutomation', {
		timeUnit: 'beats', id: context.ids.id('time-signature-automation'),
	}, [
		xmlElement('Target', { parameter: context.ids.id('time-signature') }),
		...map.events.map((event) => xmlElement('TimeSignaturePoint', {
			time: rationalToNumber(barStartBeat(event.bar, map)),
			numerator: event.numerator,
			denominator: event.denominator,
		})),
	]);
}

function rationalValue(value: unknown): number {
	if (typeof value === 'number') return value;
	const rational = record(value);
	return rationalToNumber({ num: finite(rational.num, 0), den: finite(rational.den, 1) || 1 });
}

function nonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return number;
}

function positiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}
