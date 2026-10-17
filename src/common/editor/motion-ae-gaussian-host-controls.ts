/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAeGaussianControls, normalizeMotionAeGaussianProfile, motionAeGaussianControl, type MotionAeGaussianControl, type MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
export interface MotionAeGaussianHostControl {
	readonly matchName: string; readonly numProperties: number; readonly numKeys: number; readonly isSpatial: boolean;
	readonly expressionEnabled: boolean; readonly hasMin: boolean; readonly hasMax: boolean; readonly minValue: number; readonly maxValue: number;
	readonly canSetEnabled: boolean; enabled: boolean;
	property(index: number): MotionAeGaussianHostControl | null; valueAtTime(time: number, beforeExpression: boolean): unknown;
	keyTime(index: number): number; keyInInterpolationType(index: number): unknown; keyOutInterpolationType(index: number): unknown;
	setValue(value: number): void; setValueAtTime(time: number, value: number): void; keyValue(index: number): unknown;
	setInterpolationTypeAtKey(index: number, incoming: unknown, outgoing: unknown): void;
}
type Kind = (property: MotionAeGaussianHostControl) => 'group' | 'scalar' | 'unsupported';
function equalPath(path: readonly string[], other: readonly string[]): boolean {
	if (path.length !== other.length) return false; for (let index = 0; index < path.length; index++) if (path[index] !== other[index]) return false; return true;
}
function capture(root: MotionAeGaussianHostControl, kind: Kind, ignored?: readonly string[]): MotionAeGaussianControl {
	let count = 0;
	function read(property: MotionAeGaussianHostControl, path: readonly string[]): MotionAeGaussianControl {
		if (++count > 64 || path.length > 4) throw new Error('Gaussian host control budget exceeded.');
		const type = kind(property), matchName = property.matchName;
		if (type === 'group') {
			const size = property.numProperties; if (typeof size !== 'number' || size < 0 || size > 32 || size !== Math.floor(size)) throw new Error('Gaussian host control inventory exceeds its budget.');
			const children: MotionAeGaussianControl[] = [];
			for (let index = 1; index <= size; index++) { const child = property.property(index); if (!child) throw new Error('Gaussian host control inventory is unavailable.'); const childPath = path.slice(); childPath.push(child.matchName); children.push(read(child, childPath)); }
			return { kind: 'group', matchName, children };
		}
		if (type !== 'scalar' || property.isSpatial) throw new Error('Gaussian host has an unsupported control kind.');
		if (property.expressionEnabled) throw new Error('Gaussian host control contains an enabled expression.');
		const skip = ignored !== undefined && equalPath(path, ignored);
		if (!skip && property.numKeys !== 0) throw new Error('Gaussian neutral control contains authored keys.');
		const value: unknown = skip ? 0 : property.valueAtTime(0, true);
		if (typeof value !== 'number') throw new Error('Gaussian host scalar control is unavailable.');
		return { kind: 'scalar', matchName, value, minimum: property.hasMin ? property.minValue : null, maximum: property.hasMax ? property.maxValue : null };
	}
	return normalizeMotionAeGaussianControls(read(root, []));
}
/** Read-only fresh-sample capture. No expression evaluation or source control writes. */
export function captureMotionAeGaussianControls(root: MotionAeGaussianHostControl, kind: Kind): MotionAeGaussianControl { return capture(root, kind); }
function compare(actual: MotionAeGaussianControl, expected: MotionAeGaussianControl, values: boolean): void {
	if (actual.kind !== expected.kind || actual.matchName !== expected.matchName) throw new Error('Gaussian host control closure changed.');
	if (actual.kind === 'group' && expected.kind === 'group') {
		if (actual.children.length !== expected.children.length) throw new Error('Gaussian host control inventory changed.');
		for (let index = 0; index < actual.children.length; index++) compare(actual.children[index]!, expected.children[index]!, values);
	} else if (actual.kind === 'scalar' && expected.kind === 'scalar') {
		if (actual.minimum !== expected.minimum || actual.maximum !== expected.maximum) throw new Error('Gaussian host control bounds changed.');
		if (values && actual.value !== expected.value) throw new Error('Gaussian host changed a neutral control value.');
	}
}
/** Caller owns the new effect/layer transaction and must roll it back on any failed readback. */
export function applyMotionAeGaussianHostEffect(target: MotionAeGaussianHostControl, inputProfile: MotionAeGaussianProfile, blur: MotionAeImportNumeric, enabled: boolean,
	host: Readonly<{ kind: Kind; hold: unknown; linear: unknown }>): void {
	const profile = normalizeMotionAeGaussianProfile(inputProfile), selected = motionAeGaussianControl(profile.controls, profile.blurrinessPath), maximum = Math.min(selected.maximum!, 20 * profile.blurrinessPerSigma);
	if (blur.matchName !== selected.matchName || blur.expression !== null || blur.spatial || blur.keys.length > 4096) throw new Error('Gaussian scalar expression, dimensions or key budget is unsupported.');
	function check(value: readonly number[]): void { if (value.length !== 1 || typeof value[0] !== 'number' || !isFinite(value[0]) || value[0] < 0 || value[0] > maximum) throw new Error('Gaussian scalar value exceeds admitted bounds.'); }
	check(blur.value);
	for (let index = 0; index < blur.keys.length; index++) {
		const key = blur.keys[index]!; check(key.value);
		if (!isFinite(key.time) || Math.abs(key.time) > 1e6 || index > 0 && key.time <= blur.keys[index - 1]!.time || key.roving || key.inSpatialTangent !== null || key.outSpatialTangent !== null
			|| key.inInterpolation !== 'hold' && key.inInterpolation !== 'linear' || key.outInterpolation !== 'hold' && key.outInterpolation !== 'linear') throw new Error('Gaussian key time or interpolation is unsupported.');
	}
	if (typeof enabled !== 'boolean' || target.canSetEnabled !== true) throw new Error('Gaussian effect enable switch is unavailable.');
	compare(capture(target, host.kind), profile.controls, false);
	let blurTarget: MotionAeGaussianHostControl | null = null;
	function apply(property: MotionAeGaussianHostControl, control: MotionAeGaussianControl, path: readonly string[]): void {
		if (control.kind === 'group') {
			for (let index = 0; index < control.children.length; index++) { const child = property.property(index + 1); if (!child) throw new Error('Gaussian host control disappeared.'); const next = path.slice(); next.push(child.matchName); apply(child, control.children[index]!, next); }
		} else if (equalPath(path, profile.blurrinessPath)) blurTarget = property;
		else if (property.valueAtTime(0, true) !== control.value) property.setValue(control.value);
	}
	apply(target, profile.controls, []);
	// Assignment happens in the bounded visitor; expose it without relying on control-flow inference across callbacks.
	const destination = blurTarget as MotionAeGaussianHostControl | null; if (!destination) throw new Error('Gaussian selected blur control is unavailable.');
	if (!blur.keys.length) destination.setValue(blur.value[0]!);
	else {
		for (let index = 0; index < blur.keys.length; index++) destination.setValueAtTime(blur.keys[index]!.time, blur.keys[index]!.value[0]!);
		for (let index = 0; index < blur.keys.length; index++) { const key = blur.keys[index]!; destination.setInterpolationTypeAtKey(index + 1, key.inInterpolation === 'hold' ? host.hold : host.linear, key.outInterpolation === 'hold' ? host.hold : host.linear); }
	}
	target.enabled = enabled; if (target.enabled !== enabled || destination.numKeys !== blur.keys.length) throw new Error('Gaussian host changed enable or key state.');
	function verify(actual: unknown, expected: number): void { if (typeof actual !== 'number' || !isFinite(actual) || Math.abs(actual - expected) > Math.max(1, Math.abs(expected)) * 1e-7) throw new Error('Gaussian host clamped or changed an applied scalar value.'); }
	if (!blur.keys.length) verify(destination.valueAtTime(0, true), blur.value[0]!);
	else for (let index = 0; index < blur.keys.length; index++) {
		const key = blur.keys[index]!, position = index + 1; verify(destination.keyValue(position), key.value[0]!); verify(destination.keyTime(position), key.time);
		if (destination.keyInInterpolationType(position) !== (key.inInterpolation === 'hold' ? host.hold : host.linear) || destination.keyOutInterpolationType(position) !== (key.outInterpolation === 'hold' ? host.hold : host.linear)) throw new Error('Gaussian host changed applied interpolation.');
	}
	compare(capture(target, host.kind, profile.blurrinessPath), profile.controls, true);
}
