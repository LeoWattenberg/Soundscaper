/* SPDX-License-Identifier: AGPL-3.0-only */
import type { createAudioEditorController } from '../common/editor/app.js';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { normalizeMotionCompositionOffer, createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { createStableId } from '../common/editor/stable-id.js';
import { createFramescaperCompositionLink } from './editor-project-successor-link.ts';
import { createFramescaperCompositionPlacement } from './editor-composition-link-placement.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory, redoFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from './editor-project-successor-history.ts';
import { retainFramescaperSuccessorMediaHistory } from './editor-project-successor-media-roots.ts';
import type { FramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import type { FramescaperSuccessorSession } from './editor-project-successor-session.ts';
import type { PreparedFramescaperCompositionLinkOwner, FramescaperCompositionLinkOwnerReceipt } from './editor-composition-link-owner-repository.ts';
type PreparedPublication = Pick<PreparedFramescaperCompositionLinkOwner, 'commit' | 'rollback'>;
interface ReceiveOptions { readonly readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>; readonly signal?: AbortSignal; readonly sourceId?: string }
/** Receive and history publication share the owner CAS. Live editor intent is adopted only after durable success. */
export function createFramescaperCompositionLinkSession(options: Readonly<{
	controller: ReturnType<typeof createAudioEditorController>; environment: FramescaperSuccessorEnvironment; session: FramescaperSuccessorSession;
}>) {
	const { controller, environment: env, session } = options; let busy = false;
	async function publish(build: (history: FramescaperSuccessorHistory) => Promise<{ history: FramescaperSuccessorHistory; prepared?: PreparedPublication }>) {
		if (busy) throw new Error('Wait for the current composition publication.'); busy = true;
		let prepared: PreparedPublication | undefined;
		let fence: ReturnType<typeof env.runtime.beginPublication> | null = null;
		try {
			await controller.actions.project.flush();
			const current = normalizeFramescaperSuccessorProject(controller.project);
			if (controller.getSnapshot().readOnly) throw new Error('Claim write access before changing linked compositions.');
			const capture = session.captureProjectHistory(current.id); const expectedOwnerDigest = env.controllerStore.captureOwnerDigest(current);
			fence = env.runtime.beginPublication(session, current.id, capture.token);
			const candidate = await build(capture.history); prepared = candidate.prepared;
			await retainFramescaperSuccessorMediaHistory(env.store, candidate.history);
			const commit = { expectedOwnerDigest, project: candidate.history.present, history: candidate.history, writeFence: env.controllerStore.ownerWriteFence(current.id) };
			const receipt = prepared ? await prepared.commit(commit) : await env.owners.saveOwner(commit.project, expectedOwnerDigest, commit.history, { writeFence: commit.writeFence });
			prepared = undefined; env.controllerStore.acceptOwnerReceipt(receipt); fence.acceptHistory(receipt.history); fence.release(); fence = null;
			await controller.actions.project.openById(current.id, { adoptSessionRevision: true }); return receipt;
		} catch (error) {
			if (prepared) { try { await prepared.rollback(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Composition publication and cleanup failed.', { cause: cleanup }); } }
			throw error;
		} finally { fence?.release(); busy = false; }
	}
	return Object.freeze({
		get busy() { return busy; },
		async receive(value: unknown, receive: ReceiveOptions): Promise<FramescaperCompositionLinkOwnerReceipt> {
			const offer = normalizeMotionCompositionOffer(value);
			return publish(async history => {
				const project = history.present;
				const prior = receive.sourceId ? project.compositionLinks.find(link => link.sourceId === receive.sourceId)
					: project.compositionLinks.find(link => link.projectId === offer.revision.projectId && link.compositionId === offer.compositionId);
				if (receive.sourceId && !prior) throw new RangeError('The selected composition link no longer exists.');
				const sourceId = prior?.sourceId ?? createStableId('composition');
				const prepared = await env.owners.prepareReceive(project.id, sourceId, offer, receive);
				try {
					if (prior?.acceptedDigest === prepared.state.accepted.revision.digest) return { history, prepared };
					const accepted = prepared.state.accepted;
					const command = prior ? { type: 'composition-link/replace', sourceId, expectedDigest: prior.acceptedDigest,
						link: createFramescaperCompositionLink(sourceId, accepted.compositionId, accepted.revision, { audioSourceId: prior.audioSourceId }), commands: [] }
						: createFramescaperCompositionPlacement({ project, offer: accepted, sourceId, audioSourceId: createStableId('composition-audio'),
							videoTrackId: createStableId('track'), audioTrackId: createStableId('track'), videoClipId: createStableId('clip'), audioClipId: createStableId('clip'), avLinkId: createStableId('av') });
					return { history: executeFramescaperSuccessorHistory(history, command), prepared };
				} catch (error) { return rollback(prepared, error); }
			});
		},
		async transition(sourceId: string, type: 'conform' | 'resume') {
			return publish(async history => {
				const prior = history.present.compositionLinks.find(link => link.sourceId === sourceId); if (!prior) throw new RangeError('Composition link is unavailable.');
				const prepared = await env.owners.prepareTransition(history.present.id, sourceId, { type });
				try {
					const accepted = prepared.state.accepted;
					return { prepared, history: prior.acceptedDigest === accepted.revision.digest ? history : executeFramescaperSuccessorHistory(history, {
						type: 'composition-link/replace', sourceId, expectedDigest: prior.acceptedDigest,
						link: createFramescaperCompositionLink(sourceId, accepted.compositionId, accepted.revision, { audioSourceId: prior.audioSourceId }), commands: [],
					}) };
				} catch (error) { return rollback(prepared, error); }
			});
		},
		async history(direction: 'undo' | 'redo') {
			return publish(async current => {
				const history = direction === 'undo' ? undoFramescaperSuccessorHistory(current) : redoFramescaperSuccessorHistory(current);
				const changed = history.present.compositionLinks.filter(link => current.present.compositionLinks.find(entry => entry.sourceId === link.sourceId)?.acceptedDigest !== link.acceptedDigest);
				return { history, ...(changed.length ? { prepared: await env.owners.prepareTransitions(history.present.id, changed.map(link => ({ sourceId: link.sourceId, transition: { type: 'restore', offer: createMotionCompositionOffer(link.compositionId, link.snapshot) } }))) } : {}) };
			});
		},
	});
}
async function rollback(prepared: PreparedFramescaperCompositionLinkOwner, error: unknown): Promise<never> {
	try { await prepared.rollback(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Composition preparation and cleanup failed.', { cause: cleanup }); } throw error;
}
