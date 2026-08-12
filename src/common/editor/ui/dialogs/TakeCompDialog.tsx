/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState } from 'react';

import type { AudioEditorEditBlockingSnapshot } from '../../edit-blocking.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createTakeCompDialogModel,
	type TakeCompDialogGroupModel,
} from '../take-comp-dialog-model.ts';

interface TakeCompDialogActions {
	auditionTake(groupId: string, takeId: string): unknown;
	auditionLane(groupId: string, laneId: string): unknown;
	stopAudition(): unknown;
	promoteTake(groupId: string, request: Readonly<{
		takeId: string;
		startSample?: number;
		endSample?: number;
	}>): unknown;
	editCompBoundary(groupId: string, request: Readonly<{
		regionId: string;
		edge: 'start' | 'end';
		boundarySample: number;
	}>): unknown;
	editSharedCompBoundary(groupId: string, request: Readonly<{
		leftRegionId: string;
		rightRegionId: string;
		boundarySample: number;
	}>): unknown;
	flatten(groupId: string): unknown;
	removeGroup(groupId: string): unknown;
}

interface TakeCompDialogProps {
	readonly productId: string;
	readonly controller: Readonly<{
		readonly actions: Readonly<{ readonly takeComp: TakeCompDialogActions }>;
	}>;
	readonly snapshot: AudioEditorEditBlockingSnapshot & Readonly<Record<string, unknown>> & {
		readonly project?: unknown;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

type BoundaryDrafts = Readonly<Record<string, Readonly<{ start: number; end: number }>>>;

export default function TakeCompDialog({
	productId,
	controller,
	snapshot,
	copy,
	run,
	onClose,
}: TakeCompDialogProps) {
	const firstModel = useMemo(() => createTakeCompDialogModel({
		productId, project: snapshot.project, snapshot,
	}), [productId, snapshot]);
	const [groupId, setGroupId] = useState<string | null>(firstModel.selectedGroup?.id ?? null);
	const model = useMemo(() => createTakeCompDialogModel({
		productId, project: snapshot.project, snapshot, selectedGroupId: groupId,
	}), [groupId, productId, snapshot]);
	const group = model.selectedGroup;
	const [takeId, setTakeId] = useState<string | null>(group?.takes[0]?.id ?? null);
	const [promotionStart, setPromotionStart] = useState(group?.startSample ?? 0);
	const [promotionEnd, setPromotionEnd] = useState(group?.endSample ?? 1);
	const [boundaries, setBoundaries] = useState<BoundaryDrafts>(() => boundaryDrafts(group));
	const [sharedBoundaries, setSharedBoundaries] = useState<Readonly<Record<string, number>>>(() => (
		sharedBoundaryDrafts(group)
	));
	const [pending, setPending] = useState<string | null>(null);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		if (groupId && model.groups.some(({ id }) => id === groupId)) return;
		setGroupId(model.groups[0]?.id ?? null);
	}, [groupId, model.groups]);
	useEffect(() => {
		setTakeId(group?.takes[0]?.id ?? null);
		setPromotionStart(group?.startSample ?? 0);
		setPromotionEnd(group?.endSample ?? 1);
		setBoundaries(boundaryDrafts(group));
		setSharedBoundaries(sharedBoundaryDrafts(group));
	}, [group?.id, group]);

	const disabled = model.operationsBlocked || pending !== null;
	const selectedTake = group?.takes.find(({ id }) => id === takeId) ?? null;
	const rangeValid = Boolean(group && selectedTake
		&& Number.isSafeInteger(promotionStart)
		&& Number.isSafeInteger(promotionEnd)
		&& promotionStart >= group.startSample
		&& promotionEnd <= group.endSample
		&& promotionEnd > promotionStart);
	const blockMessage = model.blockReason === 'read-only'
		? copy.takeCompReadOnly
		: model.blockReason === 'locked'
			? copy.takeCompLocked
			: model.blockReason === 'busy' ? copy.takeCompBusy : '';

	const perform = (name: string, operation: () => unknown, success = copy.takeCompOperationComplete): void => {
		setPending(name);
		setError('');
		void Promise.resolve()
			.then(() => run(operation))
			.then(() => { setStatus(success); })
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => { setPending(null); });
	};
	const close = (): void => {
		run(() => controller.actions.takeComp.stopAudition());
		onClose();
	};

	return <AudioEditorDialogShell
		title={copy.takeCompTitle}
		onClose={close}
		width={900}
		initialFocus="[data-take-comp-group]"
		dataAttributes={{ 'data-take-comp-dialog': 'true' }}
	>
		<div className="audio-editor-take-comp">
			{model.groups.length === 0 ? (
				<p data-take-comp-empty>{copy.takeCompEmpty}</p>
			) : <>
				<label className="kw-audio-editor-dialog__field audio-editor-take-comp__group-picker">
					<span>{copy.takeCompGroup}</span>
					<select
						data-take-comp-group
						value={group?.id ?? ''}
						onChange={(event) => setGroupId(event.currentTarget.value)}
					>
						{model.groups.map((candidate) => <option key={candidate.id} value={candidate.id}>
							{candidate.trackName} · {formatExtent(copy, candidate.startSample, candidate.endSample)}
						</option>)}
					</select>
				</label>
				{blockMessage && <p className="audio-editor-take-comp__block" role="status">{blockMessage}</p>}
				{group && <TakeGroupEditor
					group={group}
					copy={copy}
					disabled={disabled}
					takeId={takeId}
					onTakeChange={setTakeId}
					onAuditionLane={(laneId) => perform('audition-lane', () => (
						controller.actions.takeComp.auditionLane(group.id, laneId)
					))}
					onAuditionTake={(nextTakeId) => perform('audition-take', () => (
						controller.actions.takeComp.auditionTake(group.id, nextTakeId)
					))}
					promotionStart={promotionStart}
					promotionEnd={promotionEnd}
					onPromotionStart={setPromotionStart}
					onPromotionEnd={setPromotionEnd}
					rangeValid={rangeValid}
					onPromoteAll={() => selectedTake && perform('promote-all', () => (
						controller.actions.takeComp.promoteTake(group.id, { takeId: selectedTake.id })
					))}
					onPromoteRange={() => selectedTake && perform('promote-range', () => (
						controller.actions.takeComp.promoteTake(group.id, {
							takeId: selectedTake.id, startSample: promotionStart, endSample: promotionEnd,
						})
					))}
					boundaries={boundaries}
					onBoundaryChange={(regionId, edge, value) => setBoundaries((current) => ({
						...current,
						[regionId]: { ...current[regionId]!, [edge]: value },
					}))}
					onApplyBoundary={(regionId, edge) => perform(`boundary-${edge}`, () => (
						controller.actions.takeComp.editCompBoundary(group.id, {
							regionId, edge, boundarySample: boundaryValue(group, boundaries, regionId, edge),
						})
					))}
					sharedBoundaries={sharedBoundaries}
					onSharedBoundaryChange={(key, value) => setSharedBoundaries((current) => ({
						...current, [key]: value,
					}))}
					onApplySharedBoundary={(leftRegionId, rightRegionId) => {
						const key = sharedBoundaryKey(leftRegionId, rightRegionId);
						perform('shared-boundary', () => controller.actions.takeComp.editSharedCompBoundary(group.id, {
							leftRegionId, rightRegionId, boundarySample: sharedBoundaries[key]!,
						}));
					}}
					onFlatten={() => perform('flatten', () => (
						controller.actions.takeComp.flatten(group.id)
					), copy.takeCompFlattenComplete)}
					onRemove={() => perform('remove', () => (
						controller.actions.takeComp.removeGroup(group.id)
					), copy.takeCompRemoveComplete)}
				/>}
			</>}
			<div className="audio-editor-take-comp__status" role="status" aria-live="polite" aria-atomic="true">
				{error || (pending ? copy.loading : status)}
			</div>
			<div className="kw-audio-editor-dialog__actions">
				<button type="button" onClick={close}>{copy.close}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

interface TakeGroupEditorProps {
	readonly group: TakeCompDialogGroupModel;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly takeId: string | null;
	readonly promotionStart: number;
	readonly promotionEnd: number;
	readonly rangeValid: boolean;
	readonly boundaries: BoundaryDrafts;
	readonly sharedBoundaries: Readonly<Record<string, number>>;
	onTakeChange(takeId: string): void;
	onAuditionLane(laneId: string): void;
	onAuditionTake(takeId: string): void;
	onPromotionStart(value: number): void;
	onPromotionEnd(value: number): void;
	onPromoteAll(): void;
	onPromoteRange(): void;
	onBoundaryChange(regionId: string, edge: 'start' | 'end', value: number): void;
	onApplyBoundary(regionId: string, edge: 'start' | 'end'): void;
	onSharedBoundaryChange(key: string, value: number): void;
	onApplySharedBoundary(leftRegionId: string, rightRegionId: string): void;
	onFlatten(): void;
	onRemove(): void;
}

function TakeGroupEditor(props: TakeGroupEditorProps) {
	const { group, copy, disabled } = props;
	return <div className="audio-editor-take-comp__editor">
		<section aria-label={copy.takeCompSelectedTake}>
			<div className="audio-editor-take-comp__lanes" role="list" aria-label={copy.takeCompTitle}>
				{group.lanesView.map((lane, laneIndex) => <article key={lane.id} role="listitem" className="audio-editor-take-comp__lane">
					<header><h3>{copy.takeCompLane.replace('{number}', String(laneIndex + 1))}</h3>
						<button type="button" disabled={disabled} onClick={() => props.onAuditionLane(lane.id)}>{copy.takeCompAuditionLane}</button>
					</header>
					<ul>{lane.takes.map((take) => <li key={take.id}>
						<button
							type="button"
							aria-pressed={props.takeId === take.id}
							aria-label={copy.takeCompSelectTake.replace('{name}', take.sourceName)}
							disabled={disabled}
							onClick={() => props.onTakeChange(take.id)}
						>{take.sourceName}</button>
						<span>{formatExtent(copy, take.startSample, take.endSample)}</span>
						<button type="button" disabled={disabled} onClick={() => props.onAuditionTake(take.id)}>
							{copy.takeCompAuditionTake.replace('{name}', take.sourceName)}
						</button>
					</li>)}</ul>
				</article>)}
			</div>
		</section>
		<fieldset disabled={disabled || props.takeId === null}>
			<legend>{copy.takeCompPromotion}</legend>
			<div className="audio-editor-take-comp__promotion">
				<button type="button" onClick={props.onPromoteAll}>{copy.takeCompPromoteAll}</button>
				<NumberField label={copy.takeCompRangeStart} value={props.promotionStart} minimum={group.startSample} maximum={group.endSample - 1} onChange={props.onPromotionStart} />
				<NumberField label={copy.takeCompRangeEnd} value={props.promotionEnd} minimum={group.startSample + 1} maximum={group.endSample} onChange={props.onPromotionEnd} />
				<button type="button" disabled={!props.rangeValid} onClick={props.onPromoteRange}>{copy.takeCompPromoteRange}</button>
			</div>
		</fieldset>
		<RegionEditor {...props} />
		<div className="audio-editor-take-comp__destructive-actions">
			<button type="button" disabled={disabled} onClick={props.onFlatten}>{copy.takeCompFlatten}</button>
			<button type="button" disabled={disabled} onClick={props.onRemove}>{copy.takeCompRemoveGroup}</button>
		</div>
	</div>;
}

function RegionEditor(props: TakeGroupEditorProps) {
	const { group, copy, disabled } = props;
	return <section aria-label={copy.takeCompRegions}>
		<table className="audio-editor-take-comp__regions">
			<caption>{copy.takeCompRegions}</caption>
			<thead><tr><th scope="col">{copy.takeCompRegion}</th><th scope="col">{copy.takeCompSourceTake}</th><th scope="col">{copy.takeCompStart}</th><th scope="col">{copy.takeCompEnd}</th></tr></thead>
			<tbody>{group.compRegions.map((region) => <tr key={region.id}>
				<th scope="row">{region.id}</th><td>{region.takeId}</td>
				<td><BoundaryField label={copy.takeCompStart} value={props.boundaries[region.id]?.start ?? region.startSample} disabled={disabled} onChange={(value) => props.onBoundaryChange(region.id, 'start', value)} onApply={() => props.onApplyBoundary(region.id, 'start')} applyLabel={copy.takeCompApplyStart} /></td>
				<td><BoundaryField label={copy.takeCompEnd} value={props.boundaries[region.id]?.end ?? region.endSample} disabled={disabled} onChange={(value) => props.onBoundaryChange(region.id, 'end', value)} onApply={() => props.onApplyBoundary(region.id, 'end')} applyLabel={copy.takeCompApplyEnd} /></td>
			</tr>)}</tbody>
		</table>
		<div className="audio-editor-take-comp__shared-boundaries">
			{sharedBoundaries(group).map(({ leftRegionId, rightRegionId, boundarySample }) => {
				const key = sharedBoundaryKey(leftRegionId, rightRegionId);
				return <label key={key}><span>{copy.takeCompSharedBoundary}: {leftRegionId} → {rightRegionId}</span>
					<input type="number" step={1} value={props.sharedBoundaries[key] ?? boundarySample} disabled={disabled} onChange={(event) => props.onSharedBoundaryChange(key, Number(event.currentTarget.value))} />
					<button type="button" disabled={disabled} onClick={() => props.onApplySharedBoundary(leftRegionId, rightRegionId)}>{copy.takeCompApplySharedBoundary}</button>
				</label>;
			})}
		</div>
	</section>;
}

function BoundaryField(props: Readonly<{
	label: string; value: number; disabled: boolean; applyLabel: string;
	onChange(value: number): void; onApply(): void;
}>) {
	return <label><span className="audio-editor-visually-hidden">{props.label}</span><input type="number" step={1} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(Number(event.currentTarget.value))} /><button type="button" disabled={props.disabled} onClick={props.onApply}>{props.applyLabel}</button></label>;
}

function NumberField(props: Readonly<{
	label: string; value: number; minimum: number; maximum: number; onChange(value: number): void;
}>) {
	return <label><span>{props.label}</span><input required type="number" min={props.minimum} max={props.maximum} step={1} value={props.value} onChange={(event) => props.onChange(Number(event.currentTarget.value))} /></label>;
}

function boundaryDrafts(group: TakeCompDialogGroupModel | null): BoundaryDrafts {
	return Object.freeze(Object.fromEntries((group?.compRegions ?? []).map((region) => [
		region.id, Object.freeze({ start: region.startSample, end: region.endSample }),
	])));
}

function boundaryValue(
	group: TakeCompDialogGroupModel,
	drafts: BoundaryDrafts,
	regionId: string,
	edge: 'start' | 'end',
): number {
	const draft = drafts[regionId];
	if (draft) return draft[edge];
	const region = group.compRegions.find(({ id }) => id === regionId);
	if (!region) throw new ReferenceError(`Unknown comp region: ${regionId}.`);
	return edge === 'start' ? region.startSample : region.endSample;
}

function sharedBoundaries(group: TakeCompDialogGroupModel) {
	return group.compRegions.flatMap((left, index) => {
		const right = group.compRegions[index + 1];
		return right && left.endSample === right.startSample ? [{
			leftRegionId: left.id, rightRegionId: right.id, boundarySample: left.endSample,
		}] : [];
	});
}

function sharedBoundaryDrafts(group: TakeCompDialogGroupModel | null): Readonly<Record<string, number>> {
	return Object.freeze(Object.fromEntries((group ? sharedBoundaries(group) : []).map((boundary) => [
		sharedBoundaryKey(boundary.leftRegionId, boundary.rightRegionId), boundary.boundarySample,
	])));
}

function sharedBoundaryKey(leftRegionId: string, rightRegionId: string): string {
	return `${leftRegionId}\u0000${rightRegionId}`;
}

function formatExtent(copy: Readonly<Record<string, string>>, start: number, end: number): string {
	return copy.takeCompExtent.replace('{start}', String(start)).replace('{end}', String(end));
}
