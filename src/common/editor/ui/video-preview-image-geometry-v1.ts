/* SPDX-License-Identifier: AGPL-3.0-only */

import { imageGeometryVideoPlanV1 } from '../video-image-geometry-v1.ts';

/** Same matrices and pixel bounds as the encoded-sRGB CPU renderer; GL coordinates flip only at sampling. */
export function bindImageGeometryVideoUniformsV1(gl: WebGL2RenderingContext, locations: {
	geometryOutput: WebGLUniformLocation | null; geometrySource: WebGLUniformLocation | null; geometryBounds: WebGLUniformLocation | null;
}, value: unknown, width: number, height: number): void {
	const plan = imageGeometryVideoPlanV1(value, width, height), a = plan.outputToAperture, m = plan.apertureToSource;
	gl.uniformMatrix3fv(locations.geometryOutput, false, [a[0], a[3], 0, a[1], a[4], 0, a[2], a[5], 1]);
	gl.uniformMatrix3fv(locations.geometrySource, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
	gl.uniform4f(locations.geometryBounds, Math.floor(plan.crop.x * width), Math.floor(plan.crop.y * height),
		Math.min(width - 1, Math.ceil((plan.crop.x + plan.crop.width) * width) - 1),
		Math.min(height - 1, Math.ceil((plan.crop.y + plan.crop.height) * height) - 1));
}

export const IMAGE_GEOMETRY_PREVIEW_GLSL_V1 = `
uniform mat3 u_geometry_output;
uniform mat3 u_geometry_source;
uniform vec4 u_geometry_bounds;
vec4 geometry_sample(vec2 xy) {
	vec2 index = clamp(xy, u_geometry_bounds.xy, u_geometry_bounds.zw);
	vec2 uv = (index + 0.5) / u_source_resolution;
	vec4 texel = texture(u_texture, u_source_rect.xy + vec2(uv.x, 1.0 - uv.y) * u_source_rect.zw);
	return vec4(texel.rgb * texel.a, texel.a);
}
vec4 geometry_render(vec2 content_uv) {
	vec2 pixel = vec2(content_uv.x, 1.0 - content_uv.y) * u_source_resolution;
	vec2 aperture = (u_geometry_output * vec3(pixel, 1.0)).xy;
	if (any(lessThan(aperture, vec2(-1e-12))) || any(greaterThan(aperture, vec2(1.0 + 1e-12)))) return vec4(0.0);
	vec3 source = u_geometry_source * vec3(clamp(aperture, 0.0, 1.0), 1.0);
	vec2 xy = source.xy / source.z - 0.5, base = floor(xy), f = xy - base;
	vec4 color = geometry_sample(base) * ((1.0 - f.x) * (1.0 - f.y))
		+ geometry_sample(base + vec2(1.0, 0.0)) * (f.x * (1.0 - f.y))
		+ geometry_sample(base + vec2(0.0, 1.0)) * ((1.0 - f.x) * f.y)
		+ geometry_sample(base + vec2(1.0, 1.0)) * (f.x * f.y);
	float alpha = floor(color.a * 255.0 + 0.5) / 255.0;
	return alpha == 0.0 ? vec4(0.0) : vec4(floor(color.rgb / color.a * 255.0 + 0.5) / 255.0, alpha);
}
`;
