/* SPDX-License-Identifier: AGPL-3.0-only */

#include "audio_backends.h"

#include "pipewire_session.h"

#include <stdlib.h>
#include <string.h>

#if defined(__linux__)
#include <dlfcn.h>
#define SOUNDSCAPER_HAS_DLOPEN 1
#else
#define SOUNDSCAPER_HAS_DLOPEN 0
#endif

static void set_detail(soundscaper_backend_inventory *inventory, const char *detail)
{
	inventory->detail[0] = '\0';
	if (detail == NULL) return;
	size_t length = strlen(detail);
	if (length >= SOUNDSCAPER_AUDIO_MAX_TEXT) length = SOUNDSCAPER_AUDIO_MAX_TEXT - 1u;
	memcpy(inventory->detail, detail, length);
	inventory->detail[length] = '\0';
}

static int copy_bounded(char *destination, const char *source)
{
	if (source == NULL) return 0;
	size_t length = strlen(source);
	if (length == 0u || length >= SOUNDSCAPER_AUDIO_MAX_TEXT) return 0;
	memcpy(destination, source, length);
	destination[length] = '\0';
	return 1;
}

const char *soundscaper_audio_backend_name(soundscaper_audio_backend backend)
{
	switch (backend) {
	case SOUNDSCAPER_BACKEND_ALSA: return "alsa";
	case SOUNDSCAPER_BACKEND_JACK: return "jack";
	case SOUNDSCAPER_BACKEND_PIPEWIRE: return "pipewire";
	default: return "unknown";
	}
}

const char *soundscaper_backend_status_name(soundscaper_backend_status status)
{
	switch (status) {
	case SOUNDSCAPER_BACKEND_AVAILABLE: return "available";
	case SOUNDSCAPER_BACKEND_LIBRARY_ABSENT: return "library-absent";
	case SOUNDSCAPER_BACKEND_SYMBOLS_ABSENT: return "symbols-absent";
	case SOUNDSCAPER_BACKEND_UNSUPPORTED_PLATFORM: return "unsupported-platform";
	case SOUNDSCAPER_BACKEND_SERVER_ABSENT: return "server-absent";
	default: return "unknown";
	}
}

static void reset_inventory(soundscaper_backend_inventory *inventory)
{
	inventory->status = SOUNDSCAPER_BACKEND_UNSUPPORTED_PLATFORM;
	inventory->device_count = 0u;
	inventory->detail[0] = '\0';
}

#if SOUNDSCAPER_HAS_DLOPEN

typedef int (*alsa_device_name_hint_fn)(int, const char *, void ***);
typedef int (*alsa_device_name_free_hint_fn)(void **);
typedef char *(*alsa_device_name_get_hint_fn)(const void *, const char *);
typedef void (*alsa_free_fn)(void *);

static void enumerate_alsa(soundscaper_backend_inventory *inventory)
{
	void *library = dlopen("libasound.so.2", RTLD_LAZY | RTLD_LOCAL);
	if (library == NULL) library = dlopen("libasound.so", RTLD_LAZY | RTLD_LOCAL);
	if (library == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_LIBRARY_ABSENT;
		set_detail(inventory, "libasound could not be loaded on this system.");
		return;
	}
	alsa_device_name_hint_fn name_hint = (alsa_device_name_hint_fn)dlsym(library, "snd_device_name_hint");
	alsa_device_name_free_hint_fn free_hint =
		(alsa_device_name_free_hint_fn)dlsym(library, "snd_device_name_free_hint");
	alsa_device_name_get_hint_fn get_hint = (alsa_device_name_get_hint_fn)dlsym(library, "snd_device_name_get_hint");
	if (name_hint == NULL || free_hint == NULL || get_hint == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_SYMBOLS_ABSENT;
		set_detail(inventory, "libasound is present but does not export its device-hint interface.");
		dlclose(library);
		return;
	}

	void **hints = NULL;
	if (name_hint(-1, "pcm", &hints) != 0 || hints == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_SERVER_ABSENT;
		set_detail(inventory, "ALSA reported no PCM device hints.");
		dlclose(library);
		return;
	}
	/* `snd_device_name_get_hint` returns strdup'ed memory. ALSA documents free()
	 * as the owner, so the addon frees with the C library rather than guessing
	 * at an ALSA-specific deallocator. */
	for (void **entry = hints; *entry != NULL && inventory->device_count < SOUNDSCAPER_AUDIO_MAX_DEVICES; entry += 1) {
		char *name = get_hint(*entry, "NAME");
		char *description = get_hint(*entry, "DESC");
		char *ioid = get_hint(*entry, "IOID");
		soundscaper_audio_device *device = &inventory->devices[inventory->device_count];
		memset(device, 0, sizeof(*device));
		int accepted = copy_bounded(device->handle, name);
		if (accepted) {
			if (!copy_bounded(device->label, description)) copy_bounded(device->label, name);
			/* A hint with no IOID serves both directions; ALSA says so by omission. */
			device->direction = ioid == NULL
				? SOUNDSCAPER_DEVICE_DUPLEX
				: (strcmp(ioid, "Input") == 0 ? SOUNDSCAPER_DEVICE_INPUT : SOUNDSCAPER_DEVICE_OUTPUT);
			inventory->device_count += 1u;
		}
		free(name);
		free(description);
		free(ioid);
	}
	free_hint(hints);
	inventory->status = SOUNDSCAPER_BACKEND_AVAILABLE;
	dlclose(library);
}

typedef void *(*jack_client_open_fn)(const char *, int, int *, ...);
typedef int (*jack_client_close_fn)(void *);
typedef const char **(*jack_get_ports_fn)(void *, const char *, const char *, unsigned long);
typedef void (*jack_free_fn)(void *);

static void enumerate_jack(soundscaper_backend_inventory *inventory)
{
	void *library = dlopen("libjack.so.0", RTLD_LAZY | RTLD_LOCAL);
	if (library == NULL) library = dlopen("libjack.so", RTLD_LAZY | RTLD_LOCAL);
	if (library == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_LIBRARY_ABSENT;
		set_detail(inventory, "libjack could not be loaded on this system.");
		return;
	}
	jack_client_open_fn client_open = (jack_client_open_fn)dlsym(library, "jack_client_open");
	jack_client_close_fn client_close = (jack_client_close_fn)dlsym(library, "jack_client_close");
	jack_get_ports_fn get_ports = (jack_get_ports_fn)dlsym(library, "jack_get_ports");
	jack_free_fn jack_free_symbol = (jack_free_fn)dlsym(library, "jack_free");
	if (client_open == NULL || client_close == NULL || get_ports == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_SYMBOLS_ABSENT;
		set_detail(inventory, "libjack is present but does not export its client interface.");
		dlclose(library);
		return;
	}
	int open_status = 0;
	/* JackNoStartServer (0x01): discovery must never start a sound server the
	 * user did not ask for. An absent server is a status, not a failure. */
	void *client = client_open("soundscaper-discovery", 0x01, &open_status);
	if (client == NULL) {
		inventory->status = SOUNDSCAPER_BACKEND_SERVER_ABSENT;
		set_detail(inventory, "No JACK server is running; discovery does not start one.");
		dlclose(library);
		return;
	}
	const char **ports = get_ports(client, NULL, NULL, 0);
	if (ports != NULL) {
		for (const char **port = ports; *port != NULL && inventory->device_count < SOUNDSCAPER_AUDIO_MAX_DEVICES; port += 1) {
			soundscaper_audio_device *device = &inventory->devices[inventory->device_count];
			memset(device, 0, sizeof(*device));
			if (!copy_bounded(device->handle, *port)) continue;
			copy_bounded(device->label, *port);
			device->direction = SOUNDSCAPER_DEVICE_DUPLEX;
			inventory->device_count += 1u;
		}
		if (jack_free_symbol != NULL) jack_free_symbol((void *)ports);
	}
	client_close(client);
	inventory->status = SOUNDSCAPER_BACKEND_AVAILABLE;
	dlclose(library);
}

#endif /* SOUNDSCAPER_HAS_DLOPEN */

void soundscaper_audio_backend_enumerate(
	soundscaper_audio_backend backend,
	soundscaper_backend_inventory *inventory)
{
	if (inventory == NULL) return;
	reset_inventory(inventory);
#if SOUNDSCAPER_HAS_DLOPEN
	if (backend == SOUNDSCAPER_BACKEND_ALSA) {
		enumerate_alsa(inventory);
		return;
	}
	if (backend == SOUNDSCAPER_BACKEND_JACK) {
		enumerate_jack(inventory);
		return;
	}
	if (backend == SOUNDSCAPER_BACKEND_PIPEWIRE) {
		soundscaper_pipewire_enumerate(inventory);
		return;
	}
	set_detail(inventory, "The requested backend is not implemented by this payload.");
#else
	(void)backend;
	set_detail(inventory, "This target's audio backends are not implemented by this payload.");
#endif
}
