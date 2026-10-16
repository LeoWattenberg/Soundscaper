/* SPDX-License-Identifier: AGPL-3.0-only */
import { readPixelFrameWebGl2MaskGraphCurrentV1, writePixelFrameWebGl2MaskPathEdgesCurrentV1 } from './pixel-frame-webgl2-mask-graph-current-v1.ts';
import { scopedBrushMaskResourceV1 } from './mask-raster-source-scope-v1.ts';
import type { MaskNativeCurrentV1, MaskTextureCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import type { MaskProgramsCurrentV1 } from './pixel-frame-webgl2-mask-context-programs-current-v1.ts';
import type { PixelFrameWebGl2MaskNodeUniformsCurrentV1 } from './pixel-frame-webgl2-mask-node-current-v1.ts';

export async function executeMaskGraphCurrentV1(value: unknown, incoming: WebGLTexture, scope: unknown,
	owner: Readonly<MaskNativeCurrentV1>, programs: Readonly<MaskProgramsCurrentV1>) {
	const graph = readPixelFrameWebGl2MaskGraphCurrentV1(value), { width, height } = graph.descriptor, gl = owner.gl;
	if (!graph.eligible) owner.unavailable('mask-working-set');
	const coverage = Array.from({ length: graph.coverageTextureCount }, () => owner.texture('byte', width, height));
	const integers = Array.from({ length: graph.integerScratchTextureCount }, () => owner.texture('uint', width, height));
	const boolean = graph.booleanScratchBytes ? owner.texture('byte', width, height) : undefined;
	const dummy = owner.texture('byte', 1, 1); owner.clear(dummy);
	const path = graph.pathBankBytes ? owner.texture('float', 256, 1) : undefined, edges = path ? owner.floats(1024) : undefined;
	let brushWidth = 0, brushHeight = 0;
	for (const reference of graph.references) if (graph.retainedStorageKeys.includes(reference.storageKey)) {
		brushWidth = Math.max(brushWidth, reference.width); brushHeight = Math.max(brushHeight, reference.height);
	}
	const brush = brushWidth ? owner.texture('byte', brushWidth, brushHeight) : undefined;
	const live = new Set<number>();
	const copy: Readonly<PixelFrameWebGl2MaskNodeUniformsCurrentV1> = Object.freeze({ kind: 13, params0: [0, 0, 0, 0] as const, params1: [0, 0, 0, 0] as const,
		radius: 0, pathEdges: 0, evenOdd: false, inputName: undefined, supported: true });
	const node = (target: MaskTextureCurrentV1, uniforms: Readonly<PixelFrameWebGl2MaskNodeUniformsCurrentV1>, a = dummy.texture, b = dummy.texture,
		brushTexture = dummy.texture, bw = 1, bh = 1) => programs.node(target, uniforms, incoming, a, b, brushTexture, bw, bh);
	for (let index = 0; index < graph.steps.length; index++) {
		owner.check(); const step = graph.steps[index]!, target = coverage[step.destination]!, u = step.uniforms;
		if (step.operands.some(slot => !live.has(slot)) || live.has(step.destination)) throw new TypeError('Mask node lifetime differs from its prepared schedule.');
		if (u.kind === 14) {
			programs.feather(integers[0]!, coverage[step.operands[0]!]!.texture, u.radius, 'horizontal');
			programs.feather(target, integers[0]!.texture, u.radius, 'vertical');
		} else if (u.kind === 15) {
			let previous: MaskTextureCurrentV1 | undefined;
			for (let first = 0; first < u.pathEdges; first += 256) {
				owner.check(); const count = writePixelFrameWebGl2MaskPathEdgesCurrentV1(graph, index, first, edges!);
				gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, path!.texture);
				gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.FLOAT, edges!); edges!.fill(0); owner.check();
				const next = previous === integers[0] ? integers[1]! : integers[0]!;
				programs.path(next, path!.texture, previous?.texture, count); previous = next;
				await new Promise<void>(resolve => { setTimeout(resolve, 0); }); owner.check();
			}
			programs.resolve(target, previous!.texture, u.evenOdd);
		} else if (step.operands.length > 1) {
			let accumulator = target;
			node(target, u, coverage[step.operands[0]!]!.texture, coverage[step.operands[1]!]!.texture);
			for (let operand = 2; operand < step.operands.length; operand++) {
				const next = accumulator === target ? boolean! : target;
				node(next, u, accumulator.texture, coverage[step.operands[operand]!]!.texture); accumulator = next;
				await new Promise<void>(resolve => { setTimeout(resolve, 0); }); owner.check();
			}
			if (accumulator !== target) node(target, copy, accumulator.texture);
		} else if (step.brushStorageKey !== undefined) {
			const resource = scopedBrushMaskResourceV1(scope, step.brushStorageKey), reference = resource.reference;
			owner.clear(brush!); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, brush!.texture);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, reference.width, reference.height, gl.RED_INTEGER, gl.UNSIGNED_BYTE, resource.alpha); owner.check();
			node(target, u, dummy.texture, dummy.texture, brush!.texture, reference.width, reference.height);
		} else node(target, u, step.operands.length ? coverage[step.operands[0]!]!.texture : dummy.texture);
		// All boolean/path draws have been queued before any shared input releases.
		for (const slot of step.release) live.delete(slot); live.add(step.destination);
		await new Promise<void>(resolve => { setTimeout(resolve, 0); }); owner.check();
	}
	await owner.wait(); owner.check(); return coverage[graph.outputSlot]!;
}
