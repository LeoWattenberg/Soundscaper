/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_ADDON_PLUGIN_H
#define SOUNDSCAPER_ADDON_PLUGIN_H

#include "addon_napi.h"

napi_value list_plugin_candidates(napi_env env, napi_callback_info info);
napi_value inspect_plugin_candidate(napi_env env, napi_callback_info info);
napi_value open_plugin_instance(napi_env env, napi_callback_info info);
napi_value process_plugin_block(napi_env env, napi_callback_info info);
napi_value plugin_latency_frames(napi_env env, napi_callback_info info);
napi_value save_plugin_state(napi_env env, napi_callback_info info);
napi_value load_plugin_state(napi_env env, napi_callback_info info);

#endif
