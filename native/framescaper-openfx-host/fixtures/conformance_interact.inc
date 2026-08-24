/* SPDX-License-Identifier: AGPL-3.0-only */

struct InteractSequenceState {
	const void* handle;
	unsigned int stage;
};

std::vector<InteractSequenceState> interact_sequence_states;

auto interact_sequence_state(const void* handle) {
	return std::find_if(
		interact_sequence_states.begin(), interact_sequence_states.end(),
		[handle](const auto& state) { return state.handle == handle; }
	);
}

bool advance_interact_sequence(const void* handle, unsigned int expected, unsigned int next) {
	const auto found = interact_sequence_state(handle);
	if (found == interact_sequence_states.end() || found->stage != expected) return false;
	found->stage = next;
	return true;
}

bool reply_default_custom_interact(OfxPropertySetHandle input) {
	void* raw_effect = nullptr;
	OfxParamSetHandle set = nullptr;
	OfxParamHandle parameter = nullptr;
	char* value = nullptr;
	return properties->propGetPointer(input, kOfxPropEffectInstance, 0, &raw_effect) == kOfxStatOK
		&& raw_effect != nullptr
		&& images->getParamSet(reinterpret_cast<OfxImageEffectHandle>(raw_effect), &set) == kOfxStatOK
		&& parameters->paramGetHandle(set, "parameter15", &parameter, nullptr) == kOfxStatOK
		&& parameters->paramGetValue(parameter, &value) == kOfxStatOK
		&& value != nullptr && std::strcmp(value, "reply-default") == 0;
}

OfxStatus conformance_interact(
	const char* action,
	const void* handle,
	OfxPropertySetHandle input,
	const bool custom
) {
	if (action == nullptr || handle == nullptr) return kOfxStatErrValue;
	if (std::strcmp(action, kOfxActionDescribe) == 0) return kOfxStatOK;
	if (std::strcmp(action, kOfxActionCreateInstance) == 0) {
		if (interact_sequence_state(handle) != interact_sequence_states.end()) return kOfxStatFailed;
		interact_sequence_states.push_back({handle, 0});
		return kOfxStatOK;
	}
	if (std::strcmp(action, kOfxActionDestroyInstance) == 0) {
		const auto found = interact_sequence_state(handle);
		if (found == interact_sequence_states.end()) return kOfxStatFailed;
		interact_sequence_states.erase(found);
		return kOfxStatOK;
	}
	if (input == nullptr) return kOfxStatReplyDefault;
	if (custom && reply_default_custom_interact(input)) return kOfxStatReplyDefault;
	if (std::strcmp(action, kOfxInteractActionGainFocus) == 0
		|| std::strcmp(action, kOfxInteractActionLoseFocus) == 0) {
		void* effect = nullptr;
		if (properties->propGetPointer(input, kOfxPropEffectInstance, 0, &effect) != kOfxStatOK
			|| effect == nullptr) return kOfxStatFailed;
		const bool ordered = std::strcmp(action, kOfxInteractActionGainFocus) == 0
			? advance_interact_sequence(handle, 0, 1)
			: advance_interact_sequence(handle, 6, 7);
		if (!ordered) return kOfxStatFailed;
		return interacts->interactRedraw(
			reinterpret_cast<OfxInteractHandle>(const_cast<void*>(handle))
		) == kOfxStatOK ? kOfxStatOK : kOfxStatFailed;
	}
	if (std::strcmp(action, kOfxInteractActionPenMotion) == 0
		|| std::strcmp(action, kOfxInteractActionPenDown) == 0
		|| std::strcmp(action, kOfxInteractActionPenUp) == 0) {
		double x = -1;
		double y = -1;
		double pressure = -1;
		int viewport_x = -1;
		int viewport_y = -1;
		if (properties->propGetDouble(input, kOfxInteractPropPenPosition, 0, &x) != kOfxStatOK
			|| properties->propGetDouble(input, kOfxInteractPropPenPosition, 1, &y) != kOfxStatOK
			|| properties->propGetInt(input, kOfxInteractPropPenViewportPosition, 0, &viewport_x) != kOfxStatOK
			|| properties->propGetInt(input, kOfxInteractPropPenViewportPosition, 1, &viewport_y) != kOfxStatOK
			|| properties->propGetDouble(input, kOfxInteractPropPenPressure, 0, &pressure) != kOfxStatOK
			|| x < 0 || x > 63 || y < 0 || y > 63 || viewport_x < 0 || viewport_x > 63
			|| viewport_y < 0 || viewport_y > 63 || pressure < 0 || pressure > 1) return kOfxStatFailed;
		const bool ordered = std::strcmp(action, kOfxInteractActionPenDown) == 0
			? advance_interact_sequence(handle, 1, 2)
			: std::strcmp(action, kOfxInteractActionPenMotion) == 0
				? advance_interact_sequence(handle, 2, 3)
				: advance_interact_sequence(handle, 3, 4);
		if (!ordered) return kOfxStatFailed;
		return interacts->interactRedraw(
			reinterpret_cast<OfxInteractHandle>(const_cast<void*>(handle))
		) == kOfxStatOK ? kOfxStatOK : kOfxStatFailed;
	}
	if (std::strcmp(action, kOfxInteractActionKeyDown) == 0
		|| std::strcmp(action, kOfxInteractActionKeyUp) == 0) {
		int key_sym = -1;
		char* key_string = nullptr;
		if (properties->propGetInt(input, kOfxPropKeySym, 0, &key_sym) != kOfxStatOK
			|| properties->propGetString(input, kOfxPropKeyString, 0, &key_string) != kOfxStatOK
			|| key_sym != kOfxKey_Return || key_string == nullptr || *key_string != '\0') {
			return kOfxStatFailed;
		}
		const bool key_down = std::strcmp(action, kOfxInteractActionKeyDown) == 0;
		const bool ordered = key_down
			? advance_interact_sequence(handle, 4, 5)
			: advance_interact_sequence(handle, 5, 6);
		if (!ordered) return kOfxStatFailed;
		if (key_down) {
			void* raw_effect = nullptr;
			OfxParamSetHandle set = nullptr;
			OfxParamHandle parameter = nullptr;
			int current = 0;
			int keyed = 0;
			if (properties->propGetPointer(input, kOfxPropEffectInstance, 0, &raw_effect) != kOfxStatOK
				|| raw_effect == nullptr
				|| images->getParamSet(reinterpret_cast<OfxImageEffectHandle>(raw_effect), &set) != kOfxStatOK
				|| parameters->paramGetHandle(set, "parameter0", &parameter, nullptr) != kOfxStatOK
				|| parameters->paramGetValue(parameter, &current) != kOfxStatOK || current != 3
				|| parameters->paramGetValueAtTime(parameter, 12, &keyed) != kOfxStatOK || keyed != 9
				|| parameters->paramSetValue(parameter, 42) != kOfxStatOK) return kOfxStatFailed;
		}
		return interacts->interactRedraw(
			reinterpret_cast<OfxInteractHandle>(const_cast<void*>(handle))
		) == kOfxStatOK ? kOfxStatOK : kOfxStatFailed;
	}
	if (std::strcmp(action, kOfxInteractActionDraw) != 0) return kOfxStatReplyDefault;
	void* raw_context = nullptr;
	if (properties->propGetPointer(input, kOfxInteractPropDrawContext, 0, &raw_context) != kOfxStatOK
		|| raw_context == nullptr) return kOfxStatFailed;
	auto context = reinterpret_cast<OfxDrawContextHandle>(raw_context);
	const auto state = interact_sequence_state(handle);
	if (state == interact_sequence_states.end()) return kOfxStatFailed;
	const bool complete_sequence = state->stage == 7;
	const OfxRGBAColourF colour = custom
		? OfxRGBAColourF{0.9F, 0.4F, 0.2F, 1.0F}
		: OfxRGBAColourF{0.2F, 0.6F, 0.9F, 1.0F};
	const OfxPointD line[]{{2, 2}, {24, 18}};
	const OfxPointD label{4, custom ? 36.0 : 28.0};
	const OfxPointD sequence_label{4, custom ? 44.0 : 36.0};
	return draws->setLineWidth(context, 0) == kOfxStatErrValue
		&& draws->draw(context, kOfxDrawPrimitiveLines, line, 65'537) == kOfxStatErrValue
		&& draws->setColour(context, &colour) == kOfxStatOK
		&& draws->setLineWidth(context, 2) == kOfxStatOK
		&& draws->draw(context, kOfxDrawPrimitiveLines, line, 2) == kOfxStatOK
		&& draws->drawText(context, custom ? "PARAM" : "OFX", &label, 0) == kOfxStatOK
		&& (!complete_sequence
			|| draws->drawText(context, "STATE", &sequence_label, 0) == kOfxStatOK)
		&& interacts->interactSwapBuffers(
			reinterpret_cast<OfxInteractHandle>(const_cast<void*>(handle))
		) == kOfxStatOK ? kOfxStatOK : kOfxStatFailed;
}

OfxStatus overlay_interact(
	const char* action,
	const void* handle,
	OfxPropertySetHandle input,
	OfxPropertySetHandle
) { return conformance_interact(action, handle, input, false); }

OfxStatus custom_parameter_interact(
	const char* action,
	const void* handle,
	OfxPropertySetHandle input,
	OfxPropertySetHandle
) { return conformance_interact(action, handle, input, true); }
