/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';

import { resolveSelectionRange } from '../../selection-range.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { formatDb, formatLoudness, macroFileName } from '../inspector/inspector-helpers.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
import './analysis-dialog.css';

const MODES = Object.freeze({ levels: 'analyzeSelection', spectrum: 'plotSpectrum', clipping: 'findClipping', contrast: 'contrast' });

export default function AnalysisDialog({ mode, controller, snapshot, copy, fileService, onClose }) {
	const project = snapshot.project;
	const projectId = project?.id ?? null;
	const repeatRequest = mode === 'repeat' ? snapshot.lastAnalysisRequest : null;
	const analysisMode = mode === 'repeat'
		? (MODES[repeatRequest?.type] ? repeatRequest.type : 'levels') : mode;
	const selection = resolveSelectionRange(project, { selectedClipId: snapshot.selectedClipId ?? null });
	const [payload, setPayload] = useState(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const operationRef = useRef(null);
	const blocked = !snapshot.ready || !project?.clips?.length || snapshot.importing || snapshot.recording
		|| snapshot.exporting || snapshot.analysisProcessing || snapshot.missingSourceIds?.length > 0;
	const title = copy[MODES[analysisMode] || MODES.levels];
	const perform = useCallback((operation, toPayload) => {
		const operationId = Symbol('offline-analysis');
		operationRef.current = operationId;
		setPending(true);
		setError('');
		void Promise.resolve().then(operation).then((value) => {
			if (operationRef.current !== operationId) return;
			if (value == null) throw new Error(copy.audioAnalysisFailed);
			setPayload(toPayload(value));
		}).catch((cause) => {
			if (operationRef.current !== operationId) return;
			setError(cause instanceof Error ? cause.message : String(cause));
		}).finally(() => {
			if (operationRef.current === operationId) {
				operationRef.current = null;
				setPending(false);
			}
		});
	}, [copy.audioAnalysisFailed]);
	useEffect(() => {
		setPayload(null);
		setError('');
		if ((analysisMode !== 'contrast' || repeatRequest) && selection && !blocked) {
			const range = { startFrame: selection.startFrame, endFrame: selection.endFrame };
			const operation = repeatRequest ? () => controller.actions.analysis.repeatLast()
				: analysisMode === 'spectrum' ? () => controller.actions.analysis.plotSpectrum('master')
					: analysisMode === 'clipping' ? () => controller.actions.analysis.findClipping('master')
					: () => controller.actions.analysis.run('master');
			perform(operation, (value) => analysisMode === 'levels'
				? { result: value, report: { type: 'levels', scope: repeatRequest?.scope || 'master', ...range } }
				: { result: null, report: value });
		}
		return () => { operationRef.current = null; };
	// The modal analyses capture the selection on opening; contrast deliberately
	// remains open while the user changes the timeline selection between captures.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, projectId]);
	const captureContrast = (role) => {
		if (blocked || pending || !selection) return;
		perform(() => controller.actions.analysis.contrast(role, 'master'), (report) => ({ result: null, report }));
	};
	const exportReport = () => {
		if (!payload) return;
		const text = JSON.stringify({
			schemaVersion: 1,
			project: { id: project?.id, title: project?.title, sampleRate: project?.sampleRate },
			mode: analysisMode, ...payload,
		}, null, 2);
		void Promise.resolve().then(() => fileService.saveFile({
			purpose: 'report', suggestedName: `${macroFileName(project?.title || 'soundscaper')}-analysis.json`,
			mimeType: 'application/json', text,
		})).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
	};
	return <AudioEditorDialogShell
		title={title} onClose={onClose} width={620} modal={analysisMode !== 'contrast'}
		draggable={analysisMode === 'contrast'} closeOnOutside={analysisMode !== 'contrast'}
		dataAttributes={{ 'data-analysis-mode': analysisMode, 'data-analysis-repeat': mode === 'repeat' ? 'true' : undefined }}
		overlayDataAttributes={{ 'data-analysis-overlay': analysisMode }}
	>
		<div className="audio-editor-analysis-dialog"
			data-analysis-scope={payload?.report?.scope}
			data-analysis-start-frame={payload?.report?.startFrame}
			data-analysis-end-frame={payload?.report?.endFrame}>
			{analysisMode === 'contrast' && <p className="audio-editor-panel-hint">{copy.contrastSelectionInstructions}</p>}
			{pending && <p role="status">{copy.analysisRendering}</p>}
			{!pending && !selection && <p role="status">{copy.timeSelectionRequired}</p>}
			{analysisMode === 'levels' && payload?.result && <LevelsResult result={payload.result} copy={copy} />}
			{analysisMode === 'spectrum' && payload?.report?.type === 'spectrum' && <SpectrumResult report={payload.report} copy={copy} />}
			{analysisMode === 'clipping' && payload?.report?.type === 'clipping' && <ClippingResult report={payload.report} copy={copy} sampleRate={project?.sampleRate || 48_000} />}
			{analysisMode === 'contrast' && payload?.report?.type === 'contrast' && <ContrastResult report={payload.report} copy={copy} />}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			<div className="audio-editor-panel-actions">
				{analysisMode === 'contrast' && <>
					<Button disabled={blocked || pending || !selection} onClick={() => captureContrast('foreground')}>{copy.captureContrastForeground}</Button>
					<Button disabled={blocked || pending || !selection} onClick={() => captureContrast('background')}>{copy.captureContrastBackground}</Button>
				</>}
				<Button variant="secondary" disabled={!payload || pending} onClick={exportReport}>{copy.export}</Button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function LevelsResult({ result, copy }) {
	const values = [
		['peak', copy.peak, formatDb(result.peakDbfs, 'dBFS')],
		['truePeak', copy.truePeak, formatDb(result.truePeakDbtp, 'dBTP')],
		['rms', copy.rms, formatDb(result.rmsDbfs, 'dBFS')],
		['momentary', copy.lufsMomentary, formatLoudness(result.momentaryLufs, 'LUFS')],
		['shortTerm', copy.lufsShort, formatLoudness(result.shortTermLufs, 'LUFS')],
		['integrated', copy.lufsIntegrated, formatLoudness(result.integratedLufs, 'LUFS')],
		['lra', copy.lra, formatLoudness(result.loudnessRangeLufs, 'LU')],
		['correlation', copy.correlation, Number.isFinite(result.stereoCorrelation) ? result.stereoCorrelation.toFixed(3) : '—'],
		['clipping', copy.clipping, String(result.clippedSamples ?? 0)],
	];
	return <section data-analysis-report="levels"><h3>{copy.metering}</h3>
		<div className="audio-editor-analysis-grid" data-analysis-values>{values.map(([key, label, value]) =>
			<div key={key}><span>{label}</span><strong data-analysis-value={key}>{value}</strong></div>)}</div>
	</section>;
}

function SpectrumResult({ report, copy }) {
	const bins = report.bins || [];
	const points = Array.from({ length: 128 }, (_, index) => {
		const bin = bins[Math.min(bins.length - 1, Math.round((bins.length - 1) ** (index / 127)))];
		return `${index * 5},${Math.round(-Math.max(-120, Math.min(0, Number(bin?.db ?? -120))) / 120 * 150)}`;
	}).join(' ');
	return <section className="audio-editor-analysis-report" data-analysis-report="spectrum">
		<h4>{copy.plotSpectrum}</h4>
		<svg className="audio-editor-analysis-dialog__plot" viewBox="0 0 635 150" role="img" aria-label={copy.plotSpectrum} data-analysis-spectrum>
			<polyline points={points} />
		</svg>
		<p><strong>{formatLocalizedTemplate(copy.spectrumPeakDetail, {
			label: copy.spectrumPeak, frequency: Number(report.peak?.frequency || 0).toFixed(1),
			level: formatDb(report.peak?.db, 'dB'),
		})}</strong></p>
		<p>{formatLocalizedTemplate(copy.spectrumConfiguration, { size: report.size, sampleRate: report.sampleRate })}</p>
	</section>;
}

function ClippingResult({ report, copy, sampleRate }) {
	return <section className="audio-editor-analysis-report" data-analysis-report="clipping">
		<h4>{copy.findClipping}</h4>
		<p>{report.regionCount ? copy.clippingRegions.replace('{count}', String(report.regionCount)) : copy.noClippingRegions}</p>
		{report.regions?.length > 0 && <ol>{report.regions.slice(0, 20).map((region) =>
			<li key={`${region.startFrame}-${region.endFrame}`}>{formatLocalizedTemplate(copy.clippingRegionDetail, {
				start: (region.startFrame / sampleRate).toFixed(3), end: (region.endFrame / sampleRate).toFixed(3),
				peak: formatDb(20 * Math.log10(region.peakAmplitude), 'dBFS'),
			})}</li>)}</ol>}
	</section>;
}

function ContrastResult({ report, copy }) {
	const difference = Number.isFinite(report.differenceDb) ? `${report.differenceDb.toFixed(2)} dB` : '—';
	return <section className="audio-editor-analysis-report" data-analysis-report="contrast">
		<h4>{copy.contrast}</h4>
		<p>{copy.contrastForeground}: <strong>{formatDb(report.foreground?.rmsDb, 'dBFS')}</strong></p>
		<p>{copy.contrastBackground}: <strong>{formatDb(report.background?.rmsDb, 'dBFS')}</strong></p>
		<p>{copy.contrastDifference}: <strong>{difference}</strong></p>
		{report.passes != null && <p role="status">{report.passes ? copy.contrastPass : copy.contrastFail}</p>}
	</section>;
}
