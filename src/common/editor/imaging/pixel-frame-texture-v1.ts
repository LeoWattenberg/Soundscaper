/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareTextureEffectV1, TEXTURE_BINOMIAL5_V1, textureLumaByteV1, textureAdjustmentV1 } from '../video-texture-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface TexturePixelFrameV1{readonly descriptor:Readonly<PixelFrameDescriptorV1>;readonly pixels:Uint8Array<ArrayBuffer>}
const CHECK=AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;

/** One snapshot and one scoped output. A coupled25-sample loop computes both
 * weighted means without a neighborhood/blur plane. This is explicit serial
 * process cost, not a qualified full-resolution latency or whole-heap bound. */
export async function withTexturePixelFrameV1<Result>(value:unknown,consume:(frame:TexturePixelFrameV1)=>Result|Promise<Result>,
	options:Readonly<{limits:PixelFrameLimitsV1}>):Promise<Result>{
	const input=record(value,'texture frame',['frame','effect','signal'],['frame','effect']);
	const option=record(options,'texture options',['limits']),limits=field(option,'limits','texture options');
	const signal=Object.hasOwn(input,'signal')?field(input,'signal','texture frame'):undefined,check=()=>{if(signal!==undefined)Reflect.apply(CHECK,signal,[]);};
	check();if(typeof consume!=='function')throw new TypeError('Texture requires a scoped consumer.');
	const effect=prepareTextureEffectV1(field(input,'effect','texture frame'));
	const raw=record(field(input,'frame','texture frame'),'texture source',['descriptor','pixels']);
	const plan=admitPixelFrameV1(field(raw,'descriptor','texture source'),{limits});
	const source=readPixelFrameV1({descriptor:plan.descriptor,pixels:field(raw,'pixels','texture source')},limits);
	const original=new Uint8Array(new Uint8Array(source.pixels.buffer,source.pixels.byteOffset,source.pixels.byteLength)),sourceBuffer=original.buffer;
	let outputBuffer:ArrayBuffer|undefined;
	try{
		const pixels=new Uint8Array(original);outputBuffer=pixels.buffer;
		if(effect.enabled&&!effect.neutral){
			const {width,height}=plan.descriptor;let processed=0;
			for(let y=0;y<height;y++)for(let x=0;x<width;x++){
				check();const offset=4*(y*width+x);
				if(original[offset+3]!==0){
					let weight3=0,sum3=0,weight5=0,sum5=0;
					for(let row=0;row<5;row++)for(let column=0;column<5;column++){
						const n=4*(Math.max(0,Math.min(height-1,y+row-2))*width+Math.max(0,Math.min(width-1,x+column-2)));
						const alpha=original[n+3]!,luma=textureLumaByteV1(original[n]!,original[n+1]!,original[n+2]!);
						const w5=alpha*TEXTURE_BINOMIAL5_V1[row]!*TEXTURE_BINOMIAL5_V1[column]!;weight5+=w5;sum5+=w5*luma;
						if(row>0&&row<4&&column>0&&column<4){const w3=alpha*(row===2?2:1)*(column===2?2:1);weight3+=w3;sum3+=w3*luma;}
					}
					const delta=textureAdjustmentV1(effect,textureLumaByteV1(original[offset]!,original[offset+1]!,original[offset+2]!),sum3,weight3,sum5,weight5);
					for(let c=0;c<3;c++)pixels[offset+c]=Math.max(0,Math.min(255,original[offset+c]!+delta));
				}
				processed+=4;if(processed>=256*1024){await new Promise<void>(resolve=>{setTimeout(resolve,0);});processed=0;check();}
			}
		}
		check();const result=await consume(Object.freeze({descriptor:plan.descriptor,pixels}));check();return result;
	}finally{wipe(sourceBuffer);if(outputBuffer)wipe(outputBuffer);}
}
function wipe(buffer:ArrayBuffer):void{if(Number(Reflect.apply(BUFFER_SIZE,buffer,[]))>0)new Uint8Array(buffer).fill(0);}
