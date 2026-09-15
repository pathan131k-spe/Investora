function logActivity(userId, action, details = "") {
  const db = readDB();

  if (!db.activityLogs) {
    db.activityLogs = [];
  }

  db.activityLogs.push({
    id: Date.now().toString(),
    userId: userId || null,
    action: action,
    details: details,
    createdAt: new Date().toISOString()
  });

  writeDB(db);
}const express = require("express");
const supabase = require("./supabase");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const { initDB, getDB, saveDB } = require("./db-supabase");


const app = express();
const PORT = process.env.PORT || 3000;

const DB_FILE = process.env.VERCEL ? "/tmp/investora-database.json" : path.join(__dirname, "database.json");

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
}

async function readDB() {
  return await loadDB();
}

async function writeDB(data) {
  try {
    return saveDB(data);
  } catch (error) {
    console.error("SAVE DB ERROR:", error.message);
    return Promise.resolve();
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const crypto = require("crypto");

const SESSION_COOKIE = "investora_session";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SUPABASE_SECRET_KEY ||
  "change-this-secret";

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return body + "." + signature;
}

function verifySession(value) {
  try {
    if (!value) return null;

    const parts = value.split(".");
    if (parts.length !== 2) return null;

    const [body, signature] = parts;

    const expected = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(body)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length) return null;

    if (!crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (!payload || !payload.userId) return null;

    return payload;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || "";

  const parts = header.split(";");

  for (const part of parts) {
    const item = part.trim();

    if (item.startsWith(name + "=")) {
      return decodeURIComponent(item.substring(name.length + 1));
    }
  }

  return null;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");

  if (!existing) {
    res.setHeader("Set-Cookie", [cookie]);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", existing.concat(cookie));
  } else {
    res.setHeader("Set-Cookie", [existing, cookie]);
  }
}

function createSessionCookie(session) {
  const value = signSession({
    userId: session.userId,
    role: session.role || "user"
  });

  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=86400"
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0"
  ].join("; ");
}

app.use((req, res, next) => {
  const saved = verifySession(getCookie(req, SESSION_COOKIE));

  let destroyed = false;

  req.session = saved || {};

  req.session.destroy = () => {
    destroyed = true;
    req.session = {};
    appendSetCookie(res, clearSessionCookie());
  };

  const originalEnd = res.end;

  res.end = function (...args) {
    if (!destroyed && req.session && req.session.userId) {
      appendSetCookie(res, createSessionCookie(req.session));
    }

    return originalEnd.apply(this, args);
  };

  next();
});


app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});



// ===== SUPABASE DB BOOTSTRAP =====
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required"
      });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    if (!cleanName || !cleanEmail || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Please enter valid registration details"
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("users")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingError) {
      console.error("REGISTER CHECK ERROR:", existingError.message);
      return res.status(503).json({
        success: false,
        message: "Database temporarily unavailable"
      });
    }

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Email already registered"
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    let generatedReferralCode = "";
    let referralUnique = false;

    while (!referralUnique) {
      generatedReferralCode =
        "REF-" + Math.random().toString(36).substring(2, 10).toUpperCase();

      const { data: refCheck, error: refError } = await supabase
        .from("users")
        .select("id")
        .eq("referral_code", generatedReferralCode)
        .maybeSingle();

      if (refError) {
        console.error("REFERRAL CHECK ERROR:", refError.message);
        return res.status(503).json({
          success: false,
          message: "Database temporarily unavailable"
        });
      }

      referralUnique = !refCheck;
    }

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        id: Date.now().toString(),
        name: cleanName,
        email: cleanEmail,
        password_hash: passwordHash,
        role: "user",
        referral_code: generatedReferralCode,
        referred_by: referralCode || null,
        created_at: new Date().toISOString()
      })
      .select("id,name,email,role,referral_code,created_at")
      .single();

    if (insertError) {
      console.error("REGISTER INSERT ERROR:", insertError.message);
      return res.status(500).json({
        success: false,
        message: "Unable to create account"
      });
    }

    req.session.userId = newUser.id;
    req.session.role = newUser.role;

    res.json({
      success: true,
      message: "Account created successfully"
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: user, error } = await supabase
      .from("users")
      .select("id,name,email,password_hash,role,referral_code,referred_by,created_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error("SUPABASE LOGIN ERROR:", error.message);
      return res.status(503).json({
        success: false,
        message: "Database temporarily unavailable"
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    req.session.userId = user.id;
    req.session.role = user.role || "user";

    try {
      logActivity(user.id, "LOGIN", "User logged in");
    } catch (logError) {
      console.error("LOGIN ACTIVITY LOG ERROR:", logError.message);
    }

    return res.json({
      success: true,
      message: "Login successful"
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ loggedIn: false });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id,name,email,role,referral_code,referred_by,created_at")
      .eq("id", req.session.userId)
      .maybeSingle();

    if (error) {
      console.error("ME DB ERROR:", error.message);
      return res.status(503).json({
        loggedIn: false,
        message: "Database temporarily unavailable"
      });
    }

    if (!user) {
      req.session.destroy(() => {});
      return res.json({ loggedIn: false });
    }

    res.json({
      loggedIn: true,
      user
    });
  } catch (error) {
    console.error("ME ERROR:", error);
    res.status(500).json({
      loggedIn: false,
      message: "Server error"
    });
  }
});

app.post("/api/logout", (req, res) => {
  const userId = req.session.userId;

  if (userId) {
    logActivity(
      userId,
      "LOGOUT",
      "User logged out"
    );
  }

  req.session.destroy(() => {
    res.json({
      success: true,
      message: "Logged out"
    });
  });
});

app.use(express.static("../frontend"));
app.post("/api/deposit", async (req, res) => {
  await initDB();
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const amount = Number(req.body.amount);

  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid amount"
    });
  }

  const db = readDB();

  if (!db.deposits) {
    db.deposits = [];
  }

  const deposit = {
    id: Date.now().toString(),
    userId: req.session.userId,
    amount: amount,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  db.deposits.push(deposit);
  await saveDB(db);

  logActivity(
    req.session.userId,
    "DEPOSIT_REQUEST",
    "Deposit request: Rs. " + amount
  );

  res.json({
    success: true,
    message: "Deposit request submitted successfully"
  });
});
app.get("/api/deposits", async (req, res) => {
  await initDB();
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();
  const deposits = (db.deposits || []).filter(
    deposit => deposit.userId === req.session.userId
  );

  res.json({
    success: true,
    deposits: deposits
  });
});

// ADMIN DEMO API
app.get("/api/admin/deposits", (req, res) => {
  const db = readDB();

  const admin = db.users.find(
    user => user.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  res.json({
    success: true,
    deposits: db.deposits || []
  });
});


// DEMO ADMIN APPROVE / REJECT
app.post("/api/admin/deposits/:id/status", (req, res) => {
  const db = readDB();
  const admin = db.users.find(user => user.id === req.session.userId);

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({ success:false, message:"Admin access required" });
  }

  const { status } = req.body;
  if (!["approved","rejected"].includes(status)) {
    return res.status(400).json({ success:false, message:"Invalid status" });
  }

  const deposit = (db.deposits || []).find(d => d.id === req.params.id);
  if (!deposit) {
    return res.status(404).json({ success:false, message:"Deposit not found" });
  }

  deposit.status = status;
  deposit.updatedAt = new Date().toISOString();
  writeDB(db);

  res.json({ success:true, message:"Deposit status updated", deposit });
});




// ADMIN USERS API
app.get("/api/admin/users", (req, res) => {

  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const admin = db.users.find(
    user => user.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  const users = db.users.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  }));

  res.json({
    success: true,
    users: users
  });

});
// DEMO ADMIN ROLE CHANGE
app.post("/api/admin/users/:id/role", (req, res) => {

  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const admin = db.users.find(
    user => user.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  const { role } = req.body;

  if (!["user", "admin"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Invalid role"
    });
  }

  const user = db.users.find(
    user => user.id === req.params.id
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  user.role = role;
  writeDB(db);

  res.json({
    success: true,
    message: "User role updated",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });

});


// DEMO INVESTMENT PLANS API
app.get("/api/admin/plans", (req, res) => {

  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const admin = db.users.find(
    user => user.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  const plans = db.plans || [
    { id: "starter", name: "Starter Plan", amount: 100, active: true },
    { id: "basic", name: "Basic Plan", amount: 500, active: true },
    { id: "standard", name: "Standard Plan", amount: 1000, active: true },
    { id: "plus", name: "Plus Plan", amount: 2500, active: true },
    { id: "premium", name: "Premium Plan", amount: 5000, active: true }
  ];

  db.plans = plans;
  writeDB(db);

  res.json({
    success: true,
    plans: plans
  });

});


// DEMO INVESTMENT PLANS API
app.get("/api/plans", (req, res) => {

  const db = readDB();

  if (!db.plans) {
    db.plans = [
      { id: "starter", name: "Starter Plan", amount: 100, active: true },
      { id: "standard", name: "Standard Plan", amount: 1000, active: true },
      { id: "premium", name: "Premium Plan", amount: 5000, active: true }
    ];
    writeDB(db);
  }

  res.json({
    success: true,
    plans: db.plans
  });

});

// DEMO PLAN STATUS API
app.post("/api/admin/plans/:id/status", (req, res) => {

  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const admin = db.users.find(
    user => user.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  const plan = (db.plans || []).find(
    plan => plan.id === req.params.id
  );

  if (!plan) {
    return res.status(404).json({
      success: false,
      message: "Plan not found"
    });
  }

  plan.active = !plan.active;
  writeDB(db);

  res.json({
    success: true,
    message: plan.active ? "Plan activated" : "Plan deactivated",
    plan: plan
  });

});


// DEMO INVESTMENT ACTIVATION API
app.post("/api/invest", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const { planId } = req.body;

  const db = readDB();
  const plan = (db.plans || []).find(
    p => p.id === planId && p.active
  );

  if (!plan) {
    return res.status(404).json({
      success: false,
      message: "Active plan not found"
    });
  }

  if (!db.investments) {
    db.investments = [];
  }

  const existing = db.investments.find(
    investment =>
      investment.userId === req.session.userId &&
      investment.status === "active"
  );

  if (existing) {
    return res.status(400).json({
      success: false,
      message: "You already have an active demo investment"
    });
  }

  const investment = {
    id: Date.now().toString(),
    userId: req.session.userId,
    planId: plan.id,
    planName: plan.name,
    amount: Number(plan.amount),
    status: "active",
    createdAt: new Date().toISOString()
  };

  db.investments.push(investment);
  writeDB(db);

  logActivity(
    req.session.userId,
    "INVESTMENT_ACTIVATED",
    plan.name + " - Rs. " + Number(plan.amount).toLocaleString()
  );

  res.json({
    success: true,
    message: "Demo investment activated",
    investment: investment
  });
});

app.get("/api/investment", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const investments = (db.investments || []).filter(
    investment => investment.userId === req.session.userId
  );

  res.json({
    success: true,
    investments: investments
  });
});
// DEMO TRANSACTIONS API
app.get("/api/transactions", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const deposits = (db.deposits || [])
    .filter(d => d.userId === req.session.userId)
    .map(d => ({
      type: "deposit",
      title: "Demo Deposit",
      amount: Number(d.amount || 0),
      status: d.status,
      createdAt: d.createdAt
    }));

  const investments = (db.investments || [])
    .filter(i => i.userId === req.session.userId)
    .map(i => ({
      type: "investment",
      title: i.planName || "Demo Investment",
      amount: Number(i.amount || 0),
      status: i.status,
      createdAt: i.createdAt
    }));

  const transactions = deposits
    .concat(investments)
    .sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

  res.json({
    success: true,
    transactions
  });
});


// CHANGE PASSWORD
app.post("/api/change-password", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: "Please login first"
      });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new password are required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters"
      });
    }

    const db = readDB();
    const user = db.users.find(
      u => u.id === req.session.userId
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const valid = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!valid) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    writeDB(db);

    logActivity(user.id, "PASSWORD_CHANGED", "Password changed successfully");

    res.json({
      success: true,
      message: "Password changed successfully"
    });

  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});



// USER NOTIFICATIONS
app.get("/api/notifications", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const notifications = (db.activityLogs || [])
    .filter(log => log.userId === req.session.userId)
    .filter(log =>
      [
        "DEPOSIT_APPROVE",
        "DEPOSIT_REJECT",
        "INVESTMENT_ACTIVATED",
        "PASSWORD_CHANGED"
      ].includes(log.action)
    )
    .slice(-20)
    .reverse()
    .map(log => ({
      id: log.id,
      action: log.action,
      details: log.details,
      createdAt: log.createdAt
    }));

  res.json({
    success: true,
    notifications
  });
});



// FORGOT PASSWORD - DEVELOPMENT RESET TOKEN
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required"
    });
  }

  const db = readDB();
  const user = db.users.find(
    u => u.email.toLowerCase() === email.toLowerCase()
  );

  // Same response for existing/non-existing emails
  // to avoid revealing which accounts exist.
  if (!user) {
    return res.json({
      success: true,
      message: "If this email exists, a reset request has been created."
    });
  }

  const crypto = require("crypto");

  if (!db.passwordResets) {
    db.passwordResets = [];
  }

  const token = crypto.randomBytes(32).toString("hex");

  db.passwordResets.push({
    token: token,
    userId: user.id,
    expiresAt: Date.now() + (15 * 60 * 1000),
    used: false
  });

  writeDB(db);

  res.json({
    success: true,
    message: "Reset request created.",
    developmentToken: token
  });
});

// RESET PASSWORD
app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Token and new password are required"
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 8 characters"
    });
  }

  const db = readDB();

  const reset = (db.passwordResets || []).find(
    r =>
      r.token === token &&
      r.used === false &&
      r.expiresAt > Date.now()
  );

  if (!reset) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired reset token"
    });
  }

  const user = db.users.find(u => u.id === reset.userId);

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "User not found"
    });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  reset.used = true;

  writeDB(db);

  logActivity(
    user.id,
    "PASSWORD_CHANGED",
    "Password reset completed"
  );

  res.json({
    success: true,
    message: "Password reset successfully"
  });
});


// DEMO REFERRAL SYSTEM
function generateReferralCode() {
  return "REF-" + require("crypto").randomBytes(4).toString("hex").toUpperCase();
}

app.get("/api/referral", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();
  const user = db.users.find(
    u => u.id === req.session.userId
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  if (!user.referralCode) {
    let code;

    do {
      code = "REF-" + require("crypto")
        .randomBytes(4)
        .toString("hex")
        .toUpperCase();
    } while (
      (db.users || []).some(
        u => u.referralCode === code
      )
    );

    user.referralCode = code;
    writeDB(db);
  }

  const referrals = (db.users || [])
    .filter(
      u => u.referredBy === user.referralCode
    )
    .map(u => ({
      id: u.id,
      name: u.name,
      createdAt: u.createdAt
    }));

  res.json({
    success: true,
    referralCode: user.referralCode,
    referralCount: referrals.length,
    referrals: referrals
  });
});

// REGISTER WITH REFERRAL


// ADMIN REFERRAL MANAGEMENT
app.get("/api/admin/referrals", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      message: "Please login first"
    });
  }

  const db = readDB();

  const admin = (db.users || []).find(
    u => u.id === req.session.userId
  );

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  const users = db.users || [];

  const referrals = users
    .filter(u => u.referredBy)
    .map(u => {
      const referrer = users.find(
        r => r.referralCode === u.referredBy
      );

      return {
        id: u.id,
        userName: u.name,
        userEmail: u.email,
        referralCode: u.referredBy,
        referrerName: referrer ? referrer.name : "Unknown",
        referrerEmail: referrer ? referrer.email : "",
        createdAt: u.createdAt
      };
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    );

  res.json({
    success: true,
    totalReferrals: referrals.length,
    referrals
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Website running on port ${PORT}`);
  });
}

module.exports = app;
