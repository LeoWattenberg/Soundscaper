/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import type { VideoEffectProject } from '../../../src/common/editor/controller/clip-video/video-effect-service.ts';
import { normalizeDehazeEffectV1 } from '../../../src/common/editor/video-dehaze-v1.ts';
import { createVideoEffect } from '../../../src/common/editor/video-effects.js';
import { VideoPreviewCompositor } from '../../../src/common/editor/ui/video-preview-compositor.js';
import { applyVideoPreviewEntryEffects } from '../../../src/common/editor/ui/video-preview-entry-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { cloneFramescaperProjectFinishing } from '../../../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-domain-runtime-profile.ts';
import { createGlobalExportContextV1 } from '../../helpers/framescaper-global-export-fixture.ts';
// Literal 2x2 opaque hazy PNG; the host reference independently checks CRC,
// inflate, source bytes and the fractional37.125 process golden.
export const DEHAZE_PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAG0lEQVR4nGNwSGj437DgwH+GBQsW/H9wIOE/AFmUCt0jypWqAAAAAElFTkSuQmCC';
export const DEHAZE_SOURCE=Object.freeze([64,96,128,255,128,160,192,255,160,160,160,255,224,192,96,255]);
export const DEHAZE_PARAMS=Object.freeze({amount:37.125});
/** Independent pinned two-row result. Neither browser execution nor the CPU
 * owner computes this golden; a separate BigInt specification qualifies it. */
export const DEHAZE_PIXELS=Object.freeze([46,81,116,255,116,151,186,255,151,151,151,255,221,186,81,255]);
export const DEHAZE_BINS=Object.freeze({red:pairs([[46,1],[116,1],[151,1],[221,1]]),green:pairs([[81,1],[151,2],[186,1]]),blue:pairs([[81,1],[116,1],[151,1],[186,1]])});
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
export async function qualifyDehazeNativeV1(value:unknown){
	const input=record(value,'native dehaze',['source','height','params','mode']);
	const source=readClosedDomainArray(field(input,'source','native dehaze'),'native dehaze bytes',4,1024);
	if(source.length%4||source.some(n=>typeof n!=='number'||!Number.isInteger(n)||n<0||n>255))throw new TypeError('Native dehaze requires bounded RGBA bytes.');
	const height=field(input,'height','native dehaze'),mode=field(input,'mode','native dehaze');
	if(typeof height!=='number'||!Number.isSafeInteger(height)||height<1||height>256||source.length%(4*height))throw new RangeError('Native dehaze height refuses.');
	if(mode!=='target'&&mode!=='frame'&&mode!=='cancel'&&mode!=='fault')throw new RangeError('Native dehaze mode refuses.');
	const dehaze=normalizeDehazeEffectV1({id:'native-dehaze',type:'dehaze-v1',enabled:true,params:field(input,'params','native dehaze')});
	const nativeRead=WebGL2RenderingContext.prototype.readPixels;
	const pixels=new Uint8Array(source as number[]),before=[...pixels],width=pixels.length/(4*height),stop=new AbortController();
	let reads=0,traps=0,abandoned:Uint8Array|null=null;
	const receivers=new Set<WebGL2RenderingContext>(),reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	let cpu:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined,output:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined;
	try{
		const context=createGlobalExportContextV1([dehaze],width,height),persisted=cloneFramescaperProjectFinishing(PROFILE,context.project)as unknown as VideoEffectProject;
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
		compositor.resizeToDisplaySize({outputWidth:width,outputHeight:height});const dehazeProgramLinked=gl.getProgramParameter(compositor.programs[33],gl.LINK_STATUS)===true;
		texture=gl.createTexture();if(!texture)throw Error('Native dehaze texture unavailable.');gl.bindTexture(gl.TEXTURE_2D,texture);
		for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.NEAREST);
		for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
		gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
		const passes=compositor.passesForEffects(effects,{x:1,y:1}),entry=applyVideoPreviewEntryEffects(compositor,texture,passes,{x:0,y:0,width,height},undefined,'native-dehaze')as Target;
		output=new Uint8Array(pixels.length);gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer);gl.finish();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,output);
		return{pixels:[...output],dehazeProgramLinked,glError:gl.getError(),passCodes:passes.map(pass=>Object.getOwnPropertyDescriptor(pass,'code')?.value as unknown)};
	}finally{output?.fill(0);if(texture)gl.deleteTexture(texture);compositor.dispose();canvas.remove();}
}
