/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareNoiseReductionEffectV1 } from './video-noise-reduction-v1.ts';
import { appendOriginalAlphaEffectFfmpegV1 } from './video-original-alpha-ffmpeg-v1.ts';

export interface CompiledNoiseReductionOperationV1 { readonly kind: 'noise-reduction-v1'; readonly expression: string; readonly preserveAlpha: true }
const COMPILED = new WeakSet<object>();
export function isCompiledNoiseReductionOperationV1(value: unknown): value is Readonly<CompiledNoiseReductionOperationV1> {
	return typeof value === 'object' && value !== null && COMPILED.has(value);
}

/** GEQ double arithmetic evaluates the same bounded integers as CPU/GLSL.
 * Each output component owns all ten scalar registers; no shared cache/planes. */
export function serializeNoiseReductionEffectToFfmpegV1(value: unknown): Readonly<CompiledNoiseReductionOperationV1> | null {
	const prepared = prepareNoiseReductionEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const statements = ["st(1,r(X,Y)-b(X,Y))", "st(2,g(X,Y)-(b(X,Y)+floor(ld(1)/2)))", "st(0,b(X,Y)+floor(ld(1)/2)+floor(ld(2)/2))"];
	const point = (name: string, x: number, y: number) => `${name}(clip(X${x < 0 ? String(x) : `+${String(x)}`},0,W-1),clip(Y${y < 0 ? String(y) : `+${String(y)}`},0,H-1))`;
	if (prepared.luminanceQ8 !== 0) {
		statements.push('st(3,0)', 'st(4,0)', 'st(5,ld(0))', 'st(6,ld(0))');
		for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
			const r = point('r', x, y), g = point('g', x, y), b = point('b', x, y), t = `(${b}+floor((${r}-${b})/2))`;
			const spatial = (x === 0 ? 2 : 1) * (y === 0 ? 2 : 1);
			statements.push(`st(9,${point('alpha', x, y)})`, `st(8,${t}+floor((${g}-${t})/2))`,
				`st(7,${String(spatial)}*ld(9)*max(0,16-floor(abs(ld(8)-ld(0))*${String(prepared.luminanceDetailQ8)}/256)))`,
				'st(3,ld(3)+ld(7)*ld(8))', 'st(4,ld(4)+ld(7))', 'st(5,if(gt(ld(9),0),min(ld(5),ld(8)),ld(5)))', 'st(6,if(gt(ld(9),0),max(ld(6),ld(8)),ld(6)))');
		}
		const mean = 'floor((2*ld(3)+ld(4))/(2*max(ld(4),1)))';
		const protection = `floor((${String(prepared.luminanceContrastQ8)}*(ld(6)-ld(5))+127)/255)`;
		const strength = `floor((${String(prepared.luminanceQ8)}*(256-${protection})+128)/256)`;
		statements.push(`st(0,ld(0)+floor(((${mean}-ld(0))*${strength}+128)/256))`);
	}
	if (prepared.colorQ8 !== 0) {
		statements.push('st(3,0)', 'st(4,0)', 'st(5,0)'); const binomial = [1,4,6,4,1] as const;
		for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
			const inner = Math.abs(x) <= 1 && Math.abs(y) <= 1 ? (x === 0 ? 2 : 1) * (y === 0 ? 2 : 1) : 0;
			const spatial = Math.floor((inner * 16 * (256 - prepared.colorSmoothnessQ8) + binomial[x + 2]! * binomial[y + 2]! * prepared.colorSmoothnessQ8 + 128) / 256);
			if (spatial === 0) continue;
			const r = point('r', x, y), g = point('g', x, y), b = point('b', x, y);
			statements.push(`st(6,${r}-${b})`, `st(7,${g}-(${b}+floor(ld(6)/2)))`, `st(8,${point('alpha', x, y)})`,
				`st(9,${String(spatial)}*ld(8)*max(0,16-floor(max(abs(ld(6)-ld(1)),abs(ld(7)-ld(2)))*${String(prepared.colorDetailQ8)}/256)))`,
				'st(3,ld(3)+ld(9)*ld(6))', 'st(4,ld(4)+ld(9)*ld(7))', 'st(5,ld(5)+ld(9))');
		}
		const blend = (sum: number, original: number) => `st(${String(original)},ld(${String(original)})+floor((floor((2*ld(${String(sum)})+ld(5))/(2*max(ld(5),1)))-ld(${String(original)}))*${String(prepared.colorQ8)}/256+0.5))`;
		statements.push(blend(3, 1), blend(4, 2));
	}
	const t = '(ld(0)-floor(ld(2)/2))', blue = `(${t}-floor(ld(1)/2))`;
	const expressions = [blue + '+ld(1)', t + '+ld(2)', blue].map((channel, index) =>
		`${['r','g','b'][index]}='if(eq(alpha(X,Y),0),${['r','g','b'][index]}(X,Y),${statements.join(';')};clip(${channel},0,255))'`);
	const operation = Object.freeze({ kind: 'noise-reduction-v1' as const, expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true as const });
	COMPILED.add(operation); return operation;
}

/** Transport untouched original alpha into the neighborhood and final output. */
export function appendNoiseReductionFfmpegOperationV1(context: Readonly<{ filters: string[]; inputLabel: string; outputLabel: string;
	operation: unknown }>): void {
	const { operation } = context;
	if (!isCompiledNoiseReductionOperationV1(operation)) throw new TypeError('Noise reduction requires its owning compiled neighborhood operation.');
	appendOriginalAlphaEffectFfmpegV1({ ...context, operation });
}
