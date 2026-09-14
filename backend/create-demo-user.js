require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const bcrypt = require("bcryptjs");
const supabase = require("./supabase");

(async () => {
  const email = "demo@investora-test.com";
  const password = "Demo12345!";

  const password_hash = await bcrypt.hash(password, 10);

  const { data: existing, error: findError } = await supabase
    .from("users")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (findError) {
    console.log("FIND ERROR:", findError.message);
    process.exit(1);
  }

  if (existing) {
    console.log("DEMO USER ALREADY EXISTS");
    console.log("EMAIL:", email);
    console.log("PASSWORD:", password);
    process.exit(0);
  }

  const { error } = await supabase
    .from("users")
    .insert({
      id: "demo-" + Date.now(),
      name: "Demo User",
      email,
      password_hash,
      role: "user",
      referral_code: "REF-DEMO123",
      referred_by: null,
      created_at: new Date().toISOString()
    });

  if (error) {
    console.log("INSERT ERROR:", error.message);
    process.exit(1);
  }

  console.log("===== DEMO USER CREATED =====");
  console.log("EMAIL:", email);
  console.log("PASSWORD:", password);
  console.log("=============================");
})();
