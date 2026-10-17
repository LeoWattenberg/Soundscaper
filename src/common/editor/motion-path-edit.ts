/* SPDX-License-Identifier: AGPL-3.0-only */

import { editMotionKeyframes } from './motion-keyframe-edit.ts';
import { compileMotionProperty } from './motion-property-evaluation.ts';
import { motionPropertyOfKind, normalizeMotionPath, type MotionPath, type MotionPathProperty, type MotionVector2 } from './motion-property.ts';
import { motionInteger } from './motion-values.ts';
import type { Rational } from './timeline-time.ts';
export type MotionPathEdit =
	| { readonly type: 'vertex'; readonly vertex: number; readonly part: 'point' | 'inTangent' | 'outTangent'; readonly value: MotionVector2; readonly position?: Rational }
	| { readonly type: 'insert'; readonly after: number }
	| { readonly type: 'remove'; readonly vertex: number }
	| { readonly type: 'closed'; readonly closed: boolean };

/** Topology changes apply to every keyed path; geometry edits change only the chosen base or evaluated key. */
export function editMotionPath(input: MotionPathProperty, edit: MotionPathEdit): MotionPathProperty {
	const property = motionPropertyOfKind(input, 'path');
	if (edit.type === 'vertex') {
		if (!['point', 'inTangent', 'outTangent'].includes(edit.part)) throw new RangeError('Unknown path vertex component.');
		const path = edit.position === undefined ? property.value : normalizeMotionPath(compileMotionProperty(property)(edit.position));
		const index = motionInteger(edit.vertex, 'path vertex', 0, path.vertices.length - 1);
		const value = normalizeMotionPath({ ...path, vertices: path.vertices.map((vertex, offset) => offset === index ? { ...vertex, [edit.part]: edit.value } : vertex) });
		return edit.position === undefined ? motionPropertyOfKind({ ...property, value }, 'path')
			: motionPropertyOfKind(editMotionKeyframes(property, { type: 'set-key', position: edit.position, value }), 'path');
	}
	const transform = (path: MotionPath): MotionPath => {
		if (edit.type === 'closed') return normalizeMotionPath({ ...path, closed: edit.closed });
		if (edit.type === 'insert') return split(path, motionInteger(edit.after, 'path segment', 0, path.vertices.length - (path.closed ? 1 : 2)));
		const index = motionInteger(edit.vertex, 'path vertex', 0, path.vertices.length - 1);
		return normalizeMotionPath({ ...path, vertices: path.vertices.filter((_, offset) => offset !== index) });
	};
	return motionPropertyOfKind({ ...property, value: transform(property.value), keyframes: property.keyframes.map((key) => ({ ...key, value: transform(key.value) })) }, 'path');
}
const sum = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] + b[0], a[1] + b[1]];
const difference = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] - b[0], a[1] - b[1]];
const middle = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] / 2 + b[0] / 2, a[1] / 2 + b[1] / 2];
function split(path: MotionPath, index: number): MotionPath {
	const next = (index + 1) % path.vertices.length, a = path.vertices[index]!, b = path.vertices[next]!;
	const first = middle(a.point, sum(a.point, a.outTangent)), second = middle(sum(a.point, a.outTangent), sum(b.point, b.inTangent)), third = middle(sum(b.point, b.inTangent), b.point);
	const left = middle(first, second), right = middle(second, third), point = middle(left, right);
	const vertices = path.vertices.map((vertex, offset) => offset === index ? { ...vertex, outTangent: difference(first, a.point) } : offset === next ? { ...vertex, inTangent: difference(third, b.point) } : vertex);
	vertices.splice(index + 1, 0, { point, inTangent: difference(left, point), outTangent: difference(right, point) });
	return normalizeMotionPath({ ...path, vertices });
}
