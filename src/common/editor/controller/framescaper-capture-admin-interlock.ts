/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperCaptureAdminOperationKind = 'close' | 'delete' | 'handoff' | 'clear';
export type FramescaperCaptureInterlockedOperation = FramescaperCaptureAdminOperationKind | 'capture';

export interface FramescaperCaptureAdminOperationRequest {
	readonly kind: FramescaperCaptureAdminOperationKind;
	readonly projectId: string | null;
}

export interface FramescaperCaptureAdminInterlockLease {
	readonly operation: FramescaperCaptureInterlockedOperation;
	readonly projectId: string | null;
	assertCurrent(): void;
	release(): boolean;
}

export interface FramescaperCaptureAdminInterlock {
	beginAdminOperation(
		request: Readonly<FramescaperCaptureAdminOperationRequest>,
	): Readonly<FramescaperCaptureAdminInterlockLease>;
	beginCaptureAdmission(projectId: string): Readonly<FramescaperCaptureAdminInterlockLease>;
}

export class FramescaperCaptureAdminInterlockConflictError extends Error {
	constructor(
		readonly blockedOperation: FramescaperCaptureInterlockedOperation,
		readonly activeOperation: FramescaperCaptureInterlockedOperation,
		readonly projectId: string,
	) {
		super(`Framescaper ${blockedOperation} conflicts with active ${activeOperation} authority for ${projectId}.`);
		this.name = 'FramescaperCaptureAdminInterlockConflictError';
	}
}

interface ActiveAdminOperation {
	readonly generation: number;
	readonly kind: FramescaperCaptureAdminOperationKind;
	readonly projectId: string | null;
}

/** Serializes capture admission with destructive administration of its exact origin. */
export function createFramescaperCaptureAdminInterlock(): FramescaperCaptureAdminInterlock {
	const adminOperations = new Map<number, Readonly<ActiveAdminOperation>>();
	let captureAdmission: Readonly<{ readonly generation: number; readonly projectId: string }> | null = null;
	let generation = 0;

	function beginAdminOperation(
		requestValue: Readonly<FramescaperCaptureAdminOperationRequest>,
	): Readonly<FramescaperCaptureAdminInterlockLease> {
		const request = normalizeAdminRequest(requestValue);
		if (captureAdmission && conflicts(request.projectId, captureAdmission.projectId)) {
			throw new FramescaperCaptureAdminInterlockConflictError(
				request.kind, 'capture', captureAdmission.projectId,
			);
		}
		const active = Object.freeze({ generation: nextGeneration(), ...request });
		adminOperations.set(active.generation, active);
		return createLease(active.kind, active.projectId, active.generation, () => (
			adminOperations.get(active.generation) === active
		), () => adminOperations.delete(active.generation));
	}

	function beginCaptureAdmission(projectIdValue: string): Readonly<FramescaperCaptureAdminInterlockLease> {
		const projectId = stableId(projectIdValue);
		if (captureAdmission) {
			throw new FramescaperCaptureAdminInterlockConflictError(
				'capture', 'capture', captureAdmission.projectId,
			);
		}
		const blockingAdmin = [...adminOperations.values()].find((operation) => (
			conflicts(operation.projectId, projectId)
		));
		if (blockingAdmin) {
			throw new FramescaperCaptureAdminInterlockConflictError(
				'capture', blockingAdmin.kind, projectId,
			);
		}
		const active = Object.freeze({ generation: nextGeneration(), projectId });
		captureAdmission = active;
		return createLease('capture', projectId, active.generation, () => (
			captureAdmission === active
		), () => {
			if (captureAdmission !== active) return false;
			captureAdmission = null;
			return true;
		});
	}

	function nextGeneration(): number {
		generation += 1;
		if (!Number.isSafeInteger(generation)) throw new RangeError('Framescaper capture interlock generation is exhausted.');
		return generation;
	}

	return Object.freeze({ beginAdminOperation, beginCaptureAdmission });
}

function createLease(
	operation: FramescaperCaptureInterlockedOperation,
	projectId: string | null,
	generation: number,
	isCurrent: () => boolean,
	releaseCurrent: () => boolean,
): Readonly<FramescaperCaptureAdminInterlockLease> {
	let released = false;
	return Object.freeze({
		operation, projectId,
		assertCurrent() {
			if (released || !isCurrent()) {
				throw new Error(`Framescaper ${operation} interlock lease ${String(generation)} is no longer current.`);
			}
		},
		release() {
			if (released) return false;
			released = true;
			return releaseCurrent();
		},
	});
}

function normalizeAdminRequest(
	value: Readonly<FramescaperCaptureAdminOperationRequest>,
): Readonly<FramescaperCaptureAdminOperationRequest> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !['close', 'delete', 'handoff', 'clear'].includes(value.kind)) {
		throw new TypeError('Framescaper capture admin operation is invalid.');
	}
	if (value.kind === 'clear') {
		if (value.projectId !== null) throw new TypeError('Framescaper clear authority must be global.');
		return Object.freeze({ kind: value.kind, projectId: null });
	}
	return Object.freeze({ kind: value.kind, projectId: stableId(value.projectId) });
}

function conflicts(adminProjectId: string | null, captureProjectId: string): boolean {
	return adminProjectId === null || adminProjectId === captureProjectId;
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError('Framescaper capture interlock project ID is invalid.');
	}
	return value;
}
