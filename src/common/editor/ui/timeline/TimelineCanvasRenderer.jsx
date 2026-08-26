import { useEffect, useLayoutEffect, useState } from 'react';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';

import { boundedCanvasDimensions } from '../../design-system-adapters.js';
import { createEnvelopeValueEvaluator } from '../../automation.js';
import {
	audacityWaveformChannelGeometry,
	drawAudacityWaveformChannel,
} from '../../audacity-waveform-renderer.js';
import {
	pffftSpectrogramRevision,
	preparePffftSpectrogram,
	renderPffftSpectrogram,
	subscribePffftSpectrogram,
} from '../../pffft-spectrogram.js';
import { MAXIMUM_WAVEFORM_VERTICAL_ZOOM } from './geometry.ts';
import { createAnimationFrameCoalescer } from './animation-frame-coalescer.ts';

export function AudacityWaveformCanvases({
	rootRef,
	clips,
	displayMode,
	pixelsPerSecond,
	timeSelection,
	showRms,
	halfWave,
	verticalZoom,
	spectrogramScale,
}) {
	const { theme } = useTheme();
	const themeDrawKey = `${theme.background.canvas.default}|${theme.foreground.text.primary}`;
	const [spectrogramRevision, setSpectrogramRevision] = useState(pffftSpectrogramRevision);
	useEffect(() => subscribePffftSpectrogram(setSpectrogramRevision), []);
	useEffect(() => {
		if (displayMode !== 'spectrogram' && displayMode !== 'multiview') return;
		preparePffftSpectrogram(64).catch(() => {});
	}, [displayMode]);
	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		const draw = () => {
			const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
			const editorRoot = root.closest('#kw-audio-editor-design-system');
			const drawKey = [
				displayMode,
				pixelsPerSecond,
				showRms,
				halfWave,
				verticalZoom,
				spectrogramScale,
				spectrogramRevision,
				themeDrawKey,
				editorRoot?.dataset.editorTheme || '',
				timeSelection?.startTime ?? '',
				timeSelection?.endTime ?? '',
			].join('|');
			for (const clipElement of root.querySelectorAll('[data-clip-id]')) {
				const clip = clipById.get(String(clipElement.dataset.clipId));
				const canvas = clipElement.querySelector('canvas.clip-body__waveform');
				if (!canvas) continue;
				normalizeAudacityCanvasStyle(canvas);
				if (!clip?.audacityWaveform) {
					resetAudacityClipCanvas(canvas);
					if (clip?.waveformError) canvas.dataset.waveformError = clip.waveformError;
					continue;
				}
				const bounds = canvas.getBoundingClientRect();
				const canvasDrawKey = audacityCanvasDrawKey(canvas, clip, drawKey, bounds);
				if (canvas.__kwWaveformPlan === clip.audacityWaveform && canvas.__kwWaveformDrawKey === canvasDrawKey) continue;
				try {
					const drawn = drawAudacityClipCanvas(canvas, clip, {
						displayMode,
						pixelsPerSecond,
						timeSelection,
						showRms,
						halfWave,
						verticalZoom,
						spectrogramScale,
						bounds,
					});
					if (drawn) {
						canvas.__kwWaveformPlan = clip.audacityWaveform;
						canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, drawKey, bounds);
						canvas.__kwWaveformState = 'audacity';
						delete canvas.dataset.waveformError;
					}
				} catch (error) {
					resetAudacityClipCanvas(canvas);
					canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
				}
			}
		};
		const scheduler = createAnimationFrameCoalescer(
			(callback) => window.requestAnimationFrame(callback),
			(frame) => window.cancelAnimationFrame(frame),
			draw,
		);
		const resizeObserver = typeof ResizeObserver === 'function'
			? new ResizeObserver(scheduler.schedule)
			: null;

		draw();
		resizeObserver?.observe(root);
		return () => {
			resizeObserver?.disconnect();
			scheduler.dispose();
		};
	}, [clips, displayMode, halfWave, pixelsPerSecond, rootRef, showRms, spectrogramRevision, spectrogramScale, themeDrawKey, timeSelection, verticalZoom]);
	return null;
}

export function normalizeAudacityCanvasStyle(canvas) {
	if (canvas.style.width) canvas.style.removeProperty('width');
	if (canvas.style.height) canvas.style.removeProperty('height');
}

export function resetAudacityClipCanvas(canvas) {
	delete canvas.dataset.waveformError;
	const context = canvas.getContext('2d', { alpha: true });
	if (context) {
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.restore();
	}
	delete canvas.__kwWaveformPlan;
	delete canvas.__kwWaveformDrawKey;
	canvas.__kwWaveformState = 'empty';
	delete canvas.dataset.waveformRenderer;
	delete canvas.dataset.waveformMode;
	delete canvas.dataset.waveformOwner;
	delete canvas.dataset.waveformSource;
	delete canvas.dataset.spectrogramRenderer;
}

export function audacityCanvasDrawKey(canvas, clip, drawKey, bounds = canvas.getBoundingClientRect()) {
	return [
		drawKey,
		clip.color || '',
		clip.start,
		clip.duration,
		bounds.width,
		bounds.height,
		canvas.width,
		canvas.height,
		window.devicePixelRatio || 1,
	].join('|');
}

export function drawAudacityClipCanvas(canvas, clip, options) {
	const rendering = clip.audacityWaveform;
	const context = canvas.getContext('2d', { alpha: true });
	if (!context || !rendering.channels.length) return false;
	const bounds = options.bounds || canvas.getBoundingClientRect();
	const width = bounds.width || canvas.clientWidth || rendering.pixelWidth;
	const height = bounds.height || canvas.clientHeight;
	if (!(width > 0) || !(height > 0)) return false;
	const dimensions = boundedCanvasDimensions(Math.max(1, width), Math.max(1, height), {
		devicePixelRatio: window.devicePixelRatio || 1,
		maximumBackingHeight: 2_048,
	});
	if (canvas.width !== dimensions.backingWidth) canvas.width = dimensions.backingWidth;
	if (canvas.height !== dimensions.backingHeight) canvas.height = dimensions.backingHeight;
	const pixelRatioX = canvas.width / width;
	const pixelRatioY = canvas.height / height;
	if (!(pixelRatioX > 0) || !(pixelRatioY > 0)) return false;

	const body = canvas.closest('.clip-body');
	const color = body?.dataset.color || 'blue';
	const style = getComputedStyle(canvas);
	const baseWaveform = cssColor(style, `--clip-${color}-waveform`, '#172533');
	const selectedWaveform = cssColor(style, `--clip-${color}-time-selection-waveform`, baseWaveform);
	const baseRms = cssColor(style, `--clip-${color}-waveform-rms`, baseWaveform);
	const selectedRms = cssColor(style, `--clip-${color}-time-selection-waveform-rms`, baseRms);
	const divider = cssColor(style, `--clip-${color}-divider`, 'rgba(0, 0, 0, 0.35)');
	const splitSeparator = cssColor(style, '--split-separator', divider);
	const selection = clipSelectionPixels(clip, options.timeSelection, options.pixelsPerSecond, width);
	const splitY = options.displayMode === 'spectrogram'
		? height
		: options.displayMode === 'multiview' ? height / 2 : 0;
	const waveformHeight = height - splitY;
	const channelCount = Math.min(2, rendering.channels.length);
	const channelHeight = waveformHeight / channelCount;
	const amplitudeScale = 2 ** Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(options.verticalZoom) || 0));
	const evaluateEnvelope = rendering.envelope?.length
		? createEnvelopeValueEvaluator(rendering.envelope, rendering.durationFrames)
		: null;
	const envelopeGain = evaluateEnvelope
		? (x) => evaluateEnvelope(rendering.startFrame + x / width * rendering.frameCount)
		: undefined;
	const waveformColor = (x) => x >= selection.start && x < selection.end
		? selectedWaveform
		: baseWaveform;
	const rmsColor = (x) => x >= selection.start && x < selection.end ? selectedRms : baseRms;
	if (body) {
		if (options.halfWave) {
			body.dataset.halfWave = 'true';
			body.dataset.waveformChannels = String(channelCount);
		} else {
			delete body.dataset.halfWave;
			delete body.dataset.waveformChannels;
		}
	}

	context.save();
	context.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = 'source-over';
	context.clearRect(0, 0, width, height);
	if (splitY > 0) {
		drawAudacityClipSpectrogram(context, clip.spectrogramWaveform, {
			width,
			height: splitY,
			backgroundColor: cssColor(style, '--spectrogram-background', '#010101'),
			dividerColor: divider,
			scale: options.spectrogramScale,
		});
	} else delete canvas.dataset.spectrogramRenderer;
	if (waveformHeight > 0 && selection.end > selection.start) {
		context.fillStyle = cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)');
		context.fillRect(selection.start, splitY, selection.end - selection.start, waveformHeight);
	}
	for (let channel = 0; waveformHeight > 0 && channel < channelCount; channel += 1) {
		const channelTop = splitY + channelHeight * channel;
		const geometry = audacityWaveformChannelGeometry(
			channelTop,
			channelHeight,
			options.halfWave,
		);
		context.save();
		context.beginPath();
		context.rect(0, channelTop, width, channelHeight);
		context.clip();
		drawAudacityWaveformChannel(context, rendering, {
			channel,
			width,
			...geometry,
			maxAmplitude: geometry.maxAmplitude * amplitudeScale,
			halfWave: options.halfWave,
			envelopeGain,
			sampleColor: waveformColor,
			rmsColor,
			centerLineColor: divider,
			showRms: options.showRms,
		});
		context.restore();
	}
	context.strokeStyle = divider;
	context.lineWidth = 1;
	if (waveformHeight > 0 && channelCount > 1) drawHorizontalCanvasLine(context, splitY + channelHeight, width);
	if (splitY > 0 && waveformHeight > 0) {
		context.strokeStyle = splitSeparator;
		drawHorizontalCanvasLine(context, splitY, width);
	}
	context.restore();
	canvas.dataset.waveformRenderer = 'audacity';
	canvas.dataset.waveformMode = rendering.mode;
	canvas.dataset.waveformOwner = 'audacity';
	canvas.dataset.waveformSource = rendering.peakBlockSize ? 'peaks' : 'pcm';
	return true;
}

export function drawAudacityClipSpectrogram(context, channels, options) {
	context.fillStyle = options.backgroundColor;
	context.fillRect(0, 0, options.width, options.height);
	if (!channels?.length || !channels[0]?.length) return;
	const spectrogramOptions = {
		frequencyBands: 16,
		fftWindowSize: 64,
		intensityMultiplier: 1.5,
		pixelSkip: 4,
		scale: options.scale,
	};
	const channelCount = Math.min(2, channels.length);
	const channelHeight = options.height / channelCount;
	let pffftRendered = true;
	for (let channel = 0; channel < channelCount; channel += 1) {
		pffftRendered = renderPffftSpectrogram(
			context,
			channels[channel],
			0,
			channel * channelHeight,
			options.width,
			channelHeight,
			spectrogramOptions,
		) && pffftRendered;
	}
	context.canvas.dataset.spectrogramRenderer = pffftRendered ? 'pffft-wasm' : 'loading-pffft';
	if (channelCount > 1) {
		context.strokeStyle = options.dividerColor;
		context.lineWidth = 1;
		drawHorizontalCanvasLine(context, channelHeight, options.width);
	}
}

export function clipSelectionPixels(clip, selection, pixelsPerSecond, width) {
	if (!selection) return { start: -1, end: -1 };
	const overlapStart = Math.max(clip.start, selection.startTime);
	const overlapEnd = Math.min(clip.start + clip.duration, selection.endTime);
	if (overlapStart >= overlapEnd) return { start: -1, end: -1 };
	return {
		start: Math.max(0, Math.min(width, (overlapStart - clip.start) * pixelsPerSecond)),
		end: Math.max(0, Math.min(width, (overlapEnd - clip.start) * pixelsPerSecond)),
	};
}

export function cssColor(style, property, fallback) {
	return style.getPropertyValue(property).trim() || fallback;
}

export function drawHorizontalCanvasLine(context, y, width) {
	context.beginPath();
	context.moveTo(0, y);
	context.lineTo(width, y);
	context.stroke();
}
