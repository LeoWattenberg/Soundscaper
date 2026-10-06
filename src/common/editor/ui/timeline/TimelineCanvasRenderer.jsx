import { useEditorSkin } from '../skins/EditorSkinProvider.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
	subscribePffftSpectrogram,
} from '../../pffft-spectrogram.js';
import { MAXIMUM_WAVEFORM_VERTICAL_ZOOM } from './geometry.ts';
import { useRetainedCanvasFrame } from './useRetainedCanvasFrame.ts';
import { snapshotWaveformCanvasStyle } from './canvas-paint-measurements.ts';
import { paintWaveformSelectionLayers, releaseWaveformSelectionLayers } from './waveform-selection-layers.ts';
import { isFrequencyWaveformDisplayMode } from '../../track-display-mode.ts';
import { reprojectPendingWaveform } from './waveform-plan-continuity.ts';
import { spectrogramCanvasDrawKey } from './spectrogram-canvas-options.ts';
import { audioEditorStereoChannelGeometry } from './stereo-channel-height-runtime.ts';
import { drawAudacityClipSpectrogram, releaseSpectrogramCanvas } from './spectrogram-canvas-renderer.js';
export { drawAudacityClipSpectrogram } from './spectrogram-canvas-renderer.js';

export function AudacityWaveformCanvases({
	rootRef,
	clips,
	displayMode,
	pixelsPerSecond,
	timeSelection,
	showRms,
	halfWave,
	waveformRulerFormat = 'linear-db',
	verticalZoom,
	channelHeightRatio,
	spectrogramOptions,
}) {
	const paintedCanvases = useRef(new Set());
	const scheduleDraw = useRetainedCanvasFrame(rootRef);
	useEffect(() => () => {
		for (const canvas of paintedCanvases.current) { releaseSpectrogramCanvas(canvas); releaseWaveformSelectionLayers(canvas); }
		paintedCanvases.current.clear();
	}, []);
	const { theme } = useTheme();
	const { skin, decoration, mode } = useEditorSkin();
	const themeDrawKey = `${skin}|${decoration}|${mode}|${theme.background.canvas.default}|${theme.foreground.text.primary}`;
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
	const [frequencyWaveformRenderer, setFrequencyWaveformRenderer] = useState(null);
	useEffect(() => subscribePffftSpectrogram(setSpectrogramRevision), []);
	useEffect(() => {
		if ((displayMode !== 'waveform-three-band' && displayMode !== 'waveform-rainbow')
			|| frequencyWaveformRenderer) return undefined;
		let active = true;
		void import('./frequency-waveform-renderer.ts').then((module) => {
			if (active) setFrequencyWaveformRenderer(module);
		}).catch(() => {});
		return () => { active = false; };
	}, [displayMode, frequencyWaveformRenderer]);
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
				waveformRulerFormat,
				verticalZoom,
				channelHeightRatio,
				spectrogramDrawKey,
				spectrogramRevision,
				themeDrawKey,
				editorRoot?.dataset.editorTheme || '',
			].join('|');
			const liveCanvases = new Set();
			const measurements = [];
			// Normalize every canvas before reading any geometry, then measure the
			// whole row before resizing backing stores or painting its canvases.
			const clipElements = root.querySelectorAll('[data-clip-id]');
			for (const element of clipElements) {
				const canvas = element.querySelector('canvas.clip-body__waveform');
				if (canvas) normalizeAudacityCanvasStyle(canvas);
			}
			for (const clipElement of clipElements) {
				const clip = clipById.get(String(clipElement.dataset.clipId));
				const canvas = clipElement.querySelector('canvas.clip-body__waveform');
				if (!canvas) continue;
				liveCanvases.add(canvas);
				const bounds = canvas.getBoundingClientRect();
				const color = canvas.closest('.clip-body')?.dataset.color || 'blue';
				const style = snapshotWaveformCanvasStyle(getComputedStyle(canvas), color);
				measurements.push({ canvas, clip, bounds, style });
			}
			for (const { canvas, clip, bounds, style } of measurements) {
				if (!clip) { resetAudacityClipCanvas(canvas); continue; }
				const selection = clipSelectionPixels(clip, timeSelection, pixelsPerSecond, bounds.width);
				const clipDrawKey = `${drawKey}|${selection.start}|${selection.end}`;
				const canvasDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
				const drawOptions = {
					displayMode,
					pixelsPerSecond,
					timeSelection,
					showRms,
					halfWave,
					waveformRulerFormat,
					verticalZoom,
					channelHeightRatio,
					frequencyWaveformRenderer,
					spectrogramOptions: renderSpectrogramOptions,
					bounds, style,
				};
				if (!clip.audacityWaveform) {
					const oldPlan = canvas.__kwWaveformPlan;
					if (clip.waveformPending && oldPlan && canvas.__kwWaveformState === 'pending'
						&& canvas.__kwWaveformDrawKey === canvasDrawKey
						&& canvas.__kwFrequencyWaveformRenderer === frequencyWaveformRenderer
						&& canvas.__kwPendingFrequencyWaveform === clip.frequencyWaveform) continue;
					const pendingPlan = clip.waveformPending && oldPlan
						? reprojectPendingWaveform(oldPlan, clip, renderSpectrogramOptions.sampleRate, bounds.width)
						: null;
					if (pendingPlan) {
						try {
							const drawn = drawAudacityClipCanvas(canvas, {
								...clip,
								audacityWaveform: pendingPlan,
								frequencyWaveform: clip.frequencyWaveform || frequencyWaveformRenderer?.reprojectPendingFrequencyWaveform?.(
									canvas.__kwFrequencyWaveformPlan, pendingPlan,
								),
							}, { ...drawOptions, peakPreview: peakPlanNeedsPreview(oldPlan, bounds.width) });
							if (drawn) {
								canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
								canvas.__kwWaveformState = 'pending';
								canvas.__kwFrequencyWaveformRenderer = frequencyWaveformRenderer;
								canvas.__kwPendingFrequencyWaveform = clip.frequencyWaveform;
								delete canvas.dataset.waveformError;
							}
						} catch (error) {
							canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
						}
						canvas.dataset.waveformPending = 'true';
						continue;
					}
					resetAudacityClipCanvas(canvas);
					if (clip.waveformError) canvas.dataset.waveformError = clip.waveformError;
					continue;
				}
				if (audacityCanvasPlansAreCurrent(canvas, clip, canvasDrawKey, frequencyWaveformRenderer)
					&& canvas.__kwWaveformState === 'audacity') continue;
				try {
					const drawn = drawAudacityClipCanvas(canvas, clip, {
						...drawOptions,
						peakPreview: peakPlanNeedsPreview(clip.audacityWaveform, bounds.width),
					});
					if (drawn) {
						canvas.__kwWaveformPlan = clip.audacityWaveform;
						canvas.__kwSpectrogramColumnsPlan = clip.spectrogramColumns;
						canvas.__kwFrequencyWaveformPlan = clip.frequencyWaveform;
						canvas.__kwFrequencyWaveformRenderer = frequencyWaveformRenderer;
						canvas.__kwWaveformDrawKey = audacityCanvasDrawKey(canvas, clip, clipDrawKey, bounds);
						canvas.__kwWaveformState = 'audacity';
						delete canvas.dataset.waveformError;
						if (clip.waveformPending) canvas.dataset.waveformPending = 'true';
						else delete canvas.dataset.waveformPending;
					}
				} catch (error) {
					resetAudacityClipCanvas(canvas);
					canvas.dataset.waveformError = error instanceof Error ? error.message : String(error);
				}
			}
			for (const canvas of paintedCanvases.current) {
				if (!liveCanvases.has(canvas)) { releaseSpectrogramCanvas(canvas); releaseWaveformSelectionLayers(canvas); }
			}
			paintedCanvases.current = liveCanvases;
		};
		scheduleDraw(draw);
	}, [channelHeightRatio, clips, displayMode, frequencyWaveformRenderer, halfWave, pixelsPerSecond, renderSpectrogramOptions, rootRef, scheduleDraw, showRms, spectrogramDrawKey, spectrogramRevision, themeDrawKey, timeSelection, verticalZoom, waveformRulerFormat]);
	return null;
}

export function normalizeAudacityCanvasStyle(canvas) {
	if (canvas.style.width) canvas.style.removeProperty('width');
	if (canvas.style.height) canvas.style.removeProperty('height');
}

function peakPlanNeedsPreview(plan, liveWidth) {
	if (!plan?.peakBlockSize) return false;
	const projectedBucketWidth = plan.peakBlockSize * plan.pixelsPerSample
		* liveWidth / plan.pixelWidth;
	return liveWidth > plan.pixelWidth || !(projectedBucketWidth <= 1);
}

export function resetAudacityClipCanvas(canvas) {
	releaseSpectrogramCanvas(canvas);
	releaseWaveformSelectionLayers(canvas);
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
	delete canvas.__kwSpectrogramColumnsPlan;
	delete canvas.__kwFrequencyWaveformPlan;
	delete canvas.__kwFrequencyWaveformRenderer;
	delete canvas.__kwPendingFrequencyWaveform;
	delete canvas.__kwWaveformDrawKey;
	canvas.__kwWaveformState = 'empty';
	delete canvas.dataset.waveformRenderer;
	delete canvas.dataset.waveformMode;
	delete canvas.dataset.waveformOwner;
	delete canvas.dataset.waveformSource;
	delete canvas.dataset.spectrogramRenderer;
	delete canvas.dataset.frequencyWaveformMode;
	delete canvas.dataset.waveformAmplitudeScale;
}

export function audacityCanvasDrawKey(canvas, clip, drawKey, bounds = canvas.getBoundingClientRect()) {
	return [
		drawKey,
		clip.color || '',
		clip.sourceId,
		clip.waveformStartFrame,
		clip.waveformEndFrame,
		clip.start,
		clip.duration,
		clip.trimStart,
		clip.waveformIdentity,
		bounds.width,
		bounds.height,
		canvas.width,
		canvas.height,
		window.devicePixelRatio || 1,
	].join('|');
}

export function audacityCanvasPlansAreCurrent(canvas, clip, canvasDrawKey, frequencyWaveformRenderer) {
	return canvas.__kwWaveformPlan === clip.audacityWaveform
		&& canvas.__kwSpectrogramColumnsPlan === clip.spectrogramColumns
		&& canvas.__kwFrequencyWaveformPlan === clip.frequencyWaveform
		&& canvas.__kwFrequencyWaveformRenderer === frequencyWaveformRenderer
		&& canvas.__kwWaveformDrawKey === canvasDrawKey;
}

export function drawAudacityClipCanvas(canvas, clip, options) {
	const rendering = clip.audacityWaveform;
	const context = canvas.getContext('2d', { alpha: true });
	if (!context || !rendering.channels.length) return false;
	const bounds = options.bounds || canvas.getBoundingClientRect();
	const width = bounds.width || canvas.clientWidth || rendering.pixelWidth;
	const height = bounds.height || canvas.clientHeight;
	if (!(width > 0) || !(height > 0)) return false;
	const body = canvas.closest('.clip-body');
	const color = body?.dataset.color || options.color || 'blue';
	const style = options.style || snapshotWaveformCanvasStyle(getComputedStyle(canvas), color);
	const dimensions = boundedCanvasDimensions(Math.max(1, width), Math.max(1, height), {
		devicePixelRatio: window.devicePixelRatio || 1,
		maximumBackingHeight: 2_048,
	});
	if (canvas.width !== dimensions.backingWidth) canvas.width = dimensions.backingWidth;
	if (canvas.height !== dimensions.backingHeight) canvas.height = dimensions.backingHeight;
	const pixelRatioX = canvas.width / width;
	const pixelRatioY = canvas.height / height;
	if (!(pixelRatioX > 0) || !(pixelRatioY > 0)) return false;

	const frequencyDisplay = isFrequencyWaveformDisplayMode(options.displayMode);
	const baseWaveform = cssColor(style, frequencyDisplay ? '--frequency-sample' : `--clip-${color}-waveform`, '#172533');
	const selectedWaveform = cssColor(style, frequencyDisplay ? '--frequency-selected-sample' : `--clip-${color}-time-selection-waveform`, baseWaveform);
	const baseRms = cssColor(style, frequencyDisplay ? '--frequency-rms' : `--clip-${color}-waveform-rms`, baseWaveform);
	const selectedRms = cssColor(style, frequencyDisplay ? '--frequency-rms' : `--clip-${color}-time-selection-waveform-rms`, baseRms);
	const divider = cssColor(style, frequencyDisplay ? '--frequency-divider' : `--clip-${color}-divider`, 'rgba(0, 0, 0, 0.35)');
	const splitSeparator = cssColor(style, '--split-separator', divider);
	const selection = options.selectionPixels || clipSelectionPixels(clip, options.timeSelection, options.pixelsPerSecond, width);
	const splitY = options.displayMode === 'spectrogram'
		? height
		: options.displayMode === 'multiview' ? height / 2 : 0;
	const waveformHeight = height - splitY;
	const channelCount = Math.min(2, rendering.channels.length);
	const channelGeometry = channelCount > 1
		? audioEditorStereoChannelGeometry(waveformHeight, options.channelHeightRatio)
		: [{ top: 0, height: waveformHeight }];
	const verticalMagnification = 2 ** Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(options.verticalZoom) || 0));
	const amplitudeScale = options.waveformRulerFormat === 'logarithmic-db' ? 'db' : 'linear';
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

	let frequencyPainted = false;
	const cachedSelection = options.cacheSelectionLayers !== false && options.displayMode === 'waveform'
		&& rendering.mode === 'summary' && pixelRatioX === 1 && paintWaveformSelectionLayers(context, {
			key: [rendering, width, height, options.showRms, options.halfWave, options.waveformRulerFormat,
				options.verticalZoom, options.channelHeightRatio, baseWaveform, selectedWaveform, baseRms, selectedRms, divider,
				cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)')],
			width, start: selection.start, end: selection.end,
			draw: (surface, selected) => drawAudacityClipCanvas(surface, clip, { ...options, color, cacheSelectionLayers: false,
				selectionPixels: selected ? { start: 0, end: width } : { start: -1, end: -1 }, bounds: { width, height } }),
			drawEdges: (columnRanges) => drawAudacityClipCanvas(canvas, clip, { ...options, cacheSelectionLayers: false, columnRanges }),
		});
	if (cachedSelection) { releaseSpectrogramCanvas(canvas); delete canvas.dataset.spectrogramRenderer; }
	if (!cachedSelection) {
		if (options.cacheSelectionLayers !== false) releaseWaveformSelectionLayers(canvas);
		context.save();
		context.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0);
		context.globalAlpha = 1;
		context.globalCompositeOperation = 'source-over';
		context.clearRect(0, 0, width, height);
		if (splitY > 0) {
			drawAudacityClipSpectrogram(context, clip.spectrogramWaveform, {
				columns: clip.spectrogramColumns, deferAnalysis: clip.spectrogramDeferred,
				width,
				height: splitY,
				backgroundColor: cssColor(style, '--spectrogram-background', '#010101'),
				dividerColor: divider,
				...options.spectrogramOptions,
				channelHeightRatio: options.channelHeightRatio,
			});
		} else {
			releaseSpectrogramCanvas(canvas);
			delete canvas.dataset.spectrogramRenderer;
		}
		if (waveformHeight > 0 && selection.end > selection.start) {
			context.fillStyle = cssColor(style, frequencyDisplay ? '--frequency-selection-body' : `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)');
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
			const drawingOptions = {
				channel,
				width,
				pixelRatioX,
				...geometry,
				maxAmplitude: geometry.maxAmplitude * verticalMagnification,
				amplitudeScale,
				halfWave: options.halfWave,
				envelopeGain,
				centerLineColor: divider,
				columnRanges: options.columnRanges,
			};
			const channelFrequencyPainted = options.frequencyWaveformRenderer?.drawFrequencyWaveformChannel(
				context, options.displayMode, rendering, clip.frequencyWaveform,
				drawingOptions, style, options.showRms,
			);
			frequencyPainted ||= Boolean(channelFrequencyPainted);
			if (!channelFrequencyPainted) {
				drawAudacityWaveformChannel(context, rendering, {
					...drawingOptions,
					sampleColor: waveformColor,
					rmsColor,
					showRms: options.showRms,
				});
			}
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
	}
	canvas.dataset.waveformRenderer = 'audacity';
	canvas.dataset.waveformMode = rendering.mode;
	canvas.dataset.waveformOwner = 'audacity';
	canvas.dataset.waveformAmplitudeScale = amplitudeScale;
	const frequencyMode = frequencyPainted ? options.displayMode : null;
	if (frequencyMode) canvas.dataset.frequencyWaveformMode = frequencyMode;
	else delete canvas.dataset.frequencyWaveformMode;
	canvas.dataset.waveformSource = frequencyMode
		? 'frequency-analysis'
		: options.peakPreview ? 'peak-preview' : rendering.peakBlockSize ? 'peaks' : 'pcm';
	return true;
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
