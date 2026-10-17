/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';

/** New encoded straight-sRGB grain in CURRENT natural-output pixel centers.
 * Fixed seeded triangular lattice noise, two bilinear octaves at Size and
 * half-Size, mixed by Roughness. The common RGB offset has a symmetric encoded
 * luma midtone envelope, then explicit gamut clipping; alpha0 keeps hidden RGB.
 * No clock, random source, frame-sized mask or persisted lookup is involved. */
export const GRAIN_PROCESS_V1='srgb-natural-output-grain-q8-v1';
export const GRAIN_EFFECT_TYPE_V1='grain-v1';
export const GRAIN_EFFECT_CODE_V1=31;
const DEFAULTS=Object.freeze({amount:0,size:1,roughness:50,seed:0});
export type GrainParamsV1=Readonly<Record<keyof typeof DEFAULTS,number>>;
const KEYS=Object.freeze(Object.keys(DEFAULTS) as (keyof GrainParamsV1)[]);
const LABEL=Object.freeze({amount:'Amount',size:'Size',roughness:'Roughness',seed:'Seed'});
const LABEL_KEY=Object.freeze({amount:'videoEffectGrainAmount',size:'videoEffectGrainSize',roughness:'videoEffectGrainRoughness',seed:'videoEffectGrainSeed'});
const minimum=(key:keyof GrainParamsV1)=>key==='size'?1:0;
const maximum=(key:keyof GrainParamsV1)=>key==='size'?8:key==='seed'?65520:100;
export const GRAIN_VIDEO_EFFECT_DEFINITION_V1=Object.freeze({type:GRAIN_EFFECT_TYPE_V1,label:'Grain',labelKey:'videoEffectGrain',
	shader:GRAIN_EFFECT_TYPE_V1,ffmpegFilter:GRAIN_PROCESS_V1,params:Object.freeze(Object.fromEntries(KEYS.map(key=>[key,
		Object.freeze({label:LABEL[key],labelKey:LABEL_KEY[key],default:DEFAULTS[key],min:minimum(key),max:maximum(key),
			step:key==='size'?0.25:1,integer:key==='seed',control:'number'})])))});

export function normalizeGrainParamsV1(value:unknown):GrainParamsV1 {
	const input=record(value===undefined?{}:value,'grain parameters',KEYS,[]),result={} as Record<keyof GrainParamsV1,number>;
	for(const key of KEYS){
		const next=Object.hasOwn(input,key)?field(input,key,'grain parameters'):DEFAULTS[key];
		if(typeof next!=='number'||!Number.isFinite(next)||next<minimum(key)||next>maximum(key)||(key==='seed'&&!Number.isSafeInteger(next)))
			throw new RangeError('Grain parameters exceed their closed finite bounds.');
		result[key]=Object.is(next,-0)?0:next;
	}
	return Object.freeze(result);
}
export function normalizeGrainEffectV1(value:unknown){
	const input=record(value,'grain effect',['id','type','enabled','params']),id=field(input,'id','grain effect'),type=field(input,'type','grain effect'),enabled=field(input,'enabled','grain effect');
	if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Grain requires a bounded effect ID.');
	if(type!==GRAIN_EFFECT_TYPE_V1)throw new RangeError('Unsupported grain process.');
	if(typeof enabled!=='boolean')throw new TypeError('Grain enabled must be boolean.');
	const params=field(input,'params','grain effect');if(params===undefined)throw new TypeError('Grain requires parameters.');
	return Object.freeze({id,type,enabled,params:normalizeGrainParamsV1(params)});
}
/** Closed semantic admission precedes the private ID factory. */
export function createGrainEffectV1(value:unknown,createId:()=>string){
	const input=record(value,'grain creation',['id','type','enabled','params','index'],[]);
	const take=(key:string)=>Object.hasOwn(input,key)?field(input,key,'grain creation'):undefined;
	const id=take('id'),type=take('type'),enabled=Object.hasOwn(input,'enabled')?take('enabled'):true,index=take('index');
	if(Object.hasOwn(input,'id')&&(typeof id!=='string'||!id.length||id.length>128))throw new TypeError('Invalid grain effect ID.');
	if(Object.hasOwn(input,'type')&&type!==GRAIN_EFFECT_TYPE_V1)throw new RangeError('Invalid grain effect type.');
	if(typeof enabled!=='boolean')throw new TypeError('Grain enabled must be boolean.');
	if(index!==undefined&&(typeof index!=='number'||!Number.isSafeInteger(index)||index<0||index>100000))throw new RangeError('Invalid grain insertion index.');
	const params=normalizeGrainParamsV1(take('params'));if(typeof createId!=='function')throw new TypeError('Grain requires its private ID factory.');
	const result=normalizeGrainEffectV1({id:id??createId(),type:GRAIN_EFFECT_TYPE_V1,enabled,params});return {...result,params:{...result.params}};
}

export interface PreparedGrainEffectV1 {
	readonly type:typeof GRAIN_EFFECT_TYPE_V1;readonly enabled:boolean;readonly neutral:boolean;
	readonly amountQ8:number;readonly sizeQ8:number;readonly roughnessQ8:number;readonly seed:number;
}
const PREPARED=new WeakSet<object>();
export function prepareGrainEffectV1(value:unknown):Readonly<PreparedGrainEffectV1>{
	const {type,enabled,params}=normalizeGrainEffectV1(value),amountQ8=Math.round(params.amount*256/100);
	const prepared=Object.freeze({type,enabled,neutral:amountQ8===0,amountQ8,sizeQ8:Math.round(params.size*256),roughnessQ8:Math.round(params.roughness*256/100),seed:params.seed});
	PREPARED.add(prepared);return prepared;
}
function owned(p:PreparedGrainEffectV1):void{if(!PREPARED.has(p))throw new TypeError('An owning prepared grain effect is required.');}
function integer(value:number,min:number,max:number):void{if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError('Invalid grain scalar.');}

/** For x/y<=65535, center product (2*x+1)*32768<=4,294,934,528.
 * Half-Size>=128 makes cell+1<=131072. Linear hash sum<=42,398,709;
 * h<=65520 makes h*h+31*h+17<=4,294,901,537. Every operation fits uint32,
 * without wrap. Bilinear weights sum65536; signed sum+32768<8,421,377. */
function lattice(cx:number,cy:number,seed:number):number{
	let h=(cx*73+cy*151+seed*199+101)%65521;h=(h*h+31*h+17)%65521;
	const first=h%257;h=(h*h+31*h+17)%65521;return Math.floor((first+h%257-255)/2);
}
function octave(x:number,y:number,size:number,seed:number):number{
	const qx=Math.floor((2*x+1)*32768/size),qy=Math.floor((2*y+1)*32768/size),ix=Math.floor(qx/256),iy=Math.floor(qy/256),fx=qx%256,fy=qy%256;
	const sum=lattice(ix,iy,seed)*(256-fx)*(256-fy)+lattice(ix+1,iy,seed)*fx*(256-fy)
		+lattice(ix,iy+1,seed)*(256-fx)*fy+lattice(ix+1,iy+1,seed)*fx*fy;
	return Math.floor((sum+32768)/65536);
}
export function grainNoiseV1(p:PreparedGrainEffectV1,x:number,y:number):number{
	owned(p);integer(x,0,65535);integer(y,0,65535);if(!p.enabled||p.neutral)return 0;
	return Math.floor((octave(x,y,p.sizeQ8,p.seed)*(256-p.roughnessQ8)+octave(x,y,Math.floor(p.sizeQ8/2),p.seed)*p.roughnessQ8+128)/256);
}
/** Original luma is rounded first. The same signed offset is added to each
 * channel before gamut clipping; |offset|<=32. Signed numerator+131072 stays
 * within8,454,144, with all half ties toward +infinity. */
export function grainOffsetV1(p:PreparedGrainEffectV1,red:number,green:number,blue:number,noise:number):number{
	owned(p);integer(red,0,255);integer(green,0,255);integer(blue,0,255);integer(noise,-128,128);if(!p.enabled||p.neutral)return 0;
	const luma=Math.floor((54*red+183*green+19*blue+128)/256),response=2*Math.min(luma,255-luma);
	return Math.floor((noise*p.amountQ8*response+131072)/262144);
}
export function grainPreviewPassV1(value:unknown){
	const p=prepareGrainEffectV1(value);if(!p.enabled||p.neutral)return null;
	return Object.freeze({code:GRAIN_EFFECT_CODE_V1,params0:Object.freeze([p.amountQ8,p.sizeQ8,p.roughnessQ8,p.seed] as const),
		params1:Object.freeze([0,0,0,0] as const),direction:Object.freeze([0,0] as const)});
}

export interface GrainFfmpegOperationV1{readonly kind:'grain-v1';readonly expression:string;readonly preserveAlpha:true}
const OPERATIONS=new WeakSet<object>();
/** Only ten GEQ registers. Both lattices consume exact current-stage X/Y,
 * original channels determine the common RGB offset, and alpha stays original. */
export function serializeGrainEffectToFfmpegV1(value:unknown):Readonly<GrainFfmpegOperationV1>|null{
	const p=prepareGrainEffectV1(value);if(!p.enabled||p.neutral)return null;
	const sample=(x:string,y:string)=>`st(6,mod((${x})*73+(${y})*151+${String(p.seed)}*199+101,65521));st(6,mod(ld(6)*ld(6)+31*ld(6)+17,65521));`
		+'st(7,mod(ld(6),257));st(6,mod(ld(6)*ld(6)+31*ld(6)+17,65521));floor((ld(7)+mod(ld(6),257)-255)/2)';
	const layer=(spacing:number)=>`st(0,floor((2*X+1)*32768/${String(spacing)}));st(1,floor((2*Y+1)*32768/${String(spacing)}));`
		+'st(2,floor(ld(0)/256));st(3,floor(ld(1)/256));st(4,mod(ld(0),256));st(5,mod(ld(1),256));'
		+`st(8,(${sample('ld(2)','ld(3)')})*(256-ld(4))*(256-ld(5)));`
		+`st(8,ld(8)+(${sample('ld(2)+1','ld(3)')})*ld(4)*(256-ld(5)));`
		+`st(8,ld(8)+(${sample('ld(2)','ld(3)+1')})*(256-ld(4))*ld(5));`
		+`st(8,ld(8)+(${sample('ld(2)+1','ld(3)+1')})*ld(4)*ld(5));floor((ld(8)+32768)/65536)`;
	const noise=`st(9,(${layer(p.sizeQ8)}));st(8,(${layer(Math.floor(p.sizeQ8/2))}));`
		+`st(9,floor((ld(9)*${String(256-p.roughnessQ8)}+ld(8)*${String(p.roughnessQ8)}+128)/256));`
		+'st(8,floor((54*r(X,Y)+183*g(X,Y)+19*b(X,Y)+128)/256));st(8,2*min(ld(8),255-ld(8)));';
	const expressions=['r','g','b'].map(c=>`${c}='if(eq(alpha(X,Y),0),${c}(X,Y),${noise}clip(${c}(X,Y)+floor((ld(9)*${String(p.amountQ8)}*ld(8)+131072)/262144),0,255))'`);
	const operation=Object.freeze({kind:'grain-v1' as const,expression:`format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`,preserveAlpha:true as const});
	OPERATIONS.add(operation);return operation;
}
export function assertGrainFfmpegOperationV1(value:unknown):asserts value is Readonly<GrainFfmpegOperationV1>{
	if(!value||typeof value!=='object'||!OPERATIONS.has(value))throw new TypeError('An owning compiled grain operation is required.');
}
