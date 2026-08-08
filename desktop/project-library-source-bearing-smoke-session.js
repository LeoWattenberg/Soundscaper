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
	let complete = false;

	return Object.freeze({
		get complete() { return complete; },
		async run(webContents) {
			if (complete) throw new Error('Source-bearing packaged smoke session is already complete');
			if (!webContents || typeof webContents.executeJavaScript !== 'function'
				|| typeof webContents.getURL !== 'function' || typeof webContents.loadURL !== 'function') {
				throw new TypeError('Source-bearing packaged smoke session requires web contents');
			}
			const prior = preparedSources ? { sources: preparedSources } : null;
			const handoffNavigation = phase === 'activate' && plan.stage === 'publish'
				? expectHandoffNavigation(webContents, plan)
				: null;
			let result;
			try {
				result = await executePhase(webContents, plan, phase, prior);
			} catch (error) {
				handoffNavigation?.cancel();
				throw error;
			}
			if (phase === 'prepare') {
				assertPhase(result, 'prepared');
				preparedSources = result.sources;
				phase = 'activate';
				const url = new URL(webContents.getURL());
				url.pathname = '/';
				url.search = `?project=${encodeURIComponent(plan.seed.projectId)}`;
				url.hash = '';
				await webContents.loadURL(url.href);
				return null;
			}
			if (phase === 'activate') {
				if (result?.phase === 'editing') {
					await enterTrackName(webContents, plan.seed.advanceTrackName);
					const editNavigation = expectHandoffNavigation(webContents, plan);
					let completed;
					try {
						completed = await executePhase(webContents, plan, 'complete-edit', prior);
					} catch (error) {
						editNavigation.cancel();
						throw error;
					}
					assertPhase(completed, 'activated');
					await editNavigation.promise;
					return finish(completed);
				}
				assertPhase(result, 'activated');
				if (!handoffNavigation) return finish(result);
				await handoffNavigation.promise;
				return finish(result);
			}
			throw new Error('Source-bearing packaged smoke session phase is invalid');
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
			project: evidence?.project,
			sources: evidence?.sources,
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

async function enterTrackName(webContents, value) {
	if (typeof webContents.focus !== 'function' || typeof webContents.insertText !== 'function'
		|| typeof webContents.sendInputEvent !== 'function') {
		throw new TypeError('Source-bearing packaged recipient edit requires native input injection');
	}
	webContents.focus();
	await webContents.insertText(value);
	webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
	webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
	await new Promise((resolve) => setTimeout(resolve, 100));
}

function executePhase(webContents, plan, phase, prior) {
	return webContents.executeJavaScript(
		`(${runDesktopProjectLibrarySourceBearingRendererSmoke.toString()})(globalThis, ${JSON.stringify(plan)}, ${JSON.stringify(phase)}, ${JSON.stringify(prior)})`,
		true,
	);
}

function expectHandoffNavigation(webContents, plan) {
	if (typeof webContents.once !== 'function' || typeof webContents.removeListener !== 'function') {
		throw new TypeError('Source-bearing packaged handoff requires navigation evidence');
	}
	let timer = null;
	let settled = false;
	let listener;
	const promise = new Promise((resolve, reject) => {
		listener = (_event, candidate) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				validateHandoffNavigation(candidate, webContents.getURL(), plan);
				resolve();
			} catch (error) {
				reject(error);
			}
		};
		webContents.once('will-navigate', listener);
		timer = setTimeout(() => {
			settled = true;
			webContents.removeListener('will-navigate', listener);
			reject(new Error('Source-bearing packaged UI handoff navigation timed out'));
		}, 12_000);
	});
	void promise.catch(() => {});
	return {
		promise,
		cancel() {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			webContents.removeListener('will-navigate', listener);
		},
	};
}

function validateHandoffNavigation(candidate, currentValue, plan) {
	const current = new URL(currentValue);
	const url = new URL(String(candidate));
	const expectedPath = plan.productId === 'soundscaper'
		? /^\/framescaper\/[a-z\d-]+\/$/iu
		: /^\/[a-z\d-]+\/$/iu;
	if (url.protocol !== current.protocol || url.hostname !== current.hostname
		|| !expectedPath.test(url.pathname) || url.hash
		|| url.searchParams.size !== 1
		|| url.searchParams.get('project') !== plan.seed.projectId) {
		throw new Error('Source-bearing packaged UI handoff navigation is invalid');
	}
}

function assertPhase(value, phase) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.phase !== phase) {
		throw new TypeError(`Source-bearing packaged renderer did not complete its ${phase} phase`);
	}
}
