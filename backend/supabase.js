const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL ya SUPABASE_SECRET_KEY missing hai");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
