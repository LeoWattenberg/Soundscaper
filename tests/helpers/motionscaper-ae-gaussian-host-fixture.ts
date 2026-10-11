/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeGaussianHostControl } from '../../src/common/editor/motion-ae-gaussian-host-controls.ts';
import type { MotionAeGaussianControl } from '../../src/common/editor/motion-ae-gaussian-profile.ts';
import { motionAeGaussianProfileFixture } from './motionscaper-ae-gaussian-fixture.ts';
export function motionAeGaussianHostFixture(clamp = false) {
	const writes: string[] = [];
	class Control implements MotionAeGaussianHostControl {
		name = ''; canSetEnabled = true; enabled = true; expressionEnabled = false; isSpatial = false; keys = new Map<number, number>(); children: Control[] = []; value: number;
		readonly modes = new Map<number, readonly [unknown, unknown]>();
		readonly kind: 'group' | 'scalar'; readonly matchName: string; readonly minimum: number | null; readonly maximum: number | null;
		constructor(source: MotionAeGaussianControl) { this.kind = source.kind; this.matchName = source.matchName; this.value = source.kind === 'scalar' ? source.value : 0; this.minimum = source.kind === 'scalar' ? source.minimum : null; this.maximum = source.kind === 'scalar' ? source.maximum : null; if (source.kind === 'group') this.children = source.children.map(child => new Control(child)); }
		get propertyType() { return this.kind; } get propertyValueType() { return this.kind; }
		get numProperties() { return this.children.length; } get numKeys() { return this.keys.size; } get hasMin() { return this.minimum !== null; } get hasMax() { return this.maximum !== null; }
		get minValue() { return this.minimum!; } get maxValue() { return this.maximum!; }
		property(index: number) { return this.children[index - 1] ?? null; } valueAtTime() { return this.value; }
		setValue(value: number) { writes.push(this.matchName); this.value = clamp && this.matchName === 'reviewed-radius' ? 1 : value; }
		setValueAtTime(time: number, value: number) { writes.push(this.matchName); this.keys.set(time, clamp ? 1 : value); }
		keyValue(index: number) { return Array.from(this.keys.values())[index - 1]; }
		keyTime(index: number) { return Array.from(this.keys.keys())[index - 1]!; }
		keyInInterpolationType(index: number) { return this.modes.get(index)?.[0]; } keyOutInterpolationType(index: number) { return this.modes.get(index)?.[1]; }
		setInterpolationTypeAtKey(index: number, incoming: unknown, outgoing: unknown) { this.modes.set(index, [incoming, outgoing]); }
	}
	const root = new Control(motionAeGaussianProfileFixture().controls); return { root, writes, Control };
}
export const motionAeGaussianHostKind = (property: MotionAeGaussianHostControl) => Reflect.get(property, 'kind') as 'group' | 'scalar';
