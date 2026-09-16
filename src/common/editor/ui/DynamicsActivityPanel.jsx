import { useEffect, useRef, useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';
import { DesignCheckbox } from './inspector/inspector-controls.jsx';
import { drawDynamicsActivityCanvas } from './dynamics-activity-canvas.ts';

/**
 * Live picture of what a dynamics effect is doing to the signal.
 *
 * The response curve answers "what would this effect do to a sample at level
 * X"; this answers "what is it doing right now". The three traces scroll
 * together so the reduction can be read against the input that caused it.
 */
const HISTORY_SECONDS = 6;
const FLOOR_DB = -60;
const REDUCTION_FLOOR_DB = -24;
const FRAME_INTERVAL_MS = 33;

/**
 * Effects that can say what they are doing.
 *
 * Only the Audacity compressor and limiter run in the live effect worklet that
 * reports its readings. The native rack compressor and limiter are browser
 * DynamicsCompressorNodes and the legacy compressor runs over a whole selection,
 * so neither can report, and offering them an empty panel would read as a fault.
 */
export const DYNAMICS_ACTIVITY_TYPES = Object.freeze([
	'audacity-compressor',
	'audacity-limiter',
]);

export function supportsDynamicsActivity(effectType) {
	return DYNAMICS_ACTIVITY_TYPES.includes(String(effectType || ''));
}

export function peakToDecibels(peak) {
	const value = Number(peak);
	if (!Number.isFinite(value) || value <= 0) return FLOOR_DB;
	return Math.max(FLOOR_DB, 20 * Math.log10(value));
}

/**
 * Fold one reading into a fixed-length trail.
 *
 * The trail is a plain array of samples rather than a time series: readings
 * arrive one per display frame, so a reading is one column and a stalled
 * effect simply stops extending the trail instead of stretching its last value
 * across the graph.
 */
export function appendActivityReading(trail, reading, capacity, reductionFloor = REDUCTION_FLOOR_DB) {
	if (!reading) return trail;
	const next = trail.length >= capacity ? trail.slice(trail.length - capacity + 1) : trail.slice();
	next.push({
		inputDb: peakToDecibels(reading.inputPeak),
		outputDb: peakToDecibels(reading.outputPeak),
		reductionDb: Math.max(reductionFloor, Math.min(0, Number(reading.reductionDb) || 0)),
	});
	return next;
}

export default function DynamicsActivityPanel({ readAnalysis, copy, audacity = false, limiter = false }) {
	const canvasRef = useRef(null);
	const trailRef = useRef([]);
	const sequenceRef = useRef(0);
	const [latest, setLatest] = useState(null);
	const [show, setShow] = useState({ input: true, output: true, compression: true });
	const drawOptionsRef = useRef(null);
	drawOptionsRef.current = { audacity, limiter, show };
	const capacity = Math.round((audacity ? limiter ? 2 : 3 : HISTORY_SECONDS) * 1_000 / FRAME_INTERVAL_MS);
	const floor = limiter ? -12 : -48;
	const reductionFloor = audacity ? floor : REDUCTION_FLOOR_DB;
	// Owners bind this per effect, so it is a fresh function on every render; the
	// polling loop reads it through a ref rather than restarting for each one.
	const readAnalysisRef = useRef(readAnalysis);
	readAnalysisRef.current = readAnalysis;

	useEffect(() => {
		let animationFrame = 0;
		let previousTime = 0;
		const draw = (time) => {
			animationFrame = requestAnimationFrame(draw);
			if (time - previousTime < FRAME_INTERVAL_MS) return;
			previousTime = time;
			const read = readAnalysisRef.current;
			const reading = typeof read === 'function' ? read() : null;
			// The newest window is returned until the processor reports another,
			// so a stalled effect must not keep extending the trail with repeats.
			if (reading && reading.sequence !== sequenceRef.current) {
				sequenceRef.current = reading.sequence;
				trailRef.current = appendActivityReading(trailRef.current, reading, capacity, reductionFloor);
				setLatest(reading);
			} else if (!reading && (trailRef.current.length || sequenceRef.current)) {
				trailRef.current = [];
				sequenceRef.current = 0;
				setLatest(null);
			}
			drawDynamicsActivityCanvas(canvasRef.current, trailRef.current, capacity, drawOptionsRef.current);
		};
		animationFrame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animationFrame);
	}, [capacity, reductionFloor]);

	const reductionDb = latest ? Math.max(reductionFloor, Math.min(0, latest.reductionDb)) : null;
	const ticks = Array.from({ length: 5 }, (_, index) => index * floor / 4);
	const meterValue = (db, upwards) => Math.max(0, Math.min(100, upwards ? (1 - db / floor) * 100 : db / floor * 100));
	return (
		<div className={`audio-editor-audacity-layout__activity${audacity ? ' audio-editor-audacity-dynamics__activity' : ''}`} data-dynamics-activity data-dynamics-floor={audacity ? floor : undefined}>
			{audacity && <div className="audio-editor-audacity-dynamics__show">
				<strong>{canonicalCopyValue('effectActivityShow', copy)}</strong>
				{[
					['input', 'effectActivityInput'], ['output', 'effectActivityOutput'], ['compression', 'effectActivityCompression'],
				].map(([key, label]) => <DesignCheckbox
					key={key}
					label={canonicalCopyValue(label, copy)}
					checked={show[key]}
					onChange={checked => setShow(current => ({ ...current, [key]: checked }))}
				/>)}
			</div>}
			<div className={audacity ? 'audio-editor-audacity-dynamics__history' : undefined} role={audacity ? 'img' : undefined} aria-label={audacity ? canonicalCopyValue('effectActivityHistory', copy) : undefined}>
			<div className={audacity ? 'audio-editor-audacity-dynamics__timeline' : undefined}>
			<canvas
				className="audio-editor-audacity-layout__activity-canvas"
				ref={canvasRef}
				aria-hidden="true"
			/>
			</div>
			{audacity && <>
				<div className="audio-editor-audacity-dynamics__meters" aria-hidden="true">
					<div><span style={{ height: `${latest ? meterValue(reductionDb, false) : 0}%` }} /></div>
					<div><span style={{ height: `${latest ? meterValue(peakToDecibels(latest.outputPeak), true) : 0}%` }} /></div>
				</div>
				<div className="audio-editor-audacity-dynamics__history-ticks" aria-hidden="true">
					{ticks.map(tick => <span key={tick}>{tick}</span>)}
				</div>
			</>}
			</div>
			<dl className="audio-editor-audacity-layout__activity-readout">
				<div>
					<dt>{canonicalCopyValue('effectActivityInput', copy)}</dt>
					<dd data-dynamics-activity-input>{formatDecibels(latest && peakToDecibels(latest.inputPeak))}</dd>
				</div>
				<div>
					<dt>{canonicalCopyValue('effectActivityOutput', copy)}</dt>
					<dd data-dynamics-activity-output>{formatDecibels(latest && peakToDecibels(latest.outputPeak))}</dd>
				</div>
				<div>
					<dt>{canonicalCopyValue('effectActivityReduction', copy)}</dt>
					<dd data-dynamics-activity-reduction>{formatDecibels(reductionDb)}</dd>
				</div>
			</dl>
			{latest ? null : (
				<p className="audio-editor-audacity-layout__activity-idle">
					{canonicalCopyValue('effectActivityIdle', copy)}
				</p>
			)}
		</div>
	);
}

export function formatDecibels(value) {
	if (value == null || !Number.isFinite(value)) return '—';
	return `${value <= FLOOR_DB ? '−∞' : value.toFixed(1)} dB`;
}
