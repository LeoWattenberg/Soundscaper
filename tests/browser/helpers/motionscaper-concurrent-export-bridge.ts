/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { canonicalJsonSha256 } from '../../../src/common/canonical-json-sha256.ts';
import { FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE, type FramescaperSuccessorNativePlan } from '../../../src/framescaper/editor-successor-native-delivery-contract.ts';
interface Capture { plan: FramescaperSuccessorNativePlan; picture: number[]; audio: number[] }
interface State { paused: boolean; cleanupPaused: boolean; commits: number; cancels: number; captures: Capture[] }
interface Fixture { update(): void; release(): void; releaseCleanup(): void; state(): State }
export async function installMotionConcurrentExportBridge(page: Page, versions: number[][]): Promise<void> {
	await page.addInitScript(({ versions, profile }) => {
		let generation = 1, paused = false, cleanupPaused = false, commits = 0, cancels = 0, release!: () => void, releaseCleanup!: () => void;
		const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
		const hold = new Promise<void>(resolve => { release = resolve; }), captures: Capture[] = [], tokens = new Map<string, Uint8Array>();
		const files = { select: async () => ({ watchId: 'concurrent-watch', name: 'Concurrent.mscape' }),
			poll: async ({ afterGeneration }: { afterGeneration: number }) => {
				if (generation === afterGeneration) return { state: 'unchanged', generation };
				const token = `saved-${generation}`, bytes = new Uint8Array(versions[generation - 1]!); tokens.set(token, bytes);
				return { state: 'snapshot', snapshot: { token, generation, name: 'Concurrent.mscape', byteLength: bytes.length } };
			},
			read: async ({ token, offset, length }: { token: string; offset: number; length: number }) => tokens.get(token)!.slice(offset, offset + length),
			release: async ({ token }: { token: string }) => { tokens.delete(token); }, cancel: async () => {},
		};
		const delivery = { getProfile: async () => profile,
			begin: async ({ plan }: { plan: FramescaperSuccessorNativePlan }) => { captures.push({ plan, picture: [], audio: [] }); return { token: `delivery-${captures.length}` }; },
			write: async ({ token, offset, bytes, stream }: { token: string; offset: number; bytes: Uint8Array; stream?: string }) => {
				const capture = captures[Number(token.split('-')[1]) - 1]!, output = stream === 'audio' ? capture.audio : capture.picture;
				if (offset !== output.length || output.length + bytes.length > 1024 * 1024) throw new Error('Concurrent carrier bound or offset differs.');
				output.push(...bytes);
				// The fixed16-byte frame record is followed by actual float picture bytes.
				if (captures.length === 1 && stream !== 'audio' && bytes.length === 8 * 4 * 4 * 4 && !paused) { paused = true; await hold; }
			},
			commit: async ({ token }: { token: string }) => { const capture = captures[Number(token.split('-')[1]) - 1]!; commits++;
				return { identity: capture.plan.identity, name: 'Concurrent.mov', byteLength: 10, sha256: 'a'.repeat(64), frameCount: capture.plan.frameCount, profile, audio: { sampleRate: 48000, channels: 2, sampleCount: 4800 } }; },
			cancel: async () => { cancels++; },
		};
		const originalClose = AudioContext.prototype.close;
		AudioContext.prototype.close = async function (this: AudioContext) {
			const closed = Reflect.apply(originalClose, this, []) as Promise<void>;
			if (!cleanupPaused && captures.length === 1 && captures[0]!.audio.length > 4800 * 2 * 4) { cleanupPaused = true; await cleanup; }
			await closed;
		};
		Object.defineProperty(globalThis, 'framescaperSuccessorDesktop', { value: { v1: { motionSavedFiles: files, delivery } } });
		Object.defineProperty(globalThis, 'motionConcurrentFixture', { value: { update() { generation = 2; }, release, releaseCleanup, state: () => ({ paused, cleanupPaused, commits, cancels, captures }) } });
	}, { versions, profile: FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE });
}
export function motionConcurrentExportState(page: Page): Promise<State> { return page.evaluate(() => (globalThis as unknown as { motionConcurrentFixture: Fixture }).motionConcurrentFixture.state()); }
export async function motionConcurrentOwner(page: Page) {
	const value = await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => { const opening = indexedDB.open('kw-media-framescaper-editor-v2'); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
		try {
			const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
			const tx = database.transaction(['owners', 'assets', 'chunks'], 'readonly');
			const [owners, assets, chunks] = await Promise.all([request(tx.objectStore('owners').getAll()), request(tx.objectStore('assets').getAll()), request(tx.objectStore('chunks').getAll())]) as [
				{ project?: { compositionLinks: { acceptedDigest: string }[] }; history: { undoStack: unknown[] } }[], { sha256: string; byteLength: number; token: string; chunkCount: number }[], { token: string; key: string; bytes: Uint8Array }[]];
			const owner = owners.find(value => value.project?.compositionLinks.length);
			if (!owner?.project) return null;
			const retained = await Promise.all(assets.map(async asset => {
				const parts = chunks.filter(value => value.token === asset.token).sort((a, b) => a.key.localeCompare(b.key));
				if (parts.length !== asset.chunkCount || asset.byteLength > 65536) throw new Error('Concurrent original closure differs.');
				const bytes = new Uint8Array(await new Blob(parts.map(value => new Uint8Array(value.bytes))).arrayBuffer());
				return { sha256: asset.sha256, byteLength: bytes.length, actualSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('') };
			}));
			return { project: owner.project, acceptedDigest: owner.project.compositionLinks[0]!.acceptedDigest, undoSteps: owner.history.undoStack.length, assets: retained };
		} finally { database.close(); }
	});
	if (!value) throw new Error('The concurrent receiving owner is absent.');
	return { ...value, ownerProjectDigest: canonicalJsonSha256(value.project) };
}
