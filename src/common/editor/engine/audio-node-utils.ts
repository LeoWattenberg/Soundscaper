/* SPDX-License-Identifier: AGPL-3.0-only */

export type AudioNodeArray = AudioNode[] & { transientNodes?: Set<AudioNode> };
export type AudioNodeCollection = AudioNodeArray | Set<AudioNode>;

export function addNode<Node extends AudioNode>(nodes: AudioNodeCollection, node: Node): Node {
	if (nodes instanceof Set) nodes.add(node);
	else nodes.push(node);
	return node;
}

export function getTransientNodes(nodes: AudioNodeArray): Set<AudioNode> {
	if (!nodes.transientNodes) {
		Object.defineProperty(nodes, 'transientNodes', {
			configurable: true,
			value: new Set<AudioNode>(),
		});
	}
	return nodes.transientNodes as Set<AudioNode>;
}

export function releaseTransientNodes(
	transientNodes: Set<AudioNode>,
	nodes: readonly (AudioNode | null | undefined)[],
): void {
	for (const node of nodes) {
		if (!node) continue;
		transientNodes.delete(node);
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
}

export function connect(
	source: AudioNode | null | undefined,
	target: AudioNode | AudioParam | null | undefined,
	output?: number,
	input?: number,
): void {
	if (!source || !target) return;
	if (isAudioParam(target)) {
		if (output === undefined) source.connect(target);
		else source.connect(target, output);
		return;
	}
	if (output === undefined) source.connect(target);
	else source.connect(target, output, input);
}

export function setParam(param: AudioParam | null | undefined, value: number, time: number): void {
	if (!param) return;
	if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time || 0);
	else param.value = value;
}

export function linearRamp(param: AudioParam | null | undefined, value: number, time: number): void {
	if (!param) return;
	if (typeof param.linearRampToValueAtTime === 'function') param.linearRampToValueAtTime(value, time);
	else setParam(param, value, time);
}

function isAudioParam(value: AudioNode | AudioParam): value is AudioParam {
	return typeof (value as AudioParam).setValueAtTime === 'function';
}
