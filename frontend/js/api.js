/**
 * api.js
 * Shared API client + small utility helpers used by every page.
 * Vanilla JS, no build step, no external dependencies.
 */

// Locally this defaults to http://localhost:8000 automatically. When
// deployed, it uses DEPLOYED_API_BASE_URL from config.js (loaded before
// this file) — that's the only file you need to edit for deployment.
const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:8000"
  : DEPLOYED_API_BASE_URL;

const TOKEN_KEY = "crm_access_token";
const ROLE_KEY = "crm_role";
const USERNAME_KEY = "crm_username";

const Auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  getRole() {
    return localStorage.getItem(ROLE_KEY);
  },
  getUsername() {
    return localStorage.getItem(USERNAME_KEY);
  },
  setSession(token, role, username) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(USERNAME_KEY, username);
  },
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  requireRole(role) {
    if (!this.isLoggedIn()) {
      window.location.href = "login.html";
      return false;
    }
    if (role && this.getRole() !== role) {
      window.location.href = this.getRole() === "ADMIN" ? "admin.html" : "dashboard.html";
      return false;
    }
    return true;
  },
};

/**
 * Thin fetch wrapper that attaches the JWT bearer token, parses JSON,
 * and redirects to the login page on a 401 (expired/invalid session).
 */
async function apiRequest(path, { method = "GET", body = null, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = Auth.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error("Could not reach the server. Please check your connection and try again.");
  }

  if (response.status === 401) {
    Auth.clearSession();
    window.location.href = "login.html";
    throw new Error("Session expired. Please log in again.");
  }

  if (response.status === 204) {
    return null;
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (e) {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(payload) || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function extractErrorMessage(payload) {
  if (!payload) return null;
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((e) => (e.msg ? e.msg : JSON.stringify(e)))
      .join(" ");
  }
  if (payload.message) return payload.message;
  return null;
}

/** Toast notifications (professional, non-blocking). */
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) {
    alert(message);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type === "success" ? "" : type}`.trim();
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity .25s ease";
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status) {
  return `badge badge-${String(status).toLowerCase()}`;
}
