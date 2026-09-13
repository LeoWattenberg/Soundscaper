/* SPDX-License-Identifier: AGPL-3.0-only */

#include "plugin_scan.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The gate is nameable from the build so a target this host is not can still
 * be compiled and exercised here rather than only where it ships. */
#if defined(_WIN32)
#define SOUNDSCAPER_PLUGIN_HAS_WIN32 1
#include <windows.h>
#include <wchar.h>
#else
#define SOUNDSCAPER_PLUGIN_HAS_WIN32 0
#endif

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

#if SOUNDSCAPER_PLUGIN_HAS_WIN32
typedef HMODULE soundscaper_plugin_library;

static wchar_t *wide_path(const char *path)
{
	const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
	if (length <= 0) return NULL;
	wchar_t *wide = calloc((size_t)length, sizeof(*wide));
	if (wide == NULL) return NULL;
	if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, length) != length) {
		free(wide);
		return NULL;
	}
	return wide;
}

static int utf8_name(const wchar_t *wide, char *output, size_t capacity)
{
	const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
		wide, -1, NULL, 0, NULL, NULL);
	if (required <= 0 || (size_t)required > capacity) return 0;
	return WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
		wide, -1, output, required, NULL, NULL) == required;
}

static int regular_win32_file(DWORD attributes)
{
	return attributes != INVALID_FILE_ATTRIBUTES
		&& (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) == 0u;
}

static soundscaper_plugin_library open_plugin_library(const char *path, char *detail, size_t capacity)
{
	wchar_t *wide = wide_path(path);
	if (wide == NULL) {
		snprintf(detail, capacity, "The module path is not valid UTF-8.");
		return NULL;
	}
	const DWORD attributes = GetFileAttributesW(wide);
	if (!regular_win32_file(attributes)) {
		free(wide);
		snprintf(detail, capacity, "The candidate is not a readable regular file.");
		return NULL;
	}
	HMODULE library = LoadLibraryExW(wide, NULL,
		LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
	const DWORD error = library == NULL ? GetLastError() : ERROR_SUCCESS;
	free(wide);
	if (library == NULL) {
		snprintf(detail, capacity, "Windows rejected the module (error %lu).", (unsigned long)error);
	}
	return library;
}

static soundscaper_fixture_entry_fn plugin_entry(soundscaper_plugin_library library)
{
	return (soundscaper_fixture_entry_fn)GetProcAddress(library, SOUNDSCAPER_FIXTURE_ENTRY_SYMBOL);
}

static void close_plugin_library(soundscaper_plugin_library library)
{
	FreeLibrary(library);
}
#elif SOUNDSCAPER_PLUGIN_HAS_POSIX
typedef void *soundscaper_plugin_library;

static soundscaper_plugin_library open_plugin_library(const char *path, char *detail, size_t capacity)
{
	struct stat metadata;
	if (lstat(path, &metadata) != 0 || !S_ISREG(metadata.st_mode)) {
		snprintf(detail, capacity, "The candidate is not a readable regular file.");
		return NULL;
	}
	void *library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (library == NULL) snprintf(detail, capacity, "%s", dlerror());
	return library;
}

static soundscaper_fixture_entry_fn plugin_entry(soundscaper_plugin_library library)
{
	return (soundscaper_fixture_entry_fn)dlsym(library, SOUNDSCAPER_FIXTURE_ENTRY_SYMBOL);
}

static void close_plugin_library(soundscaper_plugin_library library)
{
	dlclose(library);
}
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
#elif SOUNDSCAPER_PLUGIN_HAS_WIN32
	wchar_t *wide_root = wide_path(root);
	if (wide_root == NULL) return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	const DWORD root_attributes = GetFileAttributesW(wide_root);
	if (root_attributes == INVALID_FILE_ATTRIBUTES
		|| (root_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0u
		|| (root_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0u) {
		free(wide_root);
		return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	}
	const size_t wide_root_length = wcslen(wide_root);
	const int needs_separator = wide_root_length > 0u
		&& wide_root[wide_root_length - 1u] != L'\\' && wide_root[wide_root_length - 1u] != L'/';
	wchar_t *pattern = calloc(wide_root_length + (needs_separator ? 3u : 2u), sizeof(*pattern));
	if (pattern == NULL) {
		free(wide_root);
		return SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	}
	memcpy(pattern, wide_root, wide_root_length * sizeof(*pattern));
	size_t pattern_length = wide_root_length;
	if (needs_separator) pattern[pattern_length++] = L'\\';
	pattern[pattern_length] = L'*';

	WIN32_FIND_DATAW entry;
	HANDLE directory = FindFirstFileW(pattern, &entry);
	free(pattern);
	free(wide_root);
	if (directory == INVALID_HANDLE_VALUE) {
		return GetLastError() == ERROR_FILE_NOT_FOUND ? 0 : SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
	}
	const size_t suffix_length = strlen(suffix);
	const size_t root_length = strlen(root);
	int result = 0;
	for (;;) {
		if (regular_win32_file(entry.dwFileAttributes)) {
			char name[SOUNDSCAPER_PLUGIN_MAX_PATH];
			if (utf8_name(entry.cFileName, name, sizeof(name))) {
				const size_t name_length = strlen(name);
				if (name_length > suffix_length
					&& strcmp(name + (name_length - suffix_length), suffix) == 0
					&& root_length + (needs_separator ? 1u : 0u) + name_length + 1u
						<= SOUNDSCAPER_PLUGIN_MAX_PATH) {
					char *output = candidates->paths[candidates->count];
					snprintf(output, SOUNDSCAPER_PLUGIN_MAX_PATH,
						needs_separator ? "%s\\%s" : "%s%s", root, name);
					candidates->count += 1u;
				}
			}
		}
		if (candidates->count >= SOUNDSCAPER_PLUGIN_MAX_CANDIDATES) break;
		if (!FindNextFileW(directory, &entry)) {
			if (GetLastError() != ERROR_NO_MORE_FILES) result = SOUNDSCAPER_PLUGIN_LIST_UNREADABLE;
			break;
		}
	}
	FindClose(directory);
	if (result != 0) candidates->count = 0u;
	return result;
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
	#if SOUNDSCAPER_PLUGIN_HAS_POSIX || SOUNDSCAPER_PLUGIN_HAS_WIN32
	char loader_detail[SOUNDSCAPER_FIXTURE_MAX_TEXT];
	loader_detail[0] = '\0';
	soundscaper_plugin_library library = open_plugin_library(path, loader_detail, sizeof(loader_detail));
	if (library == NULL) {
		/* A module that will not load at all is most often built for another
		 * architecture; the caller decides which of those two answers to
		 * publish, so the exact loader diagnostic travels with it. */
		const int unreadable = strcmp(loader_detail,
			"The candidate is not a readable regular file.") == 0;
		reject(inspection, unreadable ? SOUNDSCAPER_PLUGIN_INSPECT_UNREADABLE
			: SOUNDSCAPER_PLUGIN_INSPECT_NOT_A_MODULE, loader_detail);
		return;
	}
	soundscaper_fixture_entry_fn entry = plugin_entry(library);
	if (entry == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_NO_ENTRY, "The module exports no fixture entry point.");
		close_plugin_library(library);
		return;
	}
	/* Calling into the candidate is the dangerous moment: it may abort or never
	 * return. Both are supervised at the process boundary, not caught here. */
	const soundscaper_fixture_descriptor *descriptor = entry();
	if (descriptor == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_MALFORMED, "The fixture entry point returned no descriptor.");
		close_plugin_library(library);
		return;
	}
	if (descriptor->abi_version != SOUNDSCAPER_FIXTURE_ABI_VERSION) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_ABI_MISMATCH, "The fixture descriptor uses an unsupported ABI version.");
		close_plugin_library(library);
		return;
	}
	if (descriptor->stable_id == NULL || descriptor->stable_id[0] == '\0'
		|| descriptor->input_channels > 64u || descriptor->output_channels > 64u
		|| descriptor->create == NULL || descriptor->destroy == NULL || descriptor->process == NULL) {
		reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_MALFORMED, "The fixture descriptor is incomplete.");
		close_plugin_library(library);
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
	close_plugin_library(library);
#else
	(void)path;
	reject(inspection, SOUNDSCAPER_PLUGIN_INSPECT_UNIMPLEMENTED, "This target does not implement plug-in inspection.");
#endif
}
