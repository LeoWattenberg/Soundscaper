/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import { normalizeVideoEffects } from '../common/editor/video-effects.js';
import { assertUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { assertManagedVideoColorRenderAdmissionV1 } from '../common/editor/video-color-management-v27.ts';
import { cloneFramescaperProjectFinishing, validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { framescaperProjectRetimeFoundationFinishing } from './editor-project-finishing-runtime.ts';
import type { ProductVideoExportStrategyEncodeRequest, ProductVideoExportPlan } from '../common/editor/controller/export/product-video-export-strategy.ts';
import { hasSelectedCubeLutPictureV2 } from './selected-preview-resource-policy.ts';

type Data = Readonly<Record<string, unknown>>;
export interface ExportAuthorityFinishing {
	readonly canonicalProject: Data;
	readonly canonicalSnapshot: FramescaperProjectFinishing;
	readonly retimeProject: Data;
	readonly retimeExportProject: Data;
}

export function hasFramescaperCubeEnvelopesV16(project: FramescaperProjectFinishing): boolean {
	return hasSelectedCubeLutPictureV2(project);
}

/** This private decoder carrier has no resource rendering authority. The
 * complete canonical snapshot and named16 plan retain every cube envelope;
 * the named16 compositor restores its authored position before rendering. */
export function executableFoundation(profile: unknown, projectValue: unknown): Data {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	for (const interpretation of project.videoSourceColorInterpretations) assertManagedVideoColorRenderAdmissionV1(interpretation);
	const foundation = framescaperProjectRetimeFoundationFinishing(profile, project);
	if (!hasFramescaperCubeEnvelopesV16(project)) return foundation as unknown as Data;
	const snapshot = structuredClone(foundation);
	const projectClip = (clip: Data) => clip.kind === 'video'
		? { ...clip, videoEffects: normalizeVideoEffectsV2(clip.videoEffects).filter(effect => effect.type !== 'cube-lut-profile-v1') } : clip;
	const carrier = { ...snapshot, clips: rows(snapshot.clips).map(projectClip),
		projectBin: { ...snapshot.projectBin, clips: rows(snapshot.projectBin.clips).map(projectClip) } };
	return carrier as unknown as Data;
}

export function currentAuthority(profile: unknown, request: Readonly<{ canonicalProject: Data; exportProject: Data }>,
	exports: WeakMap<object, ExportAuthorityFinishing>): ExportAuthorityFinishing {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) throw new TypeError('The browser export projection is not owned by this exact finishing project.');
	validateFramescaperProjectFinishing(profile, request.canonicalProject);
	if (!sameProjectSnapshot(request.canonicalProject, authority.canonicalSnapshot)
		|| !sameProjectSnapshot(executableFoundation(profile, request.canonicalProject), authority.retimeProject)) throw new Error('The selected finishing browser export projection is stale.');
	return authority;
}

export function ownedPlanAuthority(profile: unknown, request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityFinishing>, plans: WeakMap<object, ExportAuthorityFinishing>): ExportAuthorityFinishing {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) throw new TypeError('The finishing export plan is not owned by this exact project snapshot.');
	return authority;
}

export function captureFramescaperExportSnapshot(profile: unknown, project: Data): FramescaperProjectFinishing {
	return cloneFramescaperProjectFinishing(profile, project);
}

export function currentFramescaperEncodeRequestV16(authority: ExportAuthorityFinishing, request: ProductVideoExportStrategyEncodeRequest): ProductVideoExportStrategyEncodeRequest {
	const check = request.assertCurrent;
	return { ...request, assertCurrent() {
		Reflect.apply(check, request, []);
		if (!sameProjectSnapshot(request.canonicalProject, authority.canonicalSnapshot)) throw new Error('The current16 export source changed.');
	} };
}

/** Numeric keyframes come from the unchanged strict decoder carrier. Resource
 * envelopes come solely from the authenticated complete picture plan. */
export function restoreFramescaperResourceCarrierLayersV16(layers: readonly unknown[], plan: UnifiedExactRenderPlanV16, timingSidecars?: UnifiedExactRenderTimingSidecars): readonly unknown[] {
	assertUnifiedExactRenderPlanV16(plan, timingSidecars);
	const clips = new Map(plan.nodes.flatMap(node => node.kind === 'clip' ? [[node.clipId, node] as const] : []));
	return layers.map(value => {
		const layer = value as Data;
		if (!Array.isArray(layer.entries)) throw new TypeError('Current16 encoder carrier lost its layer entries.');
		return { ...layer, entries: layer.entries.map((value: unknown) => {
			const entry = value as Data, clip = clips.get(String(entry.clipId));
			if (!clip) throw new Error('Current16 encoder carrier changed clip identity.');
			const effects = normalizeVideoEffectsV2(entry.effects ?? []), legacy = normalizeVideoEffects(effects.filter(effect => effect.type !== 'cube-lut-profile-v1'));
			const authored = clip.pictureState.videoEffects, expected = authored.filter(effect => effect.type !== 'cube-lut-profile-v1');
			if (legacy.length !== expected.length || legacy.some((effect, index) => effect.id !== expected[index]?.id || effect.type !== expected[index]?.type)) throw new Error('Current16 decoder effect order changed.');
			for (const effect of effects.filter(effect => effect.type === 'cube-lut-profile-v1')) {
				if (!authored.some(value => value.id === effect.id && JSON.stringify(value) === JSON.stringify(effect))) throw new Error('Current16 encoder resource authority changed.');
			}
			let index = 0;
			return { ...entry, effects: authored.map(effect => effect.type === 'cube-lut-profile-v1' ? effect : legacy[index++]!) };
		}) };
	});
}

export function framescaperResourceExportNeedsV16(authority: ExportAuthorityFinishing, _plan: ProductVideoExportPlan): boolean {
	return hasFramescaperCubeEnvelopesV16(authority.canonicalSnapshot);
}

function rows(value: unknown): readonly Data[] {
	if (!Array.isArray(value)) throw new TypeError('Current Frame clips must retain their owning array.');
	return value as readonly Data[];
}
