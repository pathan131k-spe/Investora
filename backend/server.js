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
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

const DB_FILE = process.env.VERCEL ? "/tmp/investora-database.json" : path.join(__dirname, "database.json");

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const db = readDB();

    if (!db.users) db.users = [];

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    const existing = db.users.find(
      u => String(u.email).toLowerCase() === cleanEmail
    );

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Email already registered"
      });
    }

    // Optional referral code validation
    let referredBy = null;

    if (referralCode && referralCode.trim()) {
      const cleanReferralCode = referralCode.trim().toUpperCase();

      const referrer = db.users.find(
        u => u.referralCode === cleanReferralCode
      );

      if (!referrer) {
        return res.status(400).json({
          success: false,
          message: "Invalid referral code"
        });
      }

      referredBy = referrer.referralCode;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Every new user gets a unique referral code
    let newReferralCode;

    do {
      newReferralCode =
        "REF-" +
        require("crypto")
          .randomBytes(4)
          .toString("hex")
          .toUpperCase();
    } while (
      db.users.some(u => u.referralCode === newReferralCode)
    );

    const user = {
      id: Date.now().toString(),
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      role: "user",
      referralCode: newReferralCode,
      referredBy: referredBy,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    writeDB(db);

    req.session.userId = user.id;

    logActivity(
      user.id,
      "REGISTER",
      referredBy
        ? "New account registered with referral"
        : "New account registered"
    );

    res.json({
      success: true,
      message: "Account created successfully"
    });

  } catch (error) {
    console.error(error);

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

    const db = readDB();

    const user = db.users.find(
      user => user.email === email.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordOK = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordOK) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    req.session.userId = user.id;

    logActivity(
      user.id,
      "LOGIN",
      "User logged in"
    );

    res.json({
      success: true,
      message: "Login successful"
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ loggedIn: false });
  }

  const db = readDB();

  const user = db.users.find(
    user => user.id === req.session.userId
  );

  if (!user) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
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
app.post("/api/deposit", (req, res) => {
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
  writeDB(db);

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
app.get("/api/deposits", (req, res) => {
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
