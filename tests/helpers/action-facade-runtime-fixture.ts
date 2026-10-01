/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActionRuntime } from '../../src/common/editor/controller/composition/action-facade.ts';
import { createEditorLabelActionGroup } from '../../src/common/editor/controller/composition/label-action-group.ts';
import { createEditorSelectionActionGroup } from '../../src/common/editor/controller/composition/selection-action-group.ts';
import { createEditorProjectBinActionGroup } from '../../src/common/editor/controller/composition/project-bin-action-group.ts';

/**
 * A runtime that answers every name the action facade destructures.
 *
 * The facade reads well over two hundred names off its runtime, so a fixture that listed
 * them would be longer than the tests it serves and would need editing for every new
 * action. A proxy answers with a no-op instead, and only the few names whose shape the
 * facade inspects are given real values.
 */
export function createActionFacadeRuntime(capability = true): EditorActionRuntime {
	const callable = () => undefined;
	const state = {
		recentProjectIds: [],
		projects: [],
		preferences: { recording: {} },
		audacityEffectType: 'amplify',
		effectPresets: { schemaVersion: 1 as const, presets: [] },
		effectMacros: { schemaVersion: 1 as const, macros: [] },
		macroScripts: { schemaVersion: 1 as const, scripts: [] },
	};
	const videoTrimServices = Object.freeze({
		edge: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
		rollRipple: Object.freeze({ preview: callable, commit: callable }),
		slipSlide: Object.freeze({ buildStepRequest: callable, preview: callable, commit: callable }),
		rateStretch: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
	});
	const labels = createEditorLabelActionGroup({
		getTrack: () => ({ addLabel: () => null }),
		getLabelService: () => ({
			importLabelFile: async () => null,
			importCueFile: async () => null,
			exportLabels: async () => ({
				format: 'txt', fileName: 'labels.txt', mimeType: 'text/plain', text: '',
				labelCount: 0, trackIds: [],
			}),
		}),
		commit: callable,
	});
	const clipNavigation = new Proxy<Record<string, unknown>>({}, { get: () => callable });
	const selectionView = new Proxy<Record<string, unknown>>({ clipNavigation }, { get: (target, name, receiver) => (
		name === 'clipNavigation' ? clipNavigation : Reflect.get(target, name, receiver) ?? callable
	) });
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => selectionView as never,
	});
	const projectBinService = new Proxy<Record<string, unknown>>({}, { get: () => callable });
	const projectBin = createEditorProjectBinActionGroup({
		getProjectBin: () => projectBinService as never,
		getProjectVisual: () => ({ getProjectBinClipVisualData: callable }) as never,
	});
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => capability });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'videoTrimServices') return videoTrimServices;
			if (name === 'copy') return { projectNotFound: 'Not found', localSourcesMissing: 'Missing', audioClipNotFound: 'Missing' };
			if (name === 'labels') return labels;
			if (name === 'projectBin') return projectBin;
			if (name === 'selection') return selection;
			if (name === 'project') return { tracks: [], clips: [] };
			if (name === 'state' || name === 'effectLibraryState') return state;
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	});
	return runtime as unknown as EditorActionRuntime;
}
