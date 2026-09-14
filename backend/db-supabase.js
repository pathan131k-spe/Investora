require("dotenv").config({
  path: require("path").join(__dirname, "../.env")
});

const supabase = require("./supabase");

const DEFAULT_DB = {
  users: [],
  deposits: [],
  plans: [],
  investments: [],
  activityLogs: [],
  passwordResets: []
};

let cachedDB = null;
let initPromise = null;
let saveQueue = Promise.resolve();

async function initDB() {
  if (cachedDB) return cachedDB;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data, error } = await supabase
      .from("app_state")
      .select("data")
      .eq("id", "investora")
      .maybeSingle();

    if (error) throw error;

    if (data && data.data) {
      cachedDB = {
        ...DEFAULT_DB,
        ...data.data,
        users: Array.isArray(data.data.users) ? data.data.users : [],
        deposits: Array.isArray(data.data.deposits) ? data.data.deposits : [],
        plans: Array.isArray(data.data.plans) ? data.data.plans : [],
        investments: Array.isArray(data.data.investments) ? data.data.investments : [],
        activityLogs: Array.isArray(data.data.activityLogs) ? data.data.activityLogs : [],
        passwordResets: Array.isArray(data.data.passwordResets) ? data.data.passwordResets : []
      };
    } else {
      cachedDB = { ...DEFAULT_DB };

      const { error: insertError } = await supabase
        .from("app_state")
        .upsert({
          id: "investora",
          data: cachedDB,
          updated_at: new Date().toISOString()
        });

      if (insertError) throw insertError;
    }

    return cachedDB;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

function getDB() {
  if (!cachedDB) {
    cachedDB = { ...DEFAULT_DB };
  }

  return cachedDB;
}

function saveDB(db) {
  cachedDB = {
    ...DEFAULT_DB,
    ...db
  };

  saveQueue = saveQueue
    .then(async () => {
      const { error } = await supabase
        .from("app_state")
        .upsert({
          id: "investora",
          data: cachedDB,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error("SUPABASE SAVE ERROR:", error.message);
      }
    })
    .catch((err) => {
      console.error("SUPABASE SAVE QUEUE ERROR:", err.message);
    });

  return saveQueue;
}

module.exports = {
  initDB,
  getDB,
  saveDB
};
