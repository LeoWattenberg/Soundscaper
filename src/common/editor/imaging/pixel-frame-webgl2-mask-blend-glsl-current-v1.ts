/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';

export type PixelFrameWebGl2MaskBlendPolicyCurrentV1 =
	| Readonly<{ kind: 'generic' }>
	| Readonly<{ kind: 'ca-copy'; copyRed: boolean; copyBlue: boolean }>
	| Readonly<{ kind: 'unchanged-components' }>;
export interface PixelFrameWebGl2MaskBlendUniformsCurrentV1 {
	readonly policy: 0 | 1 | 2;
	readonly copyRed: 0 | 1;
	readonly copyBlue: 0 | 1;
}
/** Closed scalar transport only. Execution still requires the private owning
 * authored checkpoint and genuine incoming/candidate/coverage textures. */
export function preparePixelFrameWebGl2MaskBlendUniformsCurrentV1(value: unknown): Readonly<PixelFrameWebGl2MaskBlendUniformsCurrentV1> {
	const label = 'native GPU mask blend policy';
	const input = record(value, label, ['kind', 'copyRed', 'copyBlue'], ['kind']), kind = field(input, 'kind', label);
	if (kind === 'generic' || kind === 'unchanged-components') {
		record(input, label, ['kind']);
		return Object.freeze({ policy: kind === 'generic' ? 0 : 2, copyRed: 0, copyBlue: 0 });
	}
	if (kind !== 'ca-copy') throw new RangeError('Unsupported native GPU mask blend policy.');
	record(input, label, ['kind', 'copyRed', 'copyBlue']);
	const red = field(input, 'copyRed', label), blue = field(input, 'copyBlue', label);
	if (typeof red !== 'boolean' || typeof blue !== 'boolean') throw new TypeError('CA copied-channel flags require booleans.');
	return Object.freeze({ policy: 1, copyRed: red ? 1 : 0, copyBlue: blue ? 1 : 0 });
}

/** A incoming and B already-F32 candidate -> distinct C. No feedback, no
 * alpha-zero RGB bypass, no generic equality bypass and no encoded plane. */
export const PIXEL_FRAME_WEBGL2_MASK_BLEND_FRAGMENT_CURRENT_V1 = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uIncoming;
uniform highp sampler2D uCandidate;
uniform highp usampler2D uCoverage;
uniform int uBlendPolicy;
uniform int uCopyRed;
uniform int uCopyBlue;
layout(location=0) out vec4 outColor;
float blendChannel(float before,float candidate,uint amount,int channel) {
	if(uBlendPolicy==1 && (channel==1 || (channel==0 && uCopyRed!=0) || (channel==2 && uCopyBlue!=0))) return before;
	// Existing Current equality precedes EVEN q255: -0/+0 keeps incoming bits.
	if(uBlendPolicy==2 && before==candidate) return before;
	if(amount==0u) return before;
	if(amount==255u) return candidate;
	// For every fractional byte1..254 all four +/-0 endpoint combinations
	// evaluate to +0 in the normative JS difference/product/add expression.
	if(before==0.0 && candidate==0.0) return 0.0;
	return before+(float(amount)/255.0)*(candidate-before);
}
void main() {
	ivec2 p=ivec2(gl_FragCoord.xy);
	vec4 before=texelFetch(uIncoming,p,0),candidate=texelFetch(uCandidate,p,0);
	uint amount=texelFetch(uCoverage,p,0).r;
	outColor=vec4(blendChannel(before.r,candidate.r,amount,0),
		blendChannel(before.g,candidate.g,amount,1),blendChannel(before.b,candidate.b,amount,2),before.a);
}`;
