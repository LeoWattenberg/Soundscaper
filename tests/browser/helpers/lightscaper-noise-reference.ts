/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import type { VideoEffectProject } from '../../../src/common/editor/controller/clip-video/video-effect-service.ts';
import { normalizeNoiseReductionEffectV1 } from '../../../src/common/editor/video-noise-reduction-v1.ts';
import { createVideoEffect } from '../../../src/common/editor/video-effects.js';
import { VideoPreviewCompositor } from '../../../src/common/editor/ui/video-preview-compositor.js';
import { applyVideoPreviewEntryEffects } from '../../../src/common/editor/ui/video-preview-entry-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { cloneFramescaperProjectFinishing } from '../../../src/framescaper/editor-project-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../../src/framescaper/editor-domain-runtime-profile.ts';
import { createGlobalExportContextV1 } from '../../helpers/framescaper-global-export-fixture.ts';
import { CURVE_PNG_BASE64, CURVE_SOURCE } from './lightscaper-curve-reference.ts';

export const NOISE_PNG_BASE64=CURVE_PNG_BASE64;
export const NOISE_SOURCE=CURVE_SOURCE;
export const NOISE_PARAMS=Object.freeze({luminance:37.125,luminanceDetail:1.5,luminanceContrast:50,color:72.25,colorDetail:3.125,colorSmoothness:50});
/** Independent pinned two-row result. Neither browser execution nor the CPU
 * owner computes this golden; a separate BigInt specification qualifies it. */
export const NOISE_PIXELS=Object.freeze([15,45,70,255,79,129,169,255,126,131,119,255,226,207,48,255]);
export const NOISE_BINS=Object.freeze({red:pairs([[15,1],[79,1],[126,1],[226,1]]),green:pairs([[45,1],[129,1],[131,1],[207,1]]),blue:pairs([[48,1],[70,1],[119,1],[169,1]])});
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
export async function qualifyNoiseNativeV1(value:unknown){
	const input=record(value,'native noise',['source','height','params','mode']);
	const source=readClosedDomainArray(field(input,'source','native noise'),'native noise bytes',4,1024);
	if(source.length%4||source.some(n=>typeof n!=='number'||!Number.isInteger(n)||n<0||n>255))throw new TypeError('Native noise requires bounded RGBA bytes.');
	const height=field(input,'height','native noise'),mode=field(input,'mode','native noise');
	if(typeof height!=='number'||!Number.isSafeInteger(height)||height<1||height>256||source.length%(4*height))throw new RangeError('Native noise height refuses.');
	if(mode!=='target'&&mode!=='frame'&&mode!=='cancel'&&mode!=='fault')throw new RangeError('Native noise mode refuses.');
	const noise=normalizeNoiseReductionEffectV1({id:'native-noise',type:'noise-reduction-v1',enabled:true,params:field(input,'params','native noise')});
	const nativeRead=WebGL2RenderingContext.prototype.readPixels;
	const pixels=new Uint8Array(source as number[]),before=[...pixels],width=pixels.length/(4*height),stop=new AbortController();
	let reads=0,traps=0,abandoned:Uint8Array|null=null;
	const receivers=new Set<WebGL2RenderingContext>(),reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	let cpu:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined,output:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined;
	try{
		const context=createGlobalExportContextV1([noise],width,height),persisted=cloneFramescaperProjectFinishing(PROFILE,context.project)as unknown as VideoEffectProject;
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
		compositor.resizeToDisplaySize({outputWidth:width,outputHeight:height});const noiseProgramLinked=gl.getProgramParameter(compositor.programs[30],gl.LINK_STATUS)===true;
		texture=gl.createTexture();if(!texture)throw Error('Native noise texture unavailable.');gl.bindTexture(gl.TEXTURE_2D,texture);
		for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.NEAREST);
		for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
		gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
		const passes=compositor.passesForEffects(effects,{x:1,y:1}),entry=applyVideoPreviewEntryEffects(compositor,texture,passes,{x:0,y:0,width,height},undefined,'native-noise')as Target;
		output=new Uint8Array(pixels.length);gl.bindFramebuffer(gl.FRAMEBUFFER,entry.framebuffer);gl.finish();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,output);
		return{pixels:[...output],noiseProgramLinked,glError:gl.getError(),passCodes:passes.map(pass=>Object.getOwnPropertyDescriptor(pass,'code')?.value as unknown)};
	}finally{output?.fill(0);if(texture)gl.deleteTexture(texture);compositor.dispose();canvas.remove();}
}
