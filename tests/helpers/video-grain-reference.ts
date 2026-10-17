/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independent bounded BigInt specification; no production scalar, preparation,
 * pixel kernel or table is imported. Quantization models the declared JS steps. */
export interface GrainReferenceParamsV1 { readonly amount:number; readonly size:number; readonly roughness:number; readonly seed:number }
export function grainReferenceV1(source:readonly number[],width:number,p:GrainReferenceParamsV1):number[] {
	if(!Number.isSafeInteger(width)||width<1||width>256||source.length===0||source.length>1024||source.length%(4*width)) throw new RangeError('Bounded RGBA reference required.');
	const size=BigInt(Math.round(p.size*256)),rough=BigInt(Math.round(p.roughness*256/100)),amount=BigInt(Math.round(p.amount*256/100));
	const floor=(n:bigint,d:bigint)=>n<0n?-((-n+d-1n)/d):n/d;
	const sample=(x:bigint,y:bigint)=>{let h=(x*73n+y*151n+BigInt(p.seed)*199n+101n)%65521n;h=(h*h+31n*h+17n)%65521n;
		const first=h%257n;h=(h*h+31n*h+17n)%65521n;return floor(first+h%257n-255n,2n);};
	const octave=(x:number,y:number,s:bigint)=>{
		const qx=BigInt(2*x+1)*32768n/s,qy=BigInt(2*y+1)*32768n/s,ix=qx/256n,iy=qy/256n,fx=qx%256n,fy=qy%256n;
		return floor(sample(ix,iy)*(256n-fx)*(256n-fy)+sample(ix+1n,iy)*fx*(256n-fy)+sample(ix,iy+1n)*(256n-fx)*fy+sample(ix+1n,iy+1n)*fx*fy+32768n,65536n);
	};
	return source.map((byte,index)=>{
		const channel=index%4,start=index-channel,pixel=start/4;if(channel===3||source[start+3]===0)return byte;
		const x=pixel%width,y=Math.floor(pixel/width),noise=floor(octave(x,y,size)*(256n-rough)+octave(x,y,size/2n)*rough+128n,256n);
		const luma=(54n*BigInt(source[start]!)+183n*BigInt(source[start+1]!)+19n*BigInt(source[start+2]!)+128n)/256n,response=2n*(luma<255n-luma?luma:255n-luma);
		const next=BigInt(byte)+floor(noise*amount*response+131072n,262144n);return Number(next<0n?0n:next>255n?255n:next);
	});
}
