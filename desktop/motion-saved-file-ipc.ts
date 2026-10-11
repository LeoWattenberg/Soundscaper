/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionSavedFileAuthority, type MotionSavedFileAuthority } from './motion-saved-file-authority.ts';
import { MOTION_SAVED_FILE_CHANNELS, normalizeMotionSavedFileSelect, normalizeMotionSavedFilePoll, normalizeMotionSavedFileRead, normalizeMotionSavedFileRelease, normalizeMotionSavedFileCancel } from '../src/common/editor/motion-saved-file-contract.ts';
export interface MotionSavedFileIpcOptions {
	readonly productId: string; readonly framescaperLine: string;
	/** Must be the current-window/main-document/origin checked registration from createTrustedDesktopIpc. */
	handle(channel: string, listener: (event: unknown, value: unknown) => Promise<unknown>): void;
	removeHandler(channel: string): void;
	ownerFor(event: unknown): object;
	isOwnerCurrent(owner: object): boolean;
	/** The main process shows a native file chooser; no renderer path is accepted. */
	chooseFile(event: unknown): Promise<string | null>;
}
/** Separate from baseline/native editorial services. Each renderer lifetime owns its own selected-path grants. */
export function registerMotionSavedFileIpc(options: MotionSavedFileIpcOptions): Readonly<{ revokeOwner(owner: object): Promise<void>; dispose(): Promise<void> }> {
	if (options.productId !== 'framescaper' || options.framescaperLine !== 'successor') throw new Error('Motion saved-file discovery requires the explicit Framescaper successor profile.');
	const owners = new Map<object, MotionSavedFileAuthority>(); let disposed = false;
	function ownerFor(event: unknown): object {
		const owner = options.ownerFor(event); if (disposed || !options.isOwnerCurrent(owner)) throw new Error('Motion saved-file renderer owner is no longer current.'); return owner;
	}
	function authority(event: unknown, create = false): MotionSavedFileAuthority {
		const owner = ownerFor(event); let result = owners.get(owner);
		if (!result && create) {
			if (owners.size >= 4) throw new RangeError('Motion saved-file renderer owner admission is full.');
			result = createMotionSavedFileAuthority({ chooseFile: async () => { ownerFor(event); const path = await options.chooseFile(event); ownerFor(event); return path; } }); owners.set(owner, result);
		}
		if (!result) throw new Error('Unknown Motion saved-file renderer owner.'); return result;
	}
	const registered: string[] = [];
	function handle(channel: string, listener: (event: unknown, value: unknown) => Promise<unknown>): void { options.handle(channel, listener); registered.push(channel); }
	try {
		handle(MOTION_SAVED_FILE_CHANNELS.select, async (event, value) => { normalizeMotionSavedFileSelect(value); return authority(event, true).select(); });
		handle(MOTION_SAVED_FILE_CHANNELS.poll, async (event, value) => { const request = normalizeMotionSavedFilePoll(value); return authority(event).poll(request); });
		handle(MOTION_SAVED_FILE_CHANNELS.read, async (event, value) => { const request = normalizeMotionSavedFileRead(value); return authority(event).read(request); });
		handle(MOTION_SAVED_FILE_CHANNELS.release, async (event, value) => { const request = normalizeMotionSavedFileRelease(value); await authority(event).release(request); });
		handle(MOTION_SAVED_FILE_CHANNELS.cancel, async (event, value) => { const request = normalizeMotionSavedFileCancel(value); await authority(event).cancel(request); });
	} catch (error) {
		const failures: unknown[] = []; for (const channel of registered) try { options.removeHandler(channel); } catch (cleanup) { failures.push(cleanup); }
		if (failures.length) throw new AggregateError([error, ...failures], 'Motion saved-file registration and cleanup failed.', { cause: error }); throw error;
	}
	async function revokeOwner(owner: object): Promise<void> { const authority = owners.get(owner); if (!authority) return; await authority.dispose(); owners.delete(owner); }
	return Object.freeze({ revokeOwner, async dispose() {
		disposed = true; const failures: unknown[] = [];
		for (const channel of registered) try { options.removeHandler(channel); } catch (error) { failures.push(error); }
		for (const owner of owners.keys()) try { await revokeOwner(owner); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Motion saved-file IPC cleanup failed.');
	} });
}
