/* SPDX-License-Identifier: AGPL-3.0-only */

export const motionCompositeVertexShader = `#version 300 es
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Same separable source-over formula as motion-surface.ts; no implicit browser color conversion. */
export const motionCompositeFragmentShader = `#version 300 es
precision highp float;
uniform highp sampler2D uSource;
uniform highp sampler2D uBackdrop;
uniform int uMode;
uniform float uOpacity;
out vec4 result;
vec3 blend(vec3 b, vec3 s) {
	if (uMode == 1) return b * s;
	if (uMode == 2) return b + s - b * s;
	if (uMode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), greaterThan(b, vec3(0.5)));
	if (uMode == 4) return min(vec3(1.0), b + s);
	if (uMode == 5) return min(b, s);
	if (uMode == 6) return max(b, s);
	if (uMode == 7) return abs(b - s);
	if (uMode == 8) return b + s - 2.0 * b * s;
	return s;
}
void main() {
	ivec2 p = ivec2(gl_FragCoord.xy);
	vec4 s = texelFetch(uSource, p, 0) * uOpacity;
	vec4 b = texelFetch(uBackdrop, p, 0);
	vec3 straightB = b.a == 0.0 ? vec3(0.0) : b.rgb / b.a;
	vec3 straightS = s.a == 0.0 ? vec3(0.0) : s.rgb / s.a;
	result = vec4((1.0 - s.a) * b.rgb + (1.0 - b.a) * s.rgb + s.a * b.a * blend(straightB, straightS), s.a + b.a * (1.0 - s.a));
}`;
