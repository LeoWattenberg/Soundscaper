/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareDehazeEffectV1 } from './video-dehaze-v1.ts';
import { appendOriginalAlphaEffectFfmpegV1 } from './video-original-alpha-ffmpeg-v1.ts';

export interface CompiledDehazeOperationV1 { readonly kind: 'dehaze-v1'; readonly expression: string; readonly preserveAlpha: true }
const COMPILED = new WeakSet<object>();
export function isCompiledDehazeOperationV1(value: unknown): value is Readonly<CompiledDehazeOperationV1> {
	return typeof value === 'object' && value !== null && COMPILED.has(value);
}

/** Each RGB expression initializes its own dark/transmission registers.
 * GEQ double arithmetic represents every bounded integer exactly. */
export function serializeDehazeEffectToFfmpegV1(value: unknown): Readonly<CompiledDehazeOperationV1> | null {
	const prepared = prepareDehazeEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const point = (name: string,x: number,y: number) => `${name}(clip(X${x < 0 ? String(x) : `+${String(x)}`},0,W-1),clip(Y${y < 0 ? String(y) : `+${String(y)}`},0,H-1))`;
	const statements = ['st(0,255)'];
	if (prepared.gainQ8 > 0) {
		for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
			const dark = `min(min(${point('r',x,y)},${point('g',x,y)}),${point('b',x,y)})`,alpha = point('alpha',x,y);
			statements.push(`st(0,min(ld(0),floor((${dark}*${alpha}+255*(255-${alpha})+127)/255)))`);
		}
		statements.push(`st(1,max(26,256-floor(ld(0)*${String(prepared.gainQ8)}*243/65280)))`);
	}
	const expressions = ['r','g','b'].map(name => {
		const original = `${name}(X,Y)`,output = prepared.gainQ8 < 0 ? `${original}+floor(((255-${original})*${String(prepared.fogQ8)}+128)/256)` :
			`${statements.join(';')};clip(255+floor((2*(${original}-255)*256+ld(1))/(2*ld(1))),0,255)`;
		return `${name}='if(eq(alpha(X,Y),0),${original},${output})'`;
	});
	const operation = Object.freeze({ kind: 'dehaze-v1' as const,expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha: true as const });
	COMPILED.add(operation); return operation;
}

export function appendDehazeFfmpegOperationV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string; operation: unknown }>): void {
	const { operation } = context;
	if (!isCompiledDehazeOperationV1(operation)) throw new TypeError('Dehaze requires its owning compiled atmospheric operation.');
	appendOriginalAlphaEffectFfmpegV1({ ...context,operation });
}
