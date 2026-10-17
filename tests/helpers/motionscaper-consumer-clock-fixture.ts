/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../../src/motionscaper/editor-project-validation.ts';
import { motionColor, motionVector } from '../../src/common/editor/motion-property.ts';
import { rational, scalar } from './motionscaper-rich-project-fixture.ts';

/** Authored oracle: the 30000/1001 root maps frame n to child second 1-n/30,
 * hence child frame 24-4n/5 at 24fps. Hold keys at child21/23 choose R/G/B.
 * One-pixel parents in each composition place the two-pixel card at root x=2. */
export const consumerClockCases = [
	{ frame: 0, time: rational(0), rootSample: rational(0), sourceTime: rational(1), childFrame: rational(24), childSample: 48000, rgb: [0, 0, 255] },
	{ frame: 1, time: rational(1001, 30000), rootSample: rational(8008, 5), sourceTime: rational(29, 30), childFrame: rational(116, 5), childSample: 46400, rgb: [0, 0, 255] },
	{ frame: 2, time: rational(1001, 15000), rootSample: rational(16016, 5), sourceTime: rational(14, 15), childFrame: rational(112, 5), childSample: 44800, rgb: [0, 255, 0] },
	{ frame: 3, time: rational(1001, 10000), rootSample: rational(24024, 5), sourceTime: rational(9, 10), childFrame: rational(108, 5), childSample: 43200, rgb: [0, 255, 0] },
	{ frame: 4, time: rational(1001, 7500), rootSample: rational(32032, 5), sourceTime: rational(13, 15), childFrame: rational(104, 5), childSample: 41600, rgb: [255, 0, 0] },
	{ frame: 5, time: rational(1001, 6000), rootSample: rational(8008), sourceTime: rational(5, 6), childFrame: rational(20), childSample: 40000, rgb: [255, 0, 0] },
] as const;

export function expectedConsumerPixels(index: number): Uint8ClampedArray {
	const color = consumerClockCases[index]!.rgb; const rgba = new Uint8ClampedArray(6 * 2 * 4);
	for (const y of [0, 1]) for (const x of [2, 3]) rgba.set([...color, 255], (y * 6 + x) * 4);
	return rgba;
}

export function consumerClockProject() {
	const project = createMotionscaperProject({ id: 'consumer-clocks', title: 'One nested clock', compositionId: 'main',
		width: 6, height: 2, durationFrames: 6, frameRate: rational(30000, 1001) });
	const parent = (id: string) => {
		const layer = createMotionLayer({ id, name: id, durationFrames: 60, content: { kind: 'null' } });
		return { ...layer, transform: { ...layer.transform, position: motionVector([1, 0, 0]) } };
	};
	const hold = (values: readonly number[]) => ({ anchors: [0, 21, 23].map((at, index) => ({ position: rational(at), value: values[index]! })),
		segments: [{ kind: 'hold' as const }, { kind: 'hold' as const }] });
	const card = createMotionLayer({ id: 'card', name: 'Hold color card', durationFrames: 60,
		content: { kind: 'solid', size: motionVector([2, 2]), color: { ...motionColor([1, 0, 0, 1]),
			curves: [hold([1, 0, 0]), hold([0, 1, 0]), hold([0, 0, 1]), null] } } });
	const nested = createMotionLayer({ id: 'nested', name: 'Reverse remapped child', durationFrames: 6,
		content: { kind: 'precomp', compositionId: 'child' } });
	return normalizeMotionscaperProject({ ...project, compositions: [
		{ ...project.compositions[0]!, layers: [{ ...nested, parentId: 'root-parent', sourceStart: rational(7), timeScale: rational(3), timeRemap: scalar(1, 0) }, parent('root-parent')] },
		{ ...project.compositions[0]!, id: 'child', name: '24fps child', width: 4, frameRate: rational(24), durationFrames: 60,
			layers: [{ ...card, parentId: 'child-parent' }, parent('child-parent')] },
	] });
}
