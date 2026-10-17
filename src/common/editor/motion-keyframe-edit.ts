/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CompiledInterpolationCurve, InterpolationShape } from './interpolation-curve.ts';
import { motionArray, motionInteger, motionRational, motionRecord, freezeMotionValue } from './motion-values.ts';
import { normalizeMotionProperty, type MotionPathProperty, type MotionProperty } from './motion-property.ts';
import type { MotionPropertyValue } from './motion-property-evaluation.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { mergeMotionPathKeys, moveMotionPathKeys, retimeMotionPathKeys, setMotionPathKey } from './motion-path-keyframe-edit.ts';
import { mergeMotionCurveKeys, motionKeyPositionId as keyId, moveMotionCurveKeys, retimeMotionCurve, selectMotionCurveKeys, setMotionCurveKey } from './motion-keyframe-curve-edit.ts';

export type MotionKeyframeEdit =
	| { readonly type: 'set-base'; readonly value: MotionPropertyValue }
	| { readonly type: 'set-key'; readonly position: Rational; readonly value: MotionPropertyValue; readonly channels?: readonly number[] }
	| { readonly type: 'delete-keys'; readonly positions: readonly Rational[]; readonly channels?: readonly number[] }
	| { readonly type: 'move-keys'; readonly positions: readonly Rational[]; readonly deltaFrames: Rational; readonly channels?: readonly number[] }
	| { readonly type: 'interpolation'; readonly fromPosition: Rational; readonly shape: InterpolationShape; readonly channels?: readonly number[] };
export interface MotionKeyframeClipboard { readonly schemaVersion: 1; readonly frameRate: Rational; readonly originFrame: Rational; readonly property: MotionProperty }

/** Edits local-frame key authority; unchanged channels, expressions and unrelated segments remain intact. */
export function editMotionKeyframes(value: MotionProperty, edit: MotionKeyframeEdit): MotionProperty {
	const property = normalizeMotionProperty(value);
	if (edit.type === 'set-base') return normalizeMotionProperty({ ...property, value: edit.value });
	const channels = selectedChannels(property, edit.channels);
	if (edit.type === 'move-keys' || edit.type === 'delete-keys') assertKeySelection(property, edit.positions, channels);
	if (property.kind === 'path') return editPath(property, edit);
	const curves = numericCurves(property); const values = property.kind === 'scalar' ? [property.value] : property.value;
	const keyValue = edit.type === 'set-key' ? normalizeMotionProperty({ ...property, value: edit.value }) : null;
	const newValues = keyValue?.kind === 'scalar' ? [keyValue.value] : keyValue && keyValue.kind !== 'path' ? keyValue.value : values;
	const selected = edit.type === 'move-keys' || edit.type === 'delete-keys' ? positions(edit.positions) : new Set<string>();
	return withCurves(property, curves.map((curve, channel) => {
		if (!channels.has(channel)) return curve;
		if (edit.type === 'set-key') return setMotionCurveKey(curve, { position: position(edit.position), value: newValues[channel]! });
		if (edit.type === 'delete-keys') return selectMotionCurveKeys(curve, (at) => !selected.has(keyId(at)));
		if (edit.type === 'move-keys') return curve === null ? null : moveMotionCurveKeys(curve, (anchor) => selected.has(keyId(anchor.position)) ? { ...anchor, position: addRationals(anchor.position, motionRational(edit.deltaFrames, 'keyframe movement')) } : anchor);
		if (!curve) throw new ReferenceError('Add two motion keyframes before editing interpolation.');
		const from = position(edit.fromPosition); const index = curve.anchors.findIndex((anchor) => compareRationals(anchor.position, from) === 0);
		if (index < 0 || index >= curve.segments.length) throw new ReferenceError('The selected motion key has no outgoing interpolation segment.');
		return { anchors: curve.anchors, segments: curve.segments.map((shape, offset) => offset === index ? edit.shape : shape) };
	}));
}

export function copyMotionKeyframes(value: MotionProperty, selectedPositions: readonly Rational[], frameRate: Rational, channels?: readonly number[]): MotionKeyframeClipboard {
	const property = normalizeMotionProperty(value); const chosen = selectedChannels(property, channels); assertKeySelection(property, selectedPositions, chosen);
	const selected = positions(selectedPositions); const ordered = [...selectedPositions].map(position).sort(compareRationals);
	const copied = property.kind === 'path' ? selectPath(property, (at) => selected.has(keyId(at)))
		: withCurves(property, numericCurves(property).map((curve, index) => chosen.has(index) ? selectMotionCurveKeys(curve, (at) => selected.has(keyId(at))) : null));
	return freezeMotionValue({ schemaVersion: 1, frameRate: motionRational(frameRate, 'clipboard frame rate', true), originFrame: ordered[0]!, property: normalizeMotionProperty({ ...copied, expression: null }) });
}

/** Clipboard times describe seconds through a retained frame rate; paste converts them once to destination frames. */
export function pasteMotionKeyframes(value: MotionProperty, clipboardValue: unknown, options: Readonly<{ atFrame: Rational; frameRate: Rational; mode: 'merge' | 'replace' }>): MotionProperty {
	const target = normalizeMotionProperty(value); const record = motionRecord(clipboardValue, ['schemaVersion', 'frameRate', 'originFrame', 'property'], 'motion keyframe clipboard');
	if (record.schemaVersion !== 1) throw new RangeError('Unsupported motion keyframe clipboard version.');
	const source = normalizeMotionProperty(record.property); if (source.kind !== target.kind) throw new TypeError('Paste motion keyframes into a property with the same value kind.');
	if (options.mode !== 'merge' && options.mode !== 'replace') throw new TypeError('Unsupported motion keyframe paste mode.');
	const origin = position(motionRational(record.originFrame, 'clipboard origin')); const at = position(options.atFrame);
	const ratio = divideRationals(motionRational(options.frameRate, 'destination frame rate', true), motionRational(record.frameRate, 'clipboard frame rate', true));
	const convert = (value: Rational) => addRationals(at, multiplyRationals(subtractRationals(value, origin), ratio));
	if (source.kind === 'path' && target.kind === 'path') {
		const moved = retimeMotionPathKeys(source, convert);
		return normalizeMotionProperty({ ...mergeMotionPathKeys(options.mode === 'replace' ? { ...target, keyframes: [], segments: [] } : target, moved), expression: target.expression });
	}
	if (source.kind === 'path' || target.kind === 'path') throw new TypeError('Motion keyframe paste kinds differ.');
	const destination = numericCurves(target);
	return withCurves(target, numericCurves(source).map((curve, index) => curve === null ? destination[index]! : options.mode === 'replace' ? retimeMotionCurve(curve, convert) : mergeMotionCurveKeys(destination[index]!, retimeMotionCurve(curve, convert))));
}

function numericCurves(property: Exclude<MotionProperty, MotionPathProperty>): readonly (CompiledInterpolationCurve | null)[] { return property.kind === 'scalar' ? [property.curve] : property.curves; }
function withCurves(property: Exclude<MotionProperty, MotionPathProperty>, curves: readonly (CompiledInterpolationCurve | null)[]): MotionProperty { return normalizeMotionProperty(property.kind === 'scalar' ? { ...property, curve: curves[0] } : { ...property, curves }); }
function position(value: Rational): Rational { const result = motionRational(value, 'keyframe position'); if (result.num < 0) throw new RangeError('Motion keyframe positions must be non-negative.'); return result; }
function positions(values: readonly Rational[]): ReadonlySet<string> {
	const valuesArray = motionArray(values, 4096, 'selected keyframes', 1).map((value) => position(motionRational(value, 'selected keyframe'))); const set = new Set(valuesArray.map(keyId));
	if (set.size !== valuesArray.length) throw new RangeError('Selected motion keys contain duplicate positions.'); return set;
}
function selectedChannels(property: MotionProperty, channels?: readonly number[]): ReadonlySet<number> {
	const count = property.kind === 'scalar' || property.kind === 'path' ? 1 : property.value.length;
	if (channels === undefined) return new Set(Array.from({ length: count }, (_, index) => index));
	const selected = motionArray(channels, count, 'selected property channels', 1).map((channel) => motionInteger(channel, 'property channel', 0, count - 1));
	if (new Set(selected).size !== selected.length) throw new RangeError('Selected motion channels contain duplicates.'); return new Set(selected);
}
function assertKeySelection(property: MotionProperty, values: readonly Rational[], channels: ReadonlySet<number>): void {
	const chosen = positions(values); const known = new Set(property.kind === 'path' ? property.keyframes.map(({ position }) => keyId(position))
		: numericCurves(property).flatMap((curve, index) => channels.has(index) ? curve?.anchors.map(({ position }) => keyId(position)) ?? [] : []));
	for (const id of chosen) if (!known.has(id)) throw new ReferenceError('A selected motion keyframe is missing.');
}
function selectPath(property: MotionPathProperty, selected: (position: Rational) => boolean): MotionPathProperty {
	const indexes = property.keyframes.flatMap((key, index) => selected(key.position) ? [index] : []);
	return { ...property, keyframes: indexes.map((index) => property.keyframes[index]!), segments: indexes.slice(1).map((index, offset) => index === indexes[offset]! + 1 ? property.segments[index - 1]! : 'linear') };
}
function editPath(property: MotionPathProperty, edit: Exclude<MotionKeyframeEdit, { type: 'set-base' }>): MotionProperty {
	if (edit.type === 'set-key') {
		const typed = normalizeMotionProperty({ ...property, value: edit.value }); if (typed.kind !== 'path') throw new TypeError('Expected a motion path.');
		return normalizeMotionProperty(setMotionPathKey(property, { position: position(edit.position), value: typed.value }));
	}
	if (edit.type === 'delete-keys') { const selected = positions(edit.positions); return normalizeMotionProperty(selectPath(property, (at) => !selected.has(keyId(at)))); }
	if (edit.type === 'move-keys') { const selected = positions(edit.positions); const delta = motionRational(edit.deltaFrames, 'keyframe movement');
		return normalizeMotionProperty(moveMotionPathKeys(property, (at) => selected.has(keyId(at)) ? addRationals(at, delta) : at)); }
	const from = position(edit.fromPosition); const index = property.keyframes.findIndex((key) => compareRationals(key.position, from) === 0);
	if (index < 0 || index >= property.segments.length) throw new ReferenceError('The selected path key has no outgoing segment.');
	return normalizeMotionProperty({ ...property, segments: property.segments.map((shape, offset) => offset === index ? edit.shape.kind === 'bezier' ? edit.shape : edit.shape.kind : shape) });
}
