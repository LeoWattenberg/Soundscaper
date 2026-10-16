/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoMaskMatteNodeV1 } from '../video-mask-matte-v24.ts';

type Vec4 = readonly [number, number, number, number];
/** Separate mask-program ABI; these integers are NOT image-pass kinds. */
export type PixelFrameWebGl2MaskNodeKindCurrentV1 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export interface PixelFrameWebGl2MaskNodeUniformsCurrentV1 {
	readonly kind: PixelFrameWebGl2MaskNodeKindCurrentV1;
	readonly params0: Vec4;
	readonly params1: Vec4;
	readonly radius: number;
	readonly pathEdges: number;
	readonly evenOdd: boolean;
	readonly inputName: string | undefined;
	readonly supported: boolean;
}
const tuple = (v: Vec4): Vec4 => Object.freeze([v[0], v[1], v[2], v[3]] as const);
const ZERO: Vec4 = tuple([0, 0, 0, 0]);

/** Only the private graph owner calls this with its detached, fully normalized
 * computation graph. These scalars alone confer no source or execution authority.
 * Double controls stay in the graph for CPU replay; F32 transport is not oracle. */
export function preparePixelFrameWebGl2MaskNodeUniformsCurrentV1(node: Readonly<VideoMaskMatteNodeV1>): Readonly<PixelFrameWebGl2MaskNodeUniformsCurrentV1> {
	let kind: PixelFrameWebGl2MaskNodeKindCurrentV1, p0 = ZERO, p1 = ZERO;
	let radius = 0, pathEdges = 0, evenOdd = false, inputName: string | undefined;
	let supported = true;
	if (node.kind === 'vector-shape') {
		kind = node.shape === 'rectangle' ? 1 : 2;
		p0 = node.shape === 'rectangle' ? tuple([node.x, node.y, node.x + node.width, node.y + node.height])
			: tuple([node.x + node.width / 2, node.y + node.height / 2, node.width / 2, node.height / 2]);
		if (node.shape === 'rectangle') supported = Math.fround(p0[0]) < Math.fround(p0[2]) && Math.fround(p0[1]) < Math.fround(p0[3]);
		else supported = Math.fround(p0[2]) > 0 && Math.fround(p0[3]) > 0;
	} else if (node.kind === 'linear-gradient') {
		kind = 3;
		const dx = node.end.x - node.start.x, dy = node.end.y - node.start.y;
		const scale = Math.max(Math.abs(dx), Math.abs(dy)), nx = dx / scale, ny = dy / scale;
		p0 = tuple([node.start.x, node.start.y, nx, ny]); p1 = tuple([scale * (nx * nx + ny * ny), 0, 0, 0]);
		supported = Math.fround(p1[0]) > 0 && (Math.fround(node.start.x) !== Math.fround(node.end.x)
			|| Math.fround(node.start.y) !== Math.fround(node.end.y));
	} else if (node.kind === 'radial-gradient') {
		kind = 4; p0 = tuple([node.center.x, node.center.y, node.radius.x, node.radius.y]);
		p1 = tuple([1 - node.innerFraction, 0, 0, 0]);
		supported = Math.fround(node.radius.x) > 0 && Math.fround(node.radius.y) > 0 && Math.fround(p1[0]) > 0;
	} else if (node.kind === 'luminance-range') {
		kind = 5; p0 = tuple([node.lower, node.upper, node.falloff, 0]);
		supported = node.falloff === 0 || Math.fround(node.falloff) > 0;
	} else if (node.kind === 'color-range') {
		kind = 6;
		const decode = (v: number): number => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
		p0 = tuple([decode(node.color.r), decode(node.color.g), decode(node.color.b), node.radius]);
		p1 = tuple([node.falloff, 0, 0, 0]); supported = (node.radius === 0 || Math.fround(node.radius) > 0)
			&& (node.falloff === 0 || Math.fround(node.falloff) > 0);
	} else if (node.kind === 'raster' || node.kind === 'alpha') {
		// Existing brush admission already refuses raster channels other than alpha.
		kind = 7; inputName = node.inputName;
	} else if (node.kind === 'invert') kind = 8;
	else if (node.kind === 'boolean') kind = node.operation === 'union' ? 9 : node.operation === 'intersect' ? 10 : node.operation === 'subtract' ? 11 : 12;
	else if (node.kind === 'feather') { radius = Math.ceil(node.radius); kind = radius === 0 ? 13 : 14; }
	else {
		kind = 15; evenOdd = node.fillRule === 'even-odd';
		for (const path of node.paths) {
			pathEdges += path.points.length;
			for (let index = 0; index < path.points.length; index++) {
				const a = path.points[index]!.position, b = path.points[(index + 1) % path.points.length]!.position;
				if (![a.x, a.y, b.x, b.y].every(v => Number.isFinite(Math.fround(v)))) supported = false;
				if ((a.x !== b.x || a.y !== b.y) && Math.fround(a.x) === Math.fround(b.x) && Math.fround(a.y) === Math.fround(b.y)) supported = false;
			}
		}
	}
	supported &&= [...p0, ...p1].every(v => Number.isFinite(Math.fround(v)));
	return Object.freeze({ kind, params0: p0, params1: p1, radius, pathEdges, evenOdd, inputName, supported });
}
