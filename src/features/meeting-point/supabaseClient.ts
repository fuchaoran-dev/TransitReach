import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null when this deployment has no Supabase project configured, so the meeting page can say
 * so rather than failing on first use.
 *
 * The session is persisted (the library default), so a device keeps the same anonymous
 * identity across reloads and returns to its own place in a room instead of taking a second.
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
