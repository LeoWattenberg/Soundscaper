/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { motionColor, motionPropertyOfKind, motionScalar } from '../../src/common/editor/motion-property.ts';
export function motionAeShapeProjectFixture() {
	const project = createMotionscaperProject({ id: 'shape-project', compositionId: 'shape-comp', title: 'Editable shapes', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 24 });
	const path = motionPropertyOfKind({ kind: 'path', value: { closed: true, vertices: [[8, 8], [56, 8], [32, 56]].map(point => ({ point, inTangent: [0, 0], outTangent: [0, 0] })) }, keyframes: [], segments: [], expression: null }, 'path');
	const layer = createMotionLayer({ id: 'original-layer', name: 'Editable triangle', durationFrames: 24, content: { kind: 'shapes', shapes: [{ id: 'triangle', path, fill: motionColor([0.8, 0.2, 0.1, 0.5]),
		stroke: { color: motionColor([0.1, 0.2, 0.8, 1]), width: motionScalar(4), lineCap: 'round', lineJoin: 'bevel' } }] } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [layer] }] };
}
