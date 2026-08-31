/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { Rational } from '../../timeline-time.ts';
import type { VideoKeyframeCurves } from '../../video-keyframe-curves.ts';
import {
	addVideoKeyframeAnchor,
	removeVideoKeyframeAnchor,
	removeVideoKeyframeCurve,
	setVideoKeyframeSegment,
	updateVideoKeyframeAnchor,
	videoKeyframeTargetKey,
	visiblePositionForVideoKeyframeAnchor,
	type VideoKeyframeDialogModel,
	type VideoKeyframeTargetChoice,
} from '../video-keyframe-dialog-model.ts';

interface VideoKeyframeCurveEditorProps {
	readonly model: VideoKeyframeDialogModel;
	readonly choices: readonly VideoKeyframeTargetChoice[];
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	commit(keyframes: VideoKeyframeCurves): void;
	reportInvalid(): void;
}

export default function VideoKeyframeCurveEditor({
	model, choices, copy, disabled, commit, reportInvalid,
}: VideoKeyframeCurveEditorProps) {
	const curves = model.keyframes?.curves ?? [];
	const [curveKey, setCurveKey] = useState(() => curves[0] ? videoKeyframeTargetKey(curves[0].target) : '');
	const curve = curves.find(({ target }) => videoKeyframeTargetKey(target) === curveKey) ?? curves[0] ?? null;
	const stableKey = curve ? videoKeyframeTargetKey(curve.target) : '';
	const choice = choices.find(({ key }) => key === stableKey) ?? null;
	const [anchorIndex, setAnchorIndex] = useState(0);
	const [segmentIndex, setSegmentIndex] = useState(0);
	const anchor = curve?.curve.anchors[Math.min(anchorIndex, Math.max(0, curve.curve.anchors.length - 1))] ?? null;
	const segment = curve?.curve.segments[Math.min(segmentIndex, Math.max(0, curve.curve.segments.length - 1))] ?? null;
	const visibleAnchor = useMemo(() => anchor ? visiblePositionForVideoKeyframeAnchor(model, anchor.position) : null, [anchor, model]);
	const [positionText, setPositionText] = useState(() => visibleAnchor ? rationalText(visibleAnchor) : '');
	const [valueText, setValueText] = useState(() => String(anchor?.value ?? ''));
	const [segmentKind, setSegmentKind] = useState<'hold' | 'linear' | 'eased' | 'bezier'>(() => segment?.kind ?? 'linear');
	const [control1Position, setControl1Position] = useState(() => segment?.kind === 'bezier'
		? optionalRationalText(visiblePositionForVideoKeyframeAnchor(model, segment.control1.position)) : '0');
	const [control1Value, setControl1Value] = useState(() => String(segment?.kind === 'bezier' ? segment.control1.value : 0));
	const [control2Position, setControl2Position] = useState(() => segment?.kind === 'bezier'
		? optionalRationalText(visiblePositionForVideoKeyframeAnchor(model, segment.control2.position)) : '0');
	const [control2Value, setControl2Value] = useState(() => String(segment?.kind === 'bezier' ? segment.control2.value : 0));
	const resetSourceRef = useRef({ curve, model });
	resetSourceRef.current = { curve, model };
	const curveResetKey = JSON.stringify([
		stableKey, curve, model.keyframes?.timeDomain,
		model.sequenceStartFrame, model.sequenceFrameCount,
	]);
	useEffect(() => {
		const { curve: resetCurve, model: resetModel } = resetSourceRef.current;
		setAnchorIndex(0); setSegmentIndex(0);
		const nextAnchor = resetCurve?.curve.anchors[0];
		const nextVisible = nextAnchor
			? visiblePositionForVideoKeyframeAnchor(resetModel, nextAnchor.position) : null;
		setPositionText(nextVisible ? rationalText(nextVisible) : ''); setValueText(String(nextAnchor?.value ?? ''));
		const nextSegment = resetCurve?.curve.segments[0];
		setSegmentKind(nextSegment?.kind ?? 'linear');
		if (nextSegment?.kind === 'bezier') {
			const first = visiblePositionForVideoKeyframeAnchor(resetModel, nextSegment.control1.position);
			const second = visiblePositionForVideoKeyframeAnchor(resetModel, nextSegment.control2.position);
			setControl1Position(first ? rationalText(first) : ''); setControl1Value(String(nextSegment.control1.value));
			setControl2Position(second ? rationalText(second) : ''); setControl2Value(String(nextSegment.control2.value));
		}
	}, [curveResetKey]);

	const selectAnchor = (index: number): void => {
		setAnchorIndex(index);
		const next = curve?.curve.anchors[index];
		const visible = next ? visiblePositionForVideoKeyframeAnchor(model, next.position) : null;
		setPositionText(visible ? rationalText(visible) : '');
		setValueText(next ? String(next.value) : '');
	};
	const selectSegment = (index: number): void => {
		setSegmentIndex(index);
		const next = curve?.curve.segments[index];
		if (!next) return;
		setSegmentKind(next.kind);
		if (next.kind === 'bezier') {
			const first = visiblePositionForVideoKeyframeAnchor(model, next.control1.position);
			const second = visiblePositionForVideoKeyframeAnchor(model, next.control2.position);
			setControl1Position(first ? rationalText(first) : ''); setControl1Value(String(next.control1.value));
			setControl2Position(second ? rationalText(second) : ''); setControl2Value(String(next.control2.value));
		}
	};
	const selectCurve = (key: string): void => {
		setCurveKey(key); setAnchorIndex(0); setSegmentIndex(0);
		const next = curves.find(({ target }) => videoKeyframeTargetKey(target) === key);
		const nextAnchor = next?.curve.anchors[0];
		const nextVisible = nextAnchor ? visiblePositionForVideoKeyframeAnchor(model, nextAnchor.position) : null;
		setPositionText(nextVisible ? rationalText(nextVisible) : '');
		setValueText(String(nextAnchor?.value ?? ''));
		const nextSegment = next?.curve.segments[0];
		setSegmentKind(nextSegment?.kind ?? 'linear');
		if (nextSegment?.kind === 'bezier') {
			const first = visiblePositionForVideoKeyframeAnchor(model, nextSegment.control1.position);
			const second = visiblePositionForVideoKeyframeAnchor(model, nextSegment.control2.position);
			setControl1Position(first ? rationalText(first) : ''); setControl1Value(String(nextSegment.control1.value));
			setControl2Position(second ? rationalText(second) : ''); setControl2Value(String(nextSegment.control2.value));
		}
	};
	const updateAnchor = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!curve) return;
		try {
			commit(updateVideoKeyframeAnchor(model, {
				target: curve.target,
				anchorIndex,
				position: parseRational(positionText),
				value: parseNumber(valueText),
			}));
		} catch { reportInvalid(); }
	};
	const updateSegment = (): void => {
		if (!curve) return;
		try {
			commit(setVideoKeyframeSegment(model, {
				target: curve.target,
				segmentIndex,
				segment: segmentKind === 'bezier' ? {
					kind: segmentKind,
					control1: { position: parseRational(control1Position), value: parseNumber(control1Value) },
					control2: { position: parseRational(control2Position), value: parseNumber(control2Value) },
				} : { kind: segmentKind },
			}));
		} catch { reportInvalid(); }
	};

	if (!model.keyframes) return null;
	return <fieldset disabled={disabled || !curve}>
		<legend>{label(copy, 'videoKeyframesEditCurve', 'Edit curve')}</legend>
		{curves.length === 0
			? <p>{label(copy, 'videoKeyframesNoCurves', 'Add a curve to begin editing.')}</p>
			: <>
				<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesCurve', 'Curve')}</span>
					<select data-video-keyframe-field="curve" value={stableKey} onChange={(event) => selectCurve(event.currentTarget.value)}>{curves.map(({ target }) => {
						const key = videoKeyframeTargetKey(target);
						const targetChoice = choices.find((candidate) => candidate.key === key);
						return <option key={key} value={key}>{targetChoice ? label(copy, targetChoice.labelKey, targetChoice.fallbackLabel) : key}</option>;
					})}</select>
				</label>
				<form onSubmit={updateAnchor}>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesAnchor', 'Anchor')}</span>
						<select data-video-keyframe-field="anchor" value={anchorIndex} onChange={(event) => selectAnchor(Number(event.currentTarget.value))}>
							{curve?.curve.anchors.map((item, index) => <option key={rationalText(item.position)} value={index}>{String(index + 1)}</option>)}
						</select>
					</label>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesPosition', 'Position (frames or num/den)')}</span>
						<input type="text" data-video-keyframe-field="anchor-position" value={positionText} disabled={!visibleAnchor} onChange={(event) => setPositionText(event.currentTarget.value)} />
					</label>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesValue', 'Value')}</span>
						<input type="number" data-video-keyframe-field="anchor-value" min={choice?.minimum} max={choice?.maximum} step={choice?.step ?? 'any'} value={valueText} onChange={(event) => setValueText(event.currentTarget.value)} />
					</label>
					<button type="submit" disabled={!visibleAnchor}>{label(copy, 'videoKeyframesUpdateAnchor', 'Update anchor')}</button>
					<button type="button" onClick={() => {
						if (!curve) return;
						try {
							const shape = segmentKind === 'bezier' ? { kind: 'linear' as const } : { kind: segmentKind };
							commit(addVideoKeyframeAnchor(model, {
								target: curve.target, position: parseRational(positionText), value: parseNumber(valueText),
								incomingSegment: shape, outgoingSegment: shape,
							}));
						} catch { reportInvalid(); }
					}}>{label(copy, 'videoKeyframesInsertAnchor', 'Insert anchor')}</button>
					<button type="button" disabled={(curve?.curve.anchors.length ?? 0) <= 2} onClick={() => {
						if (!curve) return;
						try { commit(removeVideoKeyframeAnchor(model, { target: curve.target, anchorIndex, bridgeSegment: { kind: 'linear' } })); } catch { reportInvalid(); }
					}}>{label(copy, 'videoKeyframesRemoveAnchor', 'Remove anchor')}</button>
				</form>
				<div>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesSegment', 'Segment')}</span>
						<select data-video-keyframe-field="segment" value={segmentIndex} onChange={(event) => selectSegment(Number(event.currentTarget.value))}>
							{curve?.curve.segments.map((_item, index) => <option key={index} value={index}>{String(index + 1)}</option>)}
						</select>
					</label>
					<label className="audio-editor-field"><span>{label(copy, 'videoKeyframesInterpolation', 'Interpolation')}</span>
						<select data-video-keyframe-field="segment-kind" value={segmentKind || segment?.kind} onChange={(event) => setSegmentKind(event.currentTarget.value as typeof segmentKind)}>
							{(['hold', 'linear', 'eased', 'bezier'] as const).map((kind) => <option key={kind} value={kind}>{label(copy, `videoKeyframes${titleCase(kind)}`, titleCase(kind))}</option>)}
						</select>
					</label>
					{segmentKind === 'bezier' && <div className="audio-editor-field-grid">
						<ControlField hook="control-1-position" label={label(copy, 'videoKeyframesControl1Position', 'Control 1 position')} value={control1Position} onChange={setControl1Position} />
						<ControlField hook="control-1-value" label={label(copy, 'videoKeyframesControl1Value', 'Control 1 value')} value={control1Value} onChange={setControl1Value} />
						<ControlField hook="control-2-position" label={label(copy, 'videoKeyframesControl2Position', 'Control 2 position')} value={control2Position} onChange={setControl2Position} />
						<ControlField hook="control-2-value" label={label(copy, 'videoKeyframesControl2Value', 'Control 2 value')} value={control2Value} onChange={setControl2Value} />
					</div>}
					<button type="button" onClick={updateSegment}>{label(copy, 'videoKeyframesUpdateSegment', 'Update segment')}</button>
				</div>
				<button type="button" onClick={() => curve && commit(removeVideoKeyframeCurve(model, curve.target))}>{label(copy, 'videoKeyframesRemoveCurve', 'Remove curve')}</button>
			</>}
	</fieldset>;
}

function ControlField({ hook, label: fieldLabel, value, onChange }: Readonly<{
	hook: string; label: string; value: string; onChange(value: string): void;
}>) {
	return <label className="audio-editor-field"><span>{fieldLabel}</span><input type="text" data-video-keyframe-field={hook} value={value} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}

function parseRational(value: string): number | Rational {
	const parts = value.trim().split('/');
	if (parts.length === 1) return parseNumber(parts[0] ?? '');
	if (parts.length !== 2) throw new TypeError('An exact rational uses num/den.');
	const num = Number(parts[0]); const den = Number(parts[1]);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den === 0) throw new TypeError('An exact rational uses safe integer num/den.');
	return { num, den };
}

function parseNumber(value: string): number {
	if (!value.trim()) throw new TypeError('A finite number is required.');
	const number = Number(value);
	if (!Number.isFinite(number) || Object.is(number, -0)) throw new TypeError('A finite number without negative zero is required.');
	return number;
}

function rationalText(value: Rational): string { return value.den === 1 ? String(value.num) : `${String(value.num)}/${String(value.den)}`; }
function optionalRationalText(value: Rational | null): string { return value ? rationalText(value) : ''; }
function titleCase(value: string): string { return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`; }
function label(copy: Readonly<Record<string, string>>, key: string, fallback: string): string { return copy[key] || fallback; }
