/**
 * dashboard.js — USER dashboard: sidebar navigation, candidate form
 * (add/edit/clear), candidate table with live search + status filter,
 * and view/delete modals. All data comes from the FastAPI backend.
 */

let allCandidates = [];
let editingCandidateId = null;
let pendingDeleteId = null;
let searchDebounceTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.requireRole("USER")) return;

  document.getElementById("current-username").textContent = Auth.getUsername();
  document.getElementById("avatar-initial").textContent = Auth.getUsername().charAt(0).toUpperCase();

  wireNav();
  wireForm();
  wireTableToolbar();
  wireModals();

  document.getElementById("logout-btn").addEventListener("click", logout);

  await Promise.all([loadMyStats(), loadCandidates()]);
});

// ---------------------------------------------------------------------
// Sidebar navigation
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
        "section-dashboard": "Dashboard",
        "section-candidates": "Candidates",
        "section-add": "Add Candidate",
      };
      document.getElementById("page-title").textContent = titles[item.dataset.section] || "Dashboard";
    });
  });
}

async function logout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch (e) {
    // Ignore network errors on logout — clear the session locally regardless.
  } finally {
    Auth.clearSession();
    window.location.href = "login.html";
  }
}

// ---------------------------------------------------------------------
// Stats (mini summary on the Dashboard tab)
// ---------------------------------------------------------------------

async function loadMyStats() {
  try {
    const candidates = await apiRequest("/api/candidates");
    const stats = { total: candidates.length, hot: 0, warm: 0, cold: 0, completed: 0, drop: 0 };
    candidates.forEach((c) => {
      const key = c.status.toLowerCase();
      if (stats[key] !== undefined) stats[key] += 1;
    });
    Object.entries(stats).forEach(([key, value]) => {
      const el = document.querySelector(`#my-stats-grid [data-stat="${key}"]`);
      if (el) el.textContent = value;
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---------------------------------------------------------------------
// Candidate form (create / update / clear)
// ---------------------------------------------------------------------

function wireForm() {
  const form = document.getElementById("candidate-form");
  form.addEventListener("submit", handleSaveOrUpdate);
  document.getElementById("update-candidate-btn").addEventListener("click", handleSaveOrUpdate);
  document.getElementById("clear-form-btn").addEventListener("click", resetForm);
}

function validateForm() {
  let valid = true;

  const name = document.getElementById("candidate_name").value.trim();
  const nameGroup = document.getElementById("group-candidate_name");
  if (name.length < 2) {
    nameGroup.classList.add("has-error");
    valid = false;
  } else {
    nameGroup.classList.remove("has-error");
  }

  const phone = document.getElementById("contact_number").value.trim();
  const phoneGroup = document.getElementById("group-contact_number");
  const phoneRegex = /^[0-9+\-\s()]{7,20}$/;
  if (!phoneRegex.test(phone)) {
    phoneGroup.classList.add("has-error");
    valid = false;
  } else {
    phoneGroup.classList.remove("has-error");
  }

  return valid;
}

async function handleSaveOrUpdate(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const payload = {
    candidate_name: document.getElementById("candidate_name").value.trim(),
    contact_number: document.getElementById("contact_number").value.trim(),
    status: document.getElementById("status").value,
    comments: document.getElementById("comments").value.trim() || null,
  };

  const saveBtn = document.getElementById("save-candidate-btn");
  const updateBtn = document.getElementById("update-candidate-btn");
  const activeBtn = editingCandidateId ? updateBtn : saveBtn;
  activeBtn.disabled = true;

  try {
    if (editingCandidateId) {
      await apiRequest(`/api/candidates/${editingCandidateId}`, { method: "PUT", body: payload });
      showToast("Candidate updated successfully.");
    } else {
      await apiRequest("/api/candidates", { method: "POST", body: payload });
      showToast("Candidate added successfully.");
    }
    resetForm();
    await Promise.all([loadMyStats(), loadCandidates()]);
    // Jump back to the candidate list so the user sees the result.
    document.querySelector('.nav-item[data-section="section-candidates"]').click();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    activeBtn.disabled = false;
  }
}

function resetForm() {
  editingCandidateId = null;
  document.getElementById("candidate-form").reset();
  document.getElementById("candidate-id").value = "";
  document.getElementById("status").value = "WARM";
  document.getElementById("form-title").textContent = "Add Candidate";
  document.getElementById("save-candidate-btn").classList.remove("hidden");
  document.getElementById("update-candidate-btn").classList.add("hidden");
  ["group-candidate_name", "group-contact_number"].forEach((id) =>
    document.getElementById(id).classList.remove("has-error")
  );
}

function loadCandidateIntoForm(candidate) {
  editingCandidateId = candidate.id;
  document.getElementById("candidate-id").value = candidate.id;
  document.getElementById("candidate_name").value = candidate.candidate_name;
  document.getElementById("contact_number").value = candidate.contact_number;
  document.getElementById("status").value = candidate.status;
  document.getElementById("comments").value = candidate.comments || "";
  document.getElementById("form-title").textContent = "Edit Candidate";
  document.getElementById("save-candidate-btn").classList.add("hidden");
  document.getElementById("update-candidate-btn").classList.remove("hidden");

  document.querySelectorAll(".sidebar-nav .nav-item").forEach((i) => i.classList.remove("active"));
  document.querySelector('.nav-item[data-section="section-add"]').classList.add("active");
  document.querySelectorAll(".content > section").forEach((s) => s.classList.add("hidden"));
  document.getElementById("section-add").classList.remove("hidden");
  document.getElementById("page-title").textContent = "Edit Candidate";
}

// ---------------------------------------------------------------------
// Candidate table: load, search, filter, render
// ---------------------------------------------------------------------

function wireTableToolbar() {
  document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(loadCandidates, 300);
  });
  document.getElementById("status-filter").addEventListener("change", loadCandidates);
}

async function loadCandidates() {
  const search = document.getElementById("search-input").value.trim();
  const status = document.getElementById("status-filter").value;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status_filter", status);

  try {
    allCandidates = await apiRequest(`/api/candidates?${params.toString()}`);
    renderCandidateTable();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderCandidateTable() {
  const tbody = document.getElementById("candidates-tbody");
  const emptyState = document.getElementById("empty-state");
  document.getElementById("candidate-count").textContent = allCandidates.length;

  if (allCandidates.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  tbody.innerHTML = allCandidates
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.candidate_name)}</td>
      <td>${escapeHtml(c.contact_number)}</td>
      <td><span class="${statusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></td>
      <td class="cell-comments" title="${escapeHtml(c.comments || "")}">${escapeHtml(c.comments || "—")}</td>
      <td>${formatDateTime(c.created_at)}</td>
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
      const candidate = allCandidates.find((c) => c.id === id);
      if (!candidate) return;
      if (btn.dataset.action === "view") openViewModal(candidate);
      if (btn.dataset.action === "edit") loadCandidateIntoForm(candidate);
      if (btn.dataset.action === "delete") openDeleteModal(candidate);
    });
  });
}

// ---------------------------------------------------------------------
// Modals
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
  document.getElementById("confirm-delete-btn").addEventListener("click", handleConfirmDelete);
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function openViewModal(candidate) {
  document.getElementById("view-modal-body").innerHTML = `
    <div class="detail-row"><span class="detail-label">Candidate Name</span><span class="detail-value">${escapeHtml(candidate.candidate_name)}</span></div>
    <div class="detail-row"><span class="detail-label">Contact Number</span><span class="detail-value">${escapeHtml(candidate.contact_number)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="${statusBadgeClass(candidate.status)}">${escapeHtml(candidate.status)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Comments</span><span class="detail-value">${escapeHtml(candidate.comments || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${formatDateTime(candidate.created_at)}</span></div>
    <div class="detail-row"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDateTime(candidate.updated_at)}</span></div>
  `;
  openModal("view-modal");
}

function openDeleteModal(candidate) {
  pendingDeleteId = candidate.id;
  document.getElementById("delete-candidate-name").textContent = candidate.candidate_name;
  openModal("delete-modal");
}

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById("confirm-delete-btn");
  btn.disabled = true;
  try {
    await apiRequest(`/api/candidates/${pendingDeleteId}`, { method: "DELETE" });
    showToast("Candidate deleted.");
    closeModal("delete-modal");
    pendingDeleteId = null;
    await Promise.all([loadMyStats(), loadCandidates()]);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}
