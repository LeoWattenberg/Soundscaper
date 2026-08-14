/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useMemo, useState, type FormEvent } from 'react';

import type {
	MixerEdgeV21,
	MixerOutputV21,
	MixerStripV21,
	MixerVcaV21,
} from '../../mixer-graph-v21.ts';
import type { StripRef } from '../../parameter-address.ts';
import {
	createSoundscaperRoutingEditorModel,
	editSoundscaperRoutingGraph,
	type SoundscaperRoutingDestination,
	type SoundscaperRoutingGraphEdit,
	type SoundscaperRoutingNodeCollection,
	type SoundscaperRoutingSource,
} from '../soundscaper-routing-editor-model.ts';
import type { SoundscaperProductionCopy } from '../soundscaper-production-copy.ts';

interface SoundscaperRoutingEditorProps {
	readonly copy: SoundscaperProductionCopy;
	readonly project: unknown;
	readonly draft: string;
	readonly disabled: boolean;
	readonly onDraft: (value: string) => void;
	readonly onApply: () => void;
}

export default function SoundscaperRoutingEditor({
	copy,
	project,
	draft,
	disabled,
	onDraft,
	onApply,
}: SoundscaperRoutingEditorProps) {
	const model = useMemo(() => createSoundscaperRoutingEditorModel(project, draft), [draft, project]);
	const [actionError, setActionError] = useState('');
	const [status, setStatus] = useState('');
	const issue = actionError || model.validationError || '';
	const edit = (operation: SoundscaperRoutingGraphEdit): void => {
		try {
			const result = editSoundscaperRoutingGraph(project, draft, operation);
			onDraft(result.text);
			setActionError('');
			setStatus(result.validationError ? '' : copy.mixerStructuredUpdated);
		} catch (error) {
			setActionError(errorMessage(error));
			setStatus('');
		}
	};
	const graph = model.graph;
	const summary = copy.mixerSummary
		.replace('{groups}', String(graph?.groups.length ?? 0)).replace('{sends}', String(graph?.sends.length ?? 0))
		.replace('{cues}', String(graph?.cues.length ?? 0)).replace('{vcas}', String(graph?.vcas.length ?? 0))
		.replace('{outputs}', String(graph?.outputs.length ?? 0)).replace('{edges}', String(graph?.edges.length ?? 0));
	return <fieldset disabled={disabled} data-soundscaper-routing-editor="structured">
		<legend>{copy.mixerGraphEditor}</legend>
		<p>{summary}</p>
		{graph && <>
			<section aria-labelledby="soundscaper-routing-nodes-heading">
				<h3 id="soundscaper-routing-nodes-heading">{copy.mixerNodes}</h3>
				{NODE_COLLECTIONS.map(([collection, copyKey]) => <NodeCollectionEditor
					key={collection}
					copy={copy}
					collection={collection}
					label={copy[copyKey]}
					nodes={graph[collection]}
					onEdit={edit}
				/>)}
			</section>
			<OutputEditor copy={copy} outputs={graph.outputs} onEdit={edit} />
			<VcaEditor copy={copy} vcas={graph.vcas} members={model.vcaMembers} onEdit={edit} />
			<EdgeEditor
				copy={copy}
				edges={graph.edges}
				sources={model.sourceEndpoints}
				destinations={model.destinationEndpoints}
				onEdit={edit}
			/>
		</>}
		{issue && <p role="alert">{issue}</p>}
		{!issue && status && <p role="status">{status}</p>}
		<details>
			<summary>{copy.mixerAdvanced}</summary>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.mixerGraphDocument}</span>
				<textarea
					rows={18}
					spellCheck={false}
					value={draft}
					onChange={(event) => {
						onDraft(event.currentTarget.value);
						setActionError('');
						setStatus('');
					}}
				/>
			</label>
		</details>
		<div className="kw-audio-editor-dialog__actions">
			<button type="button" disabled={!model.canApply} onClick={onApply}>{copy.applyMixerGraph}</button>
		</div>
	</fieldset>;
}

function NodeCollectionEditor({ copy, collection, label, nodes, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	collection: SoundscaperRoutingNodeCollection;
	label: string;
	nodes: readonly MixerStripV21[];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	return <section aria-label={label}>
		<h4>{label}</h4>
		{nodes.map((node) => <NodeForm key={node.id} copy={copy} collection={collection} node={node} onEdit={onEdit} />)}
		<NodeForm copy={copy} collection={collection} node={null} onEdit={onEdit} />
	</section>;
}

function NodeForm({ copy, collection, node, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	collection: SoundscaperRoutingNodeCollection;
	node: MixerStripV21 | null;
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	const collectionLabel = copy[collection === 'groups' ? 'mixerGroups' : collection === 'sends' ? 'mixerSends' : 'mixerCues'];
	return <form aria-label={node ? fill(copy.mixerUpdateNode, node.name || node.id) : fill(copy.mixerAddNode, collectionLabel)}
		onSubmit={(event) => {
			event.preventDefault();
			const form = formData(event);
			onEdit({
				type: 'node/set', collection, previousId: node?.id ?? null,
				node: {
					...(node ?? DEFAULT_NODE), id: requiredText(form, 'id'), name: fieldText(form, 'name'),
					channelCount: fieldNumber(form, 'channelCount'),
				},
			});
		}}>
		<label>{copy.mixerNodeId}<input name="id" required maxLength={256} defaultValue={node?.id ?? ''} /></label>
		<label>{copy.mixerNodeName}<input name="name" maxLength={1024} defaultValue={node?.name ?? ''} /></label>
		<label>{copy.mixerChannelCount}<input name="channelCount" type="number" min={1} max={32} step={1} defaultValue={node?.channelCount ?? 2} /></label>
		<button type="submit">{node ? fill(copy.mixerUpdateNode, node.name || node.id) : fill(copy.mixerAddNode, collectionLabel)}</button>
		{node && <button type="button" onClick={() => onEdit({ type: 'node/remove', collection, id: node.id })}>
			{fill(copy.mixerRemoveNode, node.name || node.id)}
		</button>}
	</form>;
}

function OutputEditor({ copy, outputs, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	outputs: readonly MixerOutputV21[];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	return <section aria-labelledby="soundscaper-routing-outputs-heading">
		<h3 id="soundscaper-routing-outputs-heading">{copy.mixerOutputs}</h3>
		{outputs.map((output) => <OutputForm key={output.id} copy={copy} output={output} onEdit={onEdit} />)}
		<OutputForm copy={copy} output={null} onEdit={onEdit} />
	</section>;
}

function OutputForm({ copy, output, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	output: MixerOutputV21 | null;
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	const label = output ? fill(copy.mixerUpdateOutput, output.name || output.id) : copy.mixerAddOutput;
	return <form aria-label={label} onSubmit={(event) => {
		event.preventDefault();
		const form = formData(event);
		onEdit({
			type: 'output/set', previousId: output?.id ?? null,
			output: {
				id: requiredText(form, 'id'), name: fieldText(form, 'name'),
				role: requiredText(form, 'role') as MixerOutputV21['role'],
				channelCount: fieldNumber(form, 'channelCount'),
			},
		});
	}}>
		<label>{copy.mixerOutputId}<input name="id" required maxLength={256} defaultValue={output?.id ?? ''} /></label>
		<label>{copy.mixerOutputName}<input name="name" maxLength={1024} defaultValue={output?.name ?? ''} /></label>
		<label>{copy.mixerOutputRole}<select name="role" defaultValue={output?.role ?? 'auxiliary'}>
			<option value="main">{copy.mixerOutputMain}</option><option value="cue">{copy.mixerOutputCue}</option>
			<option value="control-room">{copy.mixerOutputControlRoom}</option><option value="auxiliary">{copy.mixerOutputAuxiliary}</option>
		</select></label>
		<label>{copy.mixerChannelCount}<input name="channelCount" type="number" min={1} max={32} step={1} defaultValue={output?.channelCount ?? 2} /></label>
		<button type="submit">{label}</button>
		{output && <button type="button" onClick={() => onEdit({ type: 'output/remove', id: output.id })}>
			{fill(copy.mixerRemoveOutput, output.name || output.id)}
		</button>}
	</form>;
}

function VcaEditor({ copy, vcas, members, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	vcas: readonly MixerVcaV21[];
	members: ReturnType<typeof createSoundscaperRoutingEditorModel>['vcaMembers'];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	return <section aria-labelledby="soundscaper-routing-vcas-heading">
		<h3 id="soundscaper-routing-vcas-heading">{copy.mixerVcas}</h3>
		{vcas.map((vca) => <VcaForm key={vca.id} copy={copy} vca={vca} members={members} onEdit={onEdit} />)}
		<VcaForm copy={copy} vca={null} members={members} onEdit={onEdit} />
	</section>;
}

function VcaForm({ copy, vca, members, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	vca: MixerVcaV21 | null;
	members: ReturnType<typeof createSoundscaperRoutingEditorModel>['vcaMembers'];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	const label = vca ? fill(copy.mixerUpdateVca, vca.name || vca.id) : copy.mixerAddVca;
	const selected = new Set(vca?.members.map(endpointValue) ?? []);
	return <form aria-label={label} onSubmit={(event) => {
		event.preventDefault();
		const form = formData(event);
		const selectedValues = new Set(form.getAll('member').map(String));
		onEdit({
			type: 'vca/set', previousId: vca?.id ?? null,
			vca: {
				id: requiredText(form, 'id'), name: fieldText(form, 'name'), gain: fieldNumber(form, 'gain'),
				mute: form.has('mute'), members: members.filter(({ value }) => selectedValues.has(value)).map(({ endpoint }) => endpoint),
			},
		});
	}}>
		<label>{copy.mixerVcaId}<input name="id" required maxLength={256} defaultValue={vca?.id ?? ''} /></label>
		<label>{copy.mixerVcaName}<input name="name" maxLength={1024} defaultValue={vca?.name ?? ''} /></label>
		<label>{copy.mixerVcaGain}<input name="gain" type="number" min={0} max={4} step="0.01" defaultValue={vca?.gain ?? 1} /></label>
		<label><input name="mute" type="checkbox" defaultChecked={vca?.mute ?? false} /> {copy.mixerVcaMute}</label>
		<fieldset><legend>{copy.mixerVcaMembers}</legend>{members.map(({ value, label: memberLabel }) => <label key={value}>
			<input name="member" type="checkbox" value={value} defaultChecked={selected.has(value)} /> {memberLabel}
		</label>)}</fieldset>
		<button type="submit">{label}</button>
		{vca && <button type="button" onClick={() => onEdit({ type: 'vca/remove', id: vca.id })}>
			{fill(copy.mixerRemoveVca, vca.name || vca.id)}
		</button>}
	</form>;
}

function EdgeEditor({ copy, edges, sources, destinations, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	edges: readonly MixerEdgeV21[];
	sources: ReturnType<typeof createSoundscaperRoutingEditorModel>['sourceEndpoints'];
	destinations: ReturnType<typeof createSoundscaperRoutingEditorModel>['destinationEndpoints'];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	return <section aria-labelledby="soundscaper-routing-edges-heading">
		<h3 id="soundscaper-routing-edges-heading">{copy.mixerEdges}</h3>
		{edges.map((edge) => <EdgeForm key={edge.id} copy={copy} edge={edge} sources={sources} destinations={destinations} onEdit={onEdit} />)}
		<EdgeForm copy={copy} edge={null} sources={sources} destinations={destinations} onEdit={onEdit} />
	</section>;
}

function EdgeForm({ copy, edge, sources, destinations, onEdit }: Readonly<{
	copy: SoundscaperProductionCopy;
	edge: MixerEdgeV21 | null;
	sources: ReturnType<typeof createSoundscaperRoutingEditorModel>['sourceEndpoints'];
	destinations: ReturnType<typeof createSoundscaperRoutingEditorModel>['destinationEndpoints'];
	onEdit: (operation: SoundscaperRoutingGraphEdit) => void;
}>) {
	const label = edge ? fill(copy.mixerUpdateEdge, edge.id) : copy.mixerAddEdge;
	return <form aria-label={label} onSubmit={(event) => {
		event.preventDefault();
		const form = formData(event);
		onEdit({
			type: 'edge/set', previousId: edge?.id ?? null,
			edge: {
				id: requiredText(form, 'id'), kind: requiredText(form, 'kind') as MixerEdgeV21['kind'],
				source: selectedEndpoint(sources, requiredText(form, 'source'), copy.mixerEdgeSource),
				destination: selectedEndpoint(destinations, requiredText(form, 'destination'), copy.mixerEdgeDestination),
				position: requiredText(form, 'position') as MixerEdgeV21['position'],
				level: fieldNumber(form, 'level'), enabled: form.has('enabled'),
				channelMap: channelMap(fieldText(form, 'channelMap')),
			},
		});
	}}>
		<label>{copy.mixerEdgeId}<input name="id" required maxLength={256} defaultValue={edge?.id ?? ''} /></label>
		<label>{copy.mixerEdgeKind}<select name="kind" defaultValue={edge?.kind ?? 'assignment'}>
			<option value="assignment">{copy.mixerEdgeAssignment}</option><option value="send">{copy.mixerEdgeSend}</option>
			<option value="sidechain">{copy.mixerEdgeSidechain}</option>
		</select></label>
		<label>{copy.mixerEdgeSource}<select name="source" defaultValue={edge ? endpointValue(edge.source) : sources[0]?.value}>
			{sources.map(({ value, label: endpointLabel }) => <option key={value} value={value}>{endpointLabel}</option>)}
		</select></label>
		<label>{copy.mixerEdgeDestination}<select name="destination" defaultValue={edge ? endpointValue(edge.destination) : destinations[0]?.value}>
			{destinations.map(({ value, label: endpointLabel }) => <option key={value} value={value}>{endpointLabel}</option>)}
		</select></label>
		<label>{copy.mixerEdgePosition}<select name="position" defaultValue={edge?.position ?? 'post-fader'}>
			<option value="pre-fader">{copy.mixerEdgePreFader}</option><option value="post-fader">{copy.mixerEdgePostFader}</option>
		</select></label>
		<label>{copy.mixerEdgeLevel}<input name="level" type="number" min={0} max={4} step="0.01" defaultValue={edge?.level ?? 1} /></label>
		<label><input name="enabled" type="checkbox" defaultChecked={edge?.enabled ?? true} /> {copy.mixerEdgeEnabled}</label>
		<label>{copy.mixerEdgeChannelMap}<input name="channelMap" defaultValue={edge?.channelMap.join(', ') ?? '0, 1'} /></label>
		<button type="submit">{label}</button>
		{edge && <button type="button" onClick={() => onEdit({ type: 'edge/remove', id: edge.id })}>
			{fill(copy.mixerRemoveEdge, edge.id)}
		</button>}
	</form>;
}

function selectedEndpoint<Endpoint>(
	options: readonly Readonly<{ value: string; endpoint: Endpoint }>[],
	value: string,
	name: string,
): Endpoint {
	const option = options.find((candidate) => candidate.value === value);
	if (!option) throw new TypeError(`${name} is unavailable.`);
	return option.endpoint;
}

function channelMap(value: string): readonly number[] {
	if (!value.trim()) return Object.freeze([]);
	return Object.freeze(value.split(',').map((entry, index) => {
		const candidate = entry.trim();
		if (!/^-?\d+$/u.test(candidate)) throw new TypeError(`Channel map entry ${index + 1} must be an integer.`);
		return Number(candidate);
	}));
}

function formData(event: FormEvent<HTMLFormElement>): FormData {
	return new FormData(event.currentTarget);
}

function requiredText(form: FormData, name: string): string {
	const value = fieldText(form, name);
	if (!value) throw new TypeError(`${name} must not be empty.`);
	return value;
}

function fieldText(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

function fieldNumber(form: FormData, name: string): number {
	const value = Number(requiredText(form, name));
	if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${name} must be a finite number.`);
	return value;
}

function endpointValue(endpoint: SoundscaperRoutingSource | SoundscaperRoutingDestination | StripRef): string {
	return JSON.stringify(endpoint);
}

function fill(template: string, name: string): string {
	return template.replace('{name}', name).replace('{collection}', name);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const DEFAULT_NODE: MixerStripV21 = Object.freeze({
	id: '', name: '', color: '', gain: 1, pan: 0, mute: false, solo: false,
	collapsed: false, effectsActive: true, effects: Object.freeze([]), channelCount: 2,
});

const NODE_COLLECTIONS = Object.freeze([
	Object.freeze(['groups', 'mixerGroups'] as const),
	Object.freeze(['sends', 'mixerSends'] as const),
	Object.freeze(['cues', 'mixerCues'] as const),
]);
