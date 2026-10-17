/* SPDX-License-Identifier: AGPL-3.0-only */

import { imageGeometryVideoPlanV1 } from './video-image-geometry-v1.ts';

/** Fixed source and output extent; exact same inverse map and four premultiplied samples as CPU/GLSL. */
export function imageGeometryVideoFfmpegFilterV1(value: unknown, width: number, height: number): string {
	const plan = imageGeometryVideoPlanV1(value, width, height), a = plan.outputToAperture, m = plan.apertureToSource;
	const token = (value: number) => String(Object.is(value, -0) ? 0 : value);
	const left = Math.floor(plan.crop.x * width), top = Math.floor(plan.crop.y * height);
	const right = Math.min(width - 1, Math.ceil((plan.crop.x + plan.crop.width) * width) - 1);
	const bottom = Math.min(height - 1, Math.ceil((plan.crop.y + plan.crop.height) * height) - 1);
	const aperture = `st(0,${token(a[0])}*(X+0.5)+${token(a[1])}*(Y+0.5)+${token(a[2])});`
		+ `st(1,${token(a[3])}*(X+0.5)+${token(a[4])}*(Y+0.5)+${token(a[5])});`;
	const mapping = `st(0,clip(ld(0),0,1));st(1,clip(ld(1),0,1));`
		+ `st(2,(${token(m[0])}*ld(0)+${token(m[1])}*ld(1)+${token(m[2])})/(${token(m[6])}*ld(0)+${token(m[7])}*ld(1)+1)-0.5);`
		+ `st(3,(${token(m[3])}*ld(0)+${token(m[4])}*ld(1)+${token(m[5])})/(${token(m[6])}*ld(0)+${token(m[7])}*ld(1)+1)-0.5);`
		+ `st(4,floor(ld(2)));st(5,floor(ld(3)));st(6,ld(2)-ld(4));st(7,ld(3)-ld(5));`;
	const sample = (channel: string, dx: number, dy: number) => `${channel}(clip(ld(4)+${String(dx)},${String(left)},${String(right)}),clip(ld(5)+${String(dy)},${String(top)},${String(bottom)}))`;
	const terms = (channel: string | null) => [0, 1].flatMap(dy => [0, 1].map(dx =>
		`${channel ? `${sample(channel, dx, dy)}*` : ''}${sample('alpha', dx, dy)}*${dx ? 'ld(6)' : '(1-ld(6))'}*${dy ? 'ld(7)' : '(1-ld(7))'}`)).join('+');
	const valid = 'between(ld(0),-0.000000000001,1.000000000001)*between(ld(1),-0.000000000001,1.000000000001)';
	const alpha = terms(null);
	const expression = (channel: string | null) => aperture + `if(${valid},${mapping}`
		+ (channel ? `st(8,${alpha});if(eq(floor(ld(8)+0.5),0),0,floor((${terms(channel)})/ld(8)+0.5))` : `floor(${alpha}+0.5)`) + ',0)';
	return `format=pix_fmts=gbrap,geq=r='${expression('r')}':g='${expression('g')}':b='${expression('b')}':a='${expression(null)}':interpolation=nearest,format=pix_fmts=rgba`;
}
