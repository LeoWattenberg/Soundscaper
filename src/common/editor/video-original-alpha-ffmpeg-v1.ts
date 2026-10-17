/* SPDX-License-Identifier: AGPL-3.0-only */

/** Internal transport for owning compiled effects. Original byte alpha must
 * precede GBRAP conversion whenever GEQ reads it; it also survives final RGB
 * publication. Callers authenticate their operation kind before delegating.
 * All labels/filters deliberately retain the original sharpen graph bytes. */
export function appendOriginalAlphaEffectFfmpegV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string;
	operation: Readonly<{ expression: string; preserveAlpha: true }> }>): void {
	const { filters,inputLabel,outputLabel,operation } = context;
	const green = `${outputLabel}_g`, blue = `${outputLabel}_b`, red = `${outputLabel}_r`, alpha = `${outputLabel}_a`;
	const rgbSource = `${outputLabel}_rgb_source`, alphaSource = `${outputLabel}_alpha_source`;
	const weightAlpha = `${outputLabel}_weight_a`, outputAlpha = `${outputLabel}_output_a`, planar = `${outputLabel}_planar`, color = `${outputLabel}_color`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${rgbSource}][${alphaSource}]`);
	filters.push(`[${rgbSource}]format=pix_fmts=gbrp,extractplanes=r+g+b[${red}][${green}][${blue}]`);
	filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
	filters.push(`[${alpha}]split=2[${weightAlpha}][${outputAlpha}]`);
	filters.push(`[${green}][${blue}][${red}][${weightAlpha}]mergeplanes=mapping=0x00102030:format=gbrap[${planar}]`);
	filters.push(`[${planar}]${operation.expression},format=pix_fmts=rgb24[${color}]`);
	filters.push(`[${color}][${outputAlpha}]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${outputLabel}]`);
}
