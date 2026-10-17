/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit, Path } from 'canvaskit-wasm';
import type { MotionPath } from './motion-property.ts';

export function motionCanvasKitPath(kit: CanvasKit, value: MotionPath): Path {
	const path = new kit.PathBuilder(); const first = value.vertices[0]!;
	path.moveTo(...first.point);
	for (let i = 1; i < value.vertices.length + (value.closed ? 1 : 0); i++) {
		const prior = value.vertices[i - 1]!; const next = value.vertices[i % value.vertices.length]!;
		path.cubicTo(prior.point[0] + prior.outTangent[0], prior.point[1] + prior.outTangent[1], next.point[0] + next.inTangent[0], next.point[1] + next.inTangent[1], ...next.point);
	}
	if (value.closed) path.close(); return path.detachAndDelete();
}
