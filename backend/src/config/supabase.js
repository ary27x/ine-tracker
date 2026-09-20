const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fail loudly at startup rather than mysteriously later.
  // eslint-disable-next-line no-console
  console.error(
    '[config] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment. ' +
      'Copy .env.example to .env and fill these in.'
  );
}

// Service role key bypasses RLS — this client must ONLY ever be used on the
// server (Express backend), never sent to or created in the frontend.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = { supabase };
