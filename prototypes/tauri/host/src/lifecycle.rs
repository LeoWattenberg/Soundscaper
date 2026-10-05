// SPDX-License-Identifier: AGPL-3.0-only

#[derive(Default)]
pub struct Lifecycle {
    ready: bool,
    pending: Option<String>,
    allowed: bool,
}

impl Lifecycle {
    pub fn ready(&mut self) {
        self.ready = true;
    }

    pub fn request_close(&mut self) -> Option<String> {
        if !self.ready || self.allowed {
            return None;
        }
        Some(
            self.pending
                .get_or_insert_with(|| uuid::Uuid::new_v4().simple().to_string())
                .clone(),
        )
    }

    pub fn respond(&mut self, id: &str, allow: bool) -> Result<bool, String> {
        if self.pending.as_deref() != Some(id) {
            return Err("Close request expired".into());
        }
        self.pending = None;
        self.allowed = allow;
        Ok(allow)
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_can_close_without_a_renderer() {
        assert!(Lifecycle::default().request_close().is_none());
    }

    #[test]
    fn ready_renderer_must_authorize_the_current_request() {
        let mut lifecycle = Lifecycle::default();
        lifecycle.ready();
        let id = lifecycle.request_close().unwrap();
        assert_eq!(lifecycle.request_close().as_deref(), Some(id.as_str()));
        assert!(lifecycle.respond("stale", true).is_err());
        assert!(lifecycle.respond(&id, true).unwrap());
        assert!(lifecycle.request_close().is_none());
    }

    #[test]
    fn denial_and_reload_discard_prior_close_authority() {
        let mut lifecycle = Lifecycle::default();
        lifecycle.ready();
        let id = lifecycle.request_close().unwrap();
        assert!(!lifecycle.respond(&id, false).unwrap());
        let next = lifecycle.request_close().unwrap();
        assert_ne!(id, next);
        lifecycle.reset();
        assert!(lifecycle.respond(&next, true).is_err());
    }
}
