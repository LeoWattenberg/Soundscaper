/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalizeUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import type { VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { cloneFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from './editor-project-unified-render-plan-v16.ts';
import { createFramescaperOpenFxPlanForSourceProjectionNativeMedia } from './selected-native-media-openfx-execution.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from './video-export-visual-freshness-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

const PAIRS = new WeakMap<object, string>();
const CHECK = AbortSignal.prototype.throwIfAborted;

/** CPU resources run at their authored complete16 stage before the existing
 * native host receives a straight RGBA plane. The native14 plan is a privately
 * paired numeric projection, never a claim that the host ABI admits resources.
 * Rebuilding the whole16 plan binds every source/placement/order/ref and fixed
 * output to this native project before any external plugin is invoked. */
export function createFramescaperOpenFxExecutionForResourceFoundationV16(options: Readonly<{
	readonly profile: unknown;
	readonly project: FramescaperProjectNativeMedia;
	readonly foundationPlan: UnifiedExactRenderPlanV16;
	readonly timingViews: ReadonlyMap<string, VideoSourceTimingView>;
	readonly execute: FramescaperSelectedOpenFxExecutionNativeMedia['execute'];
	readonly resolveFrozenFrame?: FramescaperSelectedOpenFxExecutionNativeMedia['resolveFrozenFrame'];
}>): FramescaperSelectedOpenFxExecutionNativeMedia {
	const project = options.project, snapshot = cloneFramescaperProjectNativeMedia(options.profile, project);
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(snapshot);
	const plan = options.foundationPlan, identity = canonicalizeUnifiedExactRenderPlanV16(plan);
	const expected = createFramescaperProjectUnifiedExactRenderPlanV16(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, foundation, {
		sequenceId: plan.timebase.sequenceId, sampleStart: plan.timebase.sampleStart, sampleDuration: plan.timebase.sampleDuration,
		outputRate: plan.output.frameRate, format: plan.format, codecs: plan.codecs, canvas: plan.output.canvas,
		quality: plan.output.quality, includeAudio: plan.output.includeAudio, audioLayout: plan.output.audioLayout,
		timingViews: options.timingViews, visualFreshnessByModelId: createFramescaperVideoExportVisualFreshnessFinishing(foundation, {
			startFrame: plan.timebase.sampleStart, durationFrames: plan.timebase.sampleDuration,
		}),
	});
	if (canonicalizeUnifiedExactRenderPlanV16(expected) !== identity) throw new Error('The complete16 OpenFX source diverges from its authored resource snapshot.');
	const projected = numericNativeProjection(snapshot);
	const nativePlan = createFramescaperOpenFxPlanForSourceProjectionNativeMedia({ ...options, project: projected, foundationPlan: expected });
	const execute = options.execute, frozen = options.resolveFrozenFrame;
	if (typeof execute !== 'function' || frozen !== undefined && typeof frozen !== 'function') throw new TypeError('Current OpenFX execution requires captured callable ports.');
	const current = () => { if (!sameProjectSnapshot(project, snapshot)) throw new Error('The current16 native project changed during OpenFX execution.'); };
	const result: FramescaperSelectedOpenFxExecutionNativeMedia = Object.freeze({ plan: nativePlan,
		async execute(request: Parameters<typeof execute>[0]) {
			Reflect.apply(CHECK, request.signal, []); current(); Reflect.apply(CHECK, request.signal, []);
			const value = await Reflect.apply(execute, options, [request]) as Awaited<ReturnType<typeof execute>>;
			Reflect.apply(CHECK, request.signal, []); current(); Reflect.apply(CHECK, request.signal, []); return value;
		},
		...(frozen ? { async resolveFrozenFrame(...args: Parameters<NonNullable<typeof frozen>>) {
			Reflect.apply(CHECK, args[3], []); current(); Reflect.apply(CHECK, args[3], []);
			const value = await Reflect.apply(frozen, options, args) as Awaited<ReturnType<NonNullable<typeof frozen>>>;
			Reflect.apply(CHECK, args[3], []); current(); Reflect.apply(CHECK, args[3], []); return value;
		} } : {}),
	});
	PAIRS.set(result, identity); return result;
}

/** Only this creation owner can brand a resource/native pair. Geometry alone
 * is insufficient: same-size unrelated plans cannot borrow native authority. */
export function assertFramescaperOpenFxResourcePairV16(execution: object, plan: unknown): void {
	const identity = PAIRS.get(execution);
	if (identity === undefined || identity !== canonicalizeUnifiedExactRenderPlanV16(plan)) throw new Error('A paired complete16 OpenFX resource authority is required.');
}

function numericNativeProjection(project: FramescaperProjectNativeMedia): FramescaperProjectNativeMedia {
	const copy = structuredClone(project);
	const strip = (value: unknown) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Current native clip must be a record.');
		const clip = value as Readonly<Record<string, unknown>>;
		return clip.kind === 'video' ? { ...clip, videoEffects: normalizeVideoEffectsV2(clip.videoEffects).filter(effect => effect.type !== 'cube-lut-profile-v1') } : clip;
	};
	const clips = copy.clips as readonly unknown[], bin = copy.projectBin as Readonly<{ clips: readonly unknown[] }>;
	return { ...copy, clips: clips.map(strip), projectBin: { ...bin, clips: bin.clips.map(strip) } };
}
