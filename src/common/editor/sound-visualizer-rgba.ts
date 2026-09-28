/* SPDX-License-Identifier: AGPL-3.0-only */

import { amplitudeToDb, calculateAudioSpectrum } from './audio-spectrum.ts';
import { prepareBoundedWaveformWindow } from './design-system-adapters/waveform.ts';
import type { WaveformRendering } from './design-system-adapters/types.ts';
import {
	SOUND_VISUALIZER_SPECTRUM_SIZE,
	soundVisualizerSpectrumWindowStarts,
} from './sound-visualizer-spectrum-windows.ts';

export type SoundVisualizerMode = 'waveform' | 'spectrum';

export interface SoundVisualizerRgbaRequest {
	readonly mode: SoundVisualizerMode;
	/** Waveform PCM or packed, evenly spaced 1,024-sample spectrum snapshots. */
	readonly channels: readonly Float32Array[] | null;
	readonly sampleRate: number;
	/** Project timeline sample at the left edge; may precede timeline zero. */
	readonly windowStartFrame: number;
	/** Output video frame ordinal; the scan marker changes on every frame. */
	readonly timelineFrame: number;
	readonly width: number;
	readonly height: number;
	readonly foregroundColor: string;
	readonly backgroundColor: string;
}

export interface SoundVisualizerRgbaFrame {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

type Rgba = readonly [number, number, number, number];

const MAXIMUM_PIXELS = 33_554_432;
const MAXIMUM_PCM_FRAMES = 4_194_304;
const SPECTRUM_FLOOR_DB = -90;
const SPECTRUM_CEILING_DB = -6;

/** Render an exact video frame from a bounded, time-varying audio view. */
export function renderSoundVisualizerRgba(request: SoundVisualizerRgbaRequest): SoundVisualizerRgbaFrame {
	if (request.mode !== 'waveform' && request.mode !== 'spectrum') {
		throw new RangeError('Unsupported sound visualizer mode.');
	}
	const width = dimension(request.width, 'width');
	const height = dimension(request.height, 'height');
	if (width * height > MAXIMUM_PIXELS) throw new RangeError('Sound visualizer frame pixel count exceeds its limit.');
	if (!Number.isFinite(request.sampleRate) || request.sampleRate <= 0) {
		throw new RangeError('Sound visualizer sampleRate must be positive.');
	}
	const windowStartFrame = safeFrame(request.windowStartFrame, 'windowStartFrame');
	nonNegativeFrame(request.timelineFrame, 'timelineFrame');
	const foreground = color(request.foregroundColor, 'foregroundColor');
	const background = color(request.backgroundColor, 'backgroundColor');
	const channels = validateChannels(request.channels);
	if (channels !== null && !Number.isSafeInteger(windowStartFrame + channels[0]!.length)) {
		throw new RangeError('Sound visualizer PCM window end frame overflows.');
	}
	const pixels = new Uint8Array(width * height * 4);
	fillBackground(pixels, background);
	if (channels !== null) {
		if (request.mode === 'waveform') drawWaveform(pixels, width, height, channels, foreground);
		else drawSpectrum(pixels, width, height, channels, request.sampleRate, foreground);
	}
	drawMovingMarker(pixels, width, height, request.timelineFrame);
	return Object.freeze({ width, height, pixels });
}

function drawWaveform(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	channels: readonly Float32Array[], foreground: Rgba,
): void {
	const sampleCount = channels[0]!.length;
	const rendering = prepareBoundedWaveformWindow(channels, {
		sourceStartFrame: 0, durationFrames: sampleCount,
	}, {
		pixelWidth: width,
		maxSamples: Math.max(1, Math.min(4_096, width * 2)),
		reuseSummaryForCompatibility: true,
	}).rendering;
	const centerY = Math.floor(height / 2);
	const maximumAmplitude = Math.max(0, Math.floor((height - 2) / 2));
	const centerColor: Rgba = [foreground[0], foreground[1], foreground[2], Math.round(foreground[3] / 4)];
	for (let x = 0; x < width; x += 1) paintPixel(pixels, width, x, centerY, centerColor);
	for (let x = 0; x < width; x += 1) {
		const extrema = rendering?.mode === 'summary'
			? summaryExtrema(rendering, x, width)
			: interpolatedExtrema(channels, x, width);
		const top = centerY - Math.round(extrema.maximum * maximumAmplitude);
		const bottom = centerY - Math.round(extrema.minimum * maximumAmplitude);
		paintVertical(pixels, width, height, x, top, bottom, foreground);
	}
}

function summaryExtrema(rendering: WaveformRendering, x: number, width: number) {
	const columnCount = Math.max(1, Math.ceil(rendering.pixelWidth));
	const column = Math.min(columnCount - 1, Math.floor(x * columnCount / width));
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const channel of rendering.channels) {
		if (!('minimum' in channel)) continue;
		minimum = Math.min(minimum, finiteSample(channel.minimum[column]));
		maximum = Math.max(maximum, finiteSample(channel.maximum[column]));
	}
	return {
		minimum: Number.isFinite(minimum) ? minimum : 0,
		maximum: Number.isFinite(maximum) ? maximum : 0,
	};
}

function interpolatedExtrema(channels: readonly Float32Array[], x: number, width: number) {
	const sampleCount = channels[0]!.length;
	const position = (x + 0.5) * sampleCount / width - 0.5;
	const first = Math.max(0, Math.min(sampleCount - 1, Math.floor(position)));
	const second = Math.min(sampleCount - 1, first + 1);
	const fraction = Math.max(0, Math.min(1, position - first));
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const channel of channels) {
		const value = finiteSample(channel[first]) * (1 - fraction) + finiteSample(channel[second]) * fraction;
		minimum = Math.min(minimum, value);
		maximum = Math.max(maximum, value);
	}
	return { minimum, maximum };
}

function drawSpectrum(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	channels: readonly Float32Array[], sampleRate: number, foreground: Rgba,
): void {
	const sampleCount = channels[0]!.length;
	const starts = soundVisualizerSpectrumWindowStarts(sampleCount);
	const powers = new Float64Array(SOUND_VISUALIZER_SPECTRUM_SIZE / 2 + 1);
	for (const offsetFrame of starts) {
		const spectrum = calculateAudioSpectrum(channels, sampleRate, {
			size: SOUND_VISUALIZER_SPECTRUM_SIZE, offsetFrame,
		});
		for (let index = 0; index < powers.length; index += 1) {
			powers[index] += spectrum.bins[index]!.amplitude ** 2;
		}
	}
	const lastBin = powers.length - 1;
	let previousY = height - 1;
	for (let x = 0; x < width; x += 1) {
		const normalizedX = x / Math.max(1, width - 1);
		const binIndex = Math.max(1, Math.min(lastBin, Math.round(lastBin ** normalizedX)));
		const db = amplitudeToDb(Math.sqrt(powers[binIndex]! / starts.length));
		const intensity = Math.max(0, Math.min(1,
			(db - SPECTRUM_FLOOR_DB) / (SPECTRUM_CEILING_DB - SPECTRUM_FLOOR_DB),
		));
		const y = Math.round((height - 1) * (1 - intensity));
		if (x > 0) paintLine(pixels, width, height, x - 1, previousY, x, y, foreground);
		else paintPixel(pixels, width, x, y, foreground);
		previousY = y;
	}
}

function paintLine(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	x0: number, y0: number, x1: number, y1: number, rgba: Rgba,
): void {
	const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
	for (let step = 0; step <= steps; step += 1) {
		const fraction = steps === 0 ? 0 : step / steps;
		const x = Math.round(x0 + (x1 - x0) * fraction);
		const y = Math.round(y0 + (y1 - y0) * fraction);
		if (x >= 0 && x < width && y >= 0 && y < height) paintPixel(pixels, width, x, y, rgba);
	}
}

function paintVertical(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	x: number, y0: number, y1: number, rgba: Rgba,
): void {
	const first = Math.max(0, Math.min(y0, y1));
	const last = Math.min(height - 1, Math.max(y0, y1));
	for (let y = first; y <= last; y += 1) paintPixel(pixels, width, x, y, rgba);
}

function paintPixel(pixels: Uint8Array<ArrayBuffer>, width: number, x: number, y: number, rgba: Rgba): void {
	const offset = (y * width + x) * 4;
	const sourceAlpha = rgba[3] / 255;
	if (sourceAlpha === 0) return;
	const targetAlpha = pixels[offset + 3]! / 255;
	const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
	for (let component = 0; component < 3; component += 1) {
		pixels[offset + component] = Math.round((rgba[component]! * sourceAlpha
			+ pixels[offset + component]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
	}
	pixels[offset + 3] = Math.round(outputAlpha * 255);
}

function drawMovingMarker(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number, timelineFrame: number,
): void {
	const x = timelineFrame % width;
	for (let y = 0; y < height; y += 1) {
		const offset = (y * width + x) * 4;
		const luminance = (pixels[offset]! * 299 + pixels[offset + 1]! * 587
			+ pixels[offset + 2]! * 114) / 1_000;
		const value = (luminance < 128) !== (width === 1 && timelineFrame % 2 === 1) ? 255 : 0;
		pixels[offset] = value;
		pixels[offset + 1] = value;
		pixels[offset + 2] = value;
		pixels[offset + 3] = 255;
	}
}

function fillBackground(pixels: Uint8Array<ArrayBuffer>, background: Rgba): void {
	if (background.every((value) => value === 0)) return;
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = background[0];
		pixels[offset + 1] = background[1];
		pixels[offset + 2] = background[2];
		pixels[offset + 3] = background[3];
	}
}

function validateChannels(value: readonly Float32Array[] | null): readonly Float32Array[] | null {
	if (value === null || value.length === 0) return null;
	if (value.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Sound visualizer channels must be Float32Array PCM.');
	}
	const sampleCount = value[0]!.length;
	if (value.some((channel) => channel.length !== sampleCount)) {
		throw new RangeError('Sound visualizer channels must have equal lengths.');
	}
	if (sampleCount > MAXIMUM_PCM_FRAMES) throw new RangeError('Sound visualizer PCM window is too long.');
	return sampleCount === 0 ? null : value;
}

function color(value: string, name: string): Rgba {
	if (typeof value !== 'string' || !/^#[a-f0-9]{8}$/u.test(value)) {
		throw new TypeError(`Sound visualizer ${name} must be canonical #rrggbbaa.`);
	}
	return [
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
		Number.parseInt(value.slice(7, 9), 16),
	];
}

function dimension(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 65_536) {
		throw new RangeError(`Sound visualizer ${name} is invalid.`);
	}
	return value;
}

function nonNegativeFrame(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Sound visualizer ${name} is invalid.`);
	}
	return value;
}

function safeFrame(value: number, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`Sound visualizer ${name} is invalid.`);
	return value;
}

function finiteSample(value: number | undefined): number {
	return Number.isFinite(value) ? Number(value) : 0;
}
