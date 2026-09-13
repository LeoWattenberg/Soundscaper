/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The licensing rows the platform delivery catalog depends on, as recorded.
 *
 * The matrix itself is a large config document the running app has no other
 * reason to carry, so what ships is this: the status and blocker of exactly the
 * rows the catalog names. It is a copy, and a copy can drift, which is why a
 * test reads `config/production-licensing-matrix.json` and fails the moment
 * these two disagree — nothing here may claim a status the matrix does not.
 *
 * Editing this file does not clear a row. It is a runtime-facing snapshot of
 * licensing state; preset visibility and execution never depend on it.
 */

export interface PlatformDeliveryLicensingRow {
	readonly id: string;
	readonly status: string;
	readonly blocker: string | null;
}

export const PLATFORM_DELIVERY_LICENSING_ROWS: readonly PlatformDeliveryLicensingRow[] = Object.freeze([
	Object.freeze({
		id: "codec-encode-hevc-mp4-main10-hdr10",
		status: "blocked",
		blocker: "x265 Main10 encode and MP4 mux are enabled for authenticated build and testing, an actual 10-bit Main10 encode is a runtime canary, and the five-target producer owns source, notice, and binary verification; stable redistribution remains disabled by the recorded HEVC patent-pool and HDR10-metadata posture.",
	}),
	Object.freeze({
		id: "codec-encode-hevc-mp4-main10-sdr",
		status: "blocked",
		blocker: "x265 Main10 encode and MP4 mux are enabled for authenticated build and testing, an actual 10-bit Main10 encode is a runtime canary, and the five-target producer owns source, notice, and binary verification; stable redistribution remains disabled by the recorded HEVC patent-pool and color-interoperability posture.",
	}),
	Object.freeze({
		id: "codec-native-ffmpeg-current-set",
		status: "blocked",
		blocker: "The stable distribution policy deliberately excludes a redistributed native FFmpeg media host. Authenticated source, notices, a closed component recipe, target-native five-target CI production, binary inspection, runtime self-test, and package staging are enabled for build and testing.",
	}),
	Object.freeze({
		id: "codec-hardware-acceleration",
		status: "blocked",
		blocker: "No hardware codec route is part of the distributed package inventory; machine-complete paths remain enabled for testing.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-422-hq",
		status: "blocked",
		blocker: "ProRes 422 HQ encode and MOV mux are enabled for authenticated build and testing, and the five-target producer owns binary verification; stable redistribution remains disabled by the recorded format and interoperability posture.",
	}),
	Object.freeze({
		id: "codec-encode-prores-mov-4444",
		status: "blocked",
		blocker: "ProRes 4444 encode and MOV mux are enabled for authenticated build and testing, and the five-target producer owns binary verification; stable redistribution remains disabled by the recorded format and alpha-interoperability posture.",
	}),
	Object.freeze({
		id: "codec-encode-png-image-sequence",
		status: "blocked",
		blocker: "PNG encode and image-sequence mux are enabled for authenticated build and testing, and the five-target producer owns binary verification; stable redistribution remains disabled by the recorded alpha-interoperability posture.",
	}),]);

/** The same rows in the shape the availability resolver reads a matrix in. */
export const PLATFORM_DELIVERY_LICENSING_SNAPSHOT: Readonly<Record<string, unknown>> = Object.freeze({
	recordedRows: PLATFORM_DELIVERY_LICENSING_ROWS,
});
