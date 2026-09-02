/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useRef } from 'react';

import type { MixerEdgeV21, MixerGraphV21 } from '../../mixer-graph-v21.ts';
import type { SoundscaperRoutingGraphCopy } from './soundscaper-routing-graph-copy.ts';
import type {
	SoundscaperRoutingParameterGesture,
	SoundscaperRoutingParameterGestureHandler,
} from './soundscaper-routing-graph-gesture.ts';
import { routingStaticEdgeLevel } from './soundscaper-routing-graph-gesture.ts';
import {
	isSoundscaperFolderOwnedRoutingEdge,
	isSoundscaperFolderOwnedRoutingNode,
} from './soundscaper-routing-folder-authority.ts';
import {
	connectSoundscaperRoutingEdge,
	removeSoundscaperRoutingItem,
	rewireSoundscaperRoutingEdge,
	routingDeleteSummary,
	routingDestinationOptions,
	routingEndpointValue,
	routingSourceOptions,
	routingVcaMemberOptions,
	updateSoundscaperRoutingEdge,
	updateSoundscaperRoutingNode,
	updateSoundscaperRoutingOutput,
	updateSoundscaperRoutingVca,
	type RoutingGraphCandidate,
	type RoutingSelection,
} from './soundscaper-routing-graph-candidates.ts';

export interface SoundscaperRoutingGraphInspectorProps {
	readonly project: unknown;
	readonly graph: MixerGraphV21;
	readonly copy: SoundscaperRoutingGraphCopy;
	readonly selection: RoutingSelection | null;
	readonly disabled: boolean;
	readonly confirmingDelete: boolean;
	readonly onConfirmingDelete: (confirming: boolean) => void;
	readonly onCandidate: (kind: RoutingCommitKind, candidate: RoutingGraphCandidate) => void;
	readonly onParameterGesture?: SoundscaperRoutingParameterGestureHandler;
	readonly onError: (reason: unknown) => void;
}

export type RoutingCommitKind =
	| 'edge-create' | 'edge-rewire' | 'edge-update' | 'edge-delete'
	| 'node-update' | 'node-delete' | 'output-update' | 'output-delete'
	| 'vca-update' | 'vca-delete' | 'item-create';

export default function SoundscaperRoutingGraphInspector(props: SoundscaperRoutingGraphInspectorProps) {
	const { project, graph, copy, selection, disabled, confirmingDelete, onConfirmingDelete } = props;
	if (!selection) return <aside className="kw-routing-graph__inspector" aria-label={copy.routingInspector}>
		<h3>{copy.routingInspector}</h3>
		<p>{copy.routingInspectorHint}</p>
	</aside>;
	const remove = (): void => {
		const kind = selection.kind === 'edge' ? 'edge-delete'
			: selection.kind === 'output' ? 'output-delete'
				: selection.kind === 'vca' ? 'vca-delete' : 'node-delete';
		if (emitCandidate(props, kind, () => removeSoundscaperRoutingItem(project, graph, selection))) {
			onConfirmingDelete(false);
		}
	};
	const inspector = selection.kind === 'edge'
		? <EdgeInspector {...props} edgeId={selection.id} />
		: selection.kind === 'node'
			? <NodeInspector {...props} selection={selection} />
			: selection.kind === 'output'
				? <OutputInspector {...props} outputId={selection.id} />
				: selection.kind === 'vca'
					? <VcaInspector {...props} vcaId={selection.id} />
					: <OwnedStripInspector {...props} selection={selection} />;
	const removable = selection.kind !== 'track' && selection.kind !== 'master'
		&& !folderOwnsSelection(project, graph, selection);
	return <aside
		className="kw-routing-graph__inspector"
		data-routing-inspector={selection.kind}
		aria-label={selection.kind === 'edge' ? copy.connectionInspector : copy.routingInspector}
	>
		{inspector}
		{removable && !confirmingDelete && <button type="button" disabled={disabled} onClick={() => onConfirmingDelete(true)}>
			{fill(copy.deleteRoutingItem, { item: selection.kind === 'edge' ? copy.connection : selection.kind })}
		</button>}
		{removable && confirmingDelete && <div className="kw-routing-graph__delete-confirm" role="alert">
			<p>{routingDeleteSummary(graph, selection)}</p>
			<button type="button" disabled={disabled} onClick={remove}>{copy.confirmDelete}</button>
			<button type="button" onClick={() => onConfirmingDelete(false)}>{copy.cancel}</button>
		</div>}
	</aside>;
}

function OwnedStripInspector(props: SoundscaperRoutingGraphInspectorProps & Readonly<{
	selection: Extract<RoutingSelection, { kind: 'track' | 'master' }>;
}>) {
	const { project, graph, copy, selection, disabled, onCandidate } = props;
	const tracks = audioTracks(project);
	const label = selection.kind === 'master'
		? copy.master : tracks.find(({ id }) => id === selection.id)?.name ?? selection.id;
	const source = selection.kind === 'master'
		? { kind: 'master' as const } : { kind: 'track' as const, id: selection.id };
	return <>
		<h3>{label}</h3>
		<p>{selection.kind === 'master' ? copy.masterStrip : copy.audioTrack} · {copy.managedByProject}</p>
		<ConnectionForm
			project={project} graph={graph} copy={copy} source={source} disabled={disabled}
			onCandidate={(candidate) => onCandidate('edge-create', candidate)}
			onError={props.onError}
		/>
	</>;
}

function NodeInspector(props: SoundscaperRoutingGraphInspectorProps & Readonly<{
	selection: Extract<RoutingSelection, { kind: 'node' }>;
}>) {
	const { project, graph, copy, selection, disabled, onCandidate } = props;
	const node = graph[selection.collection].find(({ id }) => id === selection.id);
	if (!node) return <p>{copy.selectedNodeMissing}</p>;
	const managed = isSoundscaperFolderOwnedRoutingNode(project, selection.collection, selection.id);
	return <>
		<h3>{node.name || node.id}</h3>
		<p>{collectionName(copy, selection.collection)} · {node.channelCount} {copy.channels}</p>
		{managed && <p>{copy.managedByFolder}</p>}
		<form key={`${node.id}:${node.name}:${node.channelCount}`} onSubmit={(event) => {
			event.preventDefault();
			if (disabled || managed) return;
			const data = new FormData(event.currentTarget);
			emitCandidate(props, 'node-update', () => updateSoundscaperRoutingNode(
				project, graph, selection.collection, selection.id,
				{ name: String(data.get('name') ?? ''), channelCount: Number(data.get('channelCount')) },
			));
		}}>
			<label>{copy.name} <input name="name" maxLength={1024} defaultValue={node.name} readOnly={managed} disabled={disabled || managed} /></label>
			<label>{copy.channels} <input name="channelCount" type="number" min={1} max={32} step={1} defaultValue={node.channelCount} disabled={disabled || managed} /></label>
			<button type="submit" disabled={disabled || managed}>{copy.saveNode}</button>
		</form>
		<ConnectionForm
			project={project} graph={graph} copy={copy} source={{ kind: 'mixer-node', id: node.id }} disabled={disabled}
			onCandidate={(candidate) => onCandidate('edge-create', candidate)}
			onError={props.onError}
		/>
	</>;
}

function OutputInspector(props: SoundscaperRoutingGraphInspectorProps & Readonly<{ outputId: string }>) {
	const { project, graph, copy, outputId, disabled } = props;
	const output = graph.outputs.find(({ id }) => id === outputId);
	if (!output) return <p>{copy.selectedOutputMissing}</p>;
	return <>
		<h3>{output.name || output.id}</h3>
		<p>{roleLabel(copy, output.role)} · {output.channelCount} {copy.channels}</p>
		<form key={`${output.id}:${output.name}:${output.role}:${output.channelCount}`} onSubmit={(event) => {
			event.preventDefault();
			if (disabled) return;
			const data = new FormData(event.currentTarget);
			emitCandidate(props, 'output-update', () => updateSoundscaperRoutingOutput(project, graph, output.id, {
				name: String(data.get('name') ?? ''),
				role: String(data.get('role')) as typeof output.role,
				channelCount: Number(data.get('channelCount')),
			}));
		}}>
			<label>{copy.name} <input name="name" maxLength={1024} defaultValue={output.name} disabled={disabled} /></label>
			<label>{copy.role} <select name="role" defaultValue={output.role} disabled={disabled}>
				<option value="main">{copy.main}</option><option value="cue">{copy.cue}</option>
				<option value="control-room">{copy.controlRoom}</option><option value="auxiliary">{copy.auxiliary}</option>
			</select></label>
			<label>{copy.channels} <input name="channelCount" type="number" min={1} max={32} step={1} defaultValue={output.channelCount} disabled={disabled} /></label>
			<button type="submit" disabled={disabled}>{copy.saveOutput}</button>
		</form>
	</>;
}

function VcaInspector(props: SoundscaperRoutingGraphInspectorProps & Readonly<{ vcaId: string }>) {
	const { project, graph, copy, vcaId, disabled } = props;
	const vca = graph.vcas.find(({ id }) => id === vcaId);
	const memberOptions = routingVcaMemberOptions(project, graph);
	if (!vca) return <p>{copy.selectedVcaMissing}</p>;
	const members = new Set(vca.members.map(routingEndpointValue));
	return <>
		<h3>{vca.name || vca.id}</h3><p>{copy.vca} · {vca.members.length} {copy.members}</p>
		<form key={`${vca.id}:${vca.name}:${vca.gain}:${vca.mute}:${[...members].join()}`} onSubmit={(event) => {
			event.preventDefault();
			if (disabled) return;
			const data = new FormData(event.currentTarget);
			const selected = new Set(data.getAll('member').map(String));
			emitCandidate(props, 'vca-update', () => updateSoundscaperRoutingVca(project, graph, vca.id, {
				name: String(data.get('name') ?? ''), gain: Number(data.get('gain')),
				mute: data.has('mute'),
				members: memberOptions.filter(({ value }) => selected.has(value)).map(({ endpoint }) => endpoint),
			}));
		}}>
			<label>{copy.name} <input name="name" maxLength={1024} defaultValue={vca.name} disabled={disabled} /></label>
			<label>{copy.gain} <input name="gain" type="number" min={0} max={4} step="0.01" defaultValue={vca.gain} disabled={disabled} /></label>
			<label><input name="mute" type="checkbox" defaultChecked={vca.mute} disabled={disabled} /> {copy.mute}</label>
			<fieldset><legend>{copy.members}</legend>{memberOptions.map(({ value, label }) => <label key={value}>
				<input name="member" type="checkbox" value={value} defaultChecked={members.has(value)} disabled={disabled} /> {label}
			</label>)}</fieldset>
			<button type="submit" disabled={disabled}>{copy.saveVca}</button>
		</form>
	</>;
}

function EdgeInspector(props: SoundscaperRoutingGraphInspectorProps & Readonly<{ edgeId: string }>) {
	const { project, graph, copy, edgeId, disabled, onCandidate, onParameterGesture, onError } = props;
	const edge = graph.edges.find(({ id }) => id === edgeId);
	const managed = edge ? isSoundscaperFolderOwnedRoutingEdge(project, edge) : false;
	const controlDisabled = disabled || managed;
	const sources = routingSourceOptions(project, graph);
	const destinations = routingDestinationOptions(project, graph);
	const levelGesture = useRef<EdgeLevelGestureState>({
		request: 0, pending: false, active: false, captured: false,
		dirty: false, terminal: null, value: edge?.level ?? 0,
	});
	useEffect(() => {
		if (!levelGesture.current.active && !levelGesture.current.pending) {
			levelGesture.current.value = edge?.level ?? 0;
		}
	}, [edge?.level]);
	useEffect(() => () => {
		const state = levelGesture.current;
		state.request += 1;
		if (state.active) emitParameterGesture(onParameterGesture, {
			phase: 'cancel', address: edgeLevelAddress(edgeId), value: state.value,
		}, onError);
		state.pending = false; state.active = false; state.captured = false;
	}, [edgeId, onError, onParameterGesture]);
	const beginLevelGesture = (value: number): void => {
		if (managed) return;
		const state = levelGesture.current;
		const request = state.request + 1;
		Object.assign(state, {
			request, pending: false, active: false, captured: false,
			dirty: false, terminal: null, value,
		});
		const capture = beginParameterGesture(onParameterGesture, {
			phase: 'begin', address: edgeLevelAddress(edgeId), value,
		}, onError);
		if (!isPromiseLike(capture)) {
			state.active = capture;
			state.captured = capture;
			return;
		}
		state.pending = true;
		void Promise.resolve(capture).then((captured) => {
			if (state.request !== request) {
				if (captured) emitParameterGesture(onParameterGesture, {
					phase: 'cancel', address: edgeLevelAddress(edgeId), value: state.value,
				}, onError);
				return;
			}
			state.pending = false;
			if (!captured) return;
			const terminal = state.terminal;
			state.captured = terminal !== 'cancel';
			if (terminal) {
				state.active = false;
				emitParameterGesture(onParameterGesture, {
					phase: terminal, address: edgeLevelAddress(edgeId), value: state.value,
				}, onError);
				return;
			}
			state.active = true;
			if (state.dirty) emitParameterGesture(onParameterGesture, {
				phase: 'preview', address: edgeLevelAddress(edgeId), value: state.value,
			}, onError);
		});
	};
	const previewLevelGesture = (value: number): void => {
		if (managed) return;
		const state = levelGesture.current;
		state.value = value; state.dirty = true;
		if (state.active) emitParameterGesture(onParameterGesture, {
			phase: 'preview', address: edgeLevelAddress(edgeId), value,
		}, onError);
	};
	const finishLevelGesture = (phase: 'release' | 'cancel', value: number): void => {
		if (managed) return;
		const state = levelGesture.current;
		state.value = value;
		if (state.pending) {
			state.terminal = phase;
			return;
		}
		if (state.active) emitParameterGesture(onParameterGesture, {
			phase, address: edgeLevelAddress(edgeId), value,
		}, onError);
		state.active = false;
		if (phase === 'cancel') state.captured = false;
	};
	if (!edge) return <p>{copy.selectedConnectionMissing}</p>;
	const sourceLabel = sources.find(({ value }) => value === routingEndpointValue(edge.source))?.label ?? edge.id;
	const destinationLabel = destinations.find(({ value }) => value === routingEndpointValue(edge.destination))?.label ?? edge.id;
	return <>
		<h3>{sourceLabel} → {destinationLabel}</h3>
		<p>{edge.kind} · {edge.position} · {dbLabel(edge.level)} · {edge.enabled ? 'enabled' : 'disabled'}</p>
		{managed && <p>{copy.managedByFolder}</p>}
		<form key={edgeFormKey(edge)} onSubmit={(event) => {
			event.preventDefault();
			if (controlDisabled || levelGesture.current.pending) return;
			try {
				const data = new FormData(event.currentTarget);
				const source = optionEndpoint(sources, String(data.get('source')));
				const destination = optionEndpoint(destinations, String(data.get('destination')));
				const endpointsChanged = routingEndpointValue(source) !== routingEndpointValue(edge.source)
					|| routingEndpointValue(destination) !== routingEndpointValue(edge.destination);
				const rewired = endpointsChanged
					? rewireSoundscaperRoutingEdge(project, graph, edge.id, source, destination)
					: { graph };
				const rewiredEdge = rewired.graph.edges.find(({ id }) => id === edge.id)!;
				const channelMap = endpointsChanged ? rewiredEdge.channelMap : edge.channelMap.flatMap((_entry, index) => (
					data.has(`remove-map-${index}`) ? [] : [Number(data.get(`map-${index}`))]
				));
				const kind = destination.kind === 'effect-sidechain'
					? 'sidechain' : String(data.get('kind')) as MixerEdgeV21['kind'];
				const candidate = updateSoundscaperRoutingEdge(project, rewired.graph, edge.id, {
					source, destination, kind,
					position: String(data.get('position')) as MixerEdgeV21['position'],
					level: routingStaticEdgeLevel(
						rewiredEdge.level,
						dbToLinear(Number(data.get('levelDb'))),
						levelGesture.current.captured,
					),
					enabled: data.has('enabled'), channelMap,
				});
				levelGesture.current.captured = false;
				const candidateEdge = candidate.graph.edges.find(({ id }) => id === edge.id)!;
				if (!endpointsChanged && edgeFormKey(candidateEdge) === edgeFormKey(edge)) return;
				onCandidate(endpointsChanged ? 'edge-rewire' : 'edge-update', candidate);
			} catch (reason) {
				props.onError(reason);
			}
		}}>
			<label>{copy.source} <select name="source" defaultValue={routingEndpointValue(edge.source)} disabled={controlDisabled}>{sources.map(option)}</select></label>
			<label>{copy.destination} <select name="destination" defaultValue={routingEndpointValue(edge.destination)} disabled={controlDisabled}>{destinations.map(option)}</select></label>
			<label>{copy.kind} <select name="kind" defaultValue={edge.kind} disabled={controlDisabled || edge.destination.kind === 'effect-sidechain'}>
				<option value="assignment">{copy.assignment}</option><option value="send">{copy.send}</option>
				{edge.kind === 'sidechain' && <option value="sidechain">{copy.sidechain}</option>}
			</select></label>
			<label>{copy.position} <select name="position" defaultValue={edge.position} disabled={controlDisabled}>
				<option value="pre-fader">{copy.preFader}</option><option value="post-fader">{copy.postFader}</option>
			</select></label>
			<label>{copy.levelDb} <input
				name="levelDb" type="number" min={-60} max={12.04} step="0.01"
				defaultValue={linearToDb(edge.level)} disabled={controlDisabled}
				onFocus={(event) => {
					const value = dbToLinear(Number(event.currentTarget.value));
					beginLevelGesture(value);
				}}
				onChange={(event) => {
					const value = dbToLinear(Number(event.currentTarget.value));
					previewLevelGesture(value);
				}}
				onBlur={(event) => {
					const value = dbToLinear(Number(event.currentTarget.value));
					finishLevelGesture('release', value);
				}}
				onKeyDown={(event) => {
					if (event.key !== 'Escape'
						|| (!levelGesture.current.active && !levelGesture.current.pending)) return;
					event.preventDefault();
					event.currentTarget.value = String(linearToDb(edge.level));
					finishLevelGesture('cancel', levelGesture.current.value);
					event.currentTarget.blur();
				}}
			/></label>
			<label><input name="enabled" type="checkbox" defaultChecked={edge.enabled} disabled={controlDisabled} /> {copy.enabled}</label>
			<fieldset><legend>{copy.channelMap}</legend>{edge.channelMap.map((channel, index) => <label key={index}>
				{fill(copy.destinationChannel, { index: String(index + 1) })} <select name={`map-${index}`} defaultValue={channel} disabled={controlDisabled}>
					<option value={-1}>{copy.silence}</option>{Array.from({ length: 32 }, (_value, source) => <option key={source} value={source}>{fill(copy.sourceChannel, { index: String(source + 1) })}</option>)}
				</select>
				<span><input type="checkbox" name={`remove-map-${index}`} disabled={controlDisabled} /> {copy.removeMapRow}</span>
			</label>)}</fieldset>
			<div className="kw-routing-graph__form-actions">
				<button type="submit" disabled={controlDisabled}>{copy.saveConnection}</button>
				<button type="button" disabled={controlDisabled} onClick={() => emitCandidate(props, 'edge-update', () => rewireSoundscaperRoutingEdge(
					project, graph, edge.id, edge.source, edge.destination,
				))}>{copy.resetChannelMap}</button>
			</div>
		</form>
		<details><summary>{copy.technicalDetails}</summary><code>{edge.id}</code></details>
	</>;
}

function ConnectionForm({ project, graph, copy, source, disabled, onCandidate, onError }: Readonly<{
	project: unknown;
	graph: MixerGraphV21;
	copy: SoundscaperRoutingGraphCopy;
	source: MixerEdgeV21['source'];
	disabled: boolean;
	onCandidate: (candidate: RoutingGraphCandidate) => void;
	onError: (reason: unknown) => void;
}>) {
	const destinations = useMemo(() => routingDestinationOptions(project, graph), [graph, project]);
	return <form className="kw-routing-graph__connection-form" onSubmit={(event) => {
		event.preventDefault();
		if (disabled) return;
		const destination = optionEndpoint(destinations, String(new FormData(event.currentTarget).get('destination')));
		try {
			onCandidate(connectSoundscaperRoutingEdge(project, graph, source, destination));
		} catch (reason) {
			onError(reason);
		}
	}}>
		<label>{copy.connectTo} <select name="destination" disabled={disabled || destinations.length === 0}>{destinations.map(option)}</select></label>
		<button type="submit" disabled={disabled || destinations.length === 0}>{copy.addConnection}</button>
	</form>;
}

function option(optionValue: Readonly<{ value: string; label: string }>) {
	return <option key={optionValue.value} value={optionValue.value}>{optionValue.label}</option>;
}

function optionEndpoint<Endpoint>(options: readonly Readonly<{ value: string; endpoint: Endpoint }>[], value: string): Endpoint {
	const match = options.find((optionValue) => optionValue.value === value);
	if (!match) throw new RangeError('The selected routing endpoint no longer exists.');
	return match.endpoint;
}

function emitCandidate(
	props: Pick<SoundscaperRoutingGraphInspectorProps, 'onCandidate' | 'onError'>,
	kind: RoutingCommitKind,
	build: () => RoutingGraphCandidate,
): boolean {
	try {
		props.onCandidate(kind, build());
		return true;
	} catch (reason) {
		props.onError(reason);
		return false;
	}
}

function folderOwnsSelection(projectValue: unknown, graph: MixerGraphV21, selection: RoutingSelection): boolean {
	if (selection.kind === 'node') {
		return isSoundscaperFolderOwnedRoutingNode(projectValue, selection.collection, selection.id);
	}
	if (selection.kind !== 'edge') return false;
	const edge = graph.edges.find(({ id }) => id === selection.id);
	return edge ? isSoundscaperFolderOwnedRoutingEdge(projectValue, edge) : false;
}

function audioTracks(projectValue: unknown): readonly { id: string; name: string }[] {
	return records(record(projectValue)?.tracks).flatMap((track) => (
		track.type === 'audio' && typeof track.id === 'string'
			? [{ id: track.id, name: typeof track.name === 'string' ? track.name : track.id }] : []
	));
}

function edgeFormKey(edge: MixerEdgeV21): string {
	return JSON.stringify([edge.id, edge.source, edge.destination, edge.kind, edge.position, edge.level, edge.enabled, edge.channelMap]);
}

function collectionName(copy: SoundscaperRoutingGraphCopy, collection: 'groups' | 'sends' | 'cues'): string {
	return collection === 'groups' ? copy.group : collection === 'sends' ? copy.send : copy.cue;
}

function roleLabel(copy: SoundscaperRoutingGraphCopy, role: string): string {
	return role === 'control-room' ? `${copy.controlRoom} ${copy.output}`
		: `${role === 'main' ? copy.main : role === 'cue' ? copy.cue : copy.auxiliary} ${copy.output}`;
}

function linearToDb(value: number): number {
	return value > 0 ? Math.max(-60, Math.min(12.04, Number((20 * Math.log10(value)).toFixed(2)))) : -60;
}

function dbToLinear(value: number): number {
	return value <= -60 ? 0 : Math.min(4, 10 ** (value / 20));
}

function dbLabel(value: number): string {
	return value <= 0 ? '−∞ dB' : `${linearToDb(value)} dB`;
}

function edgeLevelAddress(edgeId: string): Extract<SoundscaperRoutingParameterGesture['address'], { kind: 'edge' }> {
	return Object.freeze({ kind: 'edge', edgeId, parameterId: 'level' });
}

function beginParameterGesture(
	handler: SoundscaperRoutingParameterGestureHandler | undefined,
	gesture: SoundscaperRoutingParameterGesture,
	onError: (reason: unknown) => void,
): boolean | Promise<boolean> {
	if (!handler) return false;
	try {
		const result = handler(Object.freeze(gesture));
		return isPromiseLike(result) ? Promise.resolve(result).catch((reason: unknown) => {
			onError(reason);
			return false;
		}) : result === true;
	} catch (reason) {
		onError(reason);
		return false;
	}
}

function emitParameterGesture(
	handler: SoundscaperRoutingParameterGestureHandler | undefined,
	gesture: SoundscaperRoutingParameterGesture,
	onError: (reason: unknown) => void,
): void {
	if (!handler) return;
	try {
		const result = handler(Object.freeze(gesture));
		if (isPromiseLike(result)) void Promise.resolve(result).catch(onError);
	} catch (reason) {
		onError(reason);
	}
}

function isPromiseLike<Value>(value: Value | PromiseLike<Value>): value is PromiseLike<Value> {
	return Boolean(value && (typeof value === 'object' || typeof value === 'function')
		&& typeof (value as PromiseLike<Value>).then === 'function');
}

interface EdgeLevelGestureState {
	request: number;
	pending: boolean;
	active: boolean;
	captured: boolean;
	dirty: boolean;
	terminal: 'release' | 'cancel' | null;
	value: number;
}

type DataRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry): entry is DataRecord => entry !== null) : [];
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template);
}
