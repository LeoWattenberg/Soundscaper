/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareGrainEffectV1, grainNoiseV1, grainOffsetV1 } from '../video-grain-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface GrainPixelFrameV1{readonly descriptor:Readonly<PixelFrameDescriptorV1>;readonly pixels:Uint8Array<ArrayBuffer>}
const CHECK=AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;

/** One detached scoped output, no per-frame noise plane or retained table.
 * Original RGB is captured before adding the shared offset; hidden RGB is
 * retained for alpha0. The current admitted descriptor defines Size units. */
export async function withGrainPixelFrameV1<Result>(value:unknown,consume:(frame:GrainPixelFrameV1)=>Result|Promise<Result>,
	options:Readonly<{limits:PixelFrameLimitsV1}>):Promise<Result>{
	const input=record(value,'grain frame',['frame','effect','signal'],['frame','effect']);
	const option=record(options,'grain options',['limits']),limits=field(option,'limits','grain options');
	const signal=Object.hasOwn(input,'signal')?field(input,'signal','grain frame'):undefined,check=()=>{if(signal!==undefined)Reflect.apply(CHECK,signal,[]);};
	check();if(typeof consume!=='function')throw new TypeError('Grain requires a scoped consumer.');
	const effect=prepareGrainEffectV1(field(input,'effect','grain frame'));
	const raw=record(field(input,'frame','grain frame'),'grain source',['descriptor','pixels']);
	const plan=admitPixelFrameV1(field(raw,'descriptor','grain source'),{limits});
	const source=readPixelFrameV1({descriptor:plan.descriptor,pixels:field(raw,'pixels','grain source')},limits);
	const pixels=new Uint8Array(new Uint8Array(source.pixels.buffer,source.pixels.byteOffset,source.pixels.byteLength)),buffer=pixels.buffer;
	try{
		if(effect.enabled&&!effect.neutral){
			const {width,height}=plan.descriptor;let processed=0;
			for(let y=0;y<height;y++)for(let x=0;x<width;x++){
				check();const offset=4*(y*width+x);
				if(pixels[offset+3]!==0){
					const red=pixels[offset]!,green=pixels[offset+1]!,blue=pixels[offset+2]!,delta=grainOffsetV1(effect,red,green,blue,grainNoiseV1(effect,x,y));
					pixels[offset]=Math.max(0,Math.min(255,red+delta));pixels[offset+1]=Math.max(0,Math.min(255,green+delta));pixels[offset+2]=Math.max(0,Math.min(255,blue+delta));
				}
				processed+=4;if(processed>=256*1024){await new Promise<void>(resolve=>{setTimeout(resolve,0);});processed=0;check();}
			}
		}
		check();const result=await consume(Object.freeze({descriptor:plan.descriptor,pixels}));check();return result;
	}finally{if(Number(Reflect.apply(BUFFER_SIZE,buffer,[]))>0)new Uint8Array(buffer).fill(0);}
}
