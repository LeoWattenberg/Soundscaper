/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareLensDistortionEffectV1 } from './video-lens-distortion-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoEffectGraphContext } from './video-effect-ffmpeg.ts';

/** Keep exact input and warped output alpha out of swscale's packed/planar
 * conversion. Both alpha planes cross only extract/merge operations. */
export function appendLensDistortionFfmpegOperationV1(context: VideoEffectGraphContext): void {
	const operation = record(context.operation, 'lens FFmpeg operation', ['kind', 'effect']);
	if (field(operation, 'kind', 'lens FFmpeg operation') !== 'lens-distortion-v1') throw new TypeError('Unsupported lens FFmpeg operation.');
	const expression = lensDistortionVideoFfmpegFilterV1(field(operation, 'effect', 'lens FFmpeg operation'), context.width, context.height);
	const { filters, inputLabel, outputLabel: out } = context;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${out}_rgb_source][${out}_alpha_source]`);
	filters.push(`[${out}_rgb_source]format=pix_fmts=gbrp,extractplanes=r+g+b[${out}_r][${out}_g][${out}_b]`);
	filters.push(`[${out}_alpha_source]alphaextract[${out}_input_alpha]`);
	filters.push(`[${out}_g][${out}_b][${out}_r][${out}_input_alpha]mergeplanes=mapping=0x00102030:format=gbrap[${out}_planar]`);
	filters.push(`[${out}_planar]${expression},split=2[${out}_filtered_rgb][${out}_filtered_alpha]`);
	filters.push(`[${out}_filtered_rgb]format=pix_fmts=rgb24[${out}_color]`);
	filters.push(`[${out}_filtered_alpha]alphaextract[${out}_output_alpha]`);
	filters.push(`[${out}_color][${out}_output_alpha]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${out}]`);
}

/** Four explicit zero-extended taps carry both alpha and premultiplied RGB.
 * geq's own edge clamping and interpolation never select the image support. */
export function lensDistortionVideoFfmpegFilterV1(value: unknown, width: number, height: number): string {
	const effect = prepareLensDistortionEffectV1(value);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 65_536 || height > 65_536
		|| width * height > 33_554_432) throw new RangeError('Lens distortion requires bounded image dimensions.');
	const k = String(effect.enabled ? effect.k : 0);
	const radius = '((X+0.5-W/2)*(X+0.5-W/2)+(Y+0.5-H/2)*(Y+0.5-H/2))/((W*W+H*H)/4)';
	const mapping = `st(0,W/2+(X+0.5-W/2)*(1+${k}*${radius})-0.5);st(1,H/2+(Y+0.5-H/2)*(1+${k}*${radius})-0.5);`
		+ 'st(2,floor(ld(0)));st(3,floor(ld(1)));st(4,ld(0)-ld(2));st(5,ld(1)-ld(3));';
	const sample = (channel: string, dx: number, dy: number) => {
		const x = `ld(2)+${String(dx)}`, y = `ld(3)+${String(dy)}`;
		return `if(between(${x},0,W-1)*between(${y},0,H-1),${channel}(clip(${x},0,W-1),clip(${y},0,H-1)),0)`;
	};
	const terms = (channel: string | null) => [0, 1].flatMap(dy => [0, 1].map(dx =>
		`${channel ? `${sample(channel, dx, dy)}*` : ''}${sample('alpha', dx, dy)}*${dx ? 'ld(4)' : '(1-ld(4))'}*${dy ? 'ld(5)' : '(1-ld(5))'}`)).join('+');
	const alpha = terms(null), expression = (channel: string | null) => mapping
		+ (channel ? `st(6,${alpha});if(eq(floor(ld(6)+0.5),0),0,floor((${terms(channel)})/ld(6)+0.5))` : `floor(${alpha}+0.5)`);
	return `geq=r='${expression('r')}':g='${expression('g')}':b='${expression('b')}':a='${expression(null)}':interpolation=nearest`;
}
