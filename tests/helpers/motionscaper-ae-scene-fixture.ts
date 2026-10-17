/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
export function motionAeSceneProjectFixture() {
	const project = createMotionscaperProject({ id: 'scene-project', compositionId: 'scene-comp', title: 'Camera and ambient', width: 64, height: 48, frameRate: { num: 24, den: 1 }, durationFrames: 24 });
	const camera = createMotionLayer({ id: 'camera', name: 'One-node camera', durationFrames: 24, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(100), near: 0.1, far: 1e7, focusDistance: motionScalar(100), aperture: motionScalar(0) } });
	const ambient = createMotionLayer({ id: 'ambient', name: 'Ambient light', durationFrames: 24, content: { kind: 'light', lightType: 'ambient', color: motionColor([0.3, 0.5, 1, 1]), intensity: motionScalar(0.75), coneAngle: motionScalar(90), coneFeather: motionScalar(0), castsShadows: false } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...camera, is3D: true, transform: { ...camera.transform, position: motionVector([32, 24, -100]) } }, { ...ambient, is3D: true }] }] };
}
