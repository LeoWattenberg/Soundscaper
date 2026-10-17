/* SPDX-License-Identifier: AGPL-3.0-only */

// Vite replaces this entire boundary with Soundscaper's closed implementation
// for selected builds, so the Framescaper services below never enter that graph.
import { framescaperVideoProxyActionRuntimeFor } from '../../framescaper-video-proxy-action-runtime-registry.ts';
import { framescaperNativeOpenFxAuthoringRuntimeForNativeMedia } from '../../framescaper-native-openfx-authoring-runtime-registry.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../../project-schema-identity.ts';
import {
	composeFramescaperNativeProjectActionRuntimes,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
} from '../framescaper-native-project-actions.ts';
import {
	framescaperCandidateAuthoringActionRuntimeFor,
	type FramescaperCandidateAuthoringSurface,
} from '../framescaper-candidate-authoring-actions.ts';
import { framescaperSelectedVisualAuthoringSurfaceId } from '../framescaper-selected-visual-authoring-menu.ts';
import { framescaperImageDevelopAuthoringForCurrentV1 } from '../../../../framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { framescaperImageHdrMergeForCurrentV1 } from '../../../../framescaper/editor-selected-image-hdr-merge-current-v1.ts';
import type { FramescaperProject } from '../../../../framescaper/editor-project.ts';
import type { FramescaperImageDevelopKindV1 } from '../framescaper-image-develop-menu-v1.ts';
import {
	framescaperFinishingSurfaceId,
	type FramescaperFinishingSurface,
} from '../framescaper-finishing-menu.ts';
import {
	resolveFramescaperNativeServicesWorkspaceRuntime,
	useFramescaperNativeServicesMenuRefresh,
	wrapFramescaperNativeServicesMenuRuntime,
} from './FramescaperNativeServicesSurface.tsx';

interface ProductWorkspaceRuntimeInput {
	readonly controller: unknown;
	readonly productId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly project: unknown;
	readonly projectCapabilities: Readonly<Record<string, unknown>>;
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
	readonly run: (operation: () => unknown) => unknown;
	readonly openSurface: (surface: string) => void;
}

export function useProductNativeServicesMenuRefresh(input: { readonly productId: string }): void {
	useFramescaperNativeServicesMenuRefresh(input);
}

export function createProductWorkspaceApplicationMenuRuntime({
	controller,
	productId,
	copy,
	project,
	projectCapabilities,
	editingBlocked,
	readOnly,
	run,
	openSurface,
}: ProductWorkspaceRuntimeInput): Readonly<Record<string, unknown>> {
	const selectedNativeProjectActions = framescaperNativeProjectActionRuntimeFor(controller);
	const proxyProjectActions = productId === 'framescaper'
		&& framescaperVideoProxyActionRuntimeFor(controller) !== null
		? createFramescaperNativeProjectActionSubsetRuntime([
			'proxy-generate', 'proxy-attach', 'proxy-detach', 'proxy-relink',
		], {
			'proxy-generate': () => openSurface('video-proxy'),
			'proxy-attach': () => openSurface('video-proxy'),
			'proxy-detach': () => openSurface('video-proxy'),
			'proxy-relink': () => openSurface('video-proxy'),
		}) : null;
	const projectActions = selectedNativeProjectActions === null ? proxyProjectActions
		: proxyProjectActions === null ? selectedNativeProjectActions
			: composeFramescaperNativeProjectActionRuntimes([
				selectedNativeProjectActions, proxyProjectActions,
			]);
	const nativeServicesRuntime = resolveFramescaperNativeServicesWorkspaceRuntime({
		productId,
		copy,
		project,
		projectCapabilities,
		editingBlocked,
		readOnly,
		projectActions,
		openFxAuthoring: framescaperNativeOpenFxAuthoringRuntimeForNativeMedia(controller) as (
			Parameters<typeof resolveFramescaperNativeServicesWorkspaceRuntime>[0]['openFxAuthoring']
		),
	});
	const candidateAuthoringRuntime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	const hdrRuntime = productId === 'framescaper' ? framescaperImageHdrMergeForCurrentV1(controller) : null;
	const hdrProject = isCurrentProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY) ? project as FramescaperProject : null;
	const hdrSelection = hdrProject ? Object.freeze([...hdrProject.selection.clipIds]) : null;
	return Object.freeze({
		openFramescaperImageHdrMerge: hdrRuntime && hdrProject && hdrSelection ? () => {
			if (editingBlocked || readOnly || framescaperImageHdrMergeForCurrentV1(controller) !== hdrRuntime) return;
			const selected = controller as { readonly project: FramescaperProject; getSnapshot(): { readOnly?: unknown; importing?: unknown } };
			const current = selected.project;
			if (!isCurrentProjectSchemaIdentity(current, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return;
			const state = selected.getSnapshot();
			if (state.readOnly === true || state.importing === true || current.id !== hdrProject.id || current.revision !== hdrProject.revision
				|| current.selection.clipIds.length !== hdrSelection.length || current.selection.clipIds.some((id, index) => id !== hdrSelection[index])) return;
			openSurface('image-hdr-merge');
		} : undefined,
		openFramescaperImageDevelop: productId === 'framescaper' && controller !== null && typeof controller === 'object'
			&& framescaperImageDevelopAuthoringForCurrentV1(controller) !== null ? (kind: FramescaperImageDevelopKindV1) => {
				if (!editingBlocked && !readOnly && (kind === 'repairs' || kind === 'masks' || kind === 'brush')) openSurface(`image-develop-${kind}`);
			} : undefined,
		framescaperNativeServices: wrapFramescaperNativeServicesMenuRuntime(nativeServicesRuntime, run),
		framescaperCandidateAuthoring: candidateAuthoringRuntime === null ? null : Object.freeze({
			surfaces: candidateAuthoringRuntime.surfaces,
			open: (surface: FramescaperCandidateAuthoringSurface) => {
				const selectedSurface = isCurrentProjectSchemaIdentity(
					project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
				)
					? framescaperSelectedVisualAuthoringSurfaceId(surface) : null;
				if (selectedSurface !== null) return openSurface(selectedSurface);
				return run(() => candidateAuthoringRuntime.run(surface));
			},
		}),
		openFramescaperFinishing: (surface: FramescaperFinishingSurface) => openSurface(
			framescaperFinishingSurfaceId(surface),
		),
	});
}
