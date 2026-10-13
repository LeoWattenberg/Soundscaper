/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';

interface FrameObservation {
	format: string;
	timestamp: number;
	duration: number | null;
	width: number;
	height: number;
	colorSpace: VideoColorSpaceInit;
	yuv: number[] | null;
	rgba: number[] | null;
	canvas: number[];
	control: number[];
}
export interface LinkedVideoObservation {
	fileColorSpace: VideoColorSpaceInit;
	frames: FrameObservation[];
	html: number[];
}

function require709(color: VideoColorSpaceInit): void {
	assert.deepEqual(color, { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }, 'actual file/plane color metadata');
}
function bytes(values: readonly number[], count: number): void {
	assert.equal(values.length, count);
	assert.ok(values.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'native byte bounds');
}

/** Independent normative inverse of limited-range BT.709; no production conversion import. */
export function verifyLinkedVideoPixels(report: LinkedVideoObservation): {
	colors: number[][]; classifications: string[];
} {
	require709(report.fileColorSpace);
	assert.equal(report.frames.length, 2, 'actual decoded frame count');
	const classifications: string[] = [];
	const colors = report.frames.map((frame, index) => {
		assert.deepEqual([frame.width, frame.height, frame.timestamp, frame.duration], [96, 64, index * 500_000, 500_000], 'actual geometry and timing');
		require709(frame.colorSpace);
		let color: number[];
		if (frame.format === 'I420' || frame.format === 'NV12') {
			assert.ok(frame.yuv); bytes(frame.yuv, 3);
			const y = (frame.yuv[0]! - 16) / 219, cb = (frame.yuv[1]! - 128) / 224, cr = (frame.yuv[2]! - 128) / 224;
			const r = y + 2 * (1 - .2126) * cr, b = y + 2 * (1 - .0722) * cb;
			color = [r, (y - .2126 * r - .0722 * b) / .7152, b].map(value => Math.max(0, Math.min(255, value * 255)));
			color.push(255); classifications.push('normative-bt709-planes');
		} else {
			assert.ok(['BGRX', 'RGBX', 'BGRA', 'RGBA'].includes(frame.format), 'admitted native pixel format');
			assert.ok(frame.rgba); bytes(frame.rgba, 4); color = frame.rgba;
			classifications.push('native-rgb-planes-unqualified');
		}
		for (const [channel, expected] of [0, 0, 255, 255].entries()) {
			assert.ok(Math.abs(color[channel]! - expected) <= 12, `authored file color ${JSON.stringify(color)}`);
		}
		bytes(frame.canvas, 4); bytes(frame.control, 4);
		assert.deepEqual(frame.canvas, frame.control, 'actual/native-control presentation');
		return color;
	});
	bytes(report.html, 4);
	assert.deepEqual(report.html, report.frames[0]!.control, 'HTML/native-control presentation');
	return { colors, classifications };
}

/** Inspect the downloaded file's actual configuration/packets, then its native output without forcing copy format. */
export async function observeLinkedVideoPixels(page: Page, file: Uint8Array): Promise<LinkedVideoObservation> {
	assert.ok(file.byteLength > 0 && file.byteLength <= 1_048_576, 'bounded linked video file');
	const input = new Input({ source: new BufferSource(file), formats: [MP4] });
	try {
		const tracks = await input.getVideoTracks();
		assert.equal(tracks.length, 1); assert.equal((await input.getAudioTracks()).length, 0);
		const track = tracks[0]!;
		assert.deepEqual([track.codec, track.displayWidth, track.displayHeight], ['avc', 96, 64]);
		const config = await track.getDecoderConfig(); assert.ok(config?.description); assert.ok(config.colorSpace);
		require709(config.colorSpace);
		const packets: { type: EncodedVideoChunkType; timestamp: number; duration: number; data: number[] }[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			assert.ok(packets.length < 2 && packet.data.byteLength > 0 && packet.data.byteLength <= 1_048_576);
			assert.deepEqual([packet.timestamp, packet.duration], [packets.length / 2, .5]);
			packets.push({ type: packet.type, timestamp: packet.timestamp * 1e6, duration: packet.duration * 1e6, data: Array.from(packet.data) });
		}
		assert.equal(packets.length, 2);
		const description = ArrayBuffer.isView(config.description)
			? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength)
			: new Uint8Array(config.description);
		return await page.evaluate(async ({ decoderConfig, packets: encodedPackets, encoded }) => {
			const canvasColor = (source: CanvasImageSource): number[] => {
				const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
				const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
				context.drawImage(source, 0, 0); return [...context.getImageData(48, 32, 1, 1).data];
			};
			const inspect = async (frame: VideoFrame): Promise<FrameObservation> => {
				if (frame.displayWidth !== 96 || frame.displayHeight !== 64 || frame.visibleRect?.x !== 0 || frame.visibleRect.y !== 0
					|| frame.visibleRect.width !== 96 || frame.visibleRect.height !== 64 || frame.codedWidth > 128 || frame.codedHeight > 128) throw new Error('Native geometry changed');
				const format = frame.format;
				if (!format || !['I420', 'NV12', 'BGRX', 'RGBX', 'BGRA', 'RGBA'].includes(format)) throw new Error(`Unqualified native format ${String(format)}`);
				const size = frame.allocationSize(); if (size > 1_048_576) throw new Error('Native allocation bound');
				const data = new Uint8Array(size); const layout = await frame.copyTo(data);
				const at = (plane: number, x: number, y: number): number => {
					const row = layout[plane]; if (!row) throw new Error('Native plane missing');
					const offset = row.offset + row.stride * y + x;
					if (!Number.isSafeInteger(offset) || offset < 0 || offset >= data.length) throw new Error('Native plane bounds');
					return data[offset]!;
				};
				const yuv = format === 'I420' ? [at(0, 48, 32), at(1, 24, 16), at(2, 24, 16)]
					: format === 'NV12' ? [at(0, 48, 32), at(1, 48, 16), at(1, 49, 16)] : null;
				const rgba = yuv ? null : [at(0, 192 + (format.startsWith('BG') ? 2 : 0), 32), at(0, 193, 32),
					at(0, 192 + (format.startsWith('BG') ? 0 : 2), 32), format.endsWith('A') ? at(0, 195, 32) : 255];
				const colorSpace = frame.colorSpace.toJSON();
				// A separate native frame constructed from copied actual bytes/tags, not a clone or expected color.
				const control = new VideoFrame(data, { format, codedWidth: 96, codedHeight: 64, layout,
					timestamp: frame.timestamp, duration: frame.duration ?? undefined, colorSpace });
				try {
					return { format, timestamp: frame.timestamp, duration: frame.duration, width: frame.displayWidth, height: frame.displayHeight,
						colorSpace, yuv, rgba, canvas: canvasColor(frame), control: canvasColor(control) };
				} finally { control.close(); }
			};
			const pending: Promise<FrameObservation | null>[] = []; const live = new Set<VideoFrame>(); const errors: string[] = [];
			const decoder = new VideoDecoder({ output(frame) {
				if (pending.length >= 2) { frame.close(); errors.push('Unexpected extra frame'); return; }
				live.add(frame);
				pending.push(inspect(frame).catch((error: unknown) => { errors.push(String(error)); return null; })
					.finally(() => { frame.close(); live.delete(frame); }));
			}, error: error => errors.push(String(error)) });
			let timer: ReturnType<typeof setTimeout> | undefined;
			let frames: (FrameObservation | null)[];
			try {
				decoder.configure({ ...decoderConfig, description: Uint8Array.from(decoderConfig.description) });
				for (const packet of encodedPackets) decoder.decode(new EncodedVideoChunk({ ...packet, data: Uint8Array.from(packet.data) }));
				frames = await Promise.race([decoder.flush().then(() => Promise.all(pending)), new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error('Native video decode timed out')), 15_000);
				})]);
				if (errors.length || frames.length !== 2 || frames.some(frame => !frame)) throw new Error(`Native video decode failed: ${errors.join('; ')}`);
			} finally { clearTimeout(timer); if (decoder.state !== 'closed') decoder.close(); for (const frame of live) frame.close(); }
			const url = URL.createObjectURL(new Blob([Uint8Array.from(encoded)], { type: 'video/mp4' }));
			const video = document.createElement('video');
			Object.assign(video, { muted: true, playsInline: true, preload: 'auto' });
			Object.assign(video.style, { position: 'fixed', left: '8px', top: '8px', width: '96px', height: '64px', zIndex: '2147483647' }); document.body.append(video);
			let callback: number | undefined;
			try {
				const presented = new Promise<void>((resolve, reject) => { timer = setTimeout(() => reject(new Error('Linked video presentation timed out.')), 15_000);
					callback = video.requestVideoFrameCallback(() => { callback = undefined; resolve(); }); });
				const loaded = new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Linked video decode failed.')); });
				video.src = url; video.load(); await Promise.all([loaded, presented]);
				if (video.videoWidth !== 96 || video.videoHeight !== 64) throw new Error('Linked video dimensions changed.');
				return { fileColorSpace: decoderConfig.colorSpace, frames: frames as FrameObservation[], html: canvasColor(video) };
			} finally {
				if (callback !== undefined) video.cancelVideoFrameCallback(callback); clearTimeout(timer);
				video.onloadeddata = null; video.onerror = null; video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(url);
			}
		}, { decoderConfig: { ...config, description: Array.from(description), colorSpace: config.colorSpace }, packets, encoded: Array.from(file) });
	} finally { input.dispose(); }
}
