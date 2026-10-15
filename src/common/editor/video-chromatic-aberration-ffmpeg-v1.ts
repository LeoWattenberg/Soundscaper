/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareChromaticAberrationEffectV1 } from './video-chromatic-aberration-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoEffectGraphContext } from './video-effect-ffmpeg.ts';

/** Exact original alpha supplies the weighted-channel divisor and the final
 * output separately, bypassing packed/planar alpha conversion. Green and each
 * zero-control channel are copied on the original reference grid. */
export function appendChromaticAberrationFfmpegOperationV1(context: VideoEffectGraphContext): void {
	const operation = record(context.operation, 'chromatic aberration FFmpeg operation', ['kind', 'effect']);
	if (field(operation, 'kind', 'chromatic aberration FFmpeg operation') !== 'chromatic-aberration-v1') throw new TypeError('Unsupported chromatic aberration FFmpeg operation.');
	const expression = chromaticAberrationVideoFfmpegFilterV1(field(operation, 'effect', 'chromatic aberration FFmpeg operation'), context.width, context.height);
	const { filters, inputLabel, outputLabel: out } = context;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${out}_rgb_source][${out}_alpha_source]`);
	filters.push(`[${out}_rgb_source]format=pix_fmts=gbrp,extractplanes=r+g+b[${out}_r][${out}_g][${out}_b]`);
	filters.push(`[${out}_alpha_source]alphaextract,split=2[${out}_control_alpha][${out}_output_alpha]`);
	filters.push(`[${out}_g][${out}_b][${out}_r][${out}_control_alpha]mergeplanes=mapping=0x00102030:format=gbrap[${out}_planar]`);
	filters.push(`[${out}_planar]${expression},format=pix_fmts=rgb24[${out}_color]`);
	filters.push(`[${out}_color][${out}_output_alpha]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${out}]`);
}

export function chromaticAberrationVideoFfmpegFilterV1(value: unknown, width: number, height: number): string {
	const effect = prepareChromaticAberrationEffectV1(value);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 65_536 || height > 65_536
		|| width * height > 33_554_432) throw new RangeError('Chromatic aberration requires bounded image dimensions.');
	const channelExpression = (channel: 'r' | 'b', control: number, coefficient: number) => {
		if (!effect.enabled || control === 0) return `${channel}(X,Y)`;
		const k = String(coefficient), radius = '((X+0.5-W/2)*(X+0.5-W/2)+(Y+0.5-H/2)*(Y+0.5-H/2))/((W*W+H*H)/4)';
		// Keep supporting weights separate from integer coordinates. In
		// particular, tiny inward motion must survive beside alpha-zero pixels.
		const mapping = `st(0,(X+0.5-W/2)*(${k}*${radius}));st(1,(Y+0.5-H/2)*(${k}*${radius}));`
			+ 'st(7,if(lt(ld(0),0),-1,1));st(8,if(lt(ld(1),0),-1,1));'
			+ 'st(2,X+ld(7)*floor(abs(ld(0))));st(3,Y+ld(8)*floor(abs(ld(1))));'
			+ 'st(4,abs(ld(0))-floor(abs(ld(0))));st(5,abs(ld(1))-floor(abs(ld(1))));';
		const sample = (name: string, dx: number, dy: number) => {
			const x = `ld(2)+${String(dx)}*ld(7)`, y = `ld(3)+${String(dy)}*ld(8)`;
			return `if(between(${x},0,W-1)*between(${y},0,H-1),${name}(clip(${x},0,W-1),clip(${y},0,H-1)),0)`;
		};
		const terms = (name: string | null) => [0, 1].flatMap(dy => [0, 1].map(dx =>
			`${name ? `${sample(name, dx, dy)}*` : ''}${sample('alpha', dx, dy)}*${dx ? 'ld(4)' : '(1-ld(4))'}*${dy ? 'ld(5)' : '(1-ld(5))'}`)).join('+');
		return `${mapping}st(6,${terms(null)});if(eq(ld(6),0),0,floor((${terms(channel)})/ld(6)+0.5))`;
	};
	return `geq=r='${channelExpression('r', effect.red, effect.redCoefficient)}':g='g(X,Y)':b='${channelExpression('b', effect.blue, effect.blueCoefficient)}':a='alpha(X,Y)':interpolation=nearest`;
}
