/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActionRuntime } from '../../src/common/editor/controller/action-facade.ts';

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
	const videoTrimServices = Object.freeze({
		edge: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
		rollRipple: Object.freeze({ preview: callable, commit: callable }),
		slipSlide: Object.freeze({ buildStepRequest: callable, preview: callable, commit: callable }),
		rateStretch: Object.freeze({ preview: callable, commit: callable, commitStep: callable }),
	});
	const runtime = new Proxy<Record<string, unknown>>({}, {
		get(_target, name) {
			if (name === 'capabilities') return new Proxy({}, { get: () => capability });
			if (name === 'product') return { name: 'Soundscaper' };
			if (name === 'videoTrimServices') return videoTrimServices;
			if (name === 'copy') return { projectNotFound: 'Not found', localSourcesMissing: 'Missing', audioClipNotFound: 'Missing' };
			if (name === 'project') return { tracks: [], clips: [] };
			if (name === 'state') return {
				recentProjectIds: [],
				projects: [],
				preferences: { recording: {} },
				audacityEffectType: 'amplify',
				effectPresets: {},
			};
			if (name === 'engine' || name === 'analysisService' || name === 'store') {
				return new Proxy({}, { get: () => callable });
			}
			if (name === 'AUDIO_EDITOR_DEFAULT_SHORTCUTS') return {};
			return callable;
		},
	});
	return runtime as EditorActionRuntime;
}
