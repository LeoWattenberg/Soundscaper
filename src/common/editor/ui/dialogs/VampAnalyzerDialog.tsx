/* SPDX-License-Identifier: AGPL-3.0-only */

/** Default-exported module boundary intended for React.lazy menu wiring. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import {
	normalizeVampAnalysisRequest,
	normalizeVampAnalysisResult,
	normalizeVampAnalyzerCatalog,
	type VampAnalysisRequest,
	type VampAnalysisResult,
	type VampAnalysisScope,
	type VampAnalyzerDescriptor,
	type VampOutputDescriptor,
} from '../../vamp-analysis.ts';
import { MAXIMUM_VAMP_LABELS } from '../../vamp-analysis-labels.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export interface VampAnalyzerDialogCopy {
	readonly title: string;
	readonly analyzer: string;
	readonly output: string;
	readonly scope: string;
	readonly selectedTrack: string;
	readonly master: string;
	readonly program: string;
	readonly defaultProgram: string;
	readonly parameters: string;
	readonly analyze: string;
	readonly cancel: string;
	readonly analyzing: string;
	readonly noAnalyzers: string;
	readonly feature: string;
	readonly features: string;
	readonly labelTrackName: string;
	readonly publishLabels: string;
	readonly publishing: string;
	readonly tooManyLabels: string;
}

export const VAMP_ANALYZER_DIALOG_COPY: Readonly<VampAnalyzerDialogCopy> = Object.freeze({
	title: 'Vamp Analyzer',
	analyzer: 'Analyzer',
	output: 'Output',
	scope: 'Scope',
	selectedTrack: 'Selected track',
	master: 'Master',
	program: 'Program',
	defaultProgram: 'Default program',
	parameters: 'Parameters',
	analyze: 'Analyze',
	cancel: 'Cancel',
	analyzing: 'Analyzing…',
	noAnalyzers: 'No enabled Vamp analyzers are available.',
	feature: 'feature',
	features: 'features',
	labelTrackName: 'Label track name',
	publishLabels: 'Publish labels',
	publishing: 'Publishing labels…',
	tooManyLabels: 'This result exceeds the 10,000-label publication limit.',
});

export interface VampAnalyzerDialogProps {
	readonly catalog: unknown;
	/** Fences asynchronous completion; it is deliberately absent from the native request. */
	readonly projectId: string;
	readonly scope: VampAnalysisScope;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
	readonly analyze: (
		request: Readonly<VampAnalysisRequest>,
		signal: AbortSignal,
	) => Promise<unknown>;
	readonly publishLabels: (
		result: Readonly<VampAnalysisResult>,
		trackName: string,
	) => PromiseLike<void> | void;
	readonly onClose: () => void;
	readonly copy?: Partial<VampAnalyzerDialogCopy>;
}

interface CatalogState {
	readonly analyzers: readonly Readonly<VampAnalyzerDescriptor>[];
	readonly error: string;
}

interface ActiveAnalysis {
	readonly id: symbol;
	readonly controller: AbortController;
	readonly projectId: string;
}

export default function VampAnalyzerDialog(props: Readonly<VampAnalyzerDialogProps>) {
	const labels = useMemo(() => Object.freeze({
		...VAMP_ANALYZER_DIALOG_COPY,
		...props.copy,
	}), [props.copy]);
	const catalogState = useMemo(() => catalog(props.catalog), [props.catalog]);
	const first = catalogState.analyzers[0] ?? null;
	const [analyzerId, setAnalyzerId] = useState(first?.analyzerId ?? '');
	const [outputId, setOutputId] = useState(first?.outputs[0]?.id ?? '');
	const [program, setProgram] = useState<string | null>(null);
	const [parameters, setParameters] = useState<Record<string, string>>(() => defaults(first));
	const [selectedScope, setSelectedScope] = useState<VampAnalysisScope>(props.scope);
	const [trackName, setTrackName] = useState(() => defaultTrackName(first, first?.outputs[0] ?? null));
	const [result, setResult] = useState<Readonly<VampAnalysisResult> | null>(null);
	const [pending, setPending] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [error, setError] = useState('');
	const activeAnalysisRef = useRef<ActiveAnalysis | null>(null);
	const activePublicationRef = useRef<symbol | null>(null);
	const currentProjectIdRef = useRef(props.projectId);
	currentProjectIdRef.current = props.projectId;

	const selectedAnalyzer = catalogState.analyzers.find((candidate) => (
		candidate.analyzerId === analyzerId
	)) ?? first;
	const selectedOutput = selectedAnalyzer?.outputs.find(({ id }) => id === outputId)
		?? selectedAnalyzer?.outputs[0] ?? null;

	useEffect(() => {
		activeAnalysisRef.current?.controller.abort();
		activeAnalysisRef.current = null;
		activePublicationRef.current = null;
		const analyzer = catalogState.analyzers[0] ?? null;
		const output = analyzer?.outputs[0] ?? null;
		setAnalyzerId(analyzer?.analyzerId ?? '');
		setOutputId(output?.id ?? '');
		setProgram(null);
		setParameters(defaults(analyzer));
		setSelectedScope(props.scope);
		setTrackName(defaultTrackName(analyzer, output));
		setResult(null);
		setPending(false);
		setPublishing(false);
		setError('');
	}, [catalogState.analyzers, props.endFrame, props.projectId, props.sampleRate, props.scope, props.startFrame]);
	useEffect(() => () => {
		activeAnalysisRef.current?.controller.abort();
		activeAnalysisRef.current = null;
		activePublicationRef.current = null;
	}, []);

	const close = (): void => {
		activeAnalysisRef.current?.controller.abort();
		activeAnalysisRef.current = null;
		activePublicationRef.current = null;
		props.onClose();
	};
	const selectAnalyzer = (nextAnalyzerId: string): void => {
		const analyzer = catalogState.analyzers.find((candidate) => candidate.analyzerId === nextAnalyzerId);
		if (!analyzer) return;
		const output = analyzer.outputs[0] ?? null;
		setAnalyzerId(analyzer.analyzerId);
		setOutputId(output?.id ?? '');
		setProgram(null);
		setParameters(defaults(analyzer));
		setTrackName(defaultTrackName(analyzer, output));
		setResult(null);
		setError('');
	};
	const selectOutput = (nextOutputId: string): void => {
		const output = selectedAnalyzer?.outputs.find(({ id }) => id === nextOutputId);
		if (!output || !selectedAnalyzer) return;
		setOutputId(output.id);
		setTrackName(defaultTrackName(selectedAnalyzer, output));
		setResult(null);
		setError('');
	};
	const submit = (): void => {
		if (pending || publishing || !selectedAnalyzer || !selectedOutput
			|| activeAnalysisRef.current !== null) return;
		let request: Readonly<VampAnalysisRequest>;
		try {
			request = normalizeVampAnalysisRequest({
				schemaVersion: 1,
				analyzerId: selectedAnalyzer.analyzerId,
				stableId: selectedAnalyzer.stableId,
				binarySha256: selectedAnalyzer.binarySha256,
				outputId: selectedOutput.id,
				program,
				parameters: selectedAnalyzer.parameters.map(({ id }) => ({
					id,
					value: Number(parameters[id]),
				})),
				scope: selectedScope,
				startFrame: props.startFrame,
				endFrame: props.endFrame,
				sampleRate: props.sampleRate,
			});
		} catch (failure) {
			setError(message(failure));
			return;
		}
		const id = Symbol('vamp-analysis');
		const controller = new AbortController();
		const projectId = props.projectId;
		activeAnalysisRef.current = { id, controller, projectId };
		setPending(true);
		setResult(null);
		setError('');
		void Promise.resolve(props.analyze(request, controller.signal)).then((raw) => {
			if (!currentAnalysis(id, projectId)) return;
			setResult(normalizeVampAnalysisResult(raw, request));
		}).catch((failure: unknown) => {
			if (!currentAnalysis(id, projectId) || controller.signal.aborted) return;
			setError(message(failure));
		}).finally(() => {
			if (!currentAnalysis(id, projectId)) return;
			activeAnalysisRef.current = null;
			setPending(false);
		});
	};
	const publish = (): void => {
		const authoredName = trackName.trim();
		if (!result || result.features.length === 0 || result.features.length > MAXIMUM_VAMP_LABELS
			|| !authoredName || publishing || activePublicationRef.current !== null) return;
		const id = Symbol('vamp-label-publication');
		const projectId = props.projectId;
		activePublicationRef.current = id;
		setPublishing(true);
		setError('');
		void Promise.resolve(props.publishLabels(result, authoredName)).then(() => {
			if (currentPublication(id, projectId)) props.onClose();
		}).catch((failure: unknown) => {
			if (currentPublication(id, projectId)) setError(message(failure));
		}).finally(() => {
			if (!currentPublication(id, projectId)) return;
			activePublicationRef.current = null;
			setPublishing(false);
		});
	};
	const currentAnalysis = (id: symbol, projectId: string): boolean => (
		activeAnalysisRef.current?.id === id
		&& activeAnalysisRef.current.projectId === projectId
		&& currentProjectIdRef.current === projectId
	);
	const currentPublication = (id: symbol, projectId: string): boolean => (
		activePublicationRef.current === id && currentProjectIdRef.current === projectId
	);

	const unavailable = catalogState.error || (!first ? labels.noAnalyzers : '');
	const disabled = pending || publishing || selectedAnalyzer === null || selectedOutput === null;
	return <AudioEditorDialogShell
		title={labels.title}
		onClose={close}
		width={560}
		initialFocus="select"
		dataAttributes={{ 'data-vamp-analyzer-dialog': 'true' }}
		footer={<DialogFooter
			className="audio-editor-dialog-footer"
			primaryText={labels.analyze}
			secondaryText={labels.cancel}
			onPrimaryClick={submit}
			onSecondaryClick={close}
			primaryDisabled={disabled}
		/>}
	>
		{unavailable ? <p role="alert">{unavailable}</p> : <form aria-busy={pending || publishing}
			onSubmit={(event) => { event.preventDefault(); submit(); }}>
			<label>{labels.analyzer}
				<select value={selectedAnalyzer?.analyzerId ?? ''} disabled={pending || publishing}
					onChange={(event) => selectAnalyzer(event.currentTarget.value)}>
					{catalogState.analyzers.map((analyzer) => <option key={analyzer.analyzerId}
						value={analyzer.analyzerId}>{analyzer.name} — {analyzer.maker}</option>)}
				</select>
			</label>
			<label>{labels.output}
				<select value={selectedOutput?.id ?? ''} disabled={pending || publishing}
					onChange={(event) => selectOutput(event.currentTarget.value)}>
					{selectedAnalyzer?.outputs.map((output) => <option key={output.id}
						value={output.id}>{output.name}</option>)}
				</select>
			</label>
			<label>{labels.scope}
				<select value={selectedScope} disabled={pending || publishing}
					onChange={(event) => {
						const value = event.currentTarget.value;
						if (value === 'track' || value === 'master') { setSelectedScope(value); setResult(null); }
					}}>
					<option value="track">{labels.selectedTrack}</option>
					<option value="master">{labels.master}</option>
				</select>
			</label>
			{Boolean(selectedAnalyzer?.programs.length) && <label>{labels.program}
				<select value={program ?? ''} disabled={pending || publishing}
					onChange={(event) => { setProgram(event.currentTarget.value || null); setResult(null); }}>
					<option value="">{labels.defaultProgram}</option>
					{selectedAnalyzer?.programs.map((name) => <option key={name} value={name}>{name}</option>)}
				</select>
			</label>}
			{Boolean(selectedAnalyzer?.parameters.length) && <fieldset disabled={pending || publishing}>
				<legend>{labels.parameters}</legend>
				{selectedAnalyzer?.parameters.map((parameter) => <label key={parameter.id}>{parameter.name}
					<input type="number" value={parameters[parameter.id] ?? ''}
						min={parameter.minValue} max={parameter.maxValue}
						step={parameter.quantizeStep ?? 'any'}
						onChange={(event) => {
							setParameters((current) => ({ ...current, [parameter.id]: event.currentTarget.value }));
							setResult(null);
						}} />
					{parameter.unit && <span> {parameter.unit}</span>}
				</label>)}
			</fieldset>}
			<p role="status" aria-live="polite">{pending ? labels.analyzing : publishing ? labels.publishing : ''}</p>
			{error && <p role="alert">{error}</p>}
			{result && <section data-vamp-analysis-result="true">
				<p>{String(result.features.length)} {result.features.length === 1 ? labels.feature : labels.features}</p>
				{result.features.length > MAXIMUM_VAMP_LABELS ? <p role="alert">{labels.tooManyLabels}</p> : <>
					<label>{labels.labelTrackName}
						<input type="text" value={trackName} disabled={publishing}
							onChange={(event) => setTrackName(event.currentTarget.value)} />
					</label>
					<button type="button" disabled={publishing || result.features.length === 0 || !trackName.trim()}
						onClick={publish}>{labels.publishLabels}</button>
				</>}
			</section>}
		</form>}
	</AudioEditorDialogShell>;
}

function catalog(value: unknown): CatalogState {
	try { return Object.freeze({ analyzers: normalizeVampAnalyzerCatalog(value), error: '' }); }
	catch (failure) { return Object.freeze({ analyzers: Object.freeze([]), error: message(failure) }); }
}

function defaults(analyzer: Readonly<VampAnalyzerDescriptor> | null): Record<string, string> {
	return Object.fromEntries((analyzer?.parameters ?? []).map(({ id, defaultValue }) => [id, String(defaultValue)]));
}

function defaultTrackName(
	analyzer: Readonly<VampAnalyzerDescriptor> | null,
	output: Readonly<VampOutputDescriptor> | null,
): string {
	return analyzer && output ? `${analyzer.name} — ${output.name}` : '';
}

function message(value: unknown): string {
	return value instanceof Error && value.message ? value.message : String(value || 'Vamp analysis failed.');
}
