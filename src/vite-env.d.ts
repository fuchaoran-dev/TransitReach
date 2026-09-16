/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the OpenTripPlanner instance, with no trailing slash.
   * Defaults to http://localhost:8080 when unset. See routing/README.md.
   */
  readonly VITE_OTP_BASE_URL?: string;
  /** Supabase project URL for Epic 6 shared meeting rooms. Unset disables rooms. */
  readonly VITE_SUPABASE_URL?: string;
  /** The project's publishable (anon) key. Never the service_role or secret key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
