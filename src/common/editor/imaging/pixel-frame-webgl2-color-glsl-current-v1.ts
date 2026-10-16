/* SPDX-License-Identifier: AGPL-3.0-only */

import { PIXEL_FRAME_WEBGL2_GLOBAL_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-global-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_CHROMA_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-chroma-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_CURVES_FUNCTIONS_CURRENT_V1 } from './pixel-frame-webgl2-curves-glsl-current-v1.ts';

/** One RGBA32F stage store. Encoded-domain adjustments remain continuous and
 * unclipped; wheels stay native linear. Numerical eligibility and streaming
 * conformance belong to the native owner, before any consumer is delivered. */
export const PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uImage;
uniform int uKind;
uniform vec4 uParams0;
uniform vec4 uParams1;
uniform vec4 uParams2;
uniform vec4 uBands[8];
uniform ivec4 uCurveCounts;
uniform vec2 uCurvePoints[128];
layout(location = 0) out vec4 outColor;
${PIXEL_FRAME_WEBGL2_GLOBAL_FUNCTIONS_CURRENT_V1}
${PIXEL_FRAME_WEBGL2_CHROMA_FUNCTIONS_CURRENT_V1}
${PIXEL_FRAME_WEBGL2_CURVES_FUNCTIONS_CURRENT_V1}

float colorEncodedCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * pow(magnitude, 1.0 / 2.4) - 0.055);
}

float colorLinearCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : pow((magnitude + 0.055) / 1.055, 2.4));
}

float colorWheelCurrentV1(float value, float gamma) {
	return gamma == 1.0 ? value : sign(value) * pow(abs(value), 1.0 / gamma);
}

vec3 wheelsColorCurrentV1(vec3 rgb) {
	vec3 gained = (rgb + uParams0.xyz) * uParams1.xyz;
	return vec3(colorWheelCurrentV1(gained.r, uParams2.x), colorWheelCurrentV1(gained.g, uParams2.y), colorWheelCurrentV1(gained.b, uParams2.z));
}

void main() {
	vec4 color = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0);
	vec3 rgb = color.rgb;
	if (uKind == 1 || uKind == 2) rgb = globalColorCurrentV1(color.rgb);
	else if (uKind == 3 || uKind == 4 || uKind == 5 || uKind == 6) {
		vec3 encoded = vec3(colorEncodedCurrentV1(rgb.r), colorEncodedCurrentV1(rgb.g), colorEncodedCurrentV1(rgb.b));
		vec3 next = uKind == 6 ? curvesColorCurrentV1(encoded) : chromaColorCurrentV1(encoded);
		rgb = vec3(next.r == encoded.r ? color.r : colorLinearCurrentV1(next.r),
			next.g == encoded.g ? color.g : colorLinearCurrentV1(next.g),
			next.b == encoded.b ? color.b : colorLinearCurrentV1(next.b));
	} else if (uKind == 7) rgb = wheelsColorCurrentV1(rgb);
	outColor = vec4(rgb, color.a);
}
`;
