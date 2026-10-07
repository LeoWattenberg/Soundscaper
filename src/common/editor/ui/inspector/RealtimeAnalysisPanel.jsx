/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { EbuR128WorkspacePanel } from '../toolbar/AudioEditorMeters.jsx';
import { ChannelCorrelationJellyfish } from './ChannelCorrelationJellyfish.tsx';

const SPECTRUM_WIDTH = 320;
const SPECTRUM_HEIGHT = 112;
const SPECTROGRAM_WIDTH = 320;
const SPECTROGRAM_HEIGHT = 96;
const MAXIMUM_SPECTRUM_BINS = 128;

export default function RealtimeAnalysisPanel({ controller, copy, settings, active = true, projectId = '' }) {
	return <div className="audio-editor-realtime-analysis" data-realtime-analysis>
		<AnalysisSection id="levels" title={copy.metering} initiallyOpen active={active}>
			<LiveLevels controller={controller} copy={copy} />
		</AnalysisSection>
		<AnalysisSection id="loudness" title={copy.meterTypeEbuR128} active={active}>
			<EbuR128WorkspacePanel controller={controller} copy={copy} settings={settings} />
		</AnalysisSection>
		<AnalysisSection id="spectrum" title={copy.spectrum} active={active}>
			<VisualAnalysisLease controller={controller}>
				<LiveSpectrum controller={controller} copy={copy} />
			</VisualAnalysisLease>
		</AnalysisSection>
		<AnalysisSection id="spectrogram" title={copy.spectrogram} active={active}>
			<VisualAnalysisLease controller={controller}>
				<LiveSpectrogram key={projectId} controller={controller} copy={copy} />
			</VisualAnalysisLease>
		</AnalysisSection>
		<AnalysisSection id="correlation" title={copy.correlation} active={active}>
			<VisualAnalysisLease controller={controller}>
				<ChannelCorrelationJellyfish controller={controller} copy={copy} />
			</VisualAnalysisLease>
		</AnalysisSection>
	</div>;
}

function VisualAnalysisLease({ controller, children }) {
	useEffect(() => controller.engine?.acquireLiveAnalysis?.(), [controller]);
	return children;
}

function AnalysisSection({ id, title, initiallyOpen = false, active, children }) {
	const [open, setOpen] = useState(initiallyOpen);
	return <details data-analysis-section={id} open={open}
		onToggle={(event) => setOpen(event.currentTarget.open)}>
		<summary>{title}</summary>
		{open && active && <div className="audio-editor-realtime-analysis__content">{children}</div>}
	</details>;
}

function LiveLevels({ controller, copy }) {
	const meter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	const peak = Number(meter?.peak);
	const rms = Number(meter?.rms);
	return <div className="audio-editor-analysis-grid" data-live-analysis-levels>
		<LiveLevel label={copy.peak} value={levelDb(peak)} dataKey="peak" />
		<LiveLevel label={copy.rms} value={levelDb(rms)} dataKey="rms" />
		<LiveLevel label={copy.clipping} value={peak >= 1 ? '●' : '—'} dataKey="clipping" />
	</div>;
}

function LiveLevel({ label, value, dataKey }) {
	return <div><span>{label}</span><strong data-live-analysis-value={dataKey}>{value}</strong></div>;
}

function levelDb(amplitude) {
	return Number.isFinite(amplitude) && amplitude > 0
		? `${(20 * Math.log10(amplitude)).toFixed(1)} dBFS`
		: '−∞ dBFS';
}

function LiveSpectrum({ controller, copy }) {
	const bins = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master?.spectrumDb);
	const canvasRef = useRef(null);
	useEffect(() => schedulePaint(canvasRef.current, (context) => paintSpectrum(context, bins)), [bins]);
	return <canvas ref={canvasRef} width={SPECTRUM_WIDTH} height={SPECTRUM_HEIGHT}
		data-live-analysis-spectrum role="img" aria-label={copy.spectrum} />;
}

function LiveSpectrogram({ controller, copy }) {
	const bins = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master?.spectrumDb);
	const canvasRef = useRef(null);
	useEffect(() => schedulePaint(canvasRef.current, (context) => paintSpectrogramColumn(context, bins)), [bins]);
	return <canvas ref={canvasRef} width={SPECTROGRAM_WIDTH} height={SPECTROGRAM_HEIGHT}
		data-live-analysis-spectrogram role="img" aria-label={copy.spectrogram} />;
}

function schedulePaint(canvas, paint) {
	if (!canvas || typeof canvas.getContext !== 'function') return undefined;
	const handle = requestAnimationFrame(() => {
		const context = canvas.getContext('2d');
		if (context) paint(context);
	});
	return () => cancelAnimationFrame(handle);
}

function paintSpectrum(context, bins) {
	context.fillStyle = '#11141a';
	context.fillRect(0, 0, SPECTRUM_WIDTH, SPECTRUM_HEIGHT);
	const count = Math.min(MAXIMUM_SPECTRUM_BINS, bins?.length ?? 0);
	if (!count) return;
	context.strokeStyle = '#66d3c5';
	context.lineWidth = 1.5;
	context.beginPath();
	for (let index = 0; index < count; index += 1) {
		const x = index / Math.max(1, count - 1) * SPECTRUM_WIDTH;
		const y = SPECTRUM_HEIGHT * (1 - intensity(bins[index]));
		if (index) context.lineTo(x, y);
		else context.moveTo(x, y);
	}
	context.stroke();
}

function paintSpectrogramColumn(context, bins) {
	context.drawImage(context.canvas, -1, 0);
	context.fillStyle = '#090b10';
	context.fillRect(SPECTROGRAM_WIDTH - 1, 0, 1, SPECTROGRAM_HEIGHT);
	const count = Math.min(MAXIMUM_SPECTRUM_BINS, bins?.length ?? 0);
	if (!count) return;
	for (let row = 0; row < SPECTROGRAM_HEIGHT; row += 1) {
		const index = Math.min(count - 1, Math.floor((SPECTROGRAM_HEIGHT - 1 - row) / SPECTROGRAM_HEIGHT * count));
		const brightness = intensity(bins[index]);
		context.fillStyle = `hsl(${Math.round(220 - brightness * 180)} 90% ${Math.round(7 + brightness * 60)}%)`;
		context.fillRect(SPECTROGRAM_WIDTH - 1, row, 1, 1);
	}
}

function intensity(value) {
	return Math.max(0, Math.min(1, (Number(value) + 90) / 90 || 0));
}
