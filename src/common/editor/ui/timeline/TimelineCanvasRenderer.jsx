import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { MINIMUM_VISIBLE_CLIP_PIXELS } from './preview.ts';
import { spectrogramCanvasDrawKey } from './spectrogram-canvas-options.ts';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';

const MAXIMUM_INTERPOLATED_PEAK_POINTS = 4_096;

export function AudacityWaveformCanvases({
	rootRef,
	clips,
	displayMode,
	pixelsPerSecond,
	timeSelection,
	showRms,
	halfWave,
	verticalZoom,
	channelHeightRatio,
	spectrogramOptions,
}) {
	const { theme } = useTheme();
	const { decoration, mode } = useEditorSkin();
	const themeDrawKey = `${decoration}|${mode}|${theme.background.canvas.default}|${theme.foreground.text.primary}`;
	const {
		scale,
		minFreq,
		maxFreq,
		fftWindowSize,
		windowType,
		gainDb,
		rangeDb,
		sampleRate,
	} = spectrogramOptions;
	const renderSpectrogramOptions = useMemo(() => ({
		scale,
		minFreq,
		maxFreq,
		fftWindowSize,
		windowType,
		gainDb,
		rangeDb,
		sampleRate,
	}), [fftWindowSize, gainDb, maxFreq, minFreq, rangeDb, sampleRate, scale, windowType]);
	const spectrogramDrawKey = spectrogramCanvasDrawKey(renderSpectrogramOptions);
	const [spectrogramRevision, setSpectrogramRevision] = useState(pffftSpectrogramRevision);
	useEffect(() => subscribePffftSpectrogram(setSpectrogramRevision), []);
	useEffect(() => {
		if (displayMode !== 'spectrogram' && displayMode !== 'multiview') return;
		preparePffftSpectrogram(renderSpectrogramOptions.fftWindowSize).catch(() => {});
	}, [displayMode, renderSpectrogramOptions.fftWindowSize]);
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
				channelHeightRatio,
				spectrogramDrawKey,
				spectrogramRevision,
				themeDrawKey,
				editorRoot?.dataset.editorTheme || '',
			].join('|');
			for (const clipElement of root.querySelectorAll('[data-clip-id]')) {
				const clip = clipById.get(String(clipElement.dataset.clipId));
				const canvas = clipElement.querySelector('canvas.clip-body__waveform');
				if (!canvas) continue;
				normalizeAudacityCanvasStyle(canvas);
				if (!clip) {
					resetAudacityClipCanvas(canvas);
					continue;
				}
				const bounds = canvas.getBoundingClientRect();
				const selection = clipSelectionPixels(clip, timeSelection, pixelsPerSecond, bounds.width);
				const clipDrawKey = `${drawKey}|${selection.start}|${selection.end}`;
				const canvasDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
				const drawOptions = {
					displayMode,
					pixelsPerSecond,
					timeSelection,
					showRms,
					halfWave,
					verticalZoom,
					channelHeightRatio,
					spectrogramOptions: renderSpectrogramOptions,
					bounds,
				};
				if (!clip.audacityWaveform) {
					const oldPlan = canvas.__kwWaveformPlan;
					if (clip.waveformPending && oldPlan && pendingPlanMatchesClip(
						oldPlan, clip, renderSpectrogramOptions.sampleRate, pixelsPerSecond,
					)) {
						const retain = shouldRetainPendingAudacityCanvas(canvas, clip);
						if (retain && canvas.__kwWaveformState === 'audacity'
							&& canvas.__kwWaveformDrawKey === canvasDrawKey) {
							canvas.dataset.waveformPending = 'true';
							continue;
						}
						if (!retain && canvas.__kwWaveformState === 'interpolated-peaks'
							&& canvas.__kwWaveformDrawKey === canvasDrawKey) {
							canvas.dataset.waveformPending = 'true';
							continue;
						}
						const pendingPlan = retain ? oldPlan : interpolatedPeakOutlinePlan(oldPlan);
						if (pendingPlan) {
							try {
								const drawn = drawAudacityClipCanvas(canvas, { ...clip, audacityWaveform: pendingPlan }, drawOptions);
								if (drawn) {
									canvas.__kwWaveformPlan = oldPlan;
									canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
									canvas.__kwWaveformState = retain ? 'audacity' : 'interpolated-peaks';
									if (!canvas.__kwWaveformPaintedWidth) canvas.__kwWaveformPaintedWidth = bounds.width;
									if (!retain) canvas.dataset.waveformSource = 'interpolated-peaks';
									canvas.dataset.waveformPending = 'true';
									delete canvas.dataset.waveformError;
									continue;
								}
							} catch (error) {
								canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
							}
						}
						// A pending read must never erase a previously painted frame.
						canvas.dataset.waveformPending = 'true';
						continue;
					}
					resetAudacityClipCanvas(canvas);
					if (clip.waveformError) canvas.dataset.waveformError = clip.waveformError;
					continue;
				}
				const needsOutline = peakPlanNeedsOutline(clip.audacityWaveform, bounds.width);
				if (canvas.__kwWaveformPlan === clip.audacityWaveform
					&& canvas.__kwWaveformDrawKey === canvasDrawKey
					&& canvas.__kwWaveformState === (needsOutline ? 'interpolated-peaks' : 'audacity')) continue;
				try {
					const outline = needsOutline
						? interpolatedPeakOutlinePlan(clip.audacityWaveform)
						: null;
					const drawn = drawAudacityClipCanvas(canvas, outline
						? { ...clip, audacityWaveform: outline }
						: clip, drawOptions);
					if (drawn) {
						canvas.__kwWaveformPlan = clip.audacityWaveform;
						canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
						canvas.__kwWaveformState = outline ? 'interpolated-peaks' : 'audacity';
						canvas.__kwWaveformPaintedWidth = outline ? clip.audacityWaveform.pixelWidth : bounds.width;
						if (outline) canvas.dataset.waveformSource = 'interpolated-peaks';
						delete canvas.dataset.waveformError;
						if (clip.waveformPending) canvas.dataset.waveformPending = 'true';
						else delete canvas.dataset.waveformPending;
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
	}, [channelHeightRatio, clips, displayMode, halfWave, pixelsPerSecond, renderSpectrogramOptions, rootRef, showRms, spectrogramDrawKey, spectrogramRevision, themeDrawKey, timeSelection, verticalZoom]);
	return null;
}

export function normalizeAudacityCanvasStyle(canvas) {
	if (canvas.style.width) canvas.style.removeProperty('width');
	if (canvas.style.height) canvas.style.removeProperty('height');
}

export function shouldRetainPendingAudacityCanvas(canvas, clip) {
	const plan = canvas?.__kwWaveformPlan;
	if (!clip?.waveformPending || !plan) return false;
	if (!plan.peakBlockSize) return true;
	const liveWidth = canvas.getBoundingClientRect?.().width || canvas.clientWidth || plan.pixelWidth;
	const paintedWidth = canvas.__kwWaveformPaintedWidth;
	return Number.isFinite(paintedWidth) && paintedWidth > 0 && liveWidth <= paintedWidth;
}

function pendingPlanMatchesClip(plan, clip, sampleRate, pixelsPerSecond) {
	if (!Number.isSafeInteger(plan.startFrame) || !Number.isSafeInteger(plan.frameCount)
		|| !(sampleRate > 0) || !(pixelsPerSecond > 0)) return false;
	if (plan.sourceId && clip.sourceId && plan.sourceId !== clip.sourceId) return false;
	const expectedDuration = Math.max(
		plan.frameCount / sampleRate,
		MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
	);
	const frameTolerance = 0.5 / sampleRate;
	return Math.abs(clip.trimStart - plan.startFrame / sampleRate) <= frameTolerance
		&& Math.abs(clip.duration - expectedDuration) <= frameTolerance;
}

function peakPlanNeedsOutline(plan, liveWidth) {
	if (!plan?.peakBlockSize) return false;
	const projectedBucketWidth = plan.peakBlockSize * plan.pixelsPerSample
		* liveWidth / plan.pixelWidth;
	return liveWidth > plan.pixelWidth || !(projectedBucketWidth <= 1);
}

function interpolatedPeakOutlinePlan(plan) {
	if (!plan?.peakBlockSize || !Number.isFinite(plan.pixelWidth) || plan.pixelWidth <= 0
		|| !Array.isArray(plan.channels) || !plan.channels.length) return null;
	const columnCount = Math.min(...plan.channels.map((channel) => Math.min(
		channel.minimum?.length ?? 0,
		channel.maximum?.length ?? 0,
	)));
	const sampleCount = Math.max(2, Math.min(columnCount, MAXIMUM_INTERPOLATED_PEAK_POINTS));
	const lowerChannels = [];
	const upperChannels = [];
	for (const channel of plan.channels) {
		const lower = new Float32Array(sampleCount);
		const upper = new Float32Array(sampleCount);
		for (let point = 0; point < sampleCount; point += 1) {
			const start = Math.floor(point * columnCount / sampleCount);
			const end = Math.ceil((point + 1) * columnCount / sampleCount);
			let minimum = Number.POSITIVE_INFINITY;
			let maximum = Number.NEGATIVE_INFINITY;
			for (let column = start; column < end; column += 1) {
				const lowerValue = Number(channel.minimum[column]);
				const upperValue = Number(channel.maximum[column]);
				minimum = Math.min(minimum, Number.isFinite(lowerValue) ? lowerValue : 0);
				maximum = Math.max(maximum, Number.isFinite(upperValue) ? upperValue : 0);
			}
			lower[point] = Number.isFinite(minimum) ? minimum : 0;
			upper[point] = Number.isFinite(maximum) ? maximum : 0;
		}
		lowerChannels.push({ samples: lower, firstSampleX: 0 });
		upperChannels.push({ samples: upper, firstSampleX: 0 });
	}
	return {
		...plan,
		mode: 'connecting-dots',
		pixelsPerSample: plan.pixelWidth / (sampleCount - 1),
		channels: lowerChannels,
		pendingPeakUpperChannels: upperChannels,
	};
}

export function resetAudacityClipCanvas(canvas) {
	delete canvas.dataset.waveformError;
	delete canvas.dataset.waveformPending;
	const context = canvas.getContext('2d', { alpha: true });
	if (context) {
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.restore();
	}
	delete canvas.__kwWaveformPlan;
	delete canvas.__kwWaveformDrawKey;
	delete canvas.__kwWaveformPaintedWidth;
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
	const channelGeometry = channelCount > 1
		? audioEditorStereoChannelGeometry(waveformHeight, options.channelHeightRatio)
		: [{ top: 0, height: waveformHeight }];
	const upperPeakOutline = rendering.pendingPeakUpperChannels
		? { ...rendering, channels: rendering.pendingPeakUpperChannels }
		: null;
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
			...options.spectrogramOptions,
			channelHeightRatio: options.channelHeightRatio,
		});
	} else delete canvas.dataset.spectrogramRenderer;
	if (waveformHeight > 0 && selection.end > selection.start) {
		context.fillStyle = cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)');
		context.fillRect(selection.start, splitY, selection.end - selection.start, waveformHeight);
	}
	for (let channel = 0; waveformHeight > 0 && channel < channelCount; channel += 1) {
		const channelTop = splitY + channelGeometry[channel].top;
		const channelHeight = channelGeometry[channel].height;
		const geometry = audacityWaveformChannelGeometry(
			channelTop,
			channelHeight,
			options.halfWave,
		);
		context.save();
		context.beginPath();
		context.rect(0, channelTop, width, channelHeight);
		context.clip();
		const channelOptions = {
			channel,
			width,
			pixelRatioX,
			...geometry,
			maxAmplitude: geometry.maxAmplitude * amplitudeScale,
			halfWave: options.halfWave,
			envelopeGain,
			sampleColor: waveformColor,
			rmsColor,
			centerLineColor: divider,
			showRms: options.showRms,
		};
		drawAudacityWaveformChannel(context, rendering, channelOptions);
		if (upperPeakOutline) drawAudacityWaveformChannel(context, upperPeakOutline, channelOptions);
		context.restore();
	}
	context.strokeStyle = divider;
	context.lineWidth = 1;
	if (waveformHeight > 0 && channelCount > 1) {
		drawHorizontalCanvasLine(context, splitY + channelGeometry[1].top, width);
	}
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
		fftWindowSize: options.fftWindowSize,
		pixelSkip: 4,
		scale: options.scale,
		minFreq: options.minFreq,
		maxFreq: options.maxFreq,
		windowType: options.windowType,
		gainDb: options.gainDb,
		rangeDb: options.rangeDb,
		sampleRate: options.sampleRate,
	};
	const channelCount = Math.min(2, channels.length);
	const channelGeometry = channelCount > 1
		? audioEditorStereoChannelGeometry(options.height, options.channelHeightRatio)
		: [{ top: 0, height: options.height }];
	let pffftRendered = true;
	for (let channel = 0; channel < channelCount; channel += 1) {
		const geometry = channelGeometry[channel];
		pffftRendered = renderPffftSpectrogram(
			context,
			channels[channel],
			0,
			geometry.top,
			options.width,
			geometry.height,
			spectrogramOptions,
		) && pffftRendered;
	}
	context.canvas.dataset.spectrogramRenderer = pffftRendered ? 'pffft-wasm' : 'loading-pffft';
	if (channelCount > 1) {
		context.strokeStyle = options.dividerColor;
		context.lineWidth = 1;
		drawHorizontalCanvasLine(context, channelGeometry[1].top, options.width);
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
