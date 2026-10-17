/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { approximateBoundedFraction, publicFraction } from './interpolation-curve-math.ts';
import { motionDigest, motionId, motionNumber } from './motion-values.ts';
import type { Rational } from './timeline-time.ts';
import type { MotionAudioAsset } from './motion-audio-contract.ts';
import { MotionExpressionError } from './motion-expression-ast.ts';

export const MOTION_AMPLITUDE_SETTINGS = Object.freeze({ version: 1, method: 'rms', window: 'centered', reconstruction: 'native-sample-hold', channels: 'mean-square', outsideSource: 'silence' } as const);
const SETTINGS_DIGEST = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(MOTION_AMPLITUDE_SETTINGS))));
export interface MotionAmplitudeRequest { readonly assetId: string; readonly time: number; readonly windowSeconds: number }
export interface MotionAmplitudeWindow { readonly assetId: string; readonly assetDigest: string; readonly time: Rational; readonly windowSeconds: Rational; readonly key: string }
export interface MotionPreparedExpressionAudio { readonly revisionDigest: string; readonly settingsDigest: string }
const READERS = new WeakMap<MotionPreparedExpressionAudio, ReadonlyMap<string, number>>();

/** Ephemeral missing-window signal is consumed only by the bounded asynchronous preparation controller. */
export class MotionExpressionAudioNeeded extends Error {
	readonly window: MotionAmplitudeWindow;
	constructor(window: MotionAmplitudeWindow) { super(`Prepare the requested audio amplitude window for asset ${window.assetId} before evaluating this expression.`); this.name = 'MotionExpressionAudioNeeded'; this.window = window; }
}
export function motionAmplitudeWindow(asset: MotionAudioAsset, request: MotionAmplitudeRequest): MotionAmplitudeWindow {
	const assetId = motionId(request.assetId); if (assetId !== asset.id) throw new ReferenceError('Amplitude asset identity does not match its retained source.');
	const time = rational(motionNumber(request.time, 'amplitude source time'));
	const seconds = motionNumber(request.windowSeconds, 'amplitude window duration', Number.MIN_VALUE, 10); const windowSeconds = rational(seconds);
	if (windowSeconds.num <= 0) throw new RangeError('Amplitude window is below the exact time resolution.');
	return Object.freeze({ assetId, assetDigest: asset.sha256, time, windowSeconds, key: `${asset.id}/${asset.sha256}/${time.num}:${time.den}/${windowSeconds.num}:${windowSeconds.den}/${SETTINGS_DIGEST}` });
}
/** A fresh snapshot prevents a replay from observing preparation performed after that replay began. */
export function createPreparedMotionExpressionAudio(revisionDigest: string, values: ReadonlyMap<string, number>): MotionPreparedExpressionAudio {
	if (values.size > 1024) throw new RangeError('Prepared amplitude snapshot exceeds its window count budget.');
	for (const [key, value] of values) { if (key.length > 1024 || !Number.isFinite(value) || value < 0) throw new RangeError('Prepared amplitude snapshot contains invalid energy.'); }
	const reader = Object.freeze({ revisionDigest: motionDigest(revisionDigest), settingsDigest: SETTINGS_DIGEST }); READERS.set(reader, new Map(values)); return reader;
}
export function readPreparedMotionExpressionAudio(reader: MotionPreparedExpressionAudio, revisionDigest: string | undefined, asset: MotionAudioAsset, request: MotionAmplitudeRequest): number {
	const values = READERS.get(reader);
	if (!values || reader.settingsDigest !== SETTINGS_DIGEST) throw new MotionExpressionError('unavailable', 'A prepared audio amplitude capability with verified analysis settings is required.', { start: 0, end: 0 });
	if (!revisionDigest || reader.revisionDigest !== revisionDigest) throw new MotionExpressionError('unavailable', 'Prepared audio amplitude belongs to a different or unpinned project revision.', { start: 0, end: 0 });
	const window = motionAmplitudeWindow(asset, request); const value = values.get(window.key); if (value === undefined) throw new MotionExpressionAudioNeeded(window); return value;
}
function rational(value: number): Rational {
	const magnitude = approximateBoundedFraction(Math.abs(value)); if (!magnitude) throw new RangeError('Amplitude time exceeds its exact coordinate domain.');
	const fraction = publicFraction(magnitude); return value < 0 ? { num: -fraction.num, den: fraction.den } : fraction;
}
