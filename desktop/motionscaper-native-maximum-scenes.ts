/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';

export type MotionMaximumScene = 'quality' | 'planes' | 'lights';
export type MotionMaximumSceneInput = MotionMaximumScene | 'planes-over' | 'lights-over' | 'combined-over';

/** Closed independent admissions, not a promise that the cross product of individual maxima is renderable. */
export function createMotionMaximumScene(kind: MotionMaximumSceneInput) {
	if (!['quality', 'planes', 'lights', 'planes-over', 'lights-over', 'combined-over'].includes(kind)) throw new RangeError('Unknown native maximum scene.');
	const planes = kind === 'planes' || kind === 'planes-over', quality = kind === 'quality';
	const size = planes ? 1024 : quality ? 64 : kind === 'combined-over' ? 1 : 32;
	const durationFrames = quality ? 4 : 1;
	const base = createMotionscaperProject({ id: `native-maximum-${kind}-v1`, title: `Native maximum ${kind}`, compositionId: 'main', width: size, height: size, durationFrames });
	const solid = (id: string, color: readonly [number, number, number, number], dimensions: readonly [number, number], position: readonly [number, number, number]): MotionLayer => {
		const layer = createMotionLayer({ id, name: id, durationFrames, content: { kind: 'solid', color: motionColor(color), size: motionVector(dimensions) } });
		return { ...layer, is3D: true, material: { ...layer.material, acceptsLights: false }, transform: { ...layer.transform, position: motionVector(position) } };
	};
	const camera = createMotionLayer({ id: 'camera', name: 'Explicit camera', durationFrames, content: { kind: 'camera', projection: quality ? 'perspective' : 'orthographic',
		zoom: motionScalar(size), near: 1, far: 1000, focusDistance: motionScalar(72), aperture: motionScalar(quality || kind === 'combined-over' ? 16 : 0) } });
	const view = { ...camera, transform: { ...camera.transform, position: quality
		? { ...motionVector([32, 32, -64]), expression: { source: '[32 + frame * 2, 32, -64]', enabled: true, references: [] } }
		: motionVector([size / 2, size / 2, -64]) } };
	const light = (index: number): MotionLayer => {
		const layer = createMotionLayer({ id: `light-${index}`, name: `Contributing shadow light ${index + 1}`, durationFrames,
			content: { kind: 'light', lightType: 'point', color: motionColor([1, 1, 1, 1]), intensity: motionScalar(1 / 32), coneAngle: motionScalar(90), coneFeather: motionScalar(0), castsShadows: true } });
		return { ...layer, transform: { ...layer.transform, position: motionVector([8, 16, -32]) } };
	};
	let layers: readonly MotionLayer[];
	if (quality) {
		const near = solid('near', [.7, .1, .05, .5], [10, 24], [12, 20, 0]);
		const far = solid('far', [.1, .3, .6, 1], [40, 32], [6, 12, 32]);
		const source = light(0); assertPoint(source);
		layers = [{ ...near, material: { ...near.material, castsShadows: true }, transform: { ...near.transform, position: { ...motionVector([12, 20, 0]), expression: { source: '[12 + frame * 6, 20, 0]', enabled: true, references: [] } } } },
			{ ...far, material: { ...far.material, acceptsLights: true, castsShadows: true, receivesShadows: true, ambient: motionScalar(0), diffuse: motionScalar(1), specular: motionScalar(0) } },
			{ ...source, color: motionColor([1, .9, .8, 1]), intensity: motionScalar(1), transform: { ...source.transform, position: motionVector([0, 32, -32]) } }, view];
	} else if (planes || kind === 'combined-over') {
		const count = kind === 'planes-over' ? 65 : 64;
		const subjects = Array.from({ length: count }, (_, authored) => {
			// A non-depth authored permutation makes omitting depth sorting visibly wrong.
			const index = authored < 64 ? authored * 17 % 64 : 64;
			const layer = solid(`plane-${index}`, [(index % 7 + 1) / 8, (index % 5 + 1) / 6, (index % 3 + 1) / 4, 1 / 64], [6, 6], [128, 128, index]);
			return { ...layer, material: { ...layer.material, castsShadows: kind === 'combined-over' }, transform: { ...layer.transform, scale: motionVector([128, 128, 1]) } };
		});
		const marker = solid('opaque', [.25, .5, .125, 1], [8, 8], [0, 0, 0]);
		layers = kind === 'combined-over' ? [...subjects, ...Array.from({ length: 32 }, (_, index) => light(index)), view]
			: [{ ...marker, is3D: false }, ...subjects, view];
	} else {
		const caster = solid('caster', [.8, .1, .2, .5], [8, 8], [12, 12, 0]);
		const receiver = solid('receiver', [.5, .25, .125, 1], [24, 24], [4, 4, 16]);
		layers = [{ ...caster, material: { ...caster.material, castsShadows: true } },
			{ ...receiver, material: { ...receiver.material, acceptsLights: true, receivesShadows: true, ambient: motionScalar(0), diffuse: motionScalar(1), specular: motionScalar(0) } },
			...Array.from({ length: kind === 'lights-over' ? 33 : 32 }, (_, index) => light(index)), view];
	}
	return normalizeMotionscaperProject({ ...base, compositions: [{ ...base.compositions[0]!, layers,
		depthOfFieldSamples: quality || kind === 'combined-over' ? 64 : 1,
		...(quality || kind === 'combined-over' ? { temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 64 } } : {}),
	}] });
}

function assertPoint(layer: MotionLayer): asserts layer is Extract<MotionLayer, { kind: 'light' }> {
	if (layer.kind !== 'light') throw new Error('The closed quality fixture requires a point light.');
}
