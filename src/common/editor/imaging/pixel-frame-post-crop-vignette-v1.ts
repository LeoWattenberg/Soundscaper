/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { preparePostCropVignetteEffectV1, postCropVignetteWeightV1, postCropVignetteByteV1 } from '../video-post-crop-vignette-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface PostCropVignettePixelFrameV1 { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly pixels: Uint8Array<ArrayBuffer> }
const CHECK=AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;

/** One detached scoped RGBA output; no spatial mask or lookup table. Shape
 * uses the admitted current natural descriptor, never a pre-crop original.
 * All original channels are read before the in-place pixel mix begins. */
export async function withPostCropVignettePixelFrameV1<Result>(value: unknown,
	consume:(view:PostCropVignettePixelFrameV1)=>Result|Promise<Result>,options:Readonly<{limits:PixelFrameLimitsV1}>):Promise<Result> {
	const input=record(value,'post-crop vignette frame',['frame','effect','signal'],['frame','effect']);
	const option=record(options,'post-crop vignette options',['limits']),limits=field(option,'limits','post-crop vignette options');
	const signal=Object.hasOwn(input,'signal')?field(input,'signal','post-crop vignette frame'):undefined;
	const check=()=>{if(signal!==undefined)Reflect.apply(CHECK,signal,[]);};
	check();if(typeof consume!=='function')throw new TypeError('Post-crop vignette requires a scoped consumer.');
	const effect=preparePostCropVignetteEffectV1(field(input,'effect','post-crop vignette frame'));
	const raw=record(field(input,'frame','post-crop vignette frame'),'post-crop vignette source',['descriptor','pixels']);
	const plan=admitPixelFrameV1(field(raw,'descriptor','post-crop vignette source'),{limits});
	const source=readPixelFrameV1({descriptor:plan.descriptor,pixels:field(raw,'pixels','post-crop vignette source')},limits);
	const pixels=new Uint8Array(new Uint8Array(source.pixels.buffer,source.pixels.byteOffset,source.pixels.byteLength)),buffer=pixels.buffer;
	try {
		if(effect.enabled&&!effect.neutral) {
			const {width,height}=plan.descriptor;let processed=0;
			for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
				check();const offset=4*(y*width+x);
				if(pixels[offset+3]!==0) {
					const red=pixels[offset]!,green=pixels[offset+1]!,blue=pixels[offset+2]!,maximum=Math.max(red,green,blue);
					const weight=postCropVignetteWeightV1(effect,width,height,x,y);
					pixels[offset]=postCropVignetteByteV1(effect,red,maximum,weight);
					pixels[offset+1]=postCropVignetteByteV1(effect,green,maximum,weight);
					pixels[offset+2]=postCropVignetteByteV1(effect,blue,maximum,weight);
				}
				processed+=4;if(processed>=256*1024){await new Promise<void>(resolve=>{setTimeout(resolve,0);});processed=0;check();}
			}
		}
		check();const result=await consume(Object.freeze({descriptor:plan.descriptor,pixels}));check();return result;
	} finally { if(Number(Reflect.apply(BUFFER_SIZE,buffer,[]))>0)new Uint8Array(buffer).fill(0); }
}
