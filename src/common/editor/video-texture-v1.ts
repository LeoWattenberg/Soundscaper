/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** Encoded straight UNORM8 sRGB. Separately rounded alpha-weighted three/five
 * binomial luma means isolate medium-frequency structure. One signed RGB
 * offset leaves channel differences unchanged until clipping; a coarse-edge
 * gate protects strong boundaries. Alpha-zero centers keep hidden RGB. */
export const TEXTURE_PROCESS_V1='srgb-alpha-binomial3-5-luma-texture-q8-v1';
export const TEXTURE_EFFECT_TYPE_V1='texture-v1';
export const TEXTURE_EFFECT_CODE_V1=32;
export const TEXTURE_BINOMIAL3_V1=Object.freeze([1,2,1]as const);
export const TEXTURE_BINOMIAL5_V1=Object.freeze([1,4,6,4,1]as const);
export const TEXTURE_VIDEO_EFFECT_DEFINITION_V1=Object.freeze({type:TEXTURE_EFFECT_TYPE_V1,label:'Texture',labelKey:'videoEffectTexture',
	shader:TEXTURE_EFFECT_TYPE_V1,ffmpegFilter:TEXTURE_PROCESS_V1,params:Object.freeze({amount:Object.freeze({label:'Amount',labelKey:'videoEffectTextureAmount',
		default:0,min:-100,max:100,step:1,integer:false,control:'number'})})});

export function normalizeTextureParamsV1(value:unknown):Readonly<{amount:number}>{
	const input=record(value===undefined?{}:value,'texture parameters',['amount'],[]),amount=Object.hasOwn(input,'amount')?field(input,'amount','texture parameters'):0;
	if(typeof amount!=='number'||!Number.isFinite(amount)||amount<-100||amount>100)throw new RangeError('Texture amount requires -100 through 100.');
	return Object.freeze({amount:Object.is(amount,-0)?0:amount});
}
export function normalizeTextureEffectV1(value:unknown){
	const input=record(value,'texture effect',['id','type','enabled','params']),id=field(input,'id','texture effect'),type=field(input,'type','texture effect'),enabled=field(input,'enabled','texture effect');
	if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Texture requires a bounded effect ID.');
	if(type!==TEXTURE_EFFECT_TYPE_V1)throw new RangeError('Unsupported texture process.');
	if(typeof enabled!=='boolean')throw new TypeError('Texture enabled must be boolean.');
	const params=field(input,'params','texture effect');if(params===undefined)throw new TypeError('Texture requires parameters.');
	return Object.freeze({id,type,enabled,params:normalizeTextureParamsV1(params)});
}
/** Complete closed semantic admission precedes the private stable-ID factory. */
export function createTextureEffectV1(value:unknown,createId:()=>string){
	const input=record(value,'texture creation',['id','type','enabled','params','index'],[]);
	const take=(key:string)=>Object.hasOwn(input,key)?field(input,key,'texture creation'):undefined;
	const id=take('id'),type=take('type'),enabled=Object.hasOwn(input,'enabled')?take('enabled'):true,index=take('index');
	if(Object.hasOwn(input,'id')&&(typeof id!=='string'||!id.length||id.length>128))throw new TypeError('Invalid texture effect ID.');
	if(Object.hasOwn(input,'type')&&type!==TEXTURE_EFFECT_TYPE_V1)throw new RangeError('Invalid texture effect type.');
	if(typeof enabled!=='boolean')throw new TypeError('Texture enabled must be boolean.');
	if(index!==undefined&&(typeof index!=='number'||!Number.isSafeInteger(index)||index<0||index>100000))throw new RangeError('Invalid texture insertion index.');
	const params=normalizeTextureParamsV1(take('params'));if(typeof createId!=='function')throw new TypeError('Texture requires its private ID factory.');
	const result=normalizeTextureEffectV1({id:id??createId(),type:TEXTURE_EFFECT_TYPE_V1,enabled,params});return {...result,params:{...result.params}};
}

export interface PreparedTextureEffectV1{readonly type:typeof TEXTURE_EFFECT_TYPE_V1;readonly enabled:boolean;readonly neutral:boolean;readonly gainQ8:number}
const PREPARED=new WeakSet<object>();
export function prepareTextureEffectV1(value:unknown):Readonly<PreparedTextureEffectV1>{
	const {type,enabled,params}=normalizeTextureEffectV1(value),gain=Math.round(params.amount*256/100),gainQ8=Object.is(gain,-0)?0:gain;
	const prepared=Object.freeze({type,enabled,neutral:gainQ8===0,gainQ8});PREPARED.add(prepared);return prepared;
}
export function textureLumaByteV1(red:number,green:number,blue:number):number{return Math.floor((54*red+183*green+19*blue+128)/256);}
/** Coarse weight<=65280,sum<=16646400; rounded numerator<=33358080.
 * Fine numerator<=2084880. Signed gain numerator<=16744448, below2^24.
 * Both means round BEFORE subtraction; signed half ties go toward +infinity. */
export function textureAdjustmentV1(p:PreparedTextureEffectV1,luma:number,sum3:number,weight3:number,sum5:number,weight5:number):number{
	if(!PREPARED.has(p))throw new TypeError('An owning prepared texture effect is required.');
	if(!p.enabled||p.neutral||weight3===0||weight5===0)return 0;
	const fine=Math.floor((2*sum3+weight3)/(2*weight3)),coarse=Math.floor((2*sum5+weight5)/(2*weight5));
	const gate=Math.max(0,256-4*Math.abs(luma-coarse));return Math.floor(((fine-coarse)*p.gainQ8*gate+32768)/65536);
}
export function texturePreviewPassV1(value:unknown){
	const p=prepareTextureEffectV1(value);if(!p.enabled||p.neutral)return null;
	return Object.freeze({code:TEXTURE_EFFECT_CODE_V1,params0:Object.freeze([p.gainQ8,0,0,0]as const),params1:Object.freeze([0,0,0,0]as const),direction:Object.freeze([0,0]as const)});
}

export interface TextureFfmpegOperationV1{readonly kind:'texture-v1';readonly expression:string;readonly preserveAlpha:true}
const OPERATIONS=new WeakSet<object>();
export function serializeTextureEffectToFfmpegV1(value:unknown):Readonly<TextureFfmpegOperationV1>|null{
	const p=prepareTextureEffectV1(value);if(!p.enabled||p.neutral)return null;
	const point=(name:string,x:number,y:number)=>`${name}(clip(X${x<0?String(x):`+${String(x)}`},0,W-1),clip(Y${y<0?String(y):`+${String(y)}`},0,H-1))`;
	const luma=(x:number,y:number)=>`floor((54*${point('r',x,y)}+183*${point('g',x,y)}+19*${point('b',x,y)}+128)/256)`;
	const mean=(bins:readonly number[],start:number)=>{
		const radius=Math.floor(bins.length/2),terms=Array.from({length:bins.length**2},(_,n)=>({x:n%bins.length-radius,y:Math.floor(n/bins.length)-radius,w:bins[n%bins.length]!*bins[Math.floor(n/bins.length)]!}));
		const weight=terms.map(n=>`${String(n.w)}*${point('alpha',n.x,n.y)}`).join('+'),sum=terms.map(n=>`${String(n.w)}*${point('alpha',n.x,n.y)}*${luma(n.x,n.y)}`).join('+');
		return `st(${String(start)},${weight});st(${String(start+1)},${sum});st(${String(start+2)},floor((2*ld(${String(start+1)})+ld(${String(start)}))/(2*max(ld(${String(start)}),1))));`;
	};
	const means=mean(TEXTURE_BINOMIAL3_V1,0)+mean(TEXTURE_BINOMIAL5_V1,3),center=luma(0,0);
	const expressions=['r','g','b'].map(c=>`${c}='if(eq(alpha(X,Y),0),${c}(X,Y),${means}st(6,${center});st(7,max(0,256-4*abs(ld(6)-ld(5))));clip(${c}(X,Y)+floor(((ld(2)-ld(5))*${String(p.gainQ8)}*ld(7)+32768)/65536),0,255))'`);
	const operation=Object.freeze({kind:'texture-v1'as const,expression:`format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true as const});
	OPERATIONS.add(operation);return operation;
}
export function assertTextureFfmpegOperationV1(value:unknown):asserts value is Readonly<TextureFfmpegOperationV1>{
	if(!value||typeof value!=='object'||!OPERATIONS.has(value))throw new TypeError('An owning compiled texture operation is required.');
}
