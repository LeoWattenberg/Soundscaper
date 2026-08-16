/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * Plug-in discovery, split into a safe half and a dangerous half.
 *
 * Listing candidates only reads a directory, so it cannot be taken down by a
 * hostile binary. Inspecting a candidate has to dlopen it and call into it,
 * which can abort or hang the whole process — that is precisely why scanning
 * lives in a supervised helper and why the two halves are separate calls. The
 * host drives one inspection at a time and reports which candidate is in
 * flight, so a process that dies leaves main knowing exactly which digest to
 * quarantine rather than losing a whole directory's worth of work.
 *
 * Nothing here loads a plug-in into a hosting process or grants it any project
 * audio: discovery and hosting are separate helper kinds and separate controls.
 */

#ifndef SOUNDSCAPER_PLUGIN_SCAN_H
#define SOUNDSCAPER_PLUGIN_SCAN_H

#include <stdint.h>

#include "fixture_plugin_abi.h"

#define SOUNDSCAPER_PLUGIN_MAX_CANDIDATES 512
#define SOUNDSCAPER_PLUGIN_MAX_PATH 4096

typedef enum {
	SOUNDSCAPER_PLUGIN_INSPECT_OK = 0,
	SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE = 1,
	SOUNDSCAPER_PLUGIN_INSPECT_NOT_A_MODULE = 2,
	SOUNDSCAPER_PLUGIN_INSPECT_NO_ENTRY = 3,
	SOUNDSCAPER_PLUGIN_INSPECT_ABI_MISMATCH = 4,
	SOUNDSCAPER_PLUGIN_INSPECT_MALFORMED = 5
} soundscaper_plugin_inspect_status;

typedef struct {
	soundscaper_plugin_inspect_status status;
	char detail[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	char stable_id[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	char name[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	char vendor[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	char version[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	uint32_t classification;
	uint32_t input_channels;
	uint32_t output_channels;
	uint32_t realtime;
	uint32_t offline;
	int32_t reported_latency_frames;
	uint32_t behaviour;
} soundscaper_plugin_inspection;

typedef struct {
	uint32_t count;
	char paths[SOUNDSCAPER_PLUGIN_MAX_CANDIDATES][SOUNDSCAPER_PLUGIN_MAX_PATH];
} soundscaper_plugin_candidates;

/*
 * Lists regular files directly under `root` whose name ends with `suffix`.
 * Symbolic links are skipped rather than followed: a root the user granted must
 * not become a way to reach a binary outside it.
 */
int soundscaper_plugin_list_candidates(
	const char *root,
	const char *suffix,
	soundscaper_plugin_candidates *candidates);

/*
 * dlopens one candidate and reads its descriptor. The library is closed again
 * before returning: discovery must leave nothing loaded.
 */
void soundscaper_plugin_inspect(const char *path, soundscaper_plugin_inspection *inspection);

#endif /* SOUNDSCAPER_PLUGIN_SCAN_H */
