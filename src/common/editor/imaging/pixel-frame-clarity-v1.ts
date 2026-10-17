/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { CLARITY_BINOMIAL_V1, clarityLumaByteV1, clarityAdjustmentV1, prepareClarityEffectV1 } from '../video-clarity-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface ClarityPixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One immutable source snapshot plus one scoped output; no per-effect table
 * or full-frame neighborhood backing.49 reads/pixel is an explicit process
 * cost, not a qualified full-resolution latency promise. */
export async function withClarityPixelFrameV1<Result>(value: unknown,
	consume: (frame: ClarityPixelFrameV1) => Result | Promise<Result>, options: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'clarity frame', ['frame','effect','signal'], ['frame','effect']);
	const option = record(options, 'clarity options', ['limits']), limits = field(option, 'limits', 'clarity options');
	const signal = Object.hasOwn(input,'signal') ? field(input,'signal','clarity frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK,signal,[]); };
	check(); if (typeof consume !== 'function') throw new TypeError('Clarity requires a scoped consumer.');
	const effect = prepareClarityEffectV1(field(input,'effect','clarity frame'));
	const raw = record(field(input,'frame','clarity frame'),'clarity source',['descriptor','pixels']);
	const plan = admitPixelFrameV1(field(raw,'descriptor','clarity source'), { limits });
	const source = readPixelFrameV1({ descriptor:plan.descriptor,pixels:field(raw,'pixels','clarity source') },limits);
	const original = new Uint8Array(new Uint8Array(source.pixels.buffer,source.pixels.byteOffset,source.pixels.byteLength));
	const sourceBuffer = original.buffer; let outputBuffer: ArrayBuffer | undefined;
	try {
		const pixels = new Uint8Array(original); outputBuffer = pixels.buffer;
		if (effect.enabled && !effect.neutral) {
			const { width,height } = plan.descriptor; let processed = 0;
			for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
				check(); const offset=4*(y*width+x);
				if (original[offset+3]!==0) {
					let weight=0,sum=0;
					for(let row=0;row<7;row++)for(let column=0;column<7;column++) {
						const n=4*(Math.max(0,Math.min(height-1,y+row-3))*width+Math.max(0,Math.min(width-1,x+column-3)));
						const w=original[n+3]!*CLARITY_BINOMIAL_V1[row]!*CLARITY_BINOMIAL_V1[column]!;
						weight+=w;sum+=w*clarityLumaByteV1(original[n]!,original[n+1]!,original[n+2]!);
					}
					const adjustment=clarityAdjustmentV1(effect,clarityLumaByteV1(original[offset]!,original[offset+1]!,original[offset+2]!),sum,weight);
					for(let channel=0;channel<3;channel++) pixels[offset+channel]=Math.max(0,Math.min(255,original[offset+channel]!+adjustment));
				}
				processed+=4;
				if(processed>=256*1024){await new Promise<void>(resolve=>{setTimeout(resolve,0);});processed=0;check();}
			}
		}
		check();const result=await consume(Object.freeze({descriptor:plan.descriptor,pixels}));check();return result;
	}finally{wipe(sourceBuffer);if(outputBuffer)wipe(outputBuffer);}
}

function wipe(buffer: ArrayBuffer): void { if(Number(Reflect.apply(BUFFER_SIZE,buffer,[]))>0)new Uint8Array(buffer).fill(0); }
