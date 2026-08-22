/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoFreezeFreshnessInputV1 } from '../common/editor/video-freeze-v24.ts';
import type { UnifiedExactRenderPlan } from '../common/editor/unified-exact-render-plan.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';

export interface FramescaperUnifiedExactRenderAuthority {
	readonly sequenceId: string;
	readonly sampleStart: number;
	readonly sampleDuration: number;
	readonly outputRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly format: UnifiedExactRenderPlan['format'];
	readonly codecs: UnifiedExactRenderPlan['codecs'];
	readonly canvas: UnifiedExactRenderPlan['output']['canvas'];
	readonly includeAudio: boolean;
	readonly audioLayout: UnifiedExactRenderPlan['output']['audioLayout'];
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
}

export interface FramescaperUnifiedExactVisualRenderAuthority
	extends FramescaperUnifiedExactRenderAuthority {
	readonly visualFreshnessByModelId: ReadonlyMap<string, VideoFreezeFreshnessInputV1>;
}

const BASE_FIELDS = Object.freeze([
	'sequenceId', 'sampleStart', 'sampleDuration', 'outputRate', 'format', 'codecs', 'canvas',
	'includeAudio', 'audioLayout', 'timingViews',
]);
const VISUAL_FIELDS = Object.freeze([...BASE_FIELDS, 'visualFreshnessByModelId']);

export function snapshotFramescaperUnifiedExactRenderAuthority(
	value: unknown,
): FramescaperUnifiedExactRenderAuthority {
	const source = exactDataRecord(value, 'Framescaper unified render authority', BASE_FIELDS);
	return Object.freeze({
		sequenceId: source.sequenceId as string,
		sampleStart: source.sampleStart as number,
		sampleDuration: source.sampleDuration as number,
		outputRate: source.outputRate as FramescaperUnifiedExactRenderAuthority['outputRate'],
		format: source.format as FramescaperUnifiedExactRenderAuthority['format'],
		codecs: source.codecs as FramescaperUnifiedExactRenderAuthority['codecs'],
		canvas: source.canvas as FramescaperUnifiedExactRenderAuthority['canvas'],
		includeAudio: source.includeAudio as boolean,
		audioLayout: source.audioLayout as FramescaperUnifiedExactRenderAuthority['audioLayout'],
		timingViews: source.timingViews as FramescaperUnifiedExactRenderAuthority['timingViews'],
	});
}

export function snapshotFramescaperUnifiedExactVisualRenderAuthority(
	value: unknown,
): FramescaperUnifiedExactVisualRenderAuthority {
	const source = exactDataRecord(value, 'Framescaper unified visual render authority', VISUAL_FIELDS);
	return Object.freeze({
		...snapshotFramescaperUnifiedExactRenderAuthority(Object.fromEntries(
			BASE_FIELDS.map((key) => [key, source[key]]),
		)),
		visualFreshnessByModelId: source.visualFreshnessByModelId as
			FramescaperUnifiedExactVisualRenderAuthority['visualFreshnessByModelId'],
	});
}

function exactDataRecord(
	value: unknown,
	name: string,
	fields: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain data record.`);
	}
	const source = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(source);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return result;
}
