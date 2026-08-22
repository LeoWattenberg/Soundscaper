export interface PackagedRuntimeWorkloadQualification extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: 1;
	readonly status: 'accepted' | 'rejected';
	readonly qualificationEvidencePublished: boolean;
	readonly environmentId: string | null;
	readonly observedEnvironmentId: string | null;
	readonly workloadId: string | null;
	readonly fixtureId: string | null;
	readonly sourceRevision: string | null;
	readonly budgetSha256: string | null;
	readonly rendererClass: string | null;
	readonly environmentFingerprint: unknown;
	readonly metrics: unknown;
	readonly rawEvidence: Readonly<{
		readonly artifactName: 'raw.json';
		readonly diagnosticKey: string | null;
		readonly diagnosticSha256: string | null;
	}>;
	readonly verification: Readonly<{
		readonly passed: boolean;
		readonly failures: readonly string[];
	}>;
}

export interface PackagedRuntimeQualification extends PackagedRuntimeWorkloadQualification {
	readonly kind: 'soundscaper-packaged-runtime-formal-qualification';
	readonly workloadQualifications: readonly PackagedRuntimeWorkloadQualification[];
}

export function createPackagedRuntimeQualification(options?: {
	readonly config?: unknown;
	readonly raw?: unknown;
	readonly summary?: unknown;
}): PackagedRuntimeQualification;
