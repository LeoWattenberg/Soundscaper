/* SPDX-License-Identifier: AGPL-3.0-only */

#include "plugin_scan.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The gate is nameable from the build so a target this host is not can still
 * be compiled and exercised here rather than only where it ships. */
#ifndef SOUNDSCAPER_PLUGIN_HAS_POSIX
#if defined(_WIN32)
#define SOUNDSCAPER_PLUGIN_HAS_POSIX 0
#else
#define SOUNDSCAPER_PLUGIN_HAS_POSIX 1
#endif
#endif

#if SOUNDSCAPER_PLUGIN_HAS_POSIX
#include <dirent.h>
#include <dlfcn.h>
#include <sys/stat.h>
#endif

static void set_text(char *destination, const char *source)
{
	destination[0] = '\0';
	if (source == NULL) return;
	size_t length = strnlen(source, SOUNDSCAPER_FIXTURE_MAX_TEXT);
	if (length >= SOUNDSCAPER_FIXTURE_MAX_TEXT) length = SOUNDSCAPER_FIXTURE_MAX_TEXT - 1u;
	memcpy(destination, source, length);
	destination[length] = '\0';
}

static void reject(soundscaper_plugin_inspection *inspection,
	soundscaper_plugin_inspect_status status,
	const char *detail)
{
	memset(inspection, 0, sizeof(*inspection));
	inspection->status = status;
	inspection->reported_latency_frames = -1;
	set_text(inspection->detail, detail);
}

int soundscaper_plugin_list_candidates(
	const char *root,
	const char *suffix,
	soundscaper_plugin_candidates *candidates)
{
	if (candidates == NULL) return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	candidates->count = 0u;
	if (root == NULL || suffix == NULL || suffix[0] == '\0') return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
#if SOUNDSCAPER_PLUGIN_HAS_POSIX
	DIR *directory = opendir(root);
	if (directory == NULL) return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	const size_t suffix_length = strlen(suffix);
	const size_t root_length = strlen(root);
	struct dirent *entry;
	while ((entry = readdir(directory)) != NULL && candidates->count < SOUNDSCAPER_PLUGIN_MAX_CANDIDATES) {
		const size_t name_length = strlen(entry->d_name);
		if (name_length <= suffix_length) continue;
		if (strcmp(entry->d_name + (name_length - suffix_length), suffix) != 0) continue;
		if (root_length + 1u + name_length + 1u > SOUNDSCAPER_PLUGIN_MAX_PATH) continue;
		char path[SOUNDSCAPER_PLUGIN_MAX_PATH];
		snprintf(path, sizeof(path), "%s/%s", root, entry->d_name);
		/* lstat, not stat: a granted root must not become a route to a binary
		 * outside it by way of a symbolic link the user never saw. */
		struct stat metadata;
		if (lstat(path, &metadata) != 0) continue;
		if (!S_ISREG(metadata.st_mode)) continue;
		memcpy(candidates->paths[candidates->count], path, strlen(path) + 1u);
		candidates->count += 1u;
	}
	closedir(directory);
	return 0;
#else
	(void)root;
	return SOUNDSCAPER_PLUGIN_LIST_UNIMPLEMENTED;
#endif
}

void soundscaper_plugin_inspect(const char *path, soundscaper_plugin_inspection *inspection)
{
	if (inspection == NULL) return;
	if (path == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE, "No candidate path was given.");
		return;
	}
#if SOUNDSCAPER_PLUGIN_HAS_POSIX
	struct stat metadata;
	if (lstat(path, &metadata) != 0 || !S_ISREG(metadata.st_mode)) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE, "The candidate is not a readable regular file.");
		return;
	}
	void *library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (library == NULL) {
		/* A module that will not load at all is most often built for another
		 * architecture; the caller decides which of those two answers to
		 * publish, so the exact loader diagnostic travels with it. */
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_NOT_A_MODULE, dlerror());
		return;
	}
	soundscaper_fixture_entry_fn entry =
		(soundscaper_fixture_entry_fn)dlsym(library, SOUNDSCAPER_FIXTURE_ENTRY_SYMBOL);
	if (entry == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_NO_ENTRY, "The module exports no fixture entry point.");
		dlclose(library);
		return;
	}
	/* Calling into the candidate is the dangerous moment: it may abort or never
	 * return. Both are supervised at the process boundary, not caught here. */
	const soundscaper_fixture_descriptor *descriptor = entry();
	if (descriptor == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_MALFORMED, "The fixture entry point returned no descriptor.");
		dlclose(library);
		return;
	}
	if (descriptor->abi_version != SOUNDSCAPER_FIXTURE_ABI_VERSION) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_ABI_MISMATCH, "The fixture descriptor uses an unsupported ABI version.");
		dlclose(library);
		return;
	}
	if (descriptor->stable_id == NULL || descriptor->stable_id[0] == '\0'
		|| descriptor->input_channels > 64u || descriptor->output_channels > 64u
		|| descriptor->create == NULL || descriptor->destroy == NULL || descriptor->process == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_MALFORMED, "The fixture descriptor is incomplete.");
		dlclose(library);
		return;
	}
	memset(inspection, 0, sizeof(*inspection));
	inspection->status = SOUNDSCAPER_PLUGIN_INSPECT_OK;
	set_text(inspection->stable_id, descriptor->stable_id);
	set_text(inspection->name, descriptor->name);
	set_text(inspection->vendor, descriptor->vendor);
	set_text(inspection->version, descriptor->version);
	inspection->classification = descriptor->classification;
	inspection->input_channels = descriptor->input_channels;
	inspection->output_channels = descriptor->output_channels;
	inspection->realtime = descriptor->realtime;
	inspection->offline = descriptor->offline;
	inspection->reported_latency_frames = descriptor->reported_latency_frames;
	inspection->behaviour = descriptor->behaviour;
	/* Discovery leaves nothing loaded: the hosting process is the only place a
	 * plug-in binary is allowed to stay resident. */
	dlclose(library);
#else
	(void)path;
	reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_UNIMPLEMENTED, "This target does not implement plug-in inspection.");
#endif
}
