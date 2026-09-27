/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { EngineMeterReading } from '../../engine/public-api.ts';
import type { StereoScopePoint } from '../../engine/engine-meter-reading.ts';

interface CorrelationTelemetry {
	readonly meters?: Readonly<{ readonly master?: EngineMeterReading | null }>;
}

interface JellyfishController {
	subscribeTelemetry(listener: () => void): () => unknown;
	getTelemetrySnapshot(): CorrelationTelemetry;
}

interface ChannelCorrelationJellyfishProps {
	readonly controller: JellyfishController;
	readonly copy: Readonly<{ readonly correlation?: string }>;
}

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 82;
const EMPTY_SCOPE: readonly StereoScopePoint[] = Object.freeze([]);

/** The host mounts this only while its realtime correlation section is expanded. */
export function ChannelCorrelationJellyfish({
	controller,
	copy,
}: ChannelCorrelationJellyfishProps) {
	const telemetry = useSyncExternalStore(
		controller.subscribeTelemetry,
		controller.getTelemetrySnapshot,
		controller.getTelemetrySnapshot,
	);
	const meter = telemetry.meters?.master;
	const correlation = meter?.stereoCorrelation;
	const points = meter?.stereoScope ?? EMPTY_SCOPE;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const context = canvasRef.current?.getContext('2d');
		if (context) drawJellyfish(context, points);
	}, [points]);
	const label = copy.correlation || 'Correlation';
	return (
		<figure className="audio-editor-channel-correlation" data-analysis-jellyfish style={{ margin: 0 }}>
			<figcaption>{label}</figcaption>
			<canvas
				ref={canvasRef}
				width={SIZE}
				height={SIZE}
				role="img"
				aria-label={label}
				data-analysis-jellyfish-canvas
				style={{ display: 'block', width: 'min(100%, 200px)', height: 'auto', background: 'var(--stage-raised)', borderRadius: 6 }}
			/>
			<div
				role="meter"
				aria-label={label}
				aria-valuemin={-1}
				aria-valuemax={1}
				aria-valuenow={typeof correlation === 'number' && Number.isFinite(correlation) ? correlation : undefined}
				data-analysis-value="correlation"
			>
				{typeof correlation === 'number' && Number.isFinite(correlation) ? correlation.toFixed(3) : '—'}
			</div>
		</figure>
	);
}

function drawJellyfish(context: CanvasRenderingContext2D, points: readonly StereoScopePoint[]): void {
	context.clearRect(0, 0, SIZE, SIZE);
	context.strokeStyle = 'rgba(130, 153, 170, 0.5)';
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(CENTER, 10);
	context.lineTo(CENTER, SIZE - 10);
	context.moveTo(10, CENTER);
	context.lineTo(SIZE - 10, CENTER);
	context.stroke();
	context.beginPath();
	context.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
	context.stroke();
	if (points.length === 0) return;
	context.strokeStyle = 'rgba(102, 211, 197, 0.65)';
	context.lineWidth = 1.25;
	context.beginPath();
	for (let index = 0; index < points.length; index += 1) {
		const point = points[index]!;
		const x = CENTER + point.x * RADIUS;
		const y = CENTER - point.y * RADIUS;
		if (index === 0) context.moveTo(x, y);
		else context.lineTo(x, y);
	}
	context.stroke();
	context.fillStyle = '#66d3c5';
	for (const point of points) {
		context.fillRect(CENTER + point.x * RADIUS - 1, CENTER - point.y * RADIUS - 1, 2, 2);
	}
}
