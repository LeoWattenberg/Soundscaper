/* SPDX-License-Identifier: AGPL-3.0-only */

import { linearGlobalDevelopChannelV1, prepareLinearGlobalEffectsV1, type PreparedLinearGlobalEffectV1 } from './pixel-frame-linear-global-v1.ts';

export interface PreparedPixelFrameWebGl2GlobalCurrentV1 {
	readonly id: string;
	readonly type: 'white-balance-v1' | 'tone-ladder-v1';
	readonly params0: readonly [number, number, number, number];
	readonly params1: readonly [number, number, number, number];
}

const PREPARED = new WeakMap<object, Readonly<PreparedLinearGlobalEffectV1>>();

/** Reuse complete native metadata admission and its detached immutable gains.
 * Original scalar identities stay private; the GPU owner receives only its own
 * uniform identity and a narrow normative channel evaluation capability. */
export function preparePixelFrameWebGl2GlobalsCurrentV1(value: unknown): readonly Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>[] {
	return Object.freeze(prepareLinearGlobalEffectsV1(value).map(effect => {
		const prepared = Object.freeze({ id: effect.id, type: effect.type, params0: effect.params0, params1: effect.params1 });
		PREPARED.set(prepared, effect); return prepared;
	}));
}

/** No reflection of unowned values occurs at the uniform authority boundary. */
export function readPixelFrameWebGl2GlobalCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1> {
	if (typeof value !== 'object' || value === null || !PREPARED.has(value)) {
		throw new TypeError('Native WebGL2 globals require an owning prepared identity.');
	}
	return value as Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1>;
}

/** Numeric eligibility uses the existing native scalar, without copying its
 * affine or regional formulas or exposing the underlying prepared identity. */
export function pixelFrameWebGl2GlobalChannelCurrentV1(value: unknown, sample: number, channel: 0 | 1 | 2): number {
	readPixelFrameWebGl2GlobalCurrentV1(value);
	return linearGlobalDevelopChannelV1(PREPARED.get(value as object)!, sample, channel);
}

export const PIXEL_FRAME_WEBGL2_GLOBAL_VERTEX_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
const vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
	gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;

/** Shared verbatim by the original global fragment and the extended color
 * fragment. Both owners use the same uniforms and stage-rounded native math. */
export const PIXEL_FRAME_WEBGL2_GLOBAL_FUNCTIONS_CURRENT_V1 = `
vec3 smoothWeight(float low, float high, vec3 value) {
	vec3 weight = clamp((value - vec3(low)) / (high - low), vec3(0.0), vec3(1.0));
	return weight * weight * (vec3(3.0) - 2.0 * weight);
}

vec3 globalColorCurrentV1(vec3 rgb) {
	if (uKind == 1) {
		rgb = rgb * uParams0.xyz;
	} else if (uKind == 2) {
		// Stable affine form preserves tiny exposure-only samples at the pivot.
		vec3 exposed = rgb * uParams0.x * uParams0.y + vec3(0.18 * (1.0 - uParams0.y));
		rgb = exposed
			+ uParams0.z * smoothWeight(0.5, 1.0, exposed)
			+ uParams0.w * (vec3(1.0) - smoothWeight(0.0, 0.5, exposed))
			+ uParams1.x * smoothWeight(0.75, 1.0, exposed)
			+ uParams1.y * (vec3(1.0) - smoothWeight(0.0, 0.25, exposed));
	}
	return rgb;
}
`;

/** Input and output textures are native linear RGBA32F. Every pass is a stage
 * store; resource ownership, finite output, numeric eligibility and readback
 * belong to the surrounding GPU owner. Only regional weights clamp here. */
export const PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uImage;
uniform int uKind;
uniform vec4 uParams0;
uniform vec4 uParams1;
layout(location = 0) out vec4 outColor;
${PIXEL_FRAME_WEBGL2_GLOBAL_FUNCTIONS_CURRENT_V1}
void main() {
	vec4 color = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0);
	vec3 rgb = globalColorCurrentV1(color.rgb);
	outColor = vec4(rgb, color.a);
}
`;
