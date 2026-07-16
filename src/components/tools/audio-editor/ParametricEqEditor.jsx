import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dilsonspickles/components';
import {
	ParametricEqWasmRuntime,
	loadParametricEqWasmModule,
	normalizeParametricEqParams,
} from '../../../lib/tools/audio-editor/parametric-eq/index.js';

const MIN_FREQUENCY = 10;
const MAX_FREQUENCY = 24_000;
const MIN_GAIN = -24;
const MAX_GAIN = 24;
const MIN_Q = 0.1;
const MAX_Q = 30;
const MAX_BANDS = 12;
const RESPONSE_MIN_DB = -30;
const RESPONSE_MAX_DB = 30;
const GRAPH_WIDTH = 1_000;
const GRAPH_HEIGHT = 360;
const BAND_TYPES = Object.freeze([
	['peaking', 'Bell'],
	['lowshelf', 'Low shelf'],
	['highshelf', 'High shelf'],
	['highpass', 'Low cut'],
	['lowpass', 'High cut'],
	['notch', 'Notch'],
]);
const CUT_SLOPES = Object.freeze([12, 24, 36, 48]);

export function ParametricEqEditor({
	params,
	effectId = 'eq',
	sampleRate = 48_000,
	copy = {},
	disabled = false,
	onGestureBegin,
	onPreview,
	onCommit,
	onCancel,
	onAudition,
	readSpectrum,
}) {
	const normalized = useMemo(
		() => normalizeParametricEqParams(params, effectId),
		[effectId, params],
	);
	const [draft, setDraft] = useState(normalized);
	const [selectedId, setSelectedId] = useState(normalized.bands[0]?.id || null);
	const [auditionedId, setAuditionedId] = useState(null);
	const [showInput, setShowInput] = useState(true);
	const [showOutput, setShowOutput] = useState(true);
	const [response, setResponse] = useState(null);
	const [responseError, setResponseError] = useState('');
	const dragRef = useRef(null);
	const previewFrameRef = useRef(0);
	const pendingPreviewRef = useRef(null);
	const inputCanvasRef = useRef(null);
	const outputCanvasRef = useRef(null);
	const auditionCallbackRef = useRef(onAudition);
	const cancelCallbackRef = useRef(onCancel);
	const responseRuntimeRef = useRef(null);
	const outputGestureRef = useRef(null);
	auditionCallbackRef.current = onAudition;
	cancelCallbackRef.current = onCancel;

	useEffect(() => {
		if (dragRef.current || outputGestureRef.current) return;
		setDraft(normalized);
		setSelectedId((current) => normalized.bands.some((band) => band.id === current)
			? current
			: normalized.bands[0]?.id || null);
	}, [normalized]);

	useEffect(() => () => {
		if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
		const gesture = dragRef.current || outputGestureRef.current;
		dragRef.current = null;
		outputGestureRef.current = null;
		pendingPreviewRef.current = null;
		if (gesture) cancelCallbackRef.current?.(gesture.start);
		auditionCallbackRef.current?.(null);
	}, []);

	useEffect(() => {
		if (!readSpectrum || (!showInput && !showOutput)) {
			drawSpectrumCanvas(inputCanvasRef.current, { input: null, output: null, sampleRate });
			drawSpectrumCanvas(outputCanvasRef.current, { input: null, output: null, sampleRate });
			return undefined;
		}
		const input = new Float32Array(2_048);
		const output = new Float32Array(2_048);
		let animationFrame = 0;
		let previousTime = 0;
		const draw = (time) => {
			animationFrame = requestAnimationFrame(draw);
			if (time - previousTime < 33) return;
			previousTime = time;
			const hasInput = showInput && Boolean(readSpectrum('input', input));
			const hasOutput = showOutput && Boolean(readSpectrum('output', output));
			drawSpectrumCanvas(inputCanvasRef.current, {
				input: hasInput ? input : null, output: null, sampleRate,
			});
			drawSpectrumCanvas(outputCanvasRef.current, {
				input: null, output: hasOutput ? output : null, sampleRate,
			});
		};
		animationFrame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animationFrame);
	}, [readSpectrum, sampleRate, showInput, showOutput]);

	const effectiveMaximum = Math.max(MIN_FREQUENCY, Math.min(MAX_FREQUENCY, sampleRate * 0.49));
	const frequencies = useMemo(() => Float64Array.from({ length: 320 }, (_, index) => (
		MIN_FREQUENCY * (effectiveMaximum / MIN_FREQUENCY) ** (index / 319)
	)), [effectiveMaximum]);
	useEffect(() => {
		let current = true;
		void loadParametricEqWasmModule()
			.then((module) => {
				if (!current) return;
				let runtime = responseRuntimeRef.current;
				if (!runtime || runtime.sampleRate !== sampleRate) {
					runtime = new ParametricEqWasmRuntime(module, { sampleRate, channelCount: 1 });
					responseRuntimeRef.current = runtime;
				}
				runtime.configure(draft, { mode: 'immediate', effectId });
				setResponse(runtime.evaluateResponse(frequencies));
				setResponseError('');
			})
			.catch((error) => {
				if (!current) return;
				setResponse(null);
				setResponseError(error instanceof Error ? error.message : String(error));
			});
		return () => { current = false; };
	}, [draft, effectId, frequencies, sampleRate]);
	const responsePoints = useMemo(() => Array.from(response || [], (gain, index) => {
		const x = index / Math.max(1, response.length - 1) * GRAPH_WIDTH;
		const y = gainToGraphY(gain);
		return `${x.toFixed(2)},${y.toFixed(2)}`;
	}).join(' '), [response]);
	const selectedIndex = draft.bands.findIndex((band) => band.id === selectedId);
	const selectedBand = selectedIndex >= 0 ? draft.bands[selectedIndex] : null;

	const queuePreview = (next) => {
		pendingPreviewRef.current = next;
		if (!onPreview || previewFrameRef.current) return;
		previewFrameRef.current = requestAnimationFrame(() => {
			previewFrameRef.current = 0;
			const pending = pendingPreviewRef.current;
			pendingPreviewRef.current = null;
			if (pending) onPreview(pending);
		});
	};

	const replaceBand = (bandId, changes, { preview = false } = {}) => {
		const next = normalizeParametricEqParams({
			...draft,
			bands: draft.bands.map((band) => band.id === bandId ? { ...band, ...changes } : band),
		}, effectId);
		setDraft(next);
		if (dragRef.current) dragRef.current.latest = next;
		if (preview) queuePreview(next);
		return next;
	};

	const commit = (next = draft) => {
		const value = normalizeParametricEqParams(next, effectId);
		setDraft(value);
		onCommit?.(value);
	};

	const beginDrag = (event, band) => {
		if (disabled || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		setSelectedId(band.id);
		dragRef.current = {
			bandId: band.id,
			start: draft,
			latest: draft,
			startBand: band,
			startX: event.clientX,
			startY: event.clientY,
		};
		onGestureBegin?.(draft);
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};

	const moveDrag = (event) => {
		const drag = dragRef.current;
		if (!drag) return;
		const graph = event.currentTarget.closest('.audio-editor-parametric-eq__graph');
		const rect = graph?.getBoundingClientRect();
		if (!rect?.width || !rect?.height) return;
		const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
		const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
		const band = draft.bands.find((candidate) => candidate.id === drag.bandId);
		if (!band) return;
		if ((event.altKey || event.ctrlKey || event.metaKey) && bandUsesQ(band.type)) {
			const sensitivity = event.shiftKey ? 1 / 960 : 1 / 240;
			replaceBand(band.id, {
				q: clamp(drag.startBand.q * 2 ** ((drag.startY - event.clientY) * sensitivity), MIN_Q, MAX_Q),
			}, { preview: true });
			return;
		}
		const changes = event.shiftKey
			? {
				frequency: drag.startBand.frequency * (effectiveMaximum / MIN_FREQUENCY)
					** ((event.clientX - drag.startX) / rect.width * 0.1),
			}
			: { frequency: MIN_FREQUENCY * (effectiveMaximum / MIN_FREQUENCY) ** x };
		if (bandUsesGain(band.type)) {
			changes.gain = event.shiftKey
				? drag.startBand.gain - (event.clientY - drag.startY) / rect.height * (MAX_GAIN - MIN_GAIN) * 0.1
				: MAX_GAIN - y * (MAX_GAIN - MIN_GAIN);
		}
		replaceBand(band.id, changes, { preview: true });
	};

	const finishDrag = (event) => {
		if (!dragRef.current) return;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		const latest = dragRef.current.latest;
		dragRef.current = null;
		if (previewFrameRef.current) {
			cancelAnimationFrame(previewFrameRef.current);
			previewFrameRef.current = 0;
		}
		pendingPreviewRef.current = null;
		commit(latest);
	};

	const cancelGesture = () => {
		const drag = dragRef.current;
		const outputGesture = outputGestureRef.current;
		if (!drag && !outputGesture) return;
		dragRef.current = null;
		outputGestureRef.current = null;
		if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
		previewFrameRef.current = 0;
		pendingPreviewRef.current = null;
		const start = drag?.start || outputGesture.start;
		setDraft(start);
		onCancel?.(start);
	};

	const addBand = (event) => {
		if (disabled || draft.bands.length >= MAX_BANDS) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
		const y = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
		const id = createBandId(effectId, draft.bands);
		const band = {
			id,
			enabled: true,
			type: 'peaking',
			frequency: MIN_FREQUENCY * (effectiveMaximum / MIN_FREQUENCY) ** x,
			gain: MAX_GAIN - y * (MAX_GAIN - MIN_GAIN),
			q: 1,
			slope: 12,
		};
		const next = normalizeParametricEqParams({ ...draft, bands: [...draft.bands, band] }, effectId);
		setDraft(next);
		setSelectedId(id);
		commit(next);
	};

	const removeSelected = () => {
		if (!selectedBand || disabled) return;
		const next = normalizeParametricEqParams({
			...draft,
			bands: draft.bands.filter((band) => band.id !== selectedBand.id),
		}, effectId);
		setDraft(next);
		setSelectedId(next.bands[Math.min(selectedIndex, next.bands.length - 1)]?.id || null);
		if (auditionedId === selectedBand.id) {
			setAuditionedId(null);
			onAudition?.(null);
		}
		commit(next);
	};

	const reset = () => {
		const next = normalizeParametricEqParams({
			outputGain: 0,
			bands: draft.bands.map((band) => ({ ...band, enabled: true, gain: 0, q: 1 })),
		}, effectId);
		setDraft(next);
		commit(next);
	};

	const finishOutputGain = (event) => {
		const gesture = outputGestureRef.current;
		if (!gesture) return;
		event?.currentTarget?.releasePointerCapture?.(event.pointerId);
		const latest = pendingPreviewRef.current || gesture.latest;
		outputGestureRef.current = null;
		if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
		previewFrameRef.current = 0;
		pendingPreviewRef.current = null;
		commit(latest);
	};

	const setSelectedValue = (key, rawValue) => {
		if (!selectedBand) return;
		const value = key === 'type' || key === 'enabled' ? rawValue : Number(rawValue);
		const next = replaceBand(selectedBand.id, { [key]: value });
		commit(next);
	};

	const handleBandKeyDown = (event, band) => {
		if (disabled) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			setSelectedId(band.id);
			const next = normalizeParametricEqParams({
				...draft,
				bands: draft.bands.filter((candidate) => candidate.id !== band.id),
			}, effectId);
			setDraft(next);
			commit(next);
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const fine = event.shiftKey ? 0.1 : 1;
		const changes = {};
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			changes.frequency = band.frequency * 2 ** ((event.key === 'ArrowRight' ? 1 : -1) * fine / 12);
		} else if (bandUsesGain(band.type)) {
			changes.gain = band.gain + (event.key === 'ArrowUp' ? 1 : -1) * fine;
		} else {
			changes.q = band.q * 2 ** ((event.key === 'ArrowUp' ? 1 : -1) * fine / 12);
		}
		const next = replaceBand(band.id, changes);
		commit(next);
	};

	const handleBandWheel = (event, band) => {
		if (disabled || !bandUsesQ(band.type)) return;
		event.preventDefault();
		setSelectedId(band.id);
		const factor = 2 ** (-Math.sign(event.deltaY) * (event.shiftKey ? 1 / 48 : 1 / 12));
		const next = replaceBand(band.id, { q: clamp(band.q * factor, MIN_Q, MAX_Q) });
		commit(next);
	};

	return (
		<div className="audio-editor-parametric-eq" data-parametric-eq onKeyDown={(event) => {
			if (event.key === 'Escape') cancelGesture();
		}}>
			<div
				className="audio-editor-parametric-eq__graph"
				dir="ltr"
				onDoubleClick={addBand}
				role="application"
				aria-label={copy.parametricEqGraph || 'Parametric equalizer response'}
			>
				<canvas ref={inputCanvasRef} className="audio-editor-parametric-eq__spectrum audio-editor-parametric-eq__spectrum--input" aria-hidden="true" />
				<canvas ref={outputCanvasRef} className="audio-editor-parametric-eq__spectrum audio-editor-parametric-eq__spectrum--output" aria-hidden="true" />
				<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
					<g className="audio-editor-parametric-eq__grid">
						{[-24, -12, 0, 12, 24].map((gain) => <line key={gain} x1="0" x2={GRAPH_WIDTH} y1={gainToGraphY(gain)} y2={gainToGraphY(gain)} />)}
						{[20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000]
							.filter((frequency) => frequency <= effectiveMaximum)
							.map((frequency) => {
								const x = frequencyToFraction(frequency, effectiveMaximum) * GRAPH_WIDTH;
								return <line key={frequency} x1={x} x2={x} y1="0" y2={GRAPH_HEIGHT} />;
							})}
					</g>
					<line className="audio-editor-parametric-eq__zero" x1="0" x2={GRAPH_WIDTH} y1={gainToGraphY(0)} y2={gainToGraphY(0)} />
					{response && <polyline className="audio-editor-parametric-eq__response" points={responsePoints} />}
				</svg>
				{draft.bands.map((band, index) => {
					const effectiveFrequency = Math.min(band.frequency, effectiveMaximum);
					const left = frequencyToFraction(effectiveFrequency, effectiveMaximum) * 100;
					const top = bandUsesGain(band.type) ? (MAX_GAIN - band.gain) / (MAX_GAIN - MIN_GAIN) * 100 : 50;
					const nyquistLimited = band.frequency > effectiveMaximum;
					return (
						<button
							type="button"
							key={band.id}
							className="audio-editor-parametric-eq__handle"
							data-selected={band.id === selectedId ? 'true' : 'false'}
							data-enabled={band.enabled ? 'true' : 'false'}
							data-nyquist-limited={nyquistLimited ? 'true' : 'false'}
							style={{ left: `${left}%`, top: `${top}%` }}
							disabled={disabled}
							aria-label={`${copy.bandNumber?.replace('{number}', String(index + 1)) || `Band ${index + 1}`}: ${formatFrequency(band.frequency)}, ${band.gain.toFixed(1)} dB, Q ${band.q.toFixed(2)}`}
							aria-pressed={band.id === selectedId}
							title={nyquistLimited ? `${formatFrequency(band.frequency)} (${formatFrequency(effectiveFrequency)} effective at ${sampleRate} Hz)` : undefined}
							onClick={() => setSelectedId(band.id)}
							onPointerDown={(event) => beginDrag(event, band)}
							onPointerMove={moveDrag}
							onPointerUp={finishDrag}
							onPointerCancel={cancelGesture}
							onKeyDown={(event) => handleBandKeyDown(event, band)}
							onWheel={(event) => handleBandWheel(event, band)}
						>{index + 1}</button>
					);
				})}
				<div className="audio-editor-parametric-eq__frequency-labels" aria-hidden="true">
					<span>10</span><span>100</span><span>1k</span><span>10k</span><span>{formatFrequency(effectiveMaximum)}</span>
				</div>
			</div>
			{responseError && <p className="audio-editor-field-error" role="alert">{responseError}</p>}

			<div className="audio-editor-parametric-eq__toolbar">
				<Button variant="secondary" disabled={disabled || draft.bands.length >= MAX_BANDS} onClick={() => {
					const id = createBandId(effectId, draft.bands);
					const next = normalizeParametricEqParams({
						...draft,
						bands: [...draft.bands, { id, enabled: true, type: 'peaking', frequency: 1_000, gain: 0, q: 1, slope: 12 }],
					}, effectId);
					setDraft(next);
					setSelectedId(id);
					commit(next);
				}}>{copy.eqAddBand || 'Add band'}</Button>
				<Button variant="secondary" disabled={disabled || !selectedBand} onClick={removeSelected}>{copy.eqDeleteBand || 'Delete band'}</Button>
				<Button variant="secondary" disabled={disabled} onClick={reset}>{copy.reset || 'Reset'}</Button>
				<label><input type="checkbox" checked={showInput} onChange={(event) => setShowInput(event.currentTarget.checked)} /> {copy.eqInputSpectrum || 'Input spectrum'}</label>
				<label><input type="checkbox" checked={showOutput} onChange={(event) => setShowOutput(event.currentTarget.checked)} /> {copy.eqOutputSpectrum || 'Output spectrum'}</label>
			</div>

			{selectedBand && (
				<section className="audio-editor-parametric-eq__inspector" aria-label={copy.eqSelectedBand || 'Selected band'}>
					<label><span>{copy.eqBandType || 'Type'}</span><select disabled={disabled} value={selectedBand.type} onChange={(event) => setSelectedValue('type', event.currentTarget.value)}>{BAND_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
					<label><span>{copy.effectParamFrequency || 'Frequency'} (Hz)</span><NumericCommitInput disabled={disabled} min={MIN_FREQUENCY} max={MAX_FREQUENCY} step="1" value={selectedBand.frequency} onCommit={(value) => setSelectedValue('frequency', value)} /></label>
					{bandUsesGain(selectedBand.type) && <label><span>{copy.eqGain || 'Gain'} (dB)</span><NumericCommitInput disabled={disabled} min={MIN_GAIN} max={MAX_GAIN} step="0.1" value={selectedBand.gain} onCommit={(value) => setSelectedValue('gain', value)} /></label>}
					{bandUsesQ(selectedBand.type) && <label><span>Q</span><NumericCommitInput disabled={disabled} min={MIN_Q} max={MAX_Q} step="0.01" value={selectedBand.q} onCommit={(value) => setSelectedValue('q', value)} /></label>}
					{bandUsesSlope(selectedBand.type) && <label><span>{copy.eqSlope || 'Slope'}</span><select disabled={disabled} value={selectedBand.slope} onChange={(event) => setSelectedValue('slope', event.currentTarget.value)}>{CUT_SLOPES.map((slope) => <option key={slope} value={slope}>{slope} dB/oct</option>)}</select></label>}
					<label className="audio-editor-parametric-eq__check"><input disabled={disabled} type="checkbox" checked={selectedBand.enabled} onChange={(event) => setSelectedValue('enabled', event.currentTarget.checked)} /> {copy.eqBandEnabled || 'Band enabled'}</label>
					<Button variant="secondary" disabled={disabled} onClick={() => {
						const next = auditionedId === selectedBand.id ? null : selectedBand.id;
						setAuditionedId(next);
						onAudition?.(next);
					}}>{auditionedId === selectedBand.id ? (copy.eqStopAudition || 'Stop audition') : (copy.eqAudition || 'Audition')}</Button>
				</section>
			)}

			<label className="audio-editor-parametric-eq__output">
				<span>{copy.eqOutputGain || 'Output gain'} (dB)</span>
				<input disabled={disabled} type="range" min={MIN_GAIN} max={MAX_GAIN} step="0.1" value={draft.outputGain} onPointerDown={(event) => {
					if (!outputGestureRef.current) {
						outputGestureRef.current = { start: draft, latest: draft };
						onGestureBegin?.(draft);
					}
					event.currentTarget.setPointerCapture?.(event.pointerId);
				}} onFocus={() => {
					if (!outputGestureRef.current) {
						outputGestureRef.current = { start: draft, latest: draft };
						onGestureBegin?.(draft);
					}
				}} onChange={(event) => {
					const next = normalizeParametricEqParams({ ...draft, outputGain: Number(event.currentTarget.value) }, effectId);
					setDraft(next);
					if (outputGestureRef.current) outputGestureRef.current.latest = next;
					queuePreview(next);
				}} onPointerUp={finishOutputGain} onPointerCancel={cancelGesture} onKeyDown={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
						&& !outputGestureRef.current) {
						outputGestureRef.current = { start: draft, latest: draft };
						onGestureBegin?.(draft);
					}
				}} onKeyUp={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) finishOutputGain();
				}} onBlur={finishOutputGain} />
				<NumericCommitInput disabled={disabled} min={MIN_GAIN} max={MAX_GAIN} step="0.1" value={draft.outputGain} onCommit={(value) => {
					const next = normalizeParametricEqParams({ ...draft, outputGain: value }, effectId);
					setDraft(next);
					commit(next);
				}} />
			</label>
		</div>
	);
}

function NumericCommitInput({ value, onCommit, disabled, min, max, step }) {
	const formattedValue = String(roundForInput(value));
	const [text, setText] = useState(formattedValue);
	const editingRef = useRef(false);
	const cancelRef = useRef(false);

	useEffect(() => {
		if (!editingRef.current) setText(formattedValue);
	}, [formattedValue]);

	const finish = () => {
		editingRef.current = false;
		if (cancelRef.current) {
			cancelRef.current = false;
			setText(formattedValue);
			return;
		}
		const number = Number(text);
		if (!text.trim() || !Number.isFinite(number)) {
			setText(formattedValue);
			return;
		}
		onCommit?.(number);
	};

	return (
		<input
			disabled={disabled}
			type="number"
			inputMode="decimal"
			min={min}
			max={max}
			step={step}
			value={text}
			onFocus={() => { editingRef.current = true; }}
			onChange={(event) => setText(event.currentTarget.value)}
			onBlur={finish}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.currentTarget.blur();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					cancelRef.current = true;
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function bandUsesGain(type) {
	return type === 'peaking' || type === 'lowshelf' || type === 'highshelf';
}

function bandUsesQ(type) {
	return type === 'peaking' || type === 'notch';
}

function bandUsesSlope(type) {
	return type === 'highpass' || type === 'lowpass';
}

function createBandId(effectId, bands) {
	const prefix = String(effectId || 'eq').replace(/[^a-z0-9_-]+/gi, '-');
	let index = bands.length + 1;
	let id = `${prefix}-band-${index}`;
	const ids = new Set(bands.map((band) => band.id));
	while (ids.has(id)) id = `${prefix}-band-${++index}`;
	return id;
}

function frequencyToFraction(frequency, maximum) {
	return clamp(Math.log(Math.max(MIN_FREQUENCY, frequency) / MIN_FREQUENCY) / Math.log(maximum / MIN_FREQUENCY), 0, 1);
}

function gainToGraphY(gain) {
	return (RESPONSE_MAX_DB - clamp(gain, RESPONSE_MIN_DB, RESPONSE_MAX_DB))
		/ (RESPONSE_MAX_DB - RESPONSE_MIN_DB) * GRAPH_HEIGHT;
}

function drawSpectrumCanvas(canvas, { input, output, sampleRate }) {
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
	context.clearRect(0, 0, width, height);
	const draw = (values, fill) => {
		if (!values) return;
		context.beginPath();
		context.moveTo(0, height);
		for (let pixel = 0; pixel < width; pixel += 2) {
			const fraction = pixel / Math.max(1, width - 1);
			const frequency = MIN_FREQUENCY * (Math.min(MAX_FREQUENCY, sampleRate * 0.49) / MIN_FREQUENCY) ** fraction;
			const bin = Math.min(values.length - 1, Math.round(frequency / (sampleRate / 2) * values.length));
			const db = Number.isFinite(values[bin]) ? values[bin] : -120;
			const y = height * (1 - clamp((db + 120) / 120, 0, 1));
			context.lineTo(pixel, y);
		}
		context.lineTo(width, height);
		context.closePath();
		context.fillStyle = fill;
		context.fill();
	};
	draw(input, 'rgba(82, 155, 255, 0.18)');
	draw(output, 'rgba(76, 222, 154, 0.22)');
}

function formatFrequency(value) {
	const frequency = Number(value) || 0;
	return frequency >= 1_000 ? `${(frequency / 1_000).toFixed(frequency >= 10_000 ? 1 : 2).replace(/\.0+$/, '')}k` : `${Math.round(frequency)}`;
}

function roundForInput(value) {
	return Math.round(Number(value) * 100) / 100;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, Number(value)));
}
