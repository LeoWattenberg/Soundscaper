/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_OS_AUDIO_CODEC_WINDOWS_SESSION_H
#define SOUNDSCAPER_OS_AUDIO_CODEC_WINDOWS_SESSION_H

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <objbase.h>

namespace soundscaper::os_audio {

/**
 * Owns the COM apartment and the Media Foundation platform for one codec call.
 *
 * Every Media Foundation interface must be released before MFShutdown and
 * CoUninitialize run; releasing one afterwards is undefined and crashes the
 * process. Declaring this guard ahead of every interface pointer makes that
 * ordering a property of the language — automatic objects are destroyed in
 * reverse declaration order — rather than something each early return has to
 * remember to do.
 */
class MediaFoundationSession {
public:
	MediaFoundationSession() = default;
	MediaFoundationSession(const MediaFoundationSession &) = delete;
	MediaFoundationSession &operator=(const MediaFoundationSession &) = delete;
	MediaFoundationSession(MediaFoundationSession &&) = delete;
	MediaFoundationSession &operator=(MediaFoundationSession &&) = delete;

	~MediaFoundationSession()
	{
		if (started_) MFShutdown();
		if (ownsApartment_) CoUninitialize();
	}

	/** Enter the multithreaded apartment and start Media Foundation. */
	bool start()
	{
		const HRESULT apartment = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
		ownsApartment_ = SUCCEEDED(apartment);
		if (FAILED(apartment) && apartment != RPC_E_CHANGED_MODE) return false;
		if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_FULL))) return false;
		started_ = true;
		return true;
	}

private:
	bool started_ = false;
	bool ownsApartment_ = false;
};

} // namespace soundscaper::os_audio

#endif
