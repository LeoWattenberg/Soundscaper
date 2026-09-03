/* SPDX-License-Identifier: AGPL-3.0-only */

import { beatToSampleFrame, type HoldTempoMap } from './timeline-time.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';
import {
	attribute,
	booleanAttribute,
	childElement,
	childElements,
	integerAttribute,
	numberAttribute,
	type XmlElement,
} from './dawproject-xml.ts';
import {
	normalizeEntryPath,
	rationalFromDouble,
	rationalToNumber,
	type DawprojectTimeUnit,
} from './dawproject-format.ts';
import type { DawprojectDocument } from './dawproject-import.ts';

/**
 * The reading half of DAWproject, part two: the arrangement flattened into
 * sample-positioned events.
 *
 * A DAWproject arrangement nests. Lanes hold Clips, a Clip holds a timeline
 * that may itself be Clips or Lanes, every level may switch between beats and
 * seconds, and a Clip may reference a timeline declared elsewhere. Bitwig, for
 * one, writes an audio clip as a Clip whose content is a Clips timeline whose
 * Clip holds a Warps timeline around the Audio. None of that structure has a
 * home in the project model, which places one clip per source span on one
 * track, so the walk here resolves every level into absolute project frames
 * through the tempo map and hands back a flat list.
 *
 * The one deliberate approximation: an Audio timeline in beats has no exact
 * meaning without a warp, so its content is read as un-stretched seconds from
 * the content origin, and the event says so for the report.
 */

export interface DawprojectTimeResolver {
	readonly sampleRate: number;
	frameAtBeat(beat: number): number;
	beatAtFrame(frame: number): number;
}

export interface DawprojectAudioEvent {
	readonly trackId: string | null;
	readonly startFrame: number;
	/** Exclusive. */
	readonly endFrame: number;
	readonly path: string;
	readonly external: boolean;
	readonly fileDurationSeconds: number | null;
	readonly fileChannels: number | null;
	readonly fileSampleRate: number | null;
	readonly sourceOffsetSeconds: number;
	readonly contentSpanSeconds: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly crossfade: boolean;
	readonly name: string | null;
	readonly color: string | null;
	readonly enabled: boolean;
	readonly looped: boolean;
	/** 0 when the content plays unwarped; otherwise the Warp events consulted. */
	readonly warpPoints: number;
	readonly contentInBeats: boolean;
}

export interface DawprojectMarkerEvent {
	readonly frame: number;
	readonly name: string;
	readonly color: string | null;
	readonly comment: string | null;
}

export interface DawprojectAutomationPoint {
	readonly frame: number;
	readonly value: number;
	readonly interpolation: 'hold' | 'linear';
}

export interface DawprojectAutomationEvent {
	readonly trackId: string | null;
	readonly parameterId: string | null;
	readonly unit: string | null;
	readonly kind: 'real' | 'bool';
	readonly points: readonly DawprojectAutomationPoint[];
}

export interface DawprojectFlattenedOmissions {
	readonly notes: number;
	readonly video: number;
	readonly clipAutomation: number;
	readonly unresolvedReferences: number;
	readonly unsupportedContent: number;
}

export interface DawprojectFlattenedArrangement {
	readonly audio: readonly DawprojectAudioEvent[];
	readonly markers: readonly DawprojectMarkerEvent[];
	readonly automation: readonly DawprojectAutomationEvent[];
	readonly omitted: DawprojectFlattenedOmissions;
}

interface Window {
	readonly start: number;
	readonly end: number | null;
}

interface Scope {
	readonly unit: DawprojectTimeUnit;
	readonly trackId: string | null;
	/** The frame at local time zero. Always in step with `originBeat`. */
	readonly originFrame: number;
	readonly originBeat: number;
	readonly window: Window | null;
	readonly depth: number;
	readonly expanding: ReadonlySet<string>;
}

interface ClipInfo {
	readonly name: string | null;
	readonly color: string | null;
	readonly enabled: boolean;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly crossfade: boolean;
	readonly looped: boolean;
}

interface WalkState {
	readonly audio: DawprojectAudioEvent[];
	readonly markers: DawprojectMarkerEvent[];
	readonly automation: DawprojectAutomationEvent[];
	notes: number;
	video: number;
	clipAutomation: number;
	unresolvedReferences: number;
	unsupportedContent: number;
}

interface Warp {
	readonly time: number;
	readonly contentTime: number;
}

const MAXIMUM_DEPTH = 48;

export function createDawprojectTimeResolver(tempoMap: HoldTempoMap, sampleRate: number): DawprojectTimeResolver {
	const first = tempoMap.events[0];
	if (!first) throw new RangeError('A tempo map requires a root event.');
	const rootBpm = rationalToNumber(first.bpm);
	return Object.freeze({
		sampleRate,
		frameAtBeat(beat: number): number {
			if (!Number.isFinite(beat)) throw new RangeError('A beat position must be finite.');
			return beatToSampleFrame(rationalFromDouble(beat), tempoMap, sampleRate);
		},
		beatAtFrame(frame: number): number {
			if (!Number.isFinite(frame)) throw new RangeError('A frame position must be finite.');
			// Before the origin there is no map to walk; the root tempo extends backwards.
			if (frame < 0) return frame / sampleRate * rootBpm / 60;
			return rationalToNumber(sampleFrameToBeat(Math.round(frame), tempoMap, sampleRate));
		},
	});
}

export function flattenDawprojectArrangement(
	document: DawprojectDocument,
	resolver: DawprojectTimeResolver,
): DawprojectFlattenedArrangement {
	const state: WalkState = {
		audio: [], markers: [], automation: [],
		notes: 0, video: 0, clipAutomation: 0, unresolvedReferences: 0, unsupportedContent: 0,
	};
	const arrangement = document.arrangement;
	if (arrangement?.lanes) visitTimeline(arrangement.lanes, rootScope('beats'), null, state, document, resolver);
	if (arrangement?.markers) {
		visitMarkers(arrangement.markers, rootScope(timeUnit(attribute(arrangement.markers, 'timeUnit')) ?? 'beats'), state, resolver);
	}
	return Object.freeze({
		audio: Object.freeze(state.audio),
		markers: Object.freeze(state.markers),
		automation: Object.freeze(state.automation),
		omitted: Object.freeze({
			notes: state.notes,
			video: state.video,
			clipAutomation: state.clipAutomation,
			unresolvedReferences: state.unresolvedReferences,
			unsupportedContent: state.unsupportedContent,
		}),
	});
}

function rootScope(unit: DawprojectTimeUnit): Scope {
	return { unit, trackId: null, originFrame: 0, originBeat: 0, window: null, depth: 0, expanding: new Set() };
}

function visitTimeline(
	element: XmlElement,
	scope: Scope,
	clip: ClipInfo | null,
	state: WalkState,
	document: DawprojectDocument,
	resolver: DawprojectTimeResolver,
): void {
	if (scope.depth > MAXIMUM_DEPTH) {
		state.unsupportedContent += 1;
		return;
	}
	switch (element.name) {
		case 'Lanes': {
			const inner = rebase(scope, timeUnit(attribute(element, 'timeUnit')) ?? scope.unit, resolver);
			const next = { ...inner, trackId: attribute(element, 'track') ?? scope.trackId, depth: scope.depth + 1 };
			for (const child of element.children) visitTimeline(child, next, clip, state, document, resolver);
			return;
		}
		case 'Clips': {
			const inner = rebase(scope, timeUnit(attribute(element, 'timeUnit')) ?? scope.unit, resolver);
			for (const child of childElements(element, 'Clip')) visitClip(child, inner, clip, state, document, resolver);
			return;
		}
		case 'Audio':
			visitAudio(element, scope, clip, state, resolver, null);
			return;
		case 'Warps':
			visitWarps(element, scope, clip, state, document, resolver);
			return;
		case 'Video':
			state.video += 1;
			return;
		case 'Notes':
			state.notes += childElements(element, 'Note').length;
			return;
		case 'Points':
			if (clip) state.clipAutomation += 1;
			else visitPoints(element, scope, state, resolver);
			return;
		case 'Markers':
		case 'markers':
			visitMarkers(element, scope, state, resolver);
			return;
		case 'ClipSlot':
		case 'Timeline':
			state.unsupportedContent += 1;
			return;
		default:
			return;
	}
}

function visitClip(
	clip: XmlElement,
	scope: Scope,
	inherited: ClipInfo | null,
	state: WalkState,
	document: DawprojectDocument,
	resolver: DawprojectTimeResolver,
): void {
	const time = numberAttribute(clip, 'time') ?? 0;
	const startFrame = frameOf(scope, time, resolver);
	const clipStartBeat = scope.unit === 'beats' ? scope.originBeat + time : resolver.beatAtFrame(startFrame);
	const contentUnit = timeUnit(attribute(clip, 'contentTimeUnit')) ?? scope.unit;
	const playStart = numberAttribute(clip, 'playStart') ?? 0;
	const inner = anchoredScope(scope, contentUnit, startFrame, clipStartBeat, playStart, resolver);
	const duration = numberAttribute(clip, 'duration');
	const playStop = numberAttribute(clip, 'playStop');
	let endFrame: number | null = null;
	if (duration !== null) endFrame = frameOf(scope, time + duration, resolver);
	else if (playStop !== null) endFrame = frameOf(inner, playStop, resolver);
	const window = intersect(scope.window, { start: startFrame, end: endFrame });
	if (!window) return;

	const fadeUnit = timeUnit(attribute(clip, 'fadeTimeUnit')) ?? scope.unit;
	const fadeFrames = (value: number): number => (fadeUnit === 'seconds'
		? Math.round(Math.abs(value) * resolver.sampleRate)
		: Math.max(0, resolver.frameAtBeat(clipStartBeat + Math.abs(value)) - startFrame));
	const fadeIn = numberAttribute(clip, 'fadeInTime') ?? 0;
	const fadeOut = numberAttribute(clip, 'fadeOutTime') ?? 0;
	const loopStart = numberAttribute(clip, 'loopStart');
	const loopEnd = numberAttribute(clip, 'loopEnd');
	const looped = loopStart !== null && loopEnd !== null && loopEnd > loopStart && endFrame !== null
		&& endFrame - startFrame > frameOf(inner, loopEnd, resolver) - frameOf(inner, loopStart, resolver) + 1;
	const info: ClipInfo = {
		name: attribute(clip, 'name') ?? inherited?.name ?? null,
		color: attribute(clip, 'color') ?? inherited?.color ?? null,
		enabled: booleanAttribute(clip, 'enable') !== false && (inherited?.enabled ?? true),
		fadeInFrames: fadeIn !== 0 ? fadeFrames(fadeIn) : (inherited?.fadeInFrames ?? 0),
		fadeOutFrames: fadeOut !== 0 ? fadeFrames(fadeOut) : (inherited?.fadeOutFrames ?? 0),
		crossfade: fadeIn < 0 || inherited?.crossfade === true,
		looped: looped || inherited?.looped === true,
	};
	const content = resolveContent(clip, scope, state, document);
	if (!content) return;
	const expanding = content.reference ? new Set([...scope.expanding, content.reference]) : scope.expanding;
	visitTimeline(content.element, { ...inner, window, depth: scope.depth + 1, expanding }, info, state, document, resolver);
}

function resolveContent(
	clip: XmlElement,
	scope: Scope,
	state: WalkState,
	document: DawprojectDocument,
): Readonly<{ element: XmlElement; reference: string | null }> | null {
	const inline = clip.children[0];
	if (inline) return { element: inline, reference: null };
	const reference = attribute(clip, 'reference');
	if (reference === null) return null;
	const element = document.elementsById.get(reference);
	if (!element || scope.expanding.has(reference)) {
		state.unresolvedReferences += 1;
		return null;
	}
	return { element, reference };
}

function visitWarps(
	element: XmlElement,
	scope: Scope,
	clip: ClipInfo | null,
	state: WalkState,
	document: DawprojectDocument,
	resolver: DawprojectTimeResolver,
): void {
	const content = element.children.find((child) => child.name !== 'Warp');
	if (!content) return;
	const warps: Warp[] = childElements(element, 'Warp')
		.map((warp) => ({ time: numberAttribute(warp, 'time') ?? 0, contentTime: numberAttribute(warp, 'contentTime') ?? 0 }))
		.sort((left, right) => left.time - right.time);
	const warpScope = rebase(scope, timeUnit(attribute(element, 'timeUnit')) ?? scope.unit, resolver);
	if (warps.length < 2 || !clip || !scope.window) {
		visitTimeline(content, warpScope, clip, state, document, resolver);
		return;
	}
	if (content.name !== 'Audio') {
		if (content.name === 'Video') state.video += 1;
		else state.unsupportedContent += 1;
		return;
	}
	const contentUnit = timeUnit(attribute(element, 'contentTimeUnit')) ?? 'seconds';
	// Content time in beats is read as seconds at the tempo of the content origin.
	const contentSeconds = (value: number): number => (contentUnit === 'seconds'
		? value
		: (resolver.frameAtBeat(warpScope.originBeat + value) - warpScope.originFrame) / resolver.sampleRate);
	const window = scope.window;
	const localStart = localTimeOf(warpScope, window.start, resolver);
	let end = window.end;
	if (end === null) {
		const fileDuration = numberAttribute(content, 'duration');
		const localEnd = fileDuration === null ? localStart : warpInverse(warps, contentUnit === 'seconds' ? fileDuration : fileDuration);
		end = Math.max(window.start + 1, frameOf(warpScope, localEnd, resolver));
	}
	const localEnd = localTimeOf(warpScope, end, resolver);
	const contentStart = contentSeconds(warpValue(warps, localStart));
	const contentEnd = contentSeconds(warpValue(warps, localEnd));
	const epsilon = 1e-9;
	const interior = warps.filter((warp) => warp.time > localStart + epsilon && warp.time < localEnd - epsilon).length;
	visitAudio(content, { ...scope, window: { start: window.start, end } }, clip, state, resolver, {
		sourceOffsetSeconds: contentStart,
		contentSpanSeconds: contentEnd - contentStart,
		warpPoints: interior > 0 ? warps.length : 2,
		contentInBeats: contentUnit === 'beats',
	});
}

function visitAudio(
	element: XmlElement,
	scope: Scope,
	clip: ClipInfo | null,
	state: WalkState,
	resolver: DawprojectTimeResolver,
	warped: Readonly<{ sourceOffsetSeconds: number; contentSpanSeconds: number; warpPoints: number; contentInBeats: boolean }> | null,
): void {
	if (!clip || !scope.window) {
		state.unsupportedContent += 1;
		return;
	}
	const file = childElement(element, 'File');
	const path = file ? attribute(file, 'path') : null;
	if (!file || path === null || !path.trim()) {
		state.unsupportedContent += 1;
		return;
	}
	const fileDuration = numberAttribute(element, 'duration');
	const audioUnit = timeUnit(attribute(element, 'timeUnit')) ?? scope.unit;
	const window = scope.window;
	let sourceOffsetSeconds: number;
	let contentSpanSeconds: number;
	let end = window.end;
	if (warped) {
		sourceOffsetSeconds = warped.sourceOffsetSeconds;
		contentSpanSeconds = warped.contentSpanSeconds;
		if (end === null) end = window.start + 1;
	} else {
		sourceOffsetSeconds = audioUnit === 'seconds'
			? localTimeOf(scope, window.start, resolver)
			: (window.start - scope.originFrame) / resolver.sampleRate;
		if (end === null) {
			const remaining = Math.max(0, (fileDuration ?? 0) - sourceOffsetSeconds);
			end = window.start + Math.max(1, Math.round(remaining * resolver.sampleRate));
		}
		contentSpanSeconds = (end - window.start) / resolver.sampleRate;
	}
	state.audio.push(Object.freeze({
		trackId: scope.trackId,
		startFrame: window.start,
		endFrame: end,
		path: normalizeEntryPath(path.trim()),
		external: booleanAttribute(file, 'external') === true,
		fileDurationSeconds: fileDuration,
		fileChannels: integerAttribute(element, 'channels'),
		fileSampleRate: integerAttribute(element, 'sampleRate'),
		sourceOffsetSeconds,
		contentSpanSeconds,
		fadeInFrames: clip.fadeInFrames,
		fadeOutFrames: clip.fadeOutFrames,
		crossfade: clip.crossfade,
		name: clip.name,
		color: clip.color,
		enabled: clip.enabled,
		looped: clip.looped,
		warpPoints: warped?.warpPoints ?? 0,
		contentInBeats: warped ? warped.contentInBeats : audioUnit === 'beats',
	}));
}

function visitPoints(element: XmlElement, scope: Scope, state: WalkState, resolver: DawprojectTimeResolver): void {
	const pointScope = rebase(scope, timeUnit(attribute(element, 'timeUnit')) ?? scope.unit, resolver);
	const target = childElement(element, 'Target');
	let kind: 'real' | 'bool' = 'real';
	const points: DawprojectAutomationPoint[] = [];
	for (const point of element.children) {
		const time = point.name === 'Target' ? null : numberAttribute(point, 'time');
		if (time === null || !Number.isFinite(time)) continue;
		const frame = frameOf(pointScope, time, resolver);
		if (point.name === 'RealPoint') {
			const value = numberAttribute(point, 'value');
			if (value === null) continue;
			const interpolation = attribute(point, 'interpolation') === 'linear' ? 'linear' : 'hold';
			points.push({ frame, value, interpolation });
		} else if (point.name === 'BoolPoint') {
			kind = 'bool';
			points.push({ frame, value: booleanAttribute(point, 'value') === true ? 1 : 0, interpolation: 'hold' });
		} else if (point.name === 'IntegerPoint' || point.name === 'EnumPoint') {
			const value = integerAttribute(point, 'value');
			if (value !== null) points.push({ frame, value, interpolation: 'hold' });
		}
	}
	if (points.length === 0) return;
	points.sort((left, right) => left.frame - right.frame);
	state.automation.push(Object.freeze({
		trackId: scope.trackId,
		parameterId: target ? attribute(target, 'parameter') : null,
		unit: attribute(element, 'unit'),
		kind,
		points: Object.freeze(points),
	}));
}

function visitMarkers(element: XmlElement, scope: Scope, state: WalkState, resolver: DawprojectTimeResolver): void {
	const markerScope = rebase(scope, timeUnit(attribute(element, 'timeUnit')) ?? scope.unit, resolver);
	for (const marker of childElements(element, 'Marker')) {
		const time = numberAttribute(marker, 'time');
		if (time === null) continue;
		state.markers.push(Object.freeze({
			frame: frameOf(markerScope, time, resolver),
			name: attribute(marker, 'name') ?? '',
			color: attribute(marker, 'color'),
			comment: attribute(marker, 'comment'),
		}));
	}
}

/** The same origin read in another unit; both coordinates are kept in step. */
function rebase(scope: Scope, unit: DawprojectTimeUnit, resolver: DawprojectTimeResolver): Scope {
	if (unit === scope.unit) return scope;
	return unit === 'seconds'
		? { ...scope, unit, originFrame: resolver.frameAtBeat(scope.originBeat) }
		: { ...scope, unit, originBeat: resolver.beatAtFrame(scope.originFrame) };
}

/** A scope in `unit` whose local time `anchorTime` falls on `anchorFrame`. */
function anchoredScope(
	scope: Scope,
	unit: DawprojectTimeUnit,
	anchorFrame: number,
	anchorBeat: number,
	anchorTime: number,
	resolver: DawprojectTimeResolver,
): Scope {
	if (unit === 'seconds') {
		const originFrame = anchorFrame - Math.round(anchorTime * resolver.sampleRate);
		return { ...scope, unit, originFrame, originBeat: resolver.beatAtFrame(originFrame) };
	}
	const originBeat = anchorBeat - anchorTime;
	return { ...scope, unit, originBeat, originFrame: resolver.frameAtBeat(originBeat) };
}

function frameOf(scope: Scope, time: number, resolver: DawprojectTimeResolver): number {
	return scope.unit === 'seconds'
		? scope.originFrame + Math.round(time * resolver.sampleRate)
		: resolver.frameAtBeat(scope.originBeat + time);
}

function localTimeOf(scope: Scope, frame: number, resolver: DawprojectTimeResolver): number {
	return scope.unit === 'seconds'
		? (frame - scope.originFrame) / resolver.sampleRate
		: resolver.beatAtFrame(frame) - scope.originBeat;
}

function intersect(outer: Window | null, inner: Window): Window | null {
	const start = outer ? Math.max(outer.start, inner.start) : inner.start;
	const end = outer?.end === null || outer?.end === undefined
		? inner.end
		: inner.end === null ? outer.end : Math.min(outer.end, inner.end);
	if (end !== null && end <= start) return null;
	return { start, end };
}

/** Piecewise-linear content time at a warped time, extrapolating past the ends. */
function warpValue(warps: readonly Warp[], time: number): number {
	const first = warps[0]!;
	const last = warps[warps.length - 1]!;
	if (time <= first.time) return interpolate(first, warps[1] ?? last, time);
	if (time >= last.time) return interpolate(warps[warps.length - 2] ?? first, last, time);
	for (let index = 1; index < warps.length; index += 1) {
		if (time <= warps[index]!.time) return interpolate(warps[index - 1]!, warps[index]!, time);
	}
	return last.contentTime;
}

function warpInverse(warps: readonly Warp[], contentTime: number): number {
	const inverted = warps.map((warp) => ({ time: warp.contentTime, contentTime: warp.time }));
	return warpValue(inverted, contentTime);
}

function interpolate(from: Warp, to: Warp, time: number): number {
	const span = to.time - from.time;
	if (span === 0) return from.contentTime;
	return from.contentTime + (time - from.time) * (to.contentTime - from.contentTime) / span;
}

function timeUnit(value: string | null): DawprojectTimeUnit | null {
	return value === 'beats' || value === 'seconds' ? value : null;
}
