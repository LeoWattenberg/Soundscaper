/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioTrackChannelCount } from './project-audio-factory.js';
import { defaultMixerChannelMapV21 } from './mixer-graph-v21.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { record, records, type DataRecord, type DawprojectExportContext } from './dawproject-export-context.ts';

/** Channel.destination carries an address, not a weighted, mapped or pre-fader connection. */
export function reportOmittedDawprojectRouting(context: DawprojectExportContext): void {
	const graph = record(context.project.mixer);
	if (graph.schemaVersion !== 1) return;
	const tracks = new Map(records(context.project.tracks).map(track => [String(track.id), track]));
	const groups = records(graph.groups);
	const sends = records(graph.sends);
	const nodes = new Map([...groups, ...sends].map(node => [String(node.id), node]));
	const masterChannels = positiveWidth(context.project.masterChannels, 2);
	const endpoint = (value: DataRecord): { name: string; width: number } | null => {
		if (value.kind === 'master') return { name: 'Master', width: masterChannels };
		if (value.kind === 'output') {
			const output = records(graph.outputs).find(candidate => candidate.id === value.id);
			return output ? { name: String(output.name), width: positiveWidth(output.channelCount, masterChannels) } : null;
		}
		const item = value.kind === 'track' ? tracks.get(String(value.id)) : nodes.get(String(value.id));
		if (!item) return null;
		return { name: String(item.name ?? item.id), width: value.kind === 'track'
			? audioTrackChannelCount(context.project, item, masterChannels)
			: positiveWidth(item.channelCount, masterChannels) };
	};
	for (const edge of records(graph.edges)) {
		const source = record(edge.source);
		const destination = record(edge.destination);
		const from = endpoint(source);
		const to = endpoint(destination);
		// Omitted processors/nodes already have their own scoped warnings.
		if (!from || !to) continue;
		const supportedSend = edge.kind === 'send' && destination.kind === 'mixer-node'
			&& sends.some(send => send.id === destination.id);
		const supportedAssignment = edge.kind === 'assignment'
			&& (destination.kind === 'master' || destination.kind === 'output'
				|| groups.some(group => group.id === destination.id));
		const features: string[] = [];
		if (!supportedSend && !supportedAssignment) features.push('connection');
		if (edge.enabled === false) features.push('enabled');
		if (!supportedSend && Number(edge.level ?? 1) !== 1) features.push('level');
		if (!supportedSend && edge.position === 'pre-fader') features.push('position');
		const expectedMap = defaultMixerChannelMapV21(from.width, to.width);
		const statedMap = Array.isArray(edge.channelMap) ? edge.channelMap : expectedMap;
		if (statedMap.length !== expectedMap.length
			|| statedMap.some((channel, index) => channel !== expectedMap[index])) features.push('channelMap');
		if (features.length === 0) continue;
		const level = Number(edge.level ?? 1);
		const levelDescription = features.includes('level')
			? ` Connection level ${decibelLabel(level)} is omitted; the destination uses unity (0 dB).` : '';
		addDeliveryReportItem(context.draft, {
			code: 'dawproject.routing-features-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'mixer-edge', id: String(edge.id) },
			data: { features, source: edge.source, destination: edge.destination,
				level, position: edge.position, enabled: edge.enabled, channelMap: statedMap },
			message: `${from.name} → ${to.name}: DAWproject cannot retain this connection's ${features.join(', ')}.${levelDescription}`,
		});
	}
}

function positiveWidth(value: unknown, fallback: number): number {
	const width = Number(value);
	return Number.isSafeInteger(width) && width > 0 ? width : fallback;
}

function decibelLabel(level: number): string {
	if (level === 0) return '−∞ dB';
	return `${String(Number((20 * Math.log10(level)).toFixed(6))).replace('-', '−')} dB`;
}
