// src/index.js
const express = require("express");
const config = require("./config");
const { log, error } = require("./utils/logger");
const uppromoteWebhooks = require("./routes/uppromoteWebhooks");
const sealWebhooks = require("./routes/sealWebhooks");

const app = express();

// -------------------------
// Request logging middleware
// -------------------------
app.use((req, res, next) => {
  const startTime = Date.now();
  log(`[Request] ${req.method} ${req.path}`, {
    query: req.query,
    headers: {
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"]
    },
    ip: req.ip || req.connection?.remoteAddress
  });

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    log(
      `[Response] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });

  next();
});

// ------------------------------------------------------
// Body parsers
// NOTE: order matters!
// - raw() for UpPromote (for HMAC verification)
// - json() for everything else
// ------------------------------------------------------

// UpPromote webhooks need raw body for signature verification
app.use("/webhooks/uppromote", express.raw({ type: "application/json" }));

// All other routes (including Seal) use JSON parser
app.use(express.json());

// -------------------------
// Health check
// -------------------------
app.get("/", (req, res) => {
  log("[Health] Health check endpoint accessed");
  res.json({ ok: true, message: "Affiliate–Seal integration running" });
});

// -------------------------
// Webhook routes
// -------------------------
app.use("/webhooks/uppromote", uppromoteWebhooks);
app.use("/webhooks/seal", sealWebhooks);

// -------------------------
// 404 handler
// -------------------------
app.use((req, res) => {
  log(`[404] Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Not found" });
});

// -------------------------
// Error handling middleware
// (must be after all routes)
// -------------------------
app.use((err, req, res, next) => {
  error("[Express] Unhandled error:", {
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    body: req.body
  });
  res.status(500).json({ error: "Internal server error" });
});

// -------------------------
// Server startup + shutdown
// -------------------------
let server;

server = app.listen(config.port, () => {
  log(`[Startup] Server listening on port ${config.port}`);
  log(`[Startup] Environment: ${process.env.NODE_ENV || "development"}`);
  log(`[Startup] Config check:`, {
    uppromoteApiKey: config.uppromoteApiKey ? "✓ Set" : "✗ Missing",
    sealApiToken: config.sealApiToken ? "✓ Set" : "✗ Missing",
    webhookSharedSecret: config.webhookSharedSecret ? "✓ Set" : "✗ Missing",
    // subscriptionDiscountCode: config.subscriptionDiscountCode || "Not configured",
    uppromoteWebhookSecret: config.uppromoteWebhookSecret
      ? "✓ Webhook secret set"
      : "✗ Webhook secret missing"
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    error(`Port ${config.port} is already in use`);
  } else {
    error("Server error:", err);
  }
  process.exit(1);
});

// -------------------------
// Process-level error handlers
// -------------------------
process.on("unhandledRejection", (reason, promise) => {
  error("[Process] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  error("[Process] Uncaught Exception:", err);
  process.exit(1);
});

// -------------------------
// Graceful shutdown
// -------------------------
function shutdown(signal) {
  log(`${signal} received, shutting down gracefully`);
  if (server) {
    server.close(() => {
      log("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
