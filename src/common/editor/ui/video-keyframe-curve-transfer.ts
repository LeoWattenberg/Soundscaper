/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../closed-domain-value.ts';
import { compileInterpolationCurve, type CompiledInterpolationCurve } from '../interpolation-curve.ts';
import {
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
	type VideoKeyframeTarget,
} from '../video-keyframe-curves.ts';
import type { VideoKeyframeDialogModel } from './video-keyframe-dialog-model.ts';

export const VIDEO_KEYFRAME_CURVE_TRANSFER_SCHEMA_VERSION = 1 as const;
export const MAXIMUM_VIDEO_KEYFRAME_CURVE_TRANSFER_BYTES = 262_144;
export type VideoKeyframeCurveTransferRole = 'clipboard' | 'preset';

export interface VideoKeyframeCurveTransfer {
	readonly schemaVersion: typeof VIDEO_KEYFRAME_CURVE_TRANSFER_SCHEMA_VERSION;
	readonly role: VideoKeyframeCurveTransferRole;
	readonly curve: CompiledInterpolationCurve;
}

interface EditableModel extends VideoKeyframeDialogModel {
	readonly composition: NonNullable<VideoKeyframeDialogModel['composition']>;
	readonly keyframes: NonNullable<VideoKeyframeDialogModel['keyframes']>;
}

/** Copy one exact authored curve into a separate UI-only transfer wire. */
export function createVideoKeyframeCurveTransfer(
	modelValue: VideoKeyframeDialogModel,
	input: Readonly<{ readonly role: VideoKeyframeCurveTransferRole; readonly target: VideoKeyframeTarget }>,
): VideoKeyframeCurveTransfer {
	const model = editableModel(modelValue);
	const key = targetKey(input.target);
	const curve = model.keyframes.curves.find(({ target }) => targetKey(target) === key)?.curve;
	if (!curve) throw new ReferenceError('The video keyframe curve is missing.');
	return normalizeTransfer({
		schemaVersion: VIDEO_KEYFRAME_CURVE_TRANSFER_SCHEMA_VERSION,
		role: input.role,
		curve: curveWire(curve),
	});
}

/** Parse bounded text or a descriptor-safe in-memory transfer. */
export function parseVideoKeyframeCurveTransfer(
	value: unknown,
	expectedRole?: VideoKeyframeCurveTransferRole,
): VideoKeyframeCurveTransfer {
	let candidate = value;
	if (typeof value === 'string') {
		const bytes = new TextEncoder().encode(value).byteLength;
		if (bytes > MAXIMUM_VIDEO_KEYFRAME_CURVE_TRANSFER_BYTES) {
			throw new RangeError('The video keyframe curve transfer exceeds its byte limit.');
		}
		try { candidate = JSON.parse(value) as unknown; } catch (cause) {
			throw new SyntaxError('The video keyframe curve transfer is not valid JSON.', { cause });
		}
	}
	const transfer = normalizeTransfer(candidate);
	if (expectedRole && transfer.role !== expectedRole) {
		throw new RangeError(`The video keyframe curve transfer role must be ${expectedRole}.`);
	}
	return transfer;
}

export function serializeVideoKeyframeCurveTransfer(value: unknown): string {
	const encoded = JSON.stringify(parseVideoKeyframeCurveTransfer(value));
	if (new TextEncoder().encode(encoded).byteLength > MAXIMUM_VIDEO_KEYFRAME_CURVE_TRANSFER_BYTES) {
		throw new RangeError('The video keyframe curve transfer exceeds its byte limit.');
	}
	return encoded;
}

/** Apply a transfer to an explicitly selected destination target and revalidate its context. */
export function applyVideoKeyframeCurveTransfer(
	modelValue: VideoKeyframeDialogModel,
	transferValue: unknown,
	targetValue: VideoKeyframeTarget,
): VideoKeyframeCurves {
	const model = editableModel(modelValue);
	const transfer = parseVideoKeyframeCurveTransfer(transferValue);
	const target = targetWire(targetValue);
	const key = targetKey(targetValue);
	const curves = model.keyframes.curves
		.filter((entry) => targetKey(entry.target) !== key)
		.map(({ target: current, curve }) => ({ target: targetWire(current), curve: curveWire(curve) }));
	curves.push({ target, curve: curveWire(transfer.curve) });
	return normalizeVideoKeyframeCurves({
		schemaVersion: 1,
		timeDomain: model.keyframes.timeDomain,
		curves,
	}, context(model), 'applied video keyframe curve transfer');
}

function normalizeTransfer(value: unknown): VideoKeyframeCurveTransfer {
	const record = readClosedDomainRecord(value, 'video keyframe curve transfer', [
		'schemaVersion', 'role', 'curve',
	]);
	if (field(record, 'schemaVersion') !== VIDEO_KEYFRAME_CURVE_TRANSFER_SCHEMA_VERSION) {
		throw new RangeError('The video keyframe curve transfer schemaVersion must be 1.');
	}
	const role = field(record, 'role');
	if (role !== 'clipboard' && role !== 'preset') {
		throw new RangeError('The video keyframe curve transfer role is unsupported.');
	}
	const curveValue = field(record, 'curve');
	assertExactCurveWire(curveValue);
	return Object.freeze({
		schemaVersion: VIDEO_KEYFRAME_CURVE_TRANSFER_SCHEMA_VERSION,
		role,
		curve: compileInterpolationCurve(curveValue),
	});
}

function assertExactCurveWire(value: unknown): void {
	const curve = readClosedDomainRecord(value, 'video keyframe curve transfer.curve', ['anchors', 'segments']);
	const anchors = readClosedDomainArray(
		field(curve, 'anchors'), 'video keyframe curve transfer.curve.anchors', 2, 4_096,
	);
	const segments = readClosedDomainArray(
		field(curve, 'segments'), 'video keyframe curve transfer.curve.segments', 1, 4_095,
	);
	if (anchors.length !== segments.length + 1) {
		throw new RangeError('A transferred video keyframe curve requires one more anchor than segment.');
	}
	for (const [index, value] of anchors.entries()) assertAnchor(value, `anchors[${String(index)}]`);
	for (const [index, value] of segments.entries()) assertSegment(value, `segments[${String(index)}]`);
}

function assertAnchor(value: unknown, name: string): void {
	const anchor = readClosedDomainRecord(value, `video keyframe curve transfer.${name}`, ['position', 'value']);
	const position = readClosedDomainRecord(field(anchor, 'position'), `${name}.position`, ['num', 'den']);
	for (const key of ['num', 'den'] as const) {
		if (Object.is(field(position, key), -0)) throw new RangeError('Video keyframe curve transfer cannot contain negative zero.');
	}
	if (Object.is(field(anchor, 'value'), -0)) throw new RangeError('Video keyframe curve transfer cannot contain negative zero.');
}

function assertSegment(value: unknown, name: string): void {
	const base = readClosedDomainRecord(value, `video keyframe curve transfer.${name}`, [
		'kind', 'control1', 'control2',
	], ['kind']);
	if (field(base, 'kind') !== 'bezier') return;
	const segment = readClosedDomainRecord(value, `video keyframe curve transfer.${name}`, [
		'kind', 'control1', 'control2',
	]);
	assertAnchor(field(segment, 'control1'), `${name}.control1`);
	assertAnchor(field(segment, 'control2'), `${name}.control2`);
}

function curveWire(curve: CompiledInterpolationCurve) {
	return {
		anchors: curve.anchors.map(({ position, value }) => ({
			position: { num: position.num, den: position.den }, value,
		})),
		segments: curve.segments.map((segment) => segment.kind === 'bezier' ? {
			kind: segment.kind,
			control1: { position: { ...segment.control1.position }, value: segment.control1.value },
			control2: { position: { ...segment.control2.position }, value: segment.control2.value },
		} : { kind: segment.kind }),
	};
}

function targetWire(target: VideoKeyframeTarget) {
	return target.kind === 'composition'
		? { kind: target.kind, parameterId: target.parameterId }
		: { kind: target.kind, effectId: target.effectId, parameterId: target.parameterId };
}

function targetKey(target: VideoKeyframeTarget): string {
	return target.kind === 'composition'
		? JSON.stringify([target.kind, target.parameterId])
		: JSON.stringify([target.kind, target.effectId, target.parameterId]);
}

function context(model: EditableModel) {
	return Object.freeze({
		duration: Object.freeze({ num: model.sequenceFrameCount, den: 1 }),
		composition: model.composition,
		videoEffects: model.videoEffects,
	});
}

function editableModel(value: VideoKeyframeDialogModel): EditableModel {
	if (!value.clipId || !value.composition || !value.keyframes || value.sequenceFrameCount <= 0) {
		throw new TypeError('An editable V20 video keyframe model is required.');
	}
	return value as EditableModel;
}

function field(record: ClosedDomainRecord, key: string): unknown {
	return readClosedDomainField(record, key, 'video keyframe curve transfer');
}
