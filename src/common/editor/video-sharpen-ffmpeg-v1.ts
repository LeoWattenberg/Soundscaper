/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native RGBA→GBRAP scaling can change alpha bytes before GEQ. Extract alpha
 * from untouched RGBA separately, then merge the original byte plane with RGB.
 * The original alpha plane is also retained for final exact publication. */
export function appendDetailSharpenFfmpegOperationV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string;
	operation: Readonly<Record<string, unknown>> }>): void {
	const { filters, inputLabel, outputLabel, operation } = context;
	if (operation.kind !== 'detail-sharpen-v1' || typeof operation.expression !== 'string' || operation.preserveAlpha !== true) {
		throw new TypeError('Detail sharpening requires its owning compiled neighborhood operation.');
	}
	const green = `${outputLabel}_g`, blue = `${outputLabel}_b`, red = `${outputLabel}_r`, alpha = `${outputLabel}_a`;
	const rgbSource = `${outputLabel}_rgb_source`, alphaSource = `${outputLabel}_alpha_source`;
	const weightAlpha = `${outputLabel}_weight_a`, outputAlpha = `${outputLabel}_output_a`, planar = `${outputLabel}_planar`, color = `${outputLabel}_color`;
	filters.push(`[${inputLabel}]format=pix_fmts=rgba,split=2[${rgbSource}][${alphaSource}]`);
	// extractplanes emits named RGB flags in its fixed R/G/B order.
	filters.push(`[${rgbSource}]format=pix_fmts=gbrp,extractplanes=r+g+b[${red}][${green}][${blue}]`);
	filters.push(`[${alphaSource}]alphaextract[${alpha}]`);
	filters.push(`[${alpha}]split=2[${weightAlpha}][${outputAlpha}]`);
	filters.push(`[${green}][${blue}][${red}][${weightAlpha}]mergeplanes=mapping=0x00102030:format=gbrap[${planar}]`);
	filters.push(`[${planar}]${operation.expression},format=pix_fmts=rgb24[${color}]`);
	filters.push(`[${color}][${outputAlpha}]alphamerge,format=pix_fmts=rgba,setpts=PTS-STARTPTS[${outputLabel}]`);
}
