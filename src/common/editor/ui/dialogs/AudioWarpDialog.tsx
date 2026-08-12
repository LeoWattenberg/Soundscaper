/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState } from 'react';

import type { RationalInput } from '../../timeline-time.ts';
import type { AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createAudioWarpDialogModel } from '../audio-warp-dialog-model.ts';

interface AudioWarpDialogActions {
	view(): Readonly<{
		readonly renderStatus: Readonly<{ readonly path: 'realtime' | 'exact-offline' }>;
	}>;
	analyze(): unknown;
	createIdentityMap(): unknown;
	addMarker(marker: Readonly<{ outer: RationalInput; source: RationalInput }>): unknown;
	moveMarker(pointIndex: number, marker: Readonly<{ outer: RationalInput; source: RationalInput }>): unknown;
	deleteMarker(pointIndex: number): unknown;
	quantize(options: unknown): unknown;
	applyGroove(options: unknown): unknown;
	clear(): unknown;
}

interface AudioWarpDialogProps {
	readonly productId: string;
	readonly controller: Readonly<{
		readonly actions: Readonly<{ readonly audioWarp: AudioWarpDialogActions }>;
	}>;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<Record<string, unknown>> & {
		readonly project?: unknown;
		readonly selectedClipId?: unknown;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function AudioWarpDialog({
	productId,
	controller,
	snapshot,
	copy,
	run,
	onClose,
}: AudioWarpDialogProps) {
	const model = useMemo(() => createAudioWarpDialogModel({
		productId, project: snapshot.project, snapshot,
	}), [productId, snapshot]);
	const runtime = controller.actions.audioWarp.view();
	const [pending, setPending] = useState<string | null>(null);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [transientCount, setTransientCount] = useState<number | null>(null);
	const [markerOuter, setMarkerOuter] = useState('1');
	const [markerSource, setMarkerSource] = useState('1');
	const [gridOrigin, setGridOrigin] = useState(0);
	const [gridInterval, setGridInterval] = useState(1);
	const [strengthPercent, setStrengthPercent] = useState(50);
	const [grooveEnabled, setGrooveEnabled] = useState(false);
	const [grooveOffsets, setGrooveOffsets] = useState('0, 1/3');
	const [grooveStrengthPercent, setGrooveStrengthPercent] = useState(50);

	useEffect(() => {
		setTransientCount(null);
		setStatus('');
		setError('');
	}, [model.clipId]);

	const disabled = model.operationsBlocked || pending !== null;
	const gridValid = Number.isSafeInteger(gridOrigin)
		&& Number.isSafeInteger(gridInterval) && gridInterval > 0;
	const blockMessage = model.blockReason === 'read-only'
		? copy.audioWarpReadOnly
		: model.blockReason === 'locked'
			? copy.audioWarpLocked
			: model.blockReason === 'busy'
				? copy.audioWarpBusy
				: model.blockReason === 'no-audio-clip' ? copy.audioWarpNoSelection : '';
	const runtimeMessage = runtime.renderStatus.path === 'realtime'
		? copy.audioWarpRealtimeStatus
		: copy.audioWarpOfflineStatus;

	const perform = (
		name: string,
		operation: () => unknown,
		success: string,
		onSuccess?: (result: unknown) => void,
	): void => {
		setPending(name);
		setError('');
		void Promise.resolve()
			.then(() => run(operation))
			.then((result) => { onSuccess?.(result); setStatus(success); })
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => { setPending(null); });
	};
	const exactStrength = (percent: number): RationalInput => ({ num: percent, den: 100 });
	const quantizeOptions = () => ({
		grid: { origin: gridOrigin, interval: gridInterval },
		strength: exactStrength(strengthPercent),
	});

	return <AudioEditorDialogShell
		title={copy.audioWarpTitle}
		onClose={onClose}
		width={780}
		initialFocus="[data-audio-warp-analyze]"
		dataAttributes={{ 'data-audio-warp-dialog': 'true' }}
	>
		<div className="audio-editor-audio-warp">
			<p className="audio-editor-audio-warp__runtime" role="status">{runtimeMessage}</p>
			{blockMessage && <p className="audio-editor-audio-warp__block" role="status">{blockMessage}</p>}
			{model.clipId && <section aria-label={copy.audioWarpSelectedClip}>
				<h3>{model.clipName}</h3>
				<p>{model.sourceName}</p>
				<div className="audio-editor-audio-warp__primary-actions">
					<button
						type="button"
						data-audio-warp-analyze="true"
						disabled={disabled}
						onClick={() => perform('analyze', () => controller.actions.audioWarp.analyze(), copy.audioWarpAnalyzed, (result) => {
							setTransientCount(transientCountFromOutcome(result));
						})}
					>{copy.audioWarpAnalyze}</button>
					<button
						type="button"
						disabled={disabled || model.hasWarpMap}
						onClick={() => perform('identity', () => controller.actions.audioWarp.createIdentityMap(), copy.audioWarpIdentityCreated)}
					>{copy.audioWarpCreateIdentity}</button>
				</div>
				{transientCount !== null && <p>{copy.audioWarpTransientsFound.replace('{count}', String(transientCount))}</p>}
			</section>}

			<WarpMapEditor
				model={model}
				copy={copy}
				disabled={disabled}
				markerOuter={markerOuter}
				markerSource={markerSource}
				onMarkerOuter={setMarkerOuter}
				onMarkerSource={setMarkerSource}
				onAdd={() => perform('add-marker', () => controller.actions.audioWarp.addMarker({
					outer: parseRationalInput(markerOuter, 'marker outer'),
					source: parseRationalInput(markerSource, 'marker source'),
				}), copy.audioWarpMarkerAdded)}
				onMove={(pointIndex, outer, source) => perform('move-marker', () => (
					controller.actions.audioWarp.moveMarker(pointIndex, {
						outer: parseRationalInput(outer, 'marker outer'),
						source: parseRationalInput(source, 'marker source'),
					})
				), copy.audioWarpMarkerMoved)}
				onDelete={(pointIndex) => perform('delete-marker', () => (
					controller.actions.audioWarp.deleteMarker(pointIndex)
				), copy.audioWarpMarkerDeleted)}
			/>

			<fieldset disabled={disabled}>
				<legend>{copy.audioWarpQuantization}</legend>
				<div className="audio-editor-audio-warp__grid-fields">
					<NumberField label={copy.audioWarpGridOrigin} value={gridOrigin} onChange={setGridOrigin} />
					<NumberField label={copy.audioWarpGridInterval} value={gridInterval} minimum={1} onChange={setGridInterval} />
				</div>
				<StrengthField
					label={copy.audioWarpStrength}
					value={strengthPercent}
					copy={copy}
					onChange={setStrengthPercent}
				/>
				<button
					type="button"
					disabled={!gridValid}
					onClick={() => perform('quantize', () => (
						controller.actions.audioWarp.quantize(quantizeOptions())
					), copy.audioWarpQuantized)}
				>{copy.audioWarpQuantize}</button>
			</fieldset>

			<fieldset disabled={disabled}>
				<legend>{copy.audioWarpEnableGroove}</legend>
				<label className="audio-editor-audio-warp__check">
					<input type="checkbox" checked={grooveEnabled} onChange={(event) => setGrooveEnabled(event.currentTarget.checked)} />
					<span>{copy.audioWarpEnableGroove}</span>
				</label>
				<label>
					<span>{copy.audioWarpGrooveOffsets}</span>
					<input type="text" value={grooveOffsets} disabled={!grooveEnabled} onChange={(event) => setGrooveOffsets(event.currentTarget.value)} />
				</label>
				<StrengthField
					label={copy.audioWarpGrooveStrength}
					value={grooveStrengthPercent}
					copy={copy}
					disabled={!grooveEnabled}
					onChange={setGrooveStrengthPercent}
				/>
				<button
					type="button"
					disabled={!grooveEnabled || !gridValid}
					onClick={() => perform('groove', () => controller.actions.audioWarp.applyGroove({
						...quantizeOptions(),
						template: { offsets: parseGrooveOffsets(grooveOffsets) },
						grooveStrength: exactStrength(grooveStrengthPercent),
					}), copy.audioWarpGrooveApplied)}
				>{copy.audioWarpApplyGroove}</button>
			</fieldset>

			<button
				type="button"
				className="audio-editor-audio-warp__clear"
				disabled={disabled || !model.hasWarpMap}
				onClick={() => perform('clear', () => controller.actions.audioWarp.clear(), copy.audioWarpCleared)}
			>{copy.audioWarpClear}</button>
			<div className="audio-editor-audio-warp__status" role="status" aria-live="polite" aria-atomic="true">
				{error || status}
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function WarpMapEditor({
	model,
	copy,
	disabled,
	markerOuter,
	markerSource,
	onMarkerOuter,
	onMarkerSource,
	onAdd,
	onMove,
	onDelete,
}: Readonly<{
	model: ReturnType<typeof createAudioWarpDialogModel>;
	copy: Readonly<Record<string, string>>;
	disabled: boolean;
	markerOuter: string;
	markerSource: string;
	onMarkerOuter(value: string): void;
	onMarkerSource(value: string): void;
	onAdd(): void;
	onMove(pointIndex: number, outer: string, source: string): void;
	onDelete(pointIndex: number): void;
}>) {
	if (!model.hasWarpMap) return <p>{copy.audioWarpNoMap}</p>;
	return <fieldset className="audio-editor-audio-warp__markers" disabled={disabled}>
		<legend>{copy.audioWarpMarkers}</legend>
		<table className="audio-editor-audio-warp__map" aria-label={copy.audioWarpMapPoints}>
		<caption>{copy.audioWarpMapPoints}</caption>
		<thead><tr><th scope="col">{copy.audioWarpOuter}</th><th scope="col">{copy.audioWarpSource}</th><th scope="col">{copy.audioWarpMarkerActions}</th></tr></thead>
		<tbody>{model.warpPoints.map((point, index) => <tr key={`${point.outer}:${point.source}:${String(index)}`}>
			{index === 0 || index === model.warpPoints.length - 1 ? <>
				<td>{point.outer}</td><td>{point.source}</td><td>{copy.audioWarpEndpoint}</td>
			</> : <MarkerRow
				point={point}
				copy={copy}
				onMove={onMove}
				onDelete={onDelete}
			/>}
		</tr>)}</tbody>
		</table>
		<div className="audio-editor-audio-warp__marker-add">
			<label><span>{copy.audioWarpOuter}</span><input type="text" value={markerOuter} onChange={(event) => onMarkerOuter(event.currentTarget.value)} /></label>
			<label><span>{copy.audioWarpSource}</span><input type="text" value={markerSource} onChange={(event) => onMarkerSource(event.currentTarget.value)} /></label>
			<button type="button" onClick={onAdd}>{copy.audioWarpAddMarker}</button>
		</div>
	</fieldset>;
}

function MarkerRow({ point, copy, onMove, onDelete }: Readonly<{
	point: ReturnType<typeof createAudioWarpDialogModel>['warpPoints'][number];
	copy: Readonly<Record<string, string>>;
	onMove(pointIndex: number, outer: string, source: string): void;
	onDelete(pointIndex: number): void;
}>) {
	const [outer, setOuter] = useState(point.outer);
	const [source, setSource] = useState(point.source);
	useEffect(() => { setOuter(point.outer); setSource(point.source); }, [point.outer, point.source]);
	const number = String(point.index);
	return <>
		<td><input
			type="text"
			aria-label={copy.audioWarpMarkerOuter.replace('{number}', number)}
			value={outer}
			onChange={(event) => setOuter(event.currentTarget.value)}
		/></td>
		<td><input
			type="text"
			aria-label={copy.audioWarpMarkerSource.replace('{number}', number)}
			value={source}
			onChange={(event) => setSource(event.currentTarget.value)}
		/></td>
		<td className="audio-editor-audio-warp__marker-actions">
			<button type="button" onClick={() => onMove(point.index, outer, source)}>
				{copy.audioWarpMoveMarker.replace('{number}', number)}
			</button>
			<button type="button" onClick={() => onDelete(point.index)}>
				{copy.audioWarpDeleteMarker.replace('{number}', number)}
			</button>
		</td>
	</>;
}

function NumberField({
	label,
	value,
	minimum,
	onChange,
}: Readonly<{
	label: string;
	value: number;
	minimum?: number;
	onChange(value: number): void;
}>) {
	return <label><span>{label}</span><input
		type="number"
		step="1"
		{...(minimum === undefined ? {} : { min: minimum })}
		value={value}
		onChange={(event) => onChange(Number(event.currentTarget.value))}
	/></label>;
}

function StrengthField({
	label,
	value,
	copy,
	disabled = false,
	onChange,
}: Readonly<{
	label: string;
	value: number;
	copy: Readonly<Record<string, string>>;
	disabled?: boolean;
	onChange(value: number): void;
}>) {
	const output = copy.audioWarpStrengthValue.replace('{percent}', String(value));
	return <label className="audio-editor-audio-warp__strength">
		<span>{label}: <output>{output}</output></span>
		<input
			type="range"
			min="0"
			max="100"
			step="1"
			value={value}
			disabled={disabled}
			aria-label={label}
			aria-valuetext={output}
			onChange={(event) => onChange(Number(event.currentTarget.value))}
		/>
	</label>;
}

function transientCountFromOutcome(value: unknown): number {
	const outcome = dataRecord(value);
	const analysis = dataRecord(outcome?.analysis);
	return Array.isArray(analysis?.transients) ? analysis.transients.length : 0;
}

function parseGrooveOffsets(value: string): readonly RationalInput[] {
	const tokens = value.split(',').map((token) => token.trim()).filter(Boolean);
	if (tokens.length < 1 || tokens.length > 128) {
		throw new RangeError('A groove template requires 1 to 128 offsets.');
	}
	return Object.freeze(tokens.map((token) => parseRationalInput(token, 'groove offset')));
}

function parseRationalInput(value: string, name: string): RationalInput {
	const token = value.trim();
	const match = /^(-?\d+)(?:\/(\d+))?$/u.exec(token);
	if (!match) throw new TypeError(`Invalid ${name}: ${token}.`);
	const num = Number(match[1]);
	const den = Number(match[2] ?? 1);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1) {
		throw new RangeError(`Invalid ${name}: ${token}.`);
	}
	return Object.freeze({ num, den });
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}
