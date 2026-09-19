/**
 * admin.js — ADMIN dashboard: summary cards + status distribution chart,
 * cross-user candidate management, and user management (create/edit/
 * activate/deactivate/reset password). All numbers come live from the
 * FastAPI backend — nothing here is hard-coded.
 */

let adminCandidates = [];
let allUsersCache = [];
let adminSearchDebounce = null;
let adminPendingDeleteId = null;

const STATUS_COLORS = {
  HOT: "#dc2626",
  WARM: "#d97706",
  COLD: "#2563eb",
  COMPLETED: "#16a34a",
  DROP: "#6b7280",
};

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.requireRole("ADMIN")) return;

  document.getElementById("current-username").textContent = Auth.getUsername();
  document.getElementById("avatar-initial").textContent = Auth.getUsername().charAt(0).toUpperCase();

  wireNav();
  wireCandidateToolbar();
  wireModals();
  wireUserManagement();

  document.getElementById("logout-btn").addEventListener("click", logout);

  await Promise.all([loadDashboardStats(), loadUsersForFilterAndTable(), loadAdminCandidates()]);
});

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

function wireNav() {
  const items = document.querySelectorAll(".sidebar-nav .nav-item[data-section]");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      items.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".content > section").forEach((s) => s.classList.add("hidden"));
      document.getElementById(item.dataset.section).classList.remove("hidden");

      const titles = {
        "section-overview": "Admin Dashboard",
        "section-candidates": "All Candidates",
        "section-users": "User Management",
      };
      document.getElementById("page-title").textContent = titles[item.dataset.section] || "Admin Dashboard";
    });
  });
}

async function logout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch (e) {
    /* ignore */
  } finally {
    Auth.clearSession();
    window.location.href = "login.html";
  }
}

// ---------------------------------------------------------------------
// Dashboard stats + chart
// ---------------------------------------------------------------------

async function loadDashboardStats() {
  try {
    const stats = await apiRequest("/api/admin/dashboard");
    Object.entries(stats).forEach(([key, value]) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    });
    renderChart(stats);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderChart(stats) {
  const rows = [
    ["HOT", stats.hot],
    ["WARM", stats.warm],
    ["COLD", stats.cold],
    ["COMPLETED", stats.completed],
    ["DROP", stats.drop],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const container = document.getElementById("chart-bars");
  container.innerHTML = rows
    .map(([label, value]) => {
      const heightPct = Math.round((value / max) * 100);
      return `
      <div class="chart-bar-col">
        <div class="chart-bar" style="height:${Math.max(heightPct, 3)}%; background:${STATUS_COLORS[label]};">
          <span class="chart-bar-value">${value}</span>
        </div>
        <div class="chart-bar-label">${label}</div>
      </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------
// Candidate management (all users)
// ---------------------------------------------------------------------

function wireCandidateToolbar() {
  document.getElementById("admin-search-input").addEventListener("input", () => {
    clearTimeout(adminSearchDebounce);
    adminSearchDebounce = setTimeout(loadAdminCandidates, 300);
  });
  document.getElementById("admin-status-filter").addEventListener("change", loadAdminCandidates);
  document.getElementById("admin-user-filter").addEventListener("change", loadAdminCandidates);
}

async function loadAdminCandidates() {
  const search = document.getElementById("admin-search-input").value.trim();
  const status = document.getElementById("admin-status-filter").value;
  const userId = document.getElementById("admin-user-filter").value;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status_filter", status);
  if (userId) params.set("user_id", userId);

  try {
    adminCandidates = await apiRequest(`/api/admin/candidates?${params.toString()}`);
    renderAdminCandidateTable();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAdminCandidateTable() {
  const tbody = document.getElementById("admin-candidates-tbody");
  const emptyState = document.getElementById("admin-candidates-empty");
  document.getElementById("admin-candidate-count").textContent = adminCandidates.length;

  if (adminCandidates.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  tbody.innerHTML = adminCandidates
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.candidate_name)}</td>
      <td>${escapeHtml(c.contact_number)}</td>
      <td><span class="${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></td>
      <td class="cell-comments" title="${escapeHtml(c.comments || "")}">${escapeHtml(c.comments || "—")}</td>
      <td>${escapeHtml(c.owner_username)}</td>
      <td>${formatDateTime(c.created_at)}</td>
      <td>${formatDateTime(c.updated_at)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="View" data-action="view" data-id="${c.id}">&#128065;</button>
          <button class="icon-btn" title="Edit" data-action="edit" data-id="${c.id}">&#9998;</button>
          <button class="icon-btn danger" title="Delete" data-action="delete" data-id="${c.id}">&#128465;</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const candidate = adminCandidates.find((c) => c.id === id);
      if (!candidate) return;
      if (btn.dataset.action === "view") openAdminViewModal(candidate);
      if (btn.dataset.action === "edit") openAdminEditModal(candidate);
      if (btn.dataset.action === "delete") openAdminDeleteModal(candidate);
    });
  });
}

function openAdminViewModal(candidate) {
  document.getElementById("admin-view-modal-body").innerHTML = `
    <div class="detail-row"><span class="detail-label">Candidate Name</span><span class="detail-value">${escapeHtml(candidate.candidate_name)}</span></div>
    <div class="detail-row"><span class="detail-label">Contact Number</span><span class="detail-value">${escapeHtml(candidate.contact_number)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="${statusBadgeClass(candidate.status)}">${escapeHtml(candidate.status)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Comments</span><span class="detail-value">${escapeHtml(candidate.comments || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Owned By</span><span class="detail-value">${escapeHtml(candidate.owner_username)}</span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${formatDateTime(candidate.created_at)}</span></div>
    <div class="detail-row"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDateTime(candidate.updated_at)}</span></div>
  `;
  openModal("admin-view-modal");
}

function openAdminEditModal(candidate) {
  document.getElementById("admin-edit-id").value = candidate.id;
  document.getElementById("admin-edit-name").value = candidate.candidate_name;
  document.getElementById("admin-edit-contact").value = candidate.contact_number;
  document.getElementById("admin-edit-status").value = candidate.status;
  document.getElementById("admin-edit-comments").value = candidate.comments || "";
  openModal("admin-edit-modal");
}

function openAdminDeleteModal(candidate) {
  adminPendingDeleteId = candidate.id;
  document.getElementById("admin-delete-candidate-name").textContent = candidate.candidate_name;
  openModal("admin-delete-modal");
}

async function handleAdminSaveCandidate() {
  const id = document.getElementById("admin-edit-id").value;
  const payload = {
    candidate_name: document.getElementById("admin-edit-name").value.trim(),
    contact_number: document.getElementById("admin-edit-contact").value.trim(),
    status: document.getElementById("admin-edit-status").value,
    comments: document.getElementById("admin-edit-comments").value.trim() || null,
  };
  const btn = document.getElementById("admin-save-candidate-btn");
  btn.disabled = true;
  try {
    await apiRequest(`/api/admin/candidates/${id}`, { method: "PUT", body: payload });
    showToast("Candidate updated.");
    closeModal("admin-edit-modal");
    await Promise.all([loadAdminCandidates(), loadDashboardStats()]);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function handleAdminConfirmDelete() {
  if (!adminPendingDeleteId) return;
  const btn = document.getElementById("admin-confirm-delete-btn");
  btn.disabled = true;
  try {
    await apiRequest(`/api/admin/candidates/${adminPendingDeleteId}`, { method: "DELETE" });
    showToast("Candidate deleted.");
    closeModal("admin-delete-modal");
    adminPendingDeleteId = null;
    await Promise.all([loadAdminCandidates(), loadDashboardStats(), loadUsersForFilterAndTable()]);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------

function wireUserManagement() {
  document.getElementById("new-user-btn").addEventListener("click", () => openUserModal(null));
  document.getElementById("save-user-btn").addEventListener("click", handleSaveUser);
  document.getElementById("confirm-reset-password-btn").addEventListener("click", handleResetPassword);
}

async function loadUsersForFilterAndTable() {
  try {
    allUsersCache = await apiRequest("/api/admin/users");
    renderUserTable();
    populateUserFilterDropdown();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function populateUserFilterDropdown() {
  const select = document.getElementById("admin-user-filter");
  const currentValue = select.value;
  select.innerHTML =
    '<option value="">All Users</option>' +
    allUsersCache.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join("");
  select.value = currentValue;
}

function renderUserTable() {
  const tbody = document.getElementById("users-tbody");
  document.getElementById("user-count").textContent = allUsersCache.length;

  tbody.innerHTML = allUsersCache
    .map((u) => {
      const roleBadge = u.role === "ADMIN" ? "badge-role-admin" : "badge-role-user";
      const statusBadge = u.is_active ? "badge-active" : "badge-inactive";
      const statusLabel = u.is_active ? "Active" : "Inactive";
      return `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="badge ${roleBadge}">${escapeHtml(u.role)}</span></td>
        <td>${u.candidate_count}</td>
        <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td>${formatDateTime(u.created_at)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Edit" data-action="edit-user" data-id="${u.id}">&#9998;</button>
            <button class="icon-btn" title="Reset Password" data-action="reset-password" data-id="${u.id}">&#128273;</button>
            <button class="icon-btn ${u.is_active ? "danger" : ""}" title="${u.is_active ? "Deactivate" : "Activate"}" data-action="toggle-active" data-id="${u.id}">${u.is_active ? "&#128683;" : "&#9989;"}</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const user = allUsersCache.find((u) => u.id === id);
      if (!user) return;
      if (btn.dataset.action === "edit-user") openUserModal(user);
      if (btn.dataset.action === "reset-password") openResetPasswordModal(user);
      if (btn.dataset.action === "toggle-active") handleToggleActive(user);
    });
  });
}

function openUserModal(user) {
  const isEdit = !!user;
  document.getElementById("user-modal-title").textContent = isEdit ? "Edit User" : "New User";
  document.getElementById("user-edit-id").value = isEdit ? user.id : "";
  document.getElementById("new-username").value = isEdit ? user.username : "";
  document.getElementById("new-username").disabled = isEdit;
  document.getElementById("new-password").value = "";
  document.getElementById("group-new-password").classList.toggle("hidden", isEdit);
  document.getElementById("new-role").value = isEdit ? user.role : "USER";
  openModal("user-modal");
}

async function handleSaveUser() {
  const id = document.getElementById("user-edit-id").value;
  const isEdit = !!id;
  const btn = document.getElementById("save-user-btn");

  if (!isEdit) {
    const username = document.getElementById("new-username").value.trim();
    const password = document.getElementById("new-password").value;
    let valid = true;
    if (username.length < 3 || /\s/.test(username)) {
      document.getElementById("group-new-username").classList.add("has-error");
      valid = false;
    } else {
      document.getElementById("group-new-username").classList.remove("has-error");
    }
    if (password.length < 6) {
      document.getElementById("group-new-password").classList.add("has-error");
      valid = false;
    } else {
      document.getElementById("group-new-password").classList.remove("has-error");
    }
    if (!valid) return;

    btn.disabled = true;
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: { username, password, role: document.getElementById("new-role").value },
      });
      showToast("User created successfully.");
      closeModal("user-modal");
      await loadUsersForFilterAndTable();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  } else {
    btn.disabled = true;
    try {
      await apiRequest(`/api/admin/users/${id}`, {
        method: "PUT",
        body: { role: document.getElementById("new-role").value },
      });
      showToast("User updated successfully.");
      closeModal("user-modal");
      await loadUsersForFilterAndTable();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }
}

async function handleToggleActive(user) {
  try {
    await apiRequest(`/api/admin/users/${user.id}`, {
      method: "PUT",
      body: { is_active: !user.is_active },
    });
    showToast(`User ${user.is_active ? "deactivated" : "activated"} successfully.`);
    await loadUsersForFilterAndTable();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openResetPasswordModal(user) {
  document.getElementById("reset-user-id").value = user.id;
  document.getElementById("reset-username").textContent = user.username;
  document.getElementById("reset-password-input").value = "";
  openModal("reset-password-modal");
}

async function handleResetPassword() {
  const id = document.getElementById("reset-user-id").value;
  const newPassword = document.getElementById("reset-password-input").value;
  if (newPassword.length < 6) {
    showToast("Password must be at least 6 characters.", "error");
    return;
  }
  const btn = document.getElementById("confirm-reset-password-btn");
  btn.disabled = true;
  try {
    await apiRequest(`/api/admin/users/${id}/reset-password`, {
      method: "PUT",
      body: { new_password: newPassword },
    });
    showToast("Password reset successfully.");
    closeModal("reset-password-modal");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Modal plumbing (shared pattern with dashboard.js)
// ---------------------------------------------------------------------

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
  document.getElementById("admin-save-candidate-btn").addEventListener("click", handleAdminSaveCandidate);
  document.getElementById("admin-confirm-delete-btn").addEventListener("click", handleAdminConfirmDelete);
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
