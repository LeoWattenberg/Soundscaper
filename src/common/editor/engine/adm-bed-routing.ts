/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admBedChannelOrder,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedChannel,
	type AdmTerminalStripKind,
} from '../adm-project-metadata.ts';
import { addNode, connect, setParam } from './audio-node-utils.ts';

export interface AdmBedRouter {
	readonly channelCount: number;
	readonly channelOrder: readonly AdmBedChannel[];
	readonly merger: ChannelMergerNode;
	terminalChannelCount(kind: AdmTerminalStripKind, id: string): number | null;
	routeTerminal(kind: AdmTerminalStripKind, id: string, source: AudioNode, channelCount?: number): boolean;
}

export function createAdmBedRouter(
	context: BaseAudioContext,
	nodes: AudioNode[],
	metadata: unknown,
	destination: AudioNode,
): AdmBedRouter | null {
	const adm = authoredMetadata(metadata);
	if (!adm) return null;
	if (typeof context.createChannelMerger !== 'function' || typeof context.createChannelSplitter !== 'function') {
		throw new Error('This browser cannot route an authored ADM bed.');
	}
	const channelOrder = admBedChannelOrder(adm.bed.layout);
	configureDiscreteNode(destination, channelOrder.length);
	const outputIndex = new Map(channelOrder.map((channel, index) => [channel, index]));
	const assignments = new Map<string, AdmAuthoredMetadata['bed']['assignments']>();
	for (const assignment of adm.bed.assignments) {
		const key = stripKey(assignment.stripKind, assignment.stripId);
		assignments.set(key, Object.freeze([...(assignments.get(key) ?? []), assignment]));
	}
	const merger = addNode(nodes, context.createChannelMerger(channelOrder.length));
	configureDiscreteNode(merger);
	connect(merger, destination);
	return Object.freeze({
		channelCount: channelOrder.length,
		channelOrder,
		merger,
		terminalChannelCount(kind: AdmTerminalStripKind, id: string): number | null {
			const routes = assignments.get(stripKey(kind, id));
			return routes?.length ? Math.max(...routes.map((route) => route.sourceChannel)) + 1 : null;
		},
		routeTerminal(kind: AdmTerminalStripKind, id: string, source: AudioNode, channelCount?: number): boolean {
			const routes = assignments.get(stripKey(kind, id));
			if (!routes?.length) return false;
			const splitterChannels = Math.max(this.terminalChannelCount(kind, id)!, channelCount ?? 0);
			const splitter = addNode(nodes, context.createChannelSplitter(splitterChannels));
			configureDiscreteNode(splitter, splitterChannels);
			connect(source, splitter);
			for (const route of routes) {
				const gain = addNode(nodes, context.createGain());
				setParam(gain.gain, route.gain, context.currentTime);
				connect(splitter, gain, route.sourceChannel, 0);
				connect(gain, merger, 0, outputIndex.get(route.bedChannel));
			}
			return true;
		},
	});
}

function authoredMetadata(value: unknown): AdmAuthoredMetadata | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !('mode' in value) || value.mode !== 'authored') {
		return null;
	}
	return normalizeAdmProjectMetadata(
		value as Parameters<typeof normalizeAdmProjectMetadata>[0],
	) as AdmAuthoredMetadata;
}

function configureDiscreteNode(node: AudioNode, channelCount?: number): void {
	try { node.channelInterpretation = 'discrete'; } catch { /* Fixed to compatible semantics. */ }
	try { node.channelCountMode = 'explicit'; } catch { /* Fixed to compatible semantics. */ }
	if (channelCount !== undefined) {
		try { node.channelCount = channelCount; } catch { /* The splitter already exposes the requested outputs. */ }
	}
}

function stripKey(kind: AdmTerminalStripKind, id: string): string {
	return `${kind}\0${id}`;
}
