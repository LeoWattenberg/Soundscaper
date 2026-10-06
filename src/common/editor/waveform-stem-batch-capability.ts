/* SPDX-License-Identifier: AGPL-3.0-only */

type NativeCanvas = HTMLCanvasElement | OffscreenCanvas;
type NativeContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface ProbeOwner { readonly key: object; readonly kind: string; create(): NativeCanvas; }

const capabilities = new WeakMap<object, Map<string, boolean>>();
const WIDTH = 480;
const HEIGHT = 100;

/** Prove compound paths on a separate native surface; never alter the caller's pixels. */
export function canBatchRoundCapStems(context: NativeContext): boolean {
	if (context.globalAlpha !== 1 || context.globalCompositeOperation !== 'source-over'
		|| context.shadowBlur || context.shadowOffsetX || context.shadowOffsetY
		|| (context.shadowColor && context.shadowColor.replace(/\s/gu, '') !== 'rgba(0,0,0,0)' && context.shadowColor !== 'transparent')
		|| (context.filter && context.filter !== 'none') || context.getLineDash?.().length) return false;
	let owner: ProbeOwner | null;
	let attributes: CanvasRenderingContext2DSettings;
	try {
		owner = probeOwner(context.canvas);
		if (!owner) return false;
		attributes = context.getContextAttributes?.() ?? { alpha: true };
	} catch { return false; }
	const key = JSON.stringify([owner.kind, attributes]);
	let cached = capabilities.get(owner.key);
	if (cached?.has(key)) return cached.get(key)!;
	const supported = probe(owner, attributes);
	if (!cached) { cached = new Map(); capabilities.set(owner.key, cached); }
	cached.set(key, supported);
	return supported;
}

function probeOwner(canvas: NativeCanvas | undefined): ProbeOwner | null {
	if (!canvas) return null;
	if ('ownerDocument' in canvas && canvas.ownerDocument?.createElement) {
		const document = canvas.ownerDocument;
		return { key: document, kind: 'html', create: () => document.createElement('canvas') };
	}
	const constructor = canvas.constructor;
	if (typeof constructor !== 'function' || constructor.name !== 'OffscreenCanvas') return null;
	return { key: constructor, kind: 'offscreen', create: () => Reflect.construct(constructor, [WIDTH, HEIGHT]) as OffscreenCanvas };
}

function probe(owner: ProbeOwner, attributes: CanvasRenderingContext2DSettings): boolean {
	const surfaces: NativeCanvas[] = [];
	try {
		const pixels = [false, true].map(batch => {
			const canvas = owner.create(); surfaces.push(canvas);
			canvas.width = WIDTH; canvas.height = HEIGHT;
			const context = canvas.getContext('2d', attributes) as NativeContext | null;
			if (!context || typeof context.getImageData !== 'function') throw new Error('Native stem pixels are unavailable.');
			paintProbe(context, batch);
			return context.getImageData(0, 0, WIDTH, HEIGHT).data;
		});
		return pixels[0]!.length === pixels[1]!.length && pixels[0]!.every((value, index) => value === pixels[1]![index]);
	} catch { return false; }
	finally { for (const surface of surfaces) { surface.width = 0; surface.height = 0; } }
}

function paintProbe(context: NativeContext, batch: boolean): void {
	const samples = Float32Array.from({ length: 130 }, (_, index) => Math.sin(index) * 0.8);
	const positions = Array.from(samples, (sample, index) => {
		const x = -0.375 + index * 4.05;
		return { x, y: 50 - sample * (0.2 + Math.max(0, Math.min(1, x / WIDTH)) * 0.8) * 40,
			color: x < WIDTH / 2 ? 'rgba(30,60,90,0.4)' : 'rgba(60,90,120,0.6)' };
	});
	context.lineWidth = 1; context.lineCap = 'round'; context.lineJoin = 'round';
	let color: string | undefined;
	for (let index = 0; index < positions.length; index++) {
		const point = positions[index]!;
		if (!batch || point.color !== color) {
			if (batch && index) context.stroke();
			context.strokeStyle = color = point.color; context.beginPath();
		}
		context.moveTo(point.x, 50); context.lineTo(point.x, point.y);
		if (!batch) context.stroke();
	}
	if (batch) context.stroke();
	context.strokeStyle = 'rgba(0,255,0,0.3)'; context.beginPath(); context.moveTo(0, 50); context.lineTo(WIDTH, 50); context.stroke();
	for (const point of positions) {
		context.fillStyle = point.color; context.beginPath(); context.arc(point.x, point.y, 2, 0, Math.PI * 2); context.fill();
	}
}
