/* SPDX-License-Identifier: AGPL-3.0-only */

import '../audio-editor-design-system/06a-panels-mixer-routing-graph.css';

import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type PointerEvent,
} from 'react';

import type { MixerEdgeV21, MixerGraphV21 } from '../../mixer-graph-v21.ts';
import type { ParameterAddress } from '../../parameter-address.ts';
import SoundscaperRoutingGraphInspector, {
	type RoutingCommitKind,
} from './SoundscaperRoutingGraphInspector.tsx';
import type { SoundscaperRoutingGraphCopy } from './soundscaper-routing-graph-copy.ts';
import type {
	SoundscaperRoutingParameterGesture,
	SoundscaperRoutingParameterGestureHandler,
} from './soundscaper-routing-graph-gesture.ts';
import {
	isSoundscaperFolderOwnedRoutingEdge,
	isSoundscaperFolderOwnedRoutingNode,
} from './soundscaper-routing-folder-authority.ts';
import {
	addSoundscaperRoutingItem,
	connectSoundscaperRoutingEdge,
	routingDestinationOptions,
	routingEndpointValue,
	routingSelectionAddresses,
	routingSourceOptions,
	type RoutingGraphCandidate,
	type RoutingSelection,
} from './soundscaper-routing-graph-candidates.ts';
import {
	layoutSoundscaperRoutingGraph,
	routingLayoutNodeKeyForEndpoint,
	type RoutingLayoutNode,
} from './soundscaper-routing-graph-layout.ts';

export interface SoundscaperRoutingGraphCommit {
	readonly kind: RoutingCommitKind;
	readonly graph: MixerGraphV21;
	readonly selection: RoutingSelection;
	readonly addresses: readonly ParameterAddress[];
}

export interface SoundscaperRoutingGraphViewProps {
	readonly project: unknown;
	readonly graph: MixerGraphV21;
	readonly disabled: boolean;
	readonly copy: SoundscaperRoutingGraphCopy;
	readonly requestedSelection?: RoutingSelection | null;
	readonly onRequestedSelectionConsumed?: () => void;
	readonly onCommit: (commit: SoundscaperRoutingGraphCommit) => unknown;
	readonly onParameterGesture?: SoundscaperRoutingParameterGestureHandler;
}

export type { SoundscaperRoutingParameterGesture };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

export default function SoundscaperRoutingGraphView({
	project,
	graph,
	disabled,
	copy,
	requestedSelection = null,
	onRequestedSelectionConsumed,
	onCommit,
	onParameterGesture,
}: SoundscaperRoutingGraphViewProps) {
	const layout = useMemo(() => layoutSoundscaperRoutingGraph(project, graph), [graph, project]);
	const destinations = useMemo(() => routingDestinationOptions(project, graph), [graph, project]);
	const [selection, setSelection] = useState<RoutingSelection | null>(null);
	const [connecting, setConnecting] = useState<MixerEdgeV21['source'] | null>(null);
	const [previewPoint, setPreviewPoint] = useState<Readonly<{ x: number; y: number }> | null>(null);
	const [zoom, setZoom] = useState(1);
	const [fitActive, setFitActive] = useState(false);
	const [status, setStatus] = useState(copy.routingReady);
	const [error, setError] = useState('');
	const [pending, setPending] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [focusKey, setFocusKey] = useState(layout.nodes.find(({ rail }) => rail === 'audio')?.key ?? layout.nodes[0]?.key ?? '');
	const viewportRef = useRef<HTMLDivElement>(null);
	const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
	const consumedRequestKeyRef = useRef<string | null>(null);
	const graphDisabled = disabled || pending;

	useEffect(() => {
		if (layout.nodes.some(({ key }) => key === focusKey)) return;
		setFocusKey(layout.nodes.find(({ rail }) => rail === 'audio')?.key ?? layout.nodes[0]?.key ?? '');
	}, [focusKey, layout.nodes]);
	useEffect(() => {
		const key = selectionKey(requestedSelection);
		if (!requestedSelection) {
			consumedRequestKeyRef.current = null;
			return;
		}
		if (!key || consumedRequestKeyRef.current === key || !layout.nodes.some((node) => node.key === key)) return;
		consumedRequestKeyRef.current = key;
		setSelection(requestedSelection);
		setFocusKey(key);
		setStatus(copy.newNodeSelected);
		requestAnimationFrame(() => nodeRefs.current.get(key)?.focus());
		onRequestedSelectionConsumed?.();
	}, [copy.newNodeSelected, layout.nodes, onRequestedSelectionConsumed, requestedSelection]);
	useEffect(() => setConfirmingDelete(false), [selection]);

	const applyCandidate = useCallback((kind: RoutingCommitKind, candidate: RoutingGraphCandidate): void => {
		if (graphDisabled) return;
		setPending(true);
		setError('');
		const commit: SoundscaperRoutingGraphCommit = Object.freeze({
			kind, graph: candidate.graph, selection: candidate.selection,
			addresses: candidate.addresses.length > 0
				? candidate.addresses : routingSelectionAddresses(candidate.selection),
		});
		void Promise.resolve()
			.then(() => onCommit(commit))
			.then(() => {
				setSelection(kind.endsWith('delete') ? null : candidate.selection);
				setStatus(statusForCommit(copy, kind));
				if (kind.endsWith('delete')) requestAnimationFrame(() => viewportRef.current?.focus());
			})
			.catch((reason: unknown) => setError(errorMessage(reason)))
			.finally(() => setPending(false));
	}, [copy, graphDisabled, onCommit]);

	const failAction = useCallback((reason: unknown): void => {
		setError(errorMessage(reason));
		setStatus('');
	}, []);

	const chooseSource = (source: MixerEdgeV21['source'], sourceLabel: string): void => {
		if (graphDisabled) return;
		setConnecting(source);
		const sourceNode = layout.nodes.find(({ key }) => key === routingLayoutNodeKeyForEndpoint(source));
		setPreviewPoint(sourceNode ? {
			x: sourceNode.x + sourceNode.width + 64,
			y: sourceNode.y + sourceNode.height / 2,
		} : null);
		setError('');
		setStatus(fill(copy.chooseDestination, { source: sourceLabel }));
	};
	const connectTo = (destination: MixerEdgeV21['destination']): void => {
		if (!connecting || graphDisabled) return;
		try {
			applyCandidate('edge-create', connectSoundscaperRoutingEdge(project, graph, connecting, destination));
			setConnecting(null);
			setPreviewPoint(null);
		} catch (reason) {
			failAction(reason);
		}
	};
	const fitGraph = useCallback((): void => {
		const viewportWidth = viewportRef.current?.clientWidth ?? 0;
		const viewportHeight = viewportRef.current?.clientHeight ?? 0;
		if (viewportWidth <= 0 || viewportHeight <= 0) {
			setZoom(1);
			return;
		}
		setZoom(clampZoom(Math.min(viewportWidth / layout.width, viewportHeight / layout.height)));
	}, [layout.height, layout.width]);

	useEffect(() => {
		if (typeof ResizeObserver === 'undefined' || !viewportRef.current) return undefined;
		const observer = new ResizeObserver(() => {
			if (fitActive) fitGraph();
		});
		observer.observe(viewportRef.current);
		return () => observer.disconnect();
	}, [fitActive, fitGraph]);

	const selectedKey = selectionKey(selection);
	const nodeByKey = new Map(layout.nodes.map((node) => [node.key, node]));
	const connectingNode = connecting
		? nodeByKey.get(routingLayoutNodeKeyForEndpoint(connecting)) : undefined;
	return <section
		className="kw-routing-graph"
		data-soundscaper-routing-graph
		aria-label={copy.routing}
		onKeyDown={(event) => {
			if (event.key !== 'Escape' || !connecting) return;
			event.preventDefault();
			setConnecting(null);
			setPreviewPoint(null);
			setStatus(copy.connectionCancelled);
		}}
	>
		<div className="kw-routing-graph__toolbar" aria-label={copy.routingControls}>
			<label>{copy.addNode} <select aria-label={copy.addRoutingNode} disabled={graphDisabled} value="" onChange={(event) => {
				const kind = event.currentTarget.value;
				event.currentTarget.value = '';
				if (kind !== 'cue' && kind !== 'vca' && kind !== 'output') return;
				try {
					applyCandidate('item-create', addSoundscaperRoutingItem(project, graph, kind));
				} catch (reason) {
					failAction(reason);
				}
			}}>
				<option value="">{copy.choose}</option><option value="cue">{copy.cue}</option>
				<option value="vca">{copy.vca}</option><option value="output">{copy.output}</option>
			</select></label>
			<div className="kw-routing-graph__zoom-controls" role="group" aria-label={copy.graphZoom}>
				<button type="button" aria-label={copy.zoomOut} disabled={zoom <= MIN_ZOOM} onClick={() => {
					setFitActive(false); setZoom((value) => clampZoom(value - ZOOM_STEP));
				}}>−</button>
				<output data-routing-zoom aria-label={copy.zoomLevel}>{Math.round(zoom * 100)}%</output>
				<button type="button" aria-label={copy.zoomIn} disabled={zoom >= MAX_ZOOM} onClick={() => {
					setFitActive(false); setZoom((value) => clampZoom(value + ZOOM_STEP));
				}}>+</button>
				<button type="button" aria-pressed={fitActive} onClick={() => {
					setFitActive(true); fitGraph();
				}}>{copy.fit}</button>
			</div>
		</div>
		<div className="kw-routing-graph__body">
			<div className="kw-routing-graph__viewport" ref={viewportRef} tabIndex={-1} onPointerMove={(event) => {
				if (!connecting) return;
				const bounds = event.currentTarget.getBoundingClientRect();
				setPreviewPoint({
					x: (event.clientX - bounds.left + event.currentTarget.scrollLeft) / zoom,
					y: (event.clientY - bounds.top + event.currentTarget.scrollTop) / zoom,
				});
			}}>
				<div className="kw-routing-graph__stage-scroll" style={{ width: `${layout.width * zoom}px`, height: `${layout.height * zoom}px` }}>
				<div className="kw-routing-graph__stage" style={{
					width: `${layout.width}px`, height: `${layout.height}px`,
					transform: `scale(${zoom})`, transformOrigin: 'top left',
				}}>
					<svg className="kw-routing-graph__wires" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
						{layout.edges.map((edge) => <path key={edge.key} d={edge.path} className={`kw-routing-graph__wire kw-routing-graph__wire--${edge.kind}${edge.enabled ? '' : ' is-disabled'}`} />)}
						{connectingNode && previewPoint && <path
							d={previewPath(connectingNode, previewPoint)}
							className="kw-routing-graph__wire kw-routing-graph__wire--preview"
						/>}
					</svg>
					{layout.edges.map((edge) => {
						const source = nodeByKey.get(edge.sourceKey);
						const destination = nodeByKey.get(edge.destinationKey);
						if (!source || !destination) return null;
						if (edge.kind === 'vca-membership') return <span
							key={`handle:${edge.key}`}
							className="kw-routing-graph__edge-label kw-routing-graph__edge-label--vca-membership"
							style={edgeHandleStyle(source, destination, edge.parallelOffset)}
							data-routing-vca-relation={`${edge.id}:${edge.destinationKey}`}
							role="note"
							aria-label={fill(copy.vcaMembership, { source: source.label, destination: destination.label })}
						>{copy.vca}</span>;
						const model = graph.edges.find(({ id }) => id === edge.id);
						if (!model) return null;
						return <button
							key={`handle:${edge.key}`}
							type="button"
							className={`kw-routing-graph__edge-handle kw-routing-graph__edge-handle--${edge.kind}${edge.enabled ? '' : ' is-disabled'}`}
							style={edgeHandleStyle(source, destination, edge.parallelOffset)}
							data-routing-edge={edge.id}
							aria-pressed={selection?.kind === 'edge' && selection.id === edge.id}
							aria-label={edgeAriaLabel(copy, model, project, graph)}
							onClick={() => setSelection({ kind: 'edge', id: edge.id })}
							onKeyDown={(event) => {
								if (event.key !== 'Delete') return;
								event.preventDefault();
								setSelection({ kind: 'edge', id: edge.id });
								if (!isSoundscaperFolderOwnedRoutingEdge(project, model)) setConfirmingDelete(true);
							}}
						>{edge.kind === 'assignment' ? 'A' : edge.kind === 'send' ? 'S' : 'SC'}</button>;
					})}
					{layout.nodes.map((node) => <RoutingNodeCard
						key={node.key}
						node={node}
						copy={copy}
						project={project}
						graph={graph}
						destinations={destinations}
						disabled={graphDisabled}
						selected={selectedKey === node.key}
						connecting={connecting !== null}
						tabIndex={focusKey === node.key ? 0 : -1}
						buttonRef={(element) => element ? nodeRefs.current.set(node.key, element) : nodeRefs.current.delete(node.key)}
						onSelect={(nextSelection) => setSelection(nextSelection)}
						onSource={chooseSource}
						onDestination={connectTo}
						onNavigate={(key, direction) => navigateNodes(layout.nodes, key, direction, setFocusKey, nodeRefs.current)}
						onDelete={(nextSelection) => {
							setSelection(nextSelection);
							if (nextSelection.kind === 'track' || nextSelection.kind === 'master') return;
							if (nextSelection.kind === 'node' && isSoundscaperFolderOwnedRoutingNode(
								project, nextSelection.collection, nextSelection.id,
							)) return;
							setConfirmingDelete(true);
						}}
					/>)}
				</div></div>
			</div>
			<SoundscaperRoutingGraphInspector
				project={project}
				graph={graph}
				copy={copy}
				selection={selection}
				disabled={graphDisabled}
				confirmingDelete={confirmingDelete}
				onConfirmingDelete={setConfirmingDelete}
				onCandidate={applyCandidate}
				onParameterGesture={onParameterGesture}
				onError={failAction}
			/>
		</div>
		<p className="kw-routing-graph__status" role="status" aria-live="polite">{status}</p>
		{error && <p className="kw-routing-graph__error" role="alert">{error}</p>}
	</section>;
}

interface RoutingNodeCardProps {
	readonly node: RoutingLayoutNode;
	readonly copy: SoundscaperRoutingGraphCopy;
	readonly project: unknown;
	readonly graph: MixerGraphV21;
	readonly destinations: ReturnType<typeof routingDestinationOptions>;
	readonly disabled: boolean;
	readonly selected: boolean;
	readonly connecting: boolean;
	readonly tabIndex: number;
	readonly buttonRef: (element: HTMLButtonElement | null) => void;
	readonly onSelect: (selection: RoutingSelection) => void;
	readonly onSource: (source: MixerEdgeV21['source'], label: string) => void;
	readonly onDestination: (destination: MixerEdgeV21['destination']) => void;
	readonly onNavigate: (key: string, direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end') => void;
	readonly onDelete: (selection: RoutingSelection) => void;
}

function RoutingNodeCard(props: RoutingNodeCardProps) {
	const { node, copy, graph, destinations, disabled, selected, connecting, tabIndex, buttonRef } = props;
	const selection = nodeSelection(node);
	const source = nodeSource(node);
	const normalDestination = destinations.find(({ endpoint }) => (
		endpoint.kind !== 'effect-sidechain' && routingLayoutNodeKeyForEndpoint(endpoint) === node.key
	));
	const sidechains = destinations.filter(({ endpoint }) => (
		endpoint.kind === 'effect-sidechain' && routingLayoutNodeKeyForEndpoint(endpoint) === node.key
	));
	const counts = connectionCounts(graph, node);
	return <div
		className={`kw-routing-graph__node kw-routing-graph__node--${node.kind}${selected ? ' is-selected' : ''}`}
		data-routing-node={node.key}
		style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }}
	>
		<button
			ref={buttonRef}
			type="button"
			className="kw-routing-graph__node-main"
			tabIndex={tabIndex}
			aria-pressed={selected}
			aria-label={`${node.detail} ${node.label}${node.channelCount === null ? '' : `, ${node.channelCount} ${copy.channels}`}, ${counts.inputs} inputs, ${counts.outputs} outputs`}
			onClick={() => props.onSelect(selection)}
			onKeyDown={(event) => nodeKeyDown(event, node, selection, props)}
		>
			<span className="kw-routing-graph__node-kind">{node.detail}</span>
			<strong>{node.label}</strong>
			{node.channelCount !== null && <span>{node.channelCount} {copy.channelAbbreviation}</span>}
		</button>
		{normalDestination && <PortButton
			kind="destination" nodeKey={node.key} label={fill(copy.connectInto, { destination: normalDestination.label })}
			disabled={disabled} active={connecting}
			onActivate={() => props.onDestination(normalDestination.endpoint)}
		/>}
		{sidechains.map((sidechain, index) => <PortButton
			key={sidechain.value} kind="sidechain" nodeKey={sidechain.value}
			sidechainIndex={index}
			label={fill(copy.connectInto, { destination: sidechain.label })} disabled={disabled} active={connecting}
			onActivate={() => props.onDestination(sidechain.endpoint)}
		/>)}
		{source && <PortButton
			kind="source" nodeKey={node.key} label={fill(copy.startConnection, { source: node.label })}
			disabled={disabled} active={false}
			onActivate={() => props.onSource(source, node.label)}
		/>}
	</div>;
}

function PortButton({ kind, nodeKey, label, disabled, active, sidechainIndex = 0, onActivate }: Readonly<{
	kind: 'source' | 'destination' | 'sidechain';
	nodeKey: string;
	label: string;
	disabled: boolean;
	active: boolean;
	sidechainIndex?: number;
	onActivate: () => void;
}>) {
	const data = kind === 'source' ? { 'data-routing-source': nodeKey } : { 'data-routing-destination': nodeKey };
	const activate = (event: KeyboardEvent<HTMLButtonElement>): void => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		onActivate();
	};
	return <button
		type="button"
		className={`kw-routing-graph__port kw-routing-graph__port--${kind}${active ? ' is-compatible' : ''}`}
		style={kind === 'sidechain' ? {
			left: `${18 + sidechainIndex % 8 * 18}px`,
			top: `${-7 - Math.floor(sidechainIndex / 8) * 18}px`,
		} : undefined}
		aria-label={label}
		disabled={disabled}
		{...data}
		onPointerDown={kind === 'source' ? (event: PointerEvent<HTMLButtonElement>) => {
			event.preventDefault(); onActivate();
		} : undefined}
		onPointerUp={kind !== 'source' ? (event: PointerEvent<HTMLButtonElement>) => {
			event.preventDefault(); if (active) onActivate();
		} : undefined}
		onKeyDown={activate}
		onClick={kind === 'source' ? onActivate : undefined}
	/>;
}

function nodeKeyDown(
	event: KeyboardEvent<HTMLButtonElement>,
	node: RoutingLayoutNode,
	selection: RoutingSelection,
	props: RoutingNodeCardProps,
): void {
	const directions = {
		ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end',
	} as const;
	const direction = directions[event.key as keyof typeof directions];
	if (direction) {
		event.preventDefault(); props.onNavigate(node.key, direction); return;
	}
	if (event.key === 'Delete') {
		event.preventDefault(); props.onDelete(selection);
	}
}

function navigateNodes(
	nodes: readonly RoutingLayoutNode[],
	fromKey: string,
	direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
	setFocusKey: (key: string) => void,
	refs: ReadonlyMap<string, HTMLButtonElement>,
): void {
	const ordered = [...nodes].sort((left, right) => left.y - right.y || left.x - right.x);
	const current = nodes.find(({ key }) => key === fromKey);
	if (!current || ordered.length === 0) return;
	let next: RoutingLayoutNode | undefined;
	if (direction === 'home') next = ordered[0];
	else if (direction === 'end') next = ordered.at(-1);
	else {
		const candidates = nodes.filter((node) => node.key !== current.key && (
			direction === 'left' ? node.x < current.x : direction === 'right' ? node.x > current.x
				: direction === 'up' ? node.y < current.y : node.y > current.y
		));
		next = candidates.sort((left, right) => spatialDistance(current, left, direction) - spatialDistance(current, right, direction))[0];
	}
	if (!next) return;
	setFocusKey(next.key);
	refs.get(next.key)?.focus();
}

function nodeSelection(node: RoutingLayoutNode): RoutingSelection {
	if (node.kind === 'track') return { kind: 'track', id: node.id };
	if (node.kind === 'master') return { kind: 'master', id: 'master' };
	if (node.kind === 'output') return { kind: 'output', id: node.id };
	if (node.kind === 'vca') return { kind: 'vca', id: node.id };
	return { kind: 'node', collection: node.kind === 'group' ? 'groups' : node.kind === 'send' ? 'sends' : 'cues', id: node.id };
}

function nodeSource(node: RoutingLayoutNode): MixerEdgeV21['source'] | null {
	if (node.kind === 'track') return { kind: 'track', id: node.id };
	if (node.kind === 'master') return { kind: 'master' };
	if (node.kind === 'group' || node.kind === 'send' || node.kind === 'cue') return { kind: 'mixer-node', id: node.id };
	return null;
}

function connectionCounts(graph: MixerGraphV21, node: RoutingLayoutNode): Readonly<{ inputs: number; outputs: number }> {
	if (node.kind === 'vca') {
		const members = graph.vcas.find(({ id }) => id === node.id)?.members.length ?? 0;
		return { inputs: 0, outputs: members };
	}
	const inputs = graph.edges.filter((edge) => routingLayoutNodeKeyForEndpoint(edge.destination) === node.key).length;
	const outputs = graph.edges.filter((edge) => routingLayoutNodeKeyForEndpoint(edge.source) === node.key).length;
	return { inputs, outputs };
}

function selectionKey(selection: RoutingSelection | null): string | null {
	if (!selection || selection.kind === 'edge') return null;
	if (selection.kind === 'master') return 'master';
	if (selection.kind === 'node') return `mixer-node:${selection.id}`;
	return `${selection.kind}:${selection.id}`;
}

function edgeHandleStyle(source: RoutingLayoutNode, destination: RoutingLayoutNode, parallelOffset = 0): React.CSSProperties {
	return {
		left: `${(source.x + source.width + destination.x) / 2 - 11}px`,
		top: `${(source.y + source.height / 2 + destination.y + destination.height / 2) / 2 - 11 + parallelOffset * 0.75}px`,
	};
}

function previewPath(source: RoutingLayoutNode, destination: Readonly<{ x: number; y: number }>): string {
	const startX = source.x + source.width;
	const startY = source.y + source.height / 2;
	const curve = Math.max(38, Math.abs(destination.x - startX) * 0.45);
	return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${destination.x - curve} ${destination.y}, ${destination.x} ${destination.y}`;
}

function edgeAriaLabel(_copy: SoundscaperRoutingGraphCopy, edge: MixerEdgeV21, project: unknown, graph: MixerGraphV21): string {
	const sources = routingSourceOptions(project, graph);
	const destinations = routingDestinationOptions(project, graph);
	const source = sources.find(({ value }) => value === routingEndpointValue(edge.source))?.label ?? routingEndpointValue(edge.source);
	const destination = destinations.find(({ value }) => value === routingEndpointValue(edge.destination))?.label ?? routingEndpointValue(edge.destination);
	return `${edge.kind} connection from ${source} to ${destination}, ${edge.position}, ${edge.enabled ? 'enabled' : 'disabled'}, ${edge.channelMap.length} channel map`;
}

function spatialDistance(from: RoutingLayoutNode, to: RoutingLayoutNode, direction: 'left' | 'right' | 'up' | 'down'): number {
	const horizontal = Math.abs(to.x - from.x);
	const vertical = Math.abs(to.y - from.y);
	return direction === 'left' || direction === 'right' ? horizontal + vertical * 2 : vertical + horizontal * 2;
}

function clampZoom(value: number): number {
	return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function statusForCommit(copy: SoundscaperRoutingGraphCopy, kind: RoutingCommitKind): string {
	if (kind === 'edge-create') return copy.connectionAdded;
	if (kind === 'edge-rewire') return copy.connectionRewired;
	if (kind.endsWith('delete')) return copy.routingItemDeleted;
	if (kind === 'item-create') return copy.routingItemAdded;
	return copy.routingUpdated;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template);
}

function errorMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : String(reason);
}
