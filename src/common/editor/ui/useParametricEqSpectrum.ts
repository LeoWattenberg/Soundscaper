/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type RefObject } from 'react';

const MIN_FREQUENCY = 10;
const MAX_FREQUENCY = 24_000;
const SPECTRUM_BIN_COUNT = 2_048;

type SpectrumSource = 'input' | 'output';
type SpectrumReader = (source: SpectrumSource, target: Float32Array) => unknown;

interface ParametricEqSpectrumOptions {
	readonly readSpectrum?: SpectrumReader;
	readonly sampleRate: number;
	readonly showInput: boolean;
	readonly showOutput: boolean;
}

interface ParametricEqSpectrumRefs {
	readonly inputCanvasRef: RefObject<HTMLCanvasElement | null>;
	readonly outputCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/** Keep realtime spectrum sampling alive when a subscribing parent rerenders. */
export function useParametricEqSpectrum({
	readSpectrum,
	sampleRate,
	showInput,
	showOutput,
}: ParametricEqSpectrumOptions): ParametricEqSpectrumRefs {
	const inputCanvasRef = useRef<HTMLCanvasElement>(null);
	const outputCanvasRef = useRef<HTMLCanvasElement>(null);
	const readerRef = useRef(readSpectrum);
	const readerAvailable = Boolean(readSpectrum);
	readerRef.current = readSpectrum;

	useEffect(() => {
		if (!readerAvailable || (!showInput && !showOutput)) {
			drawSpectrumCanvas(inputCanvasRef.current, null, sampleRate, 'input');
			drawSpectrumCanvas(outputCanvasRef.current, null, sampleRate, 'output');
			return undefined;
		}
		const input = new Float32Array(SPECTRUM_BIN_COUNT);
		const output = new Float32Array(SPECTRUM_BIN_COUNT);
		let animationFrame = 0;
		let previousTime = 0;
		const draw = (time: number) => {
			animationFrame = requestAnimationFrame(draw);
			if (time - previousTime < 33) return;
			previousTime = time;
			const hasInput = showInput && Boolean(readerRef.current?.('input', input));
			const hasOutput = showOutput && Boolean(readerRef.current?.('output', output));
			drawSpectrumCanvas(inputCanvasRef.current, hasInput ? input : null, sampleRate, 'input');
			drawSpectrumCanvas(outputCanvasRef.current, hasOutput ? output : null, sampleRate, 'output');
		};
		animationFrame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animationFrame);
	}, [readerAvailable, sampleRate, showInput, showOutput]);

	return { inputCanvasRef, outputCanvasRef };
}

function drawSpectrumCanvas(
	canvas: HTMLCanvasElement | null,
	values: Float32Array | null,
	sampleRate: number,
	source: SpectrumSource,
): void {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const ratio = Math.min(2, window.devicePixelRatio || 1);
	const width = Math.max(1, Math.round(rect.width * ratio));
	const height = Math.max(1, Math.round(rect.height * ratio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext('2d');
	if (!context) return;
	context.clearRect(0, 0, width, height);
	if (!values) return;
	context.beginPath();
	context.moveTo(0, height);
	for (let pixel = 0; pixel < width; pixel += 2) {
		const fraction = pixel / Math.max(1, width - 1);
		const maximum = Math.min(MAX_FREQUENCY, sampleRate * 0.49);
		const frequency = MIN_FREQUENCY * (maximum / MIN_FREQUENCY) ** fraction;
		const bin = Math.min(values.length - 1, Math.round(frequency / (sampleRate / 2) * values.length));
		const db = Number.isFinite(values[bin]) ? values[bin]! : -120;
		const y = height * (1 - clamp((db + 120) / 120, 0, 1));
		context.lineTo(pixel, y);
	}
	context.lineTo(width, height);
	context.closePath();
	context.fillStyle = source === 'input'
		? 'rgba(82, 155, 255, 0.18)'
		: 'rgba(76, 222, 154, 0.22)';
	context.fill();
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
