/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionVector, motionScalar } from '../src/common/editor/motion-property.ts';
import { motionTransformMatrix, MOTION_IDENTITY_MATRIX, type MotionMatrix4 } from '../src/common/editor/motion-transform.ts';
import { createMotionCamera, motionCameraRay, projectMotionCameraPoint, intersectMotionPlane } from '../src/common/editor/motion-camera.ts';
import { inverseMotionAffineMatrix, transformMotionPoint } from '../src/common/editor/motion-transform-inverse.ts';

const project = createMotionscaperProject({ id: 'camera', title: 'Camera', compositionId: 'main', width: 64, height: 32 });
const camera = (projection: 'perspective' | 'orthographic' = 'perspective') => {
	const layer = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300,
		content: { kind: 'camera', projection, zoom: motionScalar(100), near: 1, far: 1000, focusDistance: motionScalar(100), aperture: motionScalar(0) } });
	if (layer.kind !== 'camera') throw new Error('Unexpected camera fixture.'); return layer;
};
const evaluate = (layers: readonly ReturnType<typeof createMotionLayer>[] = []) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time: 0 });
const near = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]!) < 1e-8, `${a} differs from ${b}`));

test('the implicit camera preserves the z=0 composition grid and projects positive depth farther away', () => {
	const view = createMotionCamera(evaluate());
	near(projectMotionCameraPoint(view, [0, 0, 0])!.point, [0, 0]);
	near(projectMotionCameraPoint(view, [64, 32, 0])!.point, [64, 32]);
	near(projectMotionCameraPoint(view, [0, 0, 64])!.point, [16, 8]);
	const hit = intersectMotionPlane(motionCameraRay(view, [10.5, 6.5]), MOTION_IDENTITY_MATRIX)!;
	near(hit.local, [10.5, 6.5, 0]); assert.equal(hit.depth, 64);
});

test('explicit camera parenting orientation and clipping use an invertible world-space camera', () => {
	const source = camera(); const parent = createMotionLayer({ id: 'rig', name: 'Rig', durationFrames: 300, content: { kind: 'null' } });
	const view = createMotionCamera(evaluate([{ ...source, parentId: 'rig' }, { ...parent, transform: { ...parent.transform, position: motionVector([32, 16, -100]), rotation: motionVector([0, 90, 0]) } }]));
	near(projectMotionCameraPoint(view, [132, 16, -110])!.point, [42, 16]);
	assert.equal(projectMotionCameraPoint(view, [32.5, 16, -100]), null); assert.equal(projectMotionCameraPoint(view, [1033, 16, -100]), null);
	const ray = motionCameraRay(view, [42, 16]); near(ray.origin, [32, 16, -100]); near(ray.direction, [1, 0, -0.1]);
});

test('orthographic zoom is viewport-relative and thin-lens samples converge at the focus plane', () => {
	const source = camera('orthographic'); const placed = { ...source, transform: { ...source.transform, position: motionVector([32, 16, -100]) } };
	const view = createMotionCamera(evaluate([placed]));
	near(projectMotionCameraPoint(view, [40, 16, 0])!.point, [44.5, 16]); near(projectMotionCameraPoint(view, [40, 16, 200])!.point, [44.5, 16]);
	for (const projection of ['perspective', 'orthographic'] as const) {
		const own = createMotionCamera(evaluate([{ ...camera(projection), transform: placed.transform }]));
		const focus = projectMotionCameraPoint(own, [40, 16, 0], [2, -1])!;
		near(focus.point, projectMotionCameraPoint(own, [40, 16, 0])!.point);
		const hit = intersectMotionPlane(motionCameraRay(own, focus.point, [2, -1]), MOTION_IDENTITY_MATRIX)!; near(hit.local, [40, 16, 0]);
		assert.notDeepEqual(projectMotionCameraPoint(own, [40, 16, 100], [2, -1])!.point, projectMotionCameraPoint(own, [40, 16, 100])!.point);
	}
});

test('affine inversion and ray-plane intersection retain mirrored nonuniform scales, anchors and edge-on planes', () => {
	const matrix: MotionMatrix4 = [2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 4, 0, 12, 7, -8, 1];
	near(transformMotionPoint(inverseMotionAffineMatrix(matrix), transformMotionPoint(matrix, [4, 5, 6])), [4, 5, 6]);
	const transform = { anchor: [4, 3, 0] as const, position: [10, 20, 0] as const, rotation: [0, 30, 0] as const, scale: [2, 3, 1] as const, opacity: 1 };
	const plane = motionTransformMatrix(transform); const point = transformMotionPoint(plane, [4, 3, 0]);
	const hit = intersectMotionPlane({ origin: [point[0], point[1], -100], direction: [0, 0, 1] }, inverseMotionAffineMatrix(plane))!;
	near(hit.local, [4, 3, 0]); near(hit.world, point);
	assert.equal(intersectMotionPlane({ origin: [0, 0, -100], direction: [1, 0, 0] }, MOTION_IDENTITY_MATRIX), null);
	assert.throws(() => inverseMotionAffineMatrix([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), /singular/u);
});

test('active camera selection is authored-order stable and invalid animated optics fail explicitly', () => {
	const first = camera(); const second = { ...camera(), id: 'second', zoom: motionScalar(50) };
	assert.equal(createMotionCamera(evaluate([first, second])).zoom, 100); assert.equal(createMotionCamera(evaluate([second, first])).zoom, 50);
	assert.equal(createMotionCamera(evaluate([{ ...first, enabled: false }, second])).zoom, 50);
	assert.throws(() => createMotionCamera(evaluate([{ ...first, zoom: motionScalar(0) }])), /zoom/u);
	assert.throws(() => createMotionCamera(evaluate([{ ...first, focusDistance: motionScalar(-1) }])), /focus/u);
	assert.throws(() => createMotionCamera(evaluate([{ ...first, aperture: motionScalar(-1) }])), /aperture/u);
});
