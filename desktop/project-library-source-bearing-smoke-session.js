/* SPDX-License-Identifier: AGPL-3.0-only */

import { runDesktopProjectLibrarySourceBearingRendererSmoke } from './project-library-source-bearing-renderer-smoke.js';
import {
	createDesktopProjectLibrarySourceBearingPlan,
	validateDesktopProjectLibrarySourceBearingResult,
} from './project-library-source-bearing-smoke.js';

export function createDesktopProjectLibrarySourceBearingSmokeSession({
	plan: planValue,
	productId,
	projectLibraryEvidence,
}) {
	const plan = createDesktopProjectLibrarySourceBearingPlan(planValue);
	if (JSON.stringify(plan) !== JSON.stringify(planValue) || plan.productId !== productId) {
		throw new TypeError('Source-bearing packaged smoke session plan targets another product');
	}
	if (typeof projectLibraryEvidence !== 'function') {
		throw new TypeError('Source-bearing packaged smoke session requires main-process evidence');
	}
	let phase = 'prepare';
	let preparedSources = null;
	let activated = null;
	let complete = false;

	return Object.freeze({
		get complete() { return complete; },
		async run(webContents) {
			if (complete) throw new Error('Source-bearing packaged smoke session is already complete');
			if (!webContents || typeof webContents.executeJavaScript !== 'function') {
				throw new TypeError('Source-bearing packaged smoke session requires web contents');
			}
			const prior = preparedSources ? { sources: preparedSources } : null;
			const result = await webContents.executeJavaScript(
				`(${runDesktopProjectLibrarySourceBearingRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)}, ${JSON.stringify(phase)}, ${JSON.stringify(prior)})`,
				true,
			);
			if (phase === 'prepare') {
				assertPhase(result, 'prepared');
				preparedSources = result.sources;
				phase = 'activate';
				return null;
			}
			if (phase === 'activate') {
				assertPhase(result, 'activated');
				activated = result;
				if (plan.stage !== 'return') {
					phase = 'finalize';
					return null;
				}
				return finish(result);
			}
			assertPhase(result, 'finalized');
			return finish({ ...result, ui: activated.ui });
		},
	});

	async function finish(renderer) {
		const evidence = await projectLibraryEvidence(plan.seed.projectId);
		const host = evidence?.host;
		const payload = validateDesktopProjectLibrarySourceBearingResult({
			schemaVersion: 1,
			mode: plan.mode,
			workflowId: plan.workflowId,
			stage: plan.stage,
			productId: plan.productId,
			project: renderer.project,
			sources: renderer.sources,
			ui: renderer.ui,
			host: {
				owner: { product: host?.owner?.product },
				fencingToken: host?.fencingToken,
				tookOverStaleLease: host?.tookOverStaleLease,
				recovery: { outcome: host?.recovery?.outcome },
			},
			catalogRevision: evidence?.catalogRevision,
		}, plan);
		complete = true;
		return payload;
	}
}

function assertPhase(value, phase) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.phase !== phase) {
		throw new TypeError(`Source-bearing packaged renderer did not complete its ${phase} phase`);
	}
}
