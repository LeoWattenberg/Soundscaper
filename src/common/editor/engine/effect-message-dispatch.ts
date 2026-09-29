/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnknownRecord } from './types.ts';

export interface EffectMessageHandler {
	readonly channelCount: number;
	post(message: UnknownRecord): boolean;
}

const handlers = new WeakMap<object, Map<string, EffectMessageHandler>>();

/** Bind a non-AudioNode effect processor to the regular revisioned gesture path. */
export function registerEffectMessageHandler(graph: object, key: string, handler: EffectMessageHandler): void {
	let graphHandlers = handlers.get(graph);
	if (!graphHandlers) {
		graphHandlers = new Map();
		handlers.set(graph, graphHandlers);
	}
	if (graphHandlers.has(key)) throw new Error('Duplicate live effect message handler.');
	graphHandlers.set(key, handler);
}

export function effectMessageHandler(graph: object | null | undefined, key: string): EffectMessageHandler | undefined {
	return graph ? handlers.get(graph)?.get(key) : undefined;
}
