/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import type { VideoEffectProject } from '../../../src/common/editor/controller/clip-video/video-effect-service.ts';
import { normalizeTextureEffectV1 } from '../../../src/common/editor/video-texture-v1.ts';
import { createVideoEffect } from '../../../src/common/editor/video-effects.js';
import { VideoPreviewCompositor } from '../../../src/common/editor/ui/video-preview-compositor.js';
import { applyVideoPreviewEntryEffects } from '../../../src/common/editor/ui/video-preview-entry-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { cloneFramescaperProjectFinishing } from '../../../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-domain-runtime-profile.ts';
import { createGlobalExportContextV1 } from '../../helpers/framescaper-global-export-fixture.ts';
import { CURVE_PNG_BASE64, CURVE_SOURCE } from './lightscaper-curve-reference.ts';

export const TEXTURE_PNG_BASE64=CURVE_PNG_BASE64;
export const TEXTURE_SOURCE=CURVE_SOURCE;
export const TEXTURE_PARAMS=Object.freeze({amount:73.25});
/** Independent pinned two-row result. Neither browser execution nor the CPU
 * owner computes this golden; a separate BigInt specification qualifies it. */
export const TEXTURE_PIXELS=Object.freeze([0,31,63,255,64,128,192,255,129,129,129,255,255,225,17,255]);
export const TEXTURE_BINS=Object.freeze({red:pairs([[0,1],[64,1],[129,1],[255,1]]),green:pairs([[31,1],[128,1],[129,1],[225,1]]),blue:pairs([[17,1],[63,1],[129,1],[192,1]])});
function pairs(rows:readonly(readonly[number,number])[]){return Object.freeze(rows.map(row=>Object.freeze([row[0],row[1]]as const)));}

interface Target{readonly framebuffer:WebGLFramebuffer}
interface Compositor{
	readonly gl:WebGL2RenderingContext;readonly programs:readonly WebGLProgram[];
	resizeToDisplaySize(options:Readonly<{outputWidth:number;outputHeight:number}>):void;
	passesForEffects(effects:readonly unknown[],scale:Readonly<{x:number;y:number}>):readonly unknown[];
	dispose():void;
}

/** Actual persisted Frame model, maintained entry-effect target and native GL
 * readback. No renderer substitute, forced capability or pixel projection. */
export async function qualifyTextureNativeV1(value:unknown){
	const input=record(value,'native texture',['source','height','params','mode']);
	const source=readClosedDomainArray(field(input,'source','native texture'),'native texture bytes',4,1024);
	if(source.length%4||source.some(n=>typeof n!=='number'||!Number.isInteger(n)||n<0||n>255))throw new TypeError('Native texture requires bounded RGBA bytes.');
	const height=field(input,'height','native texture'),mode=field(input,'mode','native texture');
	if(typeof height!=='number'||!Number.isSafeInteger(height)||height<1||height>256||source.length%(4*height))throw new RangeError('Native texture height refuses.');
	if(mode!=='target'&&mode!=='frame'&&mode!=='cancel'&&mode!=='fault')throw new RangeError('Native texture mode refuses.');
	const texture=normalizeTextureEffectV1({id:'native-texture',type:'texture-v1',enabled:true,params:field(input,'params','native texture')});
	const nativeRead=WebGL2RenderingContext.prototype.readPixels;
	const pixels=new Uint8Array(source as number[]),before=[...pixels],width=pixels.length/(4*height),stop=new AbortController();
	let reads=0,traps=0,abandoned:Uint8Array|null=null;
	const receivers=new Set<WebGL2RenderingContext>(),reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	let cpu:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined,output:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined;
	try{
		const context=createGlobalExportContextV1([texture],width,height),persisted=cloneFramescaperProjectFinishing(PROFILE,context.project)as unknown as VideoEffectProject;
		const effects=persisted.clips.find(clip=>clip.id==='video-clip')!.videoEffects!;
		cpu=await applyVideoExactBrowserEffectsFinishing({width,height,pixels},effects,stop.signal);const cpuPixels=[...cpu.pixels];cpu.pixels.fill(0);cpu=undefined;
		WebGL2RenderingContext.prototype.readPixels=function(this:WebGL2RenderingContext,...args:unknown[]){
			reads++;receivers.add(this);Reflect.apply(nativeRead,this,args);
			if(mode==='cancel'||mode==='fault'){abandoned=args[6]as Uint8Array;if(mode==='fault')throw reason;stop.abort(reason);}
		};
		if(mode==='frame'||mode==='cancel'){
			const mixed=[...effects,createVideoEffect('color-adjust',{id:'legacy-neutral'})];
			try{output=await applyVideoExactBrowserEffectsFinishing({width,height,pixels},mixed,stop.signal);
				return{pixels:[...output.pixels],cpuPixels,source:[...pixels],before,authoredTypes:mixed.map(effect=>effect.type),nativeReadbacks:reads,
					nativeWebgl2:receivers.size>0&&[...receivers].every(receiver=>receiver instanceof WebGL2RenderingContext)};
			}catch(error){if(mode!=='cancel'||error!==reason)throw error;
				return{rejectedWithReason:true,abandonedOutputZero:(abandoned as Uint8Array|null)?.every(n=>n===0)===true,reasonTraps:traps,
					source:[...pixels],before,nativeReadbacks:reads,nativeWebgl2:receivers.size>0&&[...receivers].every(receiver=>receiver instanceof WebGL2RenderingContext)};
			}
		}
		const result=target(pixels,width,height,effects);
		return{...result,cpuPixels,source:[...pixels],before,authoredTypes:effects.map(effect=>effect.type),nativeReadbacks:reads,
			nativeWebgl2:receivers.size>0&&[...receivers].every(receiver=>receiver instanceof WebGL2RenderingContext)};
	}catch(error){if(mode!=='fault'||error!==reason)throw error;
		return{rejectedWithReason:true,abandonedOutputZero:(abandoned as Uint8Array|null)?.every(n=>n===0)===true,reasonTraps:traps,
			source:[...pixels],before,nativeReadbacks:reads,nativeWebgl2:receivers.size>0&&[...receivers].every(receiver=>receiver instanceof WebGL2RenderingContext)};
	}finally{WebGL2RenderingContext.prototype.readPixels=nativeRead;cpu?.pixels.fill(0);output?.pixels.fill(0);pixels.fill(0);}
}

function target(pixels:Uint8Array<ArrayBuffer>,width:number,height:number,effects:readonly unknown[]){
	const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
	const compositor=new VideoPreviewCompositor(canvas)as unknown as Compositor,gl=compositor.gl;let texture:WebGLTexture|null=null,output:Uint8Array|undefined;
	try{
		compositor.resizeToDisplaySize({outputWidth:width,outputHeight:height});const textureProgramLinked=gl.getProgramParameter(compositor.programs[32],gl.LINK_STATUS)===true;
		texture=gl.createTexture();if(!texture)throw Error('Native texture texture unavailable.');gl.bindTexture(gl.TEXTURE_2D,texture);
		for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.NEAREST);
		for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
		gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
		const passes=compositor.passesForEffects(effects,{x:1,y:1}),entry=applyVideoPreviewEntryEffects(compositor,texture,passes,{x:0,y:0,width,height},undefined,'native-texture')as Target;
		output=new Uint8Array(pixels.length);gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer);gl.finish();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,output);
		return{pixels:[...output],textureProgramLinked,glError:gl.getError(),passCodes:passes.map(pass=>Object.getOwnPropertyDescriptor(pass,'code')?.value as unknown)};
	}finally{output?.fill(0);if(texture)gl.deleteTexture(texture);compositor.dispose();canvas.remove();}
}

/** Independent two-neighborhood BigInt specification. Recipe preparation uses
 * exactly JavaScript Math.round(amount*256/100), including its negative ties. */
export function textureReferenceV1(source:readonly number[],width:number,amount:number):number[]{
 const height=source.length/(4*width),gain=BigInt(Math.round(amount*256/100));
 const luma=(n:number)=>(54n*BigInt(source[n]!)+183n*BigInt(source[n+1]!)+19n*BigInt(source[n+2]!)+128n)/256n;
 return source.map((byte,offset)=>{
  const channel=offset%4,pixel=Math.floor(offset/4);if(channel===3||source[pixel*4+3]===0)return byte;
  const x=pixel%width,y=Math.floor(pixel/width),mean=(bins:readonly bigint[])=>{
   let sum=0n,weight=0n;const radius=Math.floor(bins.length/2);
   for(let row=0;row<bins.length;row++)for(let column=0;column<bins.length;column++){
    const n=4*(Math.min(height-1,Math.max(0,y+row-radius))*width+Math.min(width-1,Math.max(0,x+column-radius)));
    const w=bins[row]!*bins[column]!*BigInt(source[n+3]!);weight+=w;sum+=w*luma(n);
   }return(2n*sum+weight)/(2n*weight);
  };
  const fine=mean([1n,2n,1n]),coarse=mean([1n,4n,6n,4n,1n]),difference=luma(pixel*4)-coarse;
  const response=256n-4n*(difference<0n?-difference:difference),gate=response<0n?0n:response;
  const n=(fine-coarse)*gain*gate+32768n,delta=n<0n?-((-n+65535n)/65536n):n/65536n;
  const result=BigInt(byte)+delta;return Number(result<0n?0n:result>255n?255n:result);
 });
}
