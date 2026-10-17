/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';

export interface Avc64PixelPlan {
	readonly mode: 'all-two-at-2fps' | 'first-at-1fps';
	readonly points: readonly Readonly<{ x: number; y: number }>[];
}
interface NativePixel {
	yuv: number[] | null;
	rgba: number[] | null;
	canvas: number[];
	control: number[];
}
export interface Avc64ColorObservation {
	fileColorSpace: VideoColorSpaceInit;
	frames: {
		format: string; timestamp: number; duration: number | null;
		width: number; height: number; colorSpace: VideoColorSpaceInit; pixels: NativePixel[];
	}[];
}
const FILE_709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } as const;
function byteValues(values: readonly number[], length: number): void {
	assert.equal(values.length, length);
	assert.ok(values.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'native byte bounds');
}
function requirePlan(plan: Avc64PixelPlan): void {
	assert.ok(['all-two-at-2fps', 'first-at-1fps'].includes(plan.mode));
	assert.ok(plan.points.length > 0 && plan.points.length <= 2);
	for (const point of plan.points) assert.ok([point.x, point.y].every(value => Number.isInteger(value) && value >= 0 && value < 64));
}
function srgbFrom709(value: number): number {
	const encoded = Math.max(0, Math.min(1, value));
	const linear = encoded < .081 ? encoded / 4.5 : ((encoded + .099) / 1.099) ** (1 / .45);
	return 255 * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055);
}

/** Independent BT709 limited matrix and source-OETF inverse: ITU-R BT.709-6 §§1.2,3.2–3.4
 * https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.709-6-201506-I!!PDF-E.pdf
 * IEC61966-2-1 sRGB encoding: https://registry.color.org/rgb-registry/srgb
 * Decode file709 to linear, then encode authored sRGB; no app conversion imports. */
export function avc64SrgbColors(report: Avc64ColorObservation, plan: Avc64PixelPlan): {
	colors: number[][][]; classifications: string[];
} {
	requirePlan(plan);
	assert.deepEqual(report.fileColorSpace, FILE_709, 'actual file color metadata');
	const count = plan.mode === 'all-two-at-2fps' ? 2 : 1, duration = 1_000_000 / (count === 2 ? 2 : 1);
	assert.equal(report.frames.length, count, 'observed decoded frame count');
	const classifications: string[] = [];
	const colors = report.frames.map((frame, index) => {
		assert.deepEqual([frame.width, frame.height, frame.timestamp, frame.duration], [64, 64, index * duration, duration], 'actual geometry/order/timing');
		assert.equal(frame.pixels.length, plan.points.length);
		const yuv = frame.format === 'I420' || frame.format === 'NV12';
		if (yuv) {
			assert.deepEqual(frame.colorSpace, FILE_709, 'actual native YUV color metadata');
			classifications.push('native-yuv-bt709-to-srgb');
		} else {
			assert.ok(['RGBA', 'RGBX', 'BGRA', 'BGRX'].includes(frame.format), 'admitted native pixel format');
			assert.equal(frame.colorSpace.primaries, 'bt709', 'native RGB primaries');
			assert.equal(frame.colorSpace.matrix, 'rgb', 'native RGB matrix');
			assert.equal(frame.colorSpace.fullRange, true, 'native RGB range');
			assert.ok(frame.colorSpace.transfer === 'bt709' || frame.colorSpace.transfer === 'iec61966-2-1', 'native RGB transfer must be explicit');
			classifications.push(frame.colorSpace.transfer === 'bt709' ? 'native-rgb-bt709-to-srgb-no-yuv-proof' : 'native-rgb-srgb-no-yuv-proof');
		}
		return frame.pixels.map(pixel => {
			byteValues(pixel.canvas, 4); byteValues(pixel.control, 4);
			assert.equal(pixel.canvas[3], 255); assert.equal(pixel.control[3], 255);
			assert.deepEqual(pixel.canvas, pixel.control, 'actual/native same-plane presentation');
			if (yuv) {
				assert.ok(pixel.yuv); assert.equal(pixel.rgba, null); byteValues(pixel.yuv, 3);
				const y = (pixel.yuv[0]! - 16) / 219, cb = (pixel.yuv[1]! - 128) / 224, cr = (pixel.yuv[2]! - 128) / 224;
				const r = y + 1.5748 * cr, b = y + 1.8556 * cb, g = (y - .2126 * r - .0722 * b) / .7152;
				return [r, g, b].map(srgbFrom709).concat(255);
			}
			assert.ok(pixel.rgba); assert.equal(pixel.yuv, null); byteValues(pixel.rgba, 4); assert.equal(pixel.rgba[3], 255);
			return frame.colorSpace.transfer === 'bt709'
				? pixel.rgba.slice(0, 3).map(value => srgbFrom709(value / 255)).concat(255) : [...pixel.rgba];
		});
	});
	return { colors, classifications };
}

/** The two64px MP4 witnesses only: decode all2frames or exactly the first key packet. */
export async function observeAvc64Colors(page: Page, file: Uint8Array, plan: Avc64PixelPlan): Promise<Avc64ColorObservation> {
	requirePlan(plan); assert.ok(file.byteLength > 0 && file.byteLength <= 1_048_576);
	const input = new Input({ source: new BufferSource(file), formats: [MP4] });
	const count = plan.mode === 'all-two-at-2fps' ? 2 : 1, duration = 1_000_000 / (count === 2 ? 2 : 1);
	try {
		const tracks = await input.getVideoTracks(); assert.equal(tracks.length, 1); assert.equal((await input.getAudioTracks()).length, 0);
		const track = tracks[0]!; assert.deepEqual([track.codec, track.displayWidth, track.displayHeight], ['avc', 64, 64]);
		const config = await track.getDecoderConfig(); assert.ok(config?.description); assert.ok(config.colorSpace);
		assert.deepEqual(config.colorSpace, FILE_709, 'actual file color metadata');
		const description = ArrayBuffer.isView(config.description)
			? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength) : new Uint8Array(config.description);
		assert.ok(description.byteLength > 0 && description.byteLength <= 4096);
		const packets: { type: EncodedVideoChunkType; timestamp: number; duration: number; data: number[] }[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			assert.ok(packets.length < count && packet.data.byteLength > 0 && packet.data.byteLength <= 1_048_576);
			assert.deepEqual([packet.timestamp * 1e6, packet.duration * 1e6], [packets.length * duration, duration]);
			if (packets.length === 0) assert.equal(packet.type, 'key');
			packets.push({ type: packet.type, timestamp: packet.timestamp * 1e6, duration: packet.duration * 1e6, data: [...packet.data] });
			if (plan.mode === 'first-at-1fps') break;
		}
		assert.equal(packets.length, count);
		return await page.evaluate(async ({ decoderConfig, packets: encodedPackets, points, expectedCount }) => {
			const pixelColors = (source: CanvasImageSource): number[][] => {
				const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
				const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Native witness canvas unavailable');
				context.drawImage(source, 0, 0, 64, 64);
				return points.map(point => [...context.getImageData(point.x, point.y, 1, 1).data]);
			};
			const inspect = async (frame: VideoFrame): Promise<Avc64ColorObservation['frames'][number]> => {
				if (frame.displayWidth !== 64 || frame.displayHeight !== 64 || frame.visibleRect?.x !== 0 || frame.visibleRect.y !== 0
					|| frame.visibleRect.width !== 64 || frame.visibleRect.height !== 64 || frame.codedWidth > 128 || frame.codedHeight > 128) throw new Error('Native geometry changed');
				const format = frame.format;
				if (!format || !['I420', 'NV12', 'BGRX', 'RGBX', 'BGRA', 'RGBA'].includes(format)) throw new Error(`Unqualified native format ${String(format)}`);
				const size = frame.allocationSize(); if (size < 1 || size > 1_048_576) throw new Error('Native allocation bound');
				const data = new Uint8Array(size), layout = await frame.copyTo(data);
				const at = (plane: number, x: number, y: number): number => {
					const row = layout[plane]; if (!row) throw new Error('Native plane missing');
					const offset = row.offset + row.stride * y + x;
					if (!Number.isSafeInteger(offset) || offset < 0 || offset >= data.length) throw new Error('Native plane bounds');
					return data[offset]!;
				};
				const actualCanvas = pixelColors(frame), colorSpace = frame.colorSpace.toJSON();
				const control = new VideoFrame(data, { format, codedWidth: 64, codedHeight: 64, layout,
					timestamp: frame.timestamp, duration: frame.duration ?? undefined, colorSpace });
				try {
					const controlCanvas = pixelColors(control);
					return { format, timestamp: frame.timestamp, duration: frame.duration, width: frame.displayWidth, height: frame.displayHeight, colorSpace,
						pixels: points.map((point, index) => {
							const cx = Math.floor(point.x / 2), cy = Math.floor(point.y / 2);
							const yuv = format === 'I420' ? [at(0, point.x, point.y), at(1, cx, cy), at(2, cx, cy)]
								: format === 'NV12' ? [at(0, point.x, point.y), at(1, 2 * cx, cy), at(1, 2 * cx + 1, cy)] : null;
							const rgba = yuv ? null : [at(0, 4 * point.x + (format.startsWith('BG') ? 2 : 0), point.y), at(0, 4 * point.x + 1, point.y),
								at(0, 4 * point.x + (format.startsWith('BG') ? 0 : 2), point.y), format.endsWith('A') ? at(0, 4 * point.x + 3, point.y) : 255];
							return { yuv, rgba, canvas: actualCanvas[index]!, control: controlCanvas[index]! };
						}) };
				} finally { control.close(); }
			};
			const pending: Promise<Avc64ColorObservation['frames'][number] | null>[] = [], live = new Set<VideoFrame>(), errors: string[] = [];
			const decoder = new VideoDecoder({ output(frame) {
				if (pending.length >= expectedCount) { frame.close(); if (errors.length < 4) errors.push('Unexpected extra native frame'); return; }
				live.add(frame); pending.push(inspect(frame).catch((error: unknown) => { if (errors.length < 4) errors.push(String(error)); return null; })
					.finally(() => { frame.close(); live.delete(frame); }));
			}, error(error) { if (errors.length < 4) errors.push(String(error)); } });
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				decoder.configure({ ...decoderConfig, description: Uint8Array.from(decoderConfig.description) });
				for (const packet of encodedPackets) decoder.decode(new EncodedVideoChunk({ ...packet, data: Uint8Array.from(packet.data) }));
				const frames = await Promise.race([decoder.flush().then(() => Promise.all(pending)), new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error('Native video decode timed out')), 15_000);
				})]);
				if (errors.length || frames.length !== expectedCount || frames.some(frame => !frame)) throw new Error(`Native decode failed: ${errors.join('; ')}`);
				return { fileColorSpace: decoderConfig.colorSpace, frames: frames as Avc64ColorObservation['frames'] };
			} finally { clearTimeout(timer); if (decoder.state !== 'closed') decoder.close(); for (const frame of live) frame.close(); }
		}, { decoderConfig: { ...config, description: [...description], colorSpace: config.colorSpace }, packets, points: plan.points, expectedCount: count });
	} finally { input.dispose(); }
}
