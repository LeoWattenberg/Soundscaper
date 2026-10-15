/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareDefringeEffectV1 } from './video-defringe-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoEffectGraphContext } from './video-effect-ffmpeg.ts';

/** Preserve original alpha outside RGB planar negotiation. Control alpha is
 * supplied independently to the immutable, clamped neighborhood expressions. */
export function appendDefringeFfmpegOperationV1(context: VideoEffectGraphContext): void {
	const operation = record(context.operation, 'defringe FFmpeg operation', ['kind', 'effect']);
	if (field(operation, 'kind', 'defringe FFmpeg operation') !== 'defringe-v1') throw new TypeError('Unsupported defringe FFmpeg operation.');
	const expression = defringeVideoFfmpegFilterV1(field(operation, 'effect', 'defringe FFmpeg operation'), context.width, context.height);
	const { filters, inputLabel, outputLabel: out } = context;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${out}_rgb_source][${out}_alpha_source]`);
	filters.push(`[${out}_rgb_source]format=pix_fmts=gbrp,extractplanes=r+g+b[${out}_r][${out}_g][${out}_b]`);
	filters.push(`[${out}_alpha_source]alphaextract,split=2[${out}_control_alpha][${out}_output_alpha]`);
	filters.push(`[${out}_g][${out}_b][${out}_r][${out}_control_alpha]mergeplanes=mapping=0x00102030:format=gbrap[${out}_planar]`);
	filters.push(`[${out}_planar]${expression},format=pix_fmts=rgb24[${out}_color]`);
	filters.push(`[${out}_color][${out}_output_alpha]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${out}]`);
}

export function defringeVideoFfmpegFilterV1(value: unknown, width: number, height: number): string {
	const effect = prepareDefringeEffectV1(value);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 65_536 || height > 65_536
		|| width * height > 33_554_432) throw new RangeError('Defringe requires bounded image dimensions.');
	const rgb = (x: string, y: string) => ({ r: `r(${x},${y})`, g: `g(${x},${y})`, b: `b(${x},${y})` });
	const statistics = (color: ReturnType<typeof rgb>) => ({
		luma: `(54*${color.r}+183*${color.g}+19*${color.b})/65280`,
		purple: `max(0,min(${color.r},${color.b})-${color.g})/255`,
		green: `max(0,${color.g}-max(${color.r},${color.b}))/255`,
	});
	const center = statistics(rgb('X', 'Y'));
	let preparation = `st(0,${center.luma});st(1,${center.purple});st(2,${center.green});`
		+ 'st(3,ld(0));st(4,ld(0));st(5,0);st(6,0);st(7,0);';
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		if (dx === 0 && dy === 0) continue;
		const x = `clip(X+(${String(dx)}),0,W-1)`, y = `clip(Y+(${String(dy)}),0,H-1)`, neighbor = statistics(rgb(x, y));
		preparation += `st(9,alpha(${x},${y}));st(3,if(gt(ld(9),0),min(ld(3),${neighbor.luma}),ld(3)));`
			+ `st(4,if(gt(ld(9),0),max(ld(4),${neighbor.luma}),ld(4)));st(5,ld(5)+ld(9));`
			+ `st(6,ld(6)+ld(9)*(ld(1)-(${neighbor.purple})));st(7,ld(7)+ld(9)*(ld(2)-(${neighbor.green})));`;
	}
	preparation += `st(8,clip(clip(4*((ld(4)-ld(3))-${String(effect.threshold)}),0,1)*`
		+ `(${String(effect.purpleAmount)}*if(gt(ld(5),0),clip(4*ld(6)/ld(5),0,1),0)`
		+ `+${String(effect.greenAmount)}*if(gt(ld(5),0),clip(4*ld(7)/ld(5),0,1),0)),0,1));`;
	const channel = (name: 'r' | 'g' | 'b') => !effect.enabled || effect.neutral ? `${name}(X,Y)`
		: `if(eq(alpha(X,Y),0),${name}(X,Y),${preparation}if(eq(ld(8),0),${name}(X,Y),floor(${name}(X,Y)+ld(8)*(255*ld(0)-${name}(X,Y))+0.5)))`;
	return `geq=r='${channel('r')}':g='${channel('g')}':b='${channel('b')}':a='alpha(X,Y)':interpolation=nearest`;
}
