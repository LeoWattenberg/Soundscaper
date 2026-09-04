import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { boundedCanvasDimensions } from '../../design-system-adapters.js';
import {
	createFallbackFileService,
	formatDb,
	formatLoudness,
	macroFileName,
} from './inspector-helpers.ts';

export function AnalysisPanel({ mode = 'levels', controller, snapshot, copy, fileService }) {
	return <AnalysisContent mode={mode} controller={controller} snapshot={snapshot} copy={copy} fileService={fileService} />;
}

function AnalysisContent({ mode, controller, snapshot, copy, fileService }) {
	const result = snapshot.analysis;
	const report = snapshot.analysisReport;
	const blocked = !snapshot.ready || !snapshot.project?.clips?.length || snapshot.importing || snapshot.recording || snapshot.exporting || snapshot.analysisProcessing || snapshot.missingSourceIds?.length > 0;
	const ownershipKey = `${snapshot.project?.id || ''}:${mode}`;
	const [errorState, setErrorState] = useState(null);
	const activeOperationRef = useRef(null);
	const requestedContentRef = useRef('');
	const error = errorState?.ownershipKey === ownershipKey ? errorState.message : '';
	useEffect(() => () => {
		activeOperationRef.current = null;
	}, [ownershipKey]);
	const perform = useCallback((operation) => {
		const operationId = Symbol('analysis-panel-operation');
		activeOperationRef.current = operationId;
		setErrorState(null);
		const publishFailure = (cause) => {
			if (activeOperationRef.current !== operationId) return;
			setErrorState({
				ownershipKey,
				message: cause instanceof Error ? cause.message : String(cause),
			});
		};
		try {
			Promise.resolve(operation()).catch(publishFailure);
		} catch (cause) {
			publishFailure(cause);
		}
	}, [ownershipKey]);
	const run = useCallback((scope) => {
		perform(() => {
			if (mode === 'spectrum') return controller.actions.analysis.plotSpectrum(scope);
			if (mode === 'clipping') return controller.actions.analysis.findClipping(scope);
			return controller.actions.analysis.run(scope);
		});
	}, [controller, mode, perform]);
	const selectedTrackIsAudio = snapshot.project?.tracks?.some((track) => (
		track.id === snapshot.selectedTrackId && track.type === 'audio'
	));
	const contentKey = [
		mode,
		snapshot.project?.id,
		snapshot.project?.revision,
		snapshot.selectedTrackId,
		snapshot.selection?.startFrame,
		snapshot.selection?.endFrame,
	].join(':');
	useEffect(() => {
		if (mode === 'contrast' || blocked || requestedContentRef.current === contentKey) return undefined;
		const timeout = setTimeout(() => {
			requestedContentRef.current = contentKey;
			run(selectedTrackIsAudio ? 'track' : 'master');
		}, 120);
		return () => clearTimeout(timeout);
	}, [blocked, contentKey, mode, run, selectedTrackIsAudio]);
	const captureContrast = (role) => {
		const scope = snapshot.selectedTrackId ? 'track' : 'master';
		perform(() => controller.actions.analysis.contrast(role, scope));
	};
	const exportReport = () => {
		const payload = JSON.stringify({
			schemaVersion: 1,
			project: {
				id: snapshot.project?.id,
				title: snapshot.project?.title,
				sampleRate: snapshot.project?.sampleRate,
			},
			mode,
			result,
			report,
		}, null, 2);
		perform(() => (fileService || createFallbackFileService()).saveFile({
			purpose: 'report',
			suggestedName: `${macroFileName(snapshot.project?.title || 'soundscaper')}-analysis.json`,
			mimeType: 'application/json',
			text: payload,
		}));
	};
	const values = [
		['peak', copy.peak, formatDb(result?.peakDbfs, 'dBFS')],
		['truePeak', copy.truePeak, formatDb(result?.truePeakDbtp, 'dBTP')],
		['rms', copy.rms, formatDb(result?.rmsDbfs, 'dBFS')],
		['momentary', copy.lufsMomentary, formatLoudness(result?.momentaryLufs, 'LUFS')],
		['shortTerm', copy.lufsShort, formatLoudness(result?.shortTermLufs, 'LUFS')],
		['integrated', copy.lufsIntegrated, formatLoudness(result?.integratedLufs, 'LUFS')],
		['lra', copy.lra, formatLoudness(result?.loudnessRangeLufs, 'LU')],
		['correlation', copy.correlation, Number.isFinite(result?.stereoCorrelation) ? result.stereoCorrelation.toFixed(3) : '—'],
		['clipping', copy.clipping, String(result?.clippedSamples ?? 0)],
	];
	return (
		<div
			className="audio-editor-analysis-inspector"
			data-analysis-scope={report?.scope}
			data-analysis-start-frame={report?.startFrame}
			data-analysis-end-frame={report?.endFrame}
		>
			<h3>{copy.metering}</h3>
			<div className="audio-editor-analysis-grid" data-analysis-values>
				{values.map(([key, label, value]) => (
					<div key={key}><span>{label}</span><strong data-analysis-value={key}>{value}</strong></div>
				))}
			</div>
			{snapshot.analysisVisuals && (
				<AnalysisVisuals visuals={snapshot.analysisVisuals} copy={copy} />
			)}
			<AnalysisReport report={report} mode={mode} copy={copy} sampleRate={snapshot.project?.sampleRate || 48_000} />
			{result && (
				<p className="audio-editor-panel-hint">
					{copy.analysisSummary
						.replace('{channelCount}', String(result.channelCount))
						.replace('{duration}', (result.durationSeconds || 0).toFixed(2))
						.replace('{sampleRate}', String(result.sampleRate))}
				</p>
			)}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			<div className="audio-editor-panel-actions">
				{mode === 'contrast' ? (
					<>
						<span data-analyze="contrast-foreground"><Button disabled={blocked || !snapshot.selection} onClick={() => captureContrast('foreground')}>{copy.captureContrastForeground}</Button></span>
						<span data-analyze="contrast-background"><Button disabled={blocked || !snapshot.selection} onClick={() => captureContrast('background')}>{copy.captureContrastBackground}</Button></span>
					</>
				) : (
					<span data-analyze="master"><Button disabled={blocked} onClick={() => run('master')}>{copy.analyzeMaster}</Button></span>
				)}
				<Button variant="secondary" disabled={!result && !report} onClick={exportReport}>{copy.export}</Button>
			</div>
		</div>
	);
}

function AnalysisReport({ report, mode, copy, sampleRate }) {
	if (!report || (mode !== 'levels' && report.type !== mode)) return null;
	if (report.type === 'spectrum') {
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="spectrum">
				<h4>{copy.plotSpectrum}</h4>
				<p>{copy.spectrumPeak}: <strong>{Number(report.peak?.frequency || 0).toFixed(1)} Hz · {formatDb(report.peak?.db, 'dB')}</strong></p>
				<p>{report.size} FFT · {report.sampleRate} Hz</p>
			</section>
		);
	}
	if (report.type === 'clipping') {
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="clipping">
				<h4>{copy.findClipping}</h4>
				<p>{report.regionCount ? copy.clippingRegions.replace('{count}', String(report.regionCount)) : copy.noClippingRegions}</p>
				{report.regions?.length > 0 && (
					<ol>
						{report.regions.slice(0, 20).map((region) => (
							<li key={`${region.startFrame}-${region.endFrame}`}>
								{(region.startFrame / sampleRate).toFixed(3)}–{(region.endFrame / sampleRate).toFixed(3)} s · {formatDb(20 * Math.log10(region.peakAmplitude), 'dBFS')}
							</li>
						))}
					</ol>
				)}
			</section>
		);
	}
	if (report.type === 'contrast') {
		const difference = Number.isFinite(report.differenceDb) ? `${report.differenceDb.toFixed(2)} dB` : '—';
		return (
			<section className="audio-editor-analysis-report" data-analysis-report="contrast">
				<h4>{copy.contrast}</h4>
				<p>{copy.contrastForeground}: <strong>{formatDb(report.foreground?.rmsDb, 'dBFS')}</strong></p>
				<p>{copy.contrastBackground}: <strong>{formatDb(report.background?.rmsDb, 'dBFS')}</strong></p>
				<p>{copy.contrastDifference}: <strong>{difference}</strong></p>
				{report.passes != null && <p role="status">{report.passes ? copy.contrastPass : copy.contrastFail}</p>}
			</section>
		);
	}
	return null;
}

function AnalysisVisuals({ visuals, copy }) {
	const spectrumRef = useRef(null);
	const spectrogramRef = useRef(null);
	useBoundedAnalysisCanvas(spectrumRef, visuals.spectrum?.samples, drawSpectrum);
	useBoundedAnalysisCanvas(spectrogramRef, visuals.spectrum?.samples, drawSpectrogram);
	return (
		<div className="audio-editor-analysis-visuals">
			<figure>
				<figcaption>{copy.spectrum}</figcaption>
				<canvas ref={spectrumRef} data-analysis-spectrum aria-label={copy.spectrum} role="img" />
			</figure>
			<figure>
				<figcaption>{copy.spectrogram}</figcaption>
				<canvas ref={spectrogramRef} data-analysis-spectrogram aria-label={copy.spectrogram} role="img" />
			</figure>
		</div>
	);
}

function useBoundedAnalysisCanvas(canvasRef, samples, draw) {
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !samples?.length) return undefined;
		const render = () => {
			const cssWidth = Math.max(160, Math.round(canvas.clientWidth || 320));
			const cssHeight = 112;
			const dimensions = boundedCanvasDimensions(cssWidth, cssHeight, {
				devicePixelRatio: window.devicePixelRatio || 1,
				maximumBackingWidth: 1_024,
				maximumBackingHeight: 256,
				maximumBackingPixels: 262_144,
			});
			canvas.width = dimensions.backingWidth;
			canvas.height = dimensions.backingHeight;
			canvas.style.height = `${dimensions.cssHeight}px`;
			const context = canvas.getContext('2d');
			if (!context) return;
			context.setTransform(dimensions.pixelRatioX, 0, 0, dimensions.pixelRatioY, 0, 0);
			draw(context, samples, dimensions.cssWidth, dimensions.cssHeight);
		};
		render();
		const observer = new ResizeObserver(render);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [canvasRef, draw, samples]);
}

function drawSpectrum(context, samples, width, height) {
	context.clearRect(0, 0, width, height);
	context.fillStyle = '#11141a';
	context.fillRect(0, 0, width, height);
	const windowSize = Math.min(4_096, highestPowerOfTwo(samples.length));
	if (windowSize < 2) return;
	const start = Math.max(0, Math.floor((samples.length - windowSize) / 2));
	const bins = Math.min(128, Math.max(32, Math.floor(width / 2)));
	context.beginPath();
	for (let bin = 0; bin < bins; bin += 1) {
		const frequencyBin = Math.max(1, Math.round((windowSize / 2 - 1) ** (bin / Math.max(1, bins - 1))));
		let real = 0;
		let imaginary = 0;
		for (let index = 0; index < windowSize; index += 1) {
			const sample = Number(samples[start + index] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1)));
			const phase = 2 * Math.PI * frequencyBin * index / windowSize;
			real += sample * Math.cos(phase);
			imaginary -= sample * Math.sin(phase);
		}
		const magnitude = Math.sqrt(real * real + imaginary * imaginary) / windowSize;
		const db = Math.max(-90, 20 * Math.log10(Math.max(1e-8, magnitude)));
		const x = bin / Math.max(1, bins - 1) * width;
		const y = height - (db + 90) / 90 * height;
		if (bin === 0) context.moveTo(x, y);
		else context.lineTo(x, y);
	}
	context.strokeStyle = '#66d3c5';
	context.lineWidth = 1.5;
	context.stroke();
}

function drawSpectrogram(context, samples, width, height) {
	context.clearRect(0, 0, width, height);
	context.fillStyle = '#090b10';
	context.fillRect(0, 0, width, height);
	const windowSize = Math.min(256, highestPowerOfTwo(samples.length));
	if (windowSize < 2) return;
	const columns = Math.min(96, Math.max(24, Math.floor(width / 3)));
	const rows = 48;
	for (let column = 0; column < columns; column += 1) {
		const start = Math.min(
			Math.max(0, samples.length - windowSize),
			Math.round(column / Math.max(1, columns - 1) * Math.max(0, samples.length - windowSize)),
		);
		for (let row = 0; row < rows; row += 1) {
			const bin = Math.max(1, Math.round((windowSize / 2 - 1) ** ((rows - row) / rows)));
			let real = 0;
			let imaginary = 0;
			for (let index = 0; index < windowSize; index += 1) {
				const sample = Number(samples[start + index] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1)));
				const phase = 2 * Math.PI * bin * index / windowSize;
				real += sample * Math.cos(phase);
				imaginary -= sample * Math.sin(phase);
			}
			const magnitude = Math.sqrt(real * real + imaginary * imaginary) / windowSize;
			const intensity = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-8, magnitude)) + 90) / 90));
			const hue = 255 - intensity * 205;
			context.fillStyle = `hsl(${hue} 85% ${8 + intensity * 54}%)`;
			context.fillRect(column / columns * width, row / rows * height, Math.ceil(width / columns) + 1, Math.ceil(height / rows) + 1);
		}
	}
}

function highestPowerOfTwo(value) {
	if (!Number.isFinite(value) || value < 1) return 0;
	return 2 ** Math.floor(Math.log2(value));
}

export default AnalysisPanel;
