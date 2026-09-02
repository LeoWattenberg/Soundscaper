import { useEffect, useRef, useState } from 'react';
import { canonicalCopyValue } from '../../i18n/canonical-extras.js';

/**
 * Live picture of what a dynamics effect is doing to the signal.
 *
 * The response curve answers "what would this effect do to a sample at level
 * X"; this answers "what is it doing right now". The three traces scroll
 * together so the reduction can be read against the input that caused it.
 */
const HISTORY_SECONDS = 6;
const FLOOR_DB = -60;
const CEILING_DB = 6;
const REDUCTION_FLOOR_DB = -24;
const FRAME_INTERVAL_MS = 33;

export const DYNAMICS_ACTIVITY_TYPES = Object.freeze([
	'audacity-compressor',
	'audacity-legacy-compressor',
	'audacity-limiter',
	'compressor',
	'limiter',
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
export function appendActivityReading(trail, reading, capacity) {
	if (!reading) return trail;
	const next = trail.length >= capacity ? trail.slice(trail.length - capacity + 1) : trail.slice();
	next.push({
		inputDb: peakToDecibels(reading.inputPeak),
		outputDb: peakToDecibels(reading.outputPeak),
		reductionDb: Math.max(REDUCTION_FLOOR_DB, Math.min(0, Number(reading.reductionDb) || 0)),
	});
	return next;
}

function decibelRow(db, height) {
	const span = CEILING_DB - FLOOR_DB;
	return height * (1 - (Math.max(FLOOR_DB, Math.min(CEILING_DB, db)) - FLOOR_DB) / span);
}

function drawActivityCanvas(canvas, trail, capacity) {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
	const width = Math.max(1, Math.round(rect.width * ratio));
	const height = Math.max(1, Math.round(rect.height * ratio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext('2d');
	if (!context) return;
	context.clearRect(0, 0, width, height);
	const columnWidth = width / Math.max(1, capacity);
	const columnAt = (index) => index * columnWidth;
	const trace = (pick, stroke, lineWidth) => {
		if (trail.length < 2) return;
		context.beginPath();
		for (let index = 0; index < trail.length; index += 1) {
			const y = pick(trail[index]);
			if (index === 0) context.moveTo(columnAt(index), y);
			else context.lineTo(columnAt(index), y);
		}
		context.strokeStyle = stroke;
		context.lineWidth = lineWidth * ratio;
		context.lineJoin = 'round';
		context.stroke();
	};
	// Reduction is drawn as a filled band hanging from the top so the amount
	// taken off reads as a quantity rather than another level trace.
	if (trail.length >= 2) {
		context.beginPath();
		context.moveTo(columnAt(0), 0);
		for (let index = 0; index < trail.length; index += 1) {
			context.lineTo(columnAt(index), height * (-trail[index].reductionDb / -REDUCTION_FLOOR_DB));
		}
		context.lineTo(columnAt(trail.length - 1), 0);
		context.closePath();
		context.fillStyle = 'rgba(255, 176, 82, 0.28)';
		context.fill();
	}
	trace((sample) => decibelRow(sample.inputDb, height), 'rgba(82, 155, 255, 0.75)', 1.5);
	trace((sample) => decibelRow(sample.outputDb, height), 'rgba(76, 222, 154, 0.9)', 1.5);
}

export default function DynamicsActivityPanel({ readAnalysis, copy }) {
	const canvasRef = useRef(null);
	const trailRef = useRef([]);
	const sequenceRef = useRef(0);
	const [latest, setLatest] = useState(null);
	const capacity = Math.round(HISTORY_SECONDS * 1_000 / FRAME_INTERVAL_MS);
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
				trailRef.current = appendActivityReading(trailRef.current, reading, capacity);
				setLatest(reading);
			} else if (!reading && (trailRef.current.length || sequenceRef.current)) {
				trailRef.current = [];
				sequenceRef.current = 0;
				setLatest(null);
			}
			drawActivityCanvas(canvasRef.current, trailRef.current, capacity);
		};
		animationFrame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(animationFrame);
	}, [capacity]);

	const reductionDb = latest ? Math.max(REDUCTION_FLOOR_DB, Math.min(0, latest.reductionDb)) : null;
	return (
		<div className="audio-editor-audacity-layout__activity" data-dynamics-activity>
			<canvas
				className="audio-editor-audacity-layout__activity-canvas"
				ref={canvasRef}
				aria-hidden="true"
			/>
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
