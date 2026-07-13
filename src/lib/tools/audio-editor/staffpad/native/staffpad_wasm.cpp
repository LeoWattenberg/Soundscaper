/* SPDX-License-Identifier: AGPL-3.0-only */

#include "FormantShifter.h"
#include "StaffPad/TimeAndPitch.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <memory>
#include <new>

namespace {
constexpr int kAbiVersion = 1;
constexpr int kMaximumBlockSize = 1024;
constexpr double kMinimumRatio = 0.5;
constexpr double kMaximumRatio = 2.0;
constexpr double kFormantCutoffQuefrency = 0.002;

int GetFftSize(int sampleRate, bool preserveFormants)
{
    // This is the upstream Audacity StaffPad choice: about 93 ms at 44.1 kHz,
    // or half that window while preserving formants.
    const auto sampleRateScale
        =static_cast<int>(std::round(std::log2(sampleRate / 44100.0)));
    return 1 << ((preserveFormants ? 11 : 12) + sampleRateScale);
}

bool IsValidRatio(double value)
{
    return std::isfinite(value) && value >= kMinimumRatio
           && value <= kMaximumRatio;
}

struct Session
{
    Session(int rate, int channelCount, bool preserve)
        : sampleRate(rate)
        , channels(channelCount)
        , preserveFormants(preserve)
        , fftSize(GetFftSize(rate, preserve))
        , formantShifter(rate, kFormantCutoffQuefrency)
    {
        staffpad::TimeAndPitch::ShiftTimbreCb shiftTimbre;
        if (preserveFormants) {
            formantShifter.Reset(fftSize);
            shiftTimbre = [this](
                              double factor,
                              std::complex<float>* spectrum,
                              const float* powerSpectrum) {
                if (std::abs(factor - 1.0) > 1e-12) {
                    formantShifter.Process(powerSpectrum, spectrum, factor);
                }
            };
        }
        processor = std::make_unique<staffpad::TimeAndPitch>(
            fftSize, true, std::move(shiftTimbre));
        processor->setup(channels, kMaximumBlockSize);
        processor->setTimeStretchAndPitchFactor(1.0, 1.0);
    }

    int sampleRate;
    int channels;
    bool preserveFormants;
    int fftSize;
    FormantShifter formantShifter;
    std::unique_ptr<staffpad::TimeAndPitch> processor;
    std::array<std::array<float, kMaximumBlockSize>, 2> input {};
    std::array<std::array<float, kMaximumBlockSize>, 2> output {};
};

Session* Checked(void* handle)
{
    return static_cast<Session*>(handle);
}
} // namespace

extern "C" {
int sp_abi_version()
{
    return kAbiVersion;
}

int sp_maximum_block_size()
{
    return kMaximumBlockSize;
}

void* sp_create(int sampleRate, int channels, int preserveFormants)
{
    if (sampleRate < 8000 || sampleRate > 192000 || channels < 1
        || channels > 2 || (preserveFormants != 0 && preserveFormants != 1)) {
        return nullptr;
    }
    return new (std::nothrow) Session(
        sampleRate, channels, preserveFormants != 0);
}

void sp_destroy(void* handle)
{
    delete Checked(handle);
}

int sp_reset(void* handle)
{
    auto* session = Checked(handle);
    if (!session) {
        return -1;
    }
    session->processor->reset();
    session->processor->setTimeStretchAndPitchFactor(1.0, 1.0);
    return 0;
}

int sp_fft_size(void* handle)
{
    auto* session = Checked(handle);
    return session ? session->fftSize : -1;
}

int sp_set_parameters(void* handle, double timeRatio, double pitchRatio)
{
    auto* session = Checked(handle);
    if (!session || !IsValidRatio(timeRatio) || !IsValidRatio(pitchRatio)) {
        return -1;
    }
    session->processor->setTimeStretchAndPitchFactor(timeRatio, pitchRatio);
    return 0;
}

int sp_required_input(void* handle)
{
    auto* session = Checked(handle);
    return session ? session->processor->getSamplesToNextHop() : -1;
}

int sp_available_output(void* handle)
{
    auto* session = Checked(handle);
    return session ? session->processor->getNumAvailableOutputSamples() : -1;
}

int sp_latency(void* handle, double combinedStretchRatio)
{
    auto* session = Checked(handle);
    if (!session || !std::isfinite(combinedStretchRatio)
        || combinedStretchRatio < kMinimumRatio * kMinimumRatio
        || combinedStretchRatio > kMaximumRatio * kMaximumRatio) {
        return -1;
    }
    return session->processor->getLatencySamplesForStretchRatio(
        static_cast<float>(combinedStretchRatio));
}

float* sp_input_pointer(void* handle, int channel)
{
    auto* session = Checked(handle);
    if (!session || channel < 0 || channel >= session->channels) {
        return nullptr;
    }
    return session->input[channel].data();
}

float* sp_output_pointer(void* handle, int channel)
{
    auto* session = Checked(handle);
    if (!session || channel < 0 || channel >= session->channels) {
        return nullptr;
    }
    return session->output[channel].data();
}

int sp_feed(void* handle, int frames)
{
    auto* session = Checked(handle);
    if (!session || frames <= 0 || frames > kMaximumBlockSize) {
        return -1;
    }
    const float* inputPointers[2] {
        session->input[0].data(), session->input[1].data()
    };
    session->processor->feedAudio(inputPointers, frames);
    return frames;
}

int sp_read(void* handle, int frames)
{
    auto* session = Checked(handle);
    if (!session || frames <= 0 || frames > kMaximumBlockSize
        || frames > session->processor->getNumAvailableOutputSamples()) {
        return -1;
    }
    float* outputPointers[2] {
        session->output[0].data(), session->output[1].data()
    };
    session->processor->retrieveAudio(outputPointers, frames);
    return frames;
}
} // extern "C"
