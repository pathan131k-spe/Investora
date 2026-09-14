require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const supabase = require("./supabase");

let cachedDB = null;
let initPromise = null;
let saveQueue = Promise.resolve();

const EMPTY_DB = {
  users: [],
  deposits: [],
  plans: [],
  investments: [],
  activityLogs: [],
  passwordResets: []
};

async function loadDB() {
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("id", "investora")
    .single();

  if (error) throw error;

  return {
    ...EMPTY_DB,
    ...(data?.data || {})
  };
}

async function initDB() {
  if (cachedDB) return cachedDB;

  if (!initPromise) {
    initPromise = loadDB()
      .then((db) => {
        cachedDB = db;
        return cachedDB;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }

  return await initPromise;
}

function getDB() {
  if (!cachedDB) {
    throw new Error("Database not initialized");
  }

  return cachedDB;
}

function saveDB(db) {
  cachedDB = db;

  saveQueue = saveQueue
    .then(async () => {
      const { error } = await supabase
        .from("app_state")
        .upsert({
          id: "investora",
          data: db,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
    })
    .catch((err) => {
      console.error("SUPABASE SAVE ERROR:", err.message);
    });

  return saveQueue;
}

module.exports = {
  loadDB,
  initDB,
  getDB,
  saveDB
};
