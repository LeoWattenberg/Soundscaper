/* SPDX-License-Identifier: AGPL-3.0-only */
/** A test scene whose independent switches must each change its reference pixels. */
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import type { MotionscaperProject } from '../src/common/editor/motion-project-types.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { renderMotionTemporalSamples } from '../src/common/editor/motion-temporal-rendering.ts';
import { planMotionTemporalSamples } from '../src/common/editor/motion-temporal-sampling.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';

export function createMotionNativeScene(omit?: 'camera' | 'light' | 'shadow' | 'shutter' | 'lens'): MotionscaperProject {
	const base = createMotionscaperProject({ id: 'native-scene', title: 'Native Scene', compositionId: 'main', width: 64, height: 48, durationFrames: 4, frameRate: { num: 30000, den: 1001 } });
	const caster = createMotionLayer({ id: 'caster', name: 'Moving translucent caster', durationFrames: 4, content: { kind: 'solid', color: motionColor([.7, .12, .04, .65]), size: motionVector([10, 22]) } });
	const receiver = createMotionLayer({ id: 'receiver', name: 'Lit receiver', durationFrames: 4, content: { kind: 'solid', color: motionColor([.8, .8, .8, 1]), size: motionVector([60, 38]) } });
	const light = createMotionLayer({ id: 'light', name: 'Shadow point light', durationFrames: 4, content: { kind: 'light', lightType: 'point', color: motionColor([1, .9, .8, 1]), intensity: motionScalar(1), coneAngle: motionScalar(90), coneFeather: motionScalar(0), castsShadows: omit !== 'shadow' } });
	const camera = createMotionLayer({ id: 'camera', name: 'Thin lens camera', durationFrames: 4, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(64), near: 1, far: 1000, focusDistance: motionScalar(72), aperture: motionScalar(omit === 'lens' ? 0 : 16) } });
	return normalizeMotionscaperProject({ ...base, compositions: [{ ...base.compositions[0], depthOfFieldSamples: 16,
		...(omit === 'shutter' ? {} : { temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 } }),
		layers: [
			{ ...caster, is3D: true, material: { ...caster.material, castsShadows: true, acceptsLights: false }, transform: { ...caster.transform, position: { ...motionVector([12, 12, 0]), expression: { source: '[12 + frame * 6, 12, 0]', enabled: true, references: [] } } } },
			{ ...receiver, is3D: true, transform: { ...receiver.transform, position: motionVector([2, 5, 32]) } },
			...(omit === 'light' ? [] : [{ ...light, transform: { ...light.transform, position: motionVector([0, 16, -32]) } }]),
			...(omit === 'camera' ? [] : [{ ...camera, transform: { ...camera.transform, position: motionVector([32, 24, -64]) } }]),
		],
	}] });
}
export async function renderMotionNativeSceneReference(project: MotionscaperProject, frame: number) {
	const kit = await CanvasKitInit();
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('The native reference scene owns no external assets.'); } });
	const composition = project.compositions[0]!;
	return renderMotionTemporalSamples({ evaluator: compileMotionscaperProject(project), plan: planMotionTemporalSamples(composition, { num: frame * composition.frameRate.den, den: composition.frameRate.num }), render: (evaluated, options) => renderMotionCompositionFrame(evaluated, { rasterizer, ...options }) });
}
