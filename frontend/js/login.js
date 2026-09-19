/**
 * login.js — handles the login form: client-side validation, API call,
 * session storage, and role-based redirect.
 */
document.addEventListener("DOMContentLoaded", () => {
  // Already logged in? skip straight to the right dashboard.
  if (Auth.isLoggedIn()) {
    window.location.href = Auth.getRole() === "ADMIN" ? "admin.html" : "dashboard.html";
    return;
  }

  const form = document.getElementById("login-form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const errorBox = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");

  function setFieldError(groupId, hasError) {
    document.getElementById(groupId).classList.toggle("has-error", hasError);
  }

  function showLoginError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("visible");
  }

  function hideLoginError() {
    errorBox.classList.remove("visible");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideLoginError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    let valid = true;
    if (!username) {
      setFieldError("group-username", true);
      valid = false;
    } else {
      setFieldError("group-username", false);
    }
    if (!password) {
      setFieldError("group-password", true);
      valid = false;
    } else {
      setFieldError("group-password", false);
    }
    if (!valid) return;

    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";

    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        auth: false,
        body: { username, password },
      });
      Auth.setSession(data.access_token, data.role, data.username);
      window.location.href = data.role === "ADMIN" ? "admin.html" : "dashboard.html";
    } catch (err) {
      showLoginError(err.message || "Invalid username or password.");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Login";
    }
  });
});
