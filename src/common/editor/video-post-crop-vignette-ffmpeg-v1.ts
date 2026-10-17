/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPostCropVignetteFfmpegOperationV1 } from './video-post-crop-vignette-v1.ts';

/** Restore the untouched alpha plane before GEQ and final publication. Native
 * RGBA→GBRAP conversion otherwise rounds some alpha bytes before inspection.
 * This owner requires the exact locally compiled recipe, not caller text. */
export function appendPostCropVignetteFfmpegOperationV1(context:Readonly<{filters:string[];inputLabel:string;outputLabel:string;operation:unknown}>):void {
	const {filters,inputLabel,outputLabel,operation}=context;assertPostCropVignetteFfmpegOperationV1(operation);
	const red=`${outputLabel}_r`,green=`${outputLabel}_g`,blue=`${outputLabel}_b`,alpha=`${outputLabel}_a`;
	const rgbSource=`${outputLabel}_rgb_source`,alphaSource=`${outputLabel}_alpha_source`,controlAlpha=`${outputLabel}_control_a`,outputAlpha=`${outputLabel}_output_a`;
	const planar=`${outputLabel}_planar`,color=`${outputLabel}_color`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${rgbSource}][${alphaSource}]`);
	filters.push(`[${rgbSource}]format=pix_fmts=gbrp,extractplanes=r+g+b[${red}][${green}][${blue}]`);
	filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
	filters.push(`[${alpha}]split=2[${controlAlpha}][${outputAlpha}]`);
	filters.push(`[${green}][${blue}][${red}][${controlAlpha}]mergeplanes=mapping=0x00102030:format=gbrap[${planar}]`);
	filters.push(`[${planar}]${operation.expression},format=pix_fmts=rgb24[${color}]`);
	filters.push(`[${color}][${outputAlpha}]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${outputLabel}]`);
}
