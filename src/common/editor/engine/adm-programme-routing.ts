/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admBedChannelOrder,
	authoredAdmDeliveryChannels,
	normalizeAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedChannel,
	type AdmTerminalStripKind,
} from '../adm-project-metadata.ts';
import { addNode, connect, setParam } from './audio-node-utils.ts';

/**
 * Routing an authored ADM programme: terminal strips in, delivered channels out.
 *
 * Bed assignments and objects are the same routing statement wearing two names —
 * take channel *c* of strip *s* at gain *g* and put it on delivered channel *n*.
 * They are flattened into one table here so the graph cannot honour one kind and
 * quietly drop the other, which is the failure this stage exists to prevent.
 *
 * The programme claims the stage between the terminal strips and the master on
 * every graph that has one. Nothing downstream re-maps: the merger is discrete
 * and explicit so no browser folds a bed back into stereo on its way out.
 */

interface DeliveryRoute {
	readonly sourceChannel: number;
	readonly gain: number;
	readonly outputIndex: number;
}

export interface AdmProgrammeRouter {
	readonly channelCount: number;
	readonly channelOrder: readonly AdmBedChannel[];
	readonly merger: ChannelMergerNode;
	terminalChannelCount(kind: AdmTerminalStripKind, id: string): number | null;
	routeTerminal(kind: AdmTerminalStripKind, id: string, source: AudioNode, channelCount?: number): boolean;
}

export function createAdmProgrammeRouter(
	context: BaseAudioContext,
	nodes: AudioNode[],
	metadata: unknown,
	destination: AudioNode,
): AdmProgrammeRouter | null {
	const adm = authoredMetadata(metadata);
	if (!adm) return null;
	if (typeof context.createChannelMerger !== 'function' || typeof context.createChannelSplitter !== 'function') {
		throw new Error('This browser cannot route an authored ADM programme.');
	}
	const channelOrder = admBedChannelOrder(adm.bed.layout);
	const delivered = authoredAdmDeliveryChannels(adm);
	configureDiscreteNode(destination, delivered.length);
	const bedIndex = new Map(channelOrder.map((channel, index) => [channel, index]));
	const objectIndex = new Map(delivered.flatMap((channel, index) => (
		channel.kind === 'object' ? [[channel.objectId, index] as const] : []
	)));
	const routes = new Map<string, DeliveryRoute[]>();
	const addRoute = (kind: AdmTerminalStripKind, id: string, route: DeliveryRoute): void => {
		const key = stripKey(kind, id);
		routes.set(key, [...(routes.get(key) ?? []), route]);
	};
	for (const assignment of adm.bed.assignments) {
		addRoute(assignment.stripKind, assignment.stripId, {
			sourceChannel: assignment.sourceChannel,
			gain: assignment.gain,
			outputIndex: bedIndex.get(assignment.bedChannel)!,
		});
	}
	for (const object of adm.objects ?? []) {
		addRoute(object.stripKind, object.stripId, {
			sourceChannel: object.sourceChannel,
			gain: object.gain,
			outputIndex: objectIndex.get(object.id)!,
		});
	}
	const merger = addNode(nodes, context.createChannelMerger(delivered.length));
	configureDiscreteNode(merger);
	connect(merger, destination);
	return Object.freeze({
		channelCount: delivered.length,
		channelOrder,
		merger,
		terminalChannelCount(kind: AdmTerminalStripKind, id: string): number | null {
			const strip = routes.get(stripKey(kind, id));
			return strip?.length ? Math.max(...strip.map((route) => route.sourceChannel)) + 1 : null;
		},
		routeTerminal(kind: AdmTerminalStripKind, id: string, source: AudioNode, channelCount?: number): boolean {
			const strip = routes.get(stripKey(kind, id));
			if (!strip?.length) return false;
			const splitterChannels = Math.max(this.terminalChannelCount(kind, id)!, channelCount ?? 0);
			const splitter = addNode(nodes, context.createChannelSplitter(splitterChannels));
			configureDiscreteNode(splitter, splitterChannels);
			connect(source, splitter);
			for (const route of strip) {
				const gain = addNode(nodes, context.createGain());
				setParam(gain.gain, route.gain, context.currentTime);
				connect(splitter, gain, route.sourceChannel, 0);
				connect(gain, merger, 0, route.outputIndex);
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
