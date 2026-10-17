/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareOpticalVignetteEffectV1 } from './video-optical-vignette-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoEffectGraphContext } from './video-effect-ffmpeg.ts';

/** Separate alpha custody prevents packed/planar conversion drift while geq
 * decodes, multiplies and encodes the immutable incoming RGB samples. */
export function appendOpticalVignetteFfmpegOperationV1(context: VideoEffectGraphContext): void {
	const operation = record(context.operation, 'optical vignette FFmpeg operation', ['kind', 'effect']);
	if (field(operation, 'kind', 'optical vignette FFmpeg operation') !== 'optical-vignette-v1') throw new TypeError('Unsupported optical vignette FFmpeg operation.');
	const expression = opticalVignetteVideoFfmpegFilterV1(field(operation, 'effect', 'optical vignette FFmpeg operation'), context.width, context.height);
	const { filters, inputLabel, outputLabel: out } = context;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${out}_rgb_source][${out}_alpha_source]`);
	filters.push(`[${out}_rgb_source]format=pix_fmts=gbrp,extractplanes=r+g+b[${out}_r][${out}_g][${out}_b]`);
	filters.push(`[${out}_alpha_source]alphaextract,split=2[${out}_control_alpha][${out}_output_alpha]`);
	filters.push(`[${out}_g][${out}_b][${out}_r][${out}_control_alpha]mergeplanes=mapping=0x00102030:format=gbrap[${out}_planar]`);
	filters.push(`[${out}_planar]${expression},format=pix_fmts=rgb24[${out}_color]`);
	filters.push(`[${out}_color][${out}_output_alpha]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${out}]`);
}

export function opticalVignetteVideoFfmpegFilterV1(value: unknown, width: number, height: number): string {
	const effect = prepareOpticalVignetteEffectV1(value);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 65_536 || height > 65_536
		|| width * height > 33_554_432) throw new RangeError('Optical vignette requires bounded image dimensions.');
	const radius = '((2*X+1-W)*(2*X+1-W)+(2*Y+1-H)*(2*Y+1-H))/(W*W+H*H)';
	const gain = `pow(2,${String(2 * effect.amount / 100)}*${radius})`;
	const encode = 'if(lte(ld(1),0.0031308),12.92*ld(1),1.055*pow(ld(1),1/2.4)-0.055)';
	const channel = (name: 'r' | 'g' | 'b') => {
		const input = `${name}(X,Y)`; if (!effect.enabled || effect.neutral) return input;
		const encoded = `(${input}/255)`, decoded = `if(lte(${encoded},0.04045),${encoded}/12.92,pow((${encoded}+0.055)/1.055,2.4))`;
		return `if(eq(alpha(X,Y),0),${input},st(0,${gain});if(eq(ld(0),1),${input},st(1,(${decoded})*ld(0));clip(floor(255*(${encode})+0.5),0,255)))`;
	};
	return `geq=r='${channel('r')}':g='${channel('g')}':b='${channel('b')}':a='alpha(X,Y)':interpolation=nearest`;
}
