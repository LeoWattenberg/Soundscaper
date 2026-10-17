/* SPDX-License-Identifier: AGPL-3.0-only */

import { HSL_MIXER_EFFECT_CODE_V1 } from '../video-hsl-mixer-v1.ts';

type Key = 'params0'|'params1'|'params2'|'params3'|'params4'|'params5';
const KEYS: readonly Key[] = ['params0','params1','params2','params3','params4','params5'];
const ZERO = Object.freeze([0,0,0,0]);

/** Legacy passes retain exactly their two uniform uploads. HSL owns six small
 * immutable tuples; native uniform upload borrows them without another recipe. */
export function bindVideoPreviewEffectParameters(gl: Pick<WebGL2RenderingContext,'uniform4fv'>,
	locations: Readonly<Record<Key,WebGLUniformLocation|null>>, pass: Readonly<Partial<Record<Key,readonly number[]>> & {code?:number}>): void {
	for(let index=0;index<(pass.code===HSL_MIXER_EFFECT_CODE_V1?6:2);index++){
		const key=KEYS[index]!;Reflect.apply(gl.uniform4fv,gl,[locations[key],pass[key]||ZERO]);
	}
}
