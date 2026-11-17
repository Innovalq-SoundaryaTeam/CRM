/**
 * import-export.js — shared "Import" and "Export" page logic, loaded by
 * both dashboard.html (USER) and admin.html (ADMIN). The markup/IDs are
 * identical on both pages, so one script drives both.
 *
 * Import: drag-and-drop or click to pick an .xlsx/.xls file, upload it,
 * and render the server's summary (total/imported/duplicates/failed).
 * Export: pick a status and download the full matching dataset as .xlsx.
 */

let pendingImportFile = null;
let lastFailedRecords = [];

document.addEventListener("DOMContentLoaded", () => {
  const dropzone = document.getElementById("import-dropzone");
  if (!dropzone) return; // this page doesn't have the Import/Export sections

  wireImportUi();
  wireExportUi();
});

// ---------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------

function wireImportUi() {
  const dropzone = document.getElementById("import-dropzone");
  const fileInput = document.getElementById("import-file-input");

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectImportFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      selectImportFile(fileInput.files[0]);
    }
  });

  document.getElementById("import-cancel-btn").addEventListener("click", resetImportUi);
  document.getElementById("import-upload-btn").addEventListener("click", handleImportUpload);
  document.getElementById("import-download-failed-btn").addEventListener("click", downloadFailedRecords);
}

function selectImportFile(file) {
  const allowed = /\.(xlsx|xlsm|xls)$/i;
  if (!allowed.test(file.name)) {
    showToast("Please choose an .xlsx or .xls Excel file.", "error");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showToast("File is too large (max 15 MB).", "error");
    return;
  }
  pendingImportFile = file;
  document.getElementById("import-file-name").textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  document.getElementById("import-selected-file").classList.remove("hidden");
  document.getElementById("import-summary").classList.add("hidden");
}

function resetImportUi() {
  pendingImportFile = null;
  document.getElementById("import-file-input").value = "";
  document.getElementById("import-selected-file").classList.add("hidden");
  document.getElementById("import-progress").classList.add("hidden");
}

async function handleImportUpload() {
  if (!pendingImportFile) return;

  const uploadBtn = document.getElementById("import-upload-btn");
  uploadBtn.disabled = true;
  document.getElementById("import-progress").classList.remove("hidden");
  document.getElementById("import-selected-file").classList.add("hidden");

  try {
    const formData = new FormData();
    formData.append("file", pendingImportFile);

    const token = Auth.getToken();
    const response = await fetch(`${API_BASE_URL}/api/candidates/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (response.status === 401) {
      Auth.clearSession();
      window.location.href = "login.html";
      return;
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (e) {
      payload = null;
    }

    if (!response.ok) {
      const message = extractErrorMessage(payload) || `Import failed (${response.status})`;
      throw new Error(message);
    }

    renderImportSummary(payload);
    showToast(`Import complete: ${payload.imported} candidate(s) added.`);

    // Refresh whichever stats/tables are on this page.
    if (typeof loadMyStats === "function") loadMyStats();
    if (typeof loadCandidates === "function") loadCandidates();
    if (typeof loadDashboardStats === "function") loadDashboardStats();
    if (typeof loadAdminCandidates === "function") loadAdminCandidates();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    uploadBtn.disabled = false;
    document.getElementById("import-progress").classList.add("hidden");
    pendingImportFile = null;
    document.getElementById("import-file-input").value = "";
  }
}

function renderImportSummary(summary) {
  document.getElementById("import-summary").classList.remove("hidden");
  ["total", "imported", "duplicate_in_db", "duplicate_in_file", "failed"].forEach((key) => {
    const el = document.querySelector(`#import-summary [data-sum="${key}"]`);
    if (el) el.textContent = summary[key] ?? 0;
  });

  lastFailedRecords = summary.failed_records || [];
  const downloadBtn = document.getElementById("import-download-failed-btn");
  downloadBtn.classList.toggle("hidden", lastFailedRecords.length === 0);
}

function downloadFailedRecords() {
  if (lastFailedRecords.length === 0) return;
  const headers = ["Row", "Name", "Phone", "Email", "Reason"];
  const csvEscape = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  lastFailedRecords.forEach((r) => {
    lines.push([r.row, r.name, r.phone, r.email, r.reason].map(csvEscape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerBlobDownload(blob, "Candidate_CRM_Import_Failed_Records.csv");
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

function wireExportUi() {
  document.getElementById("export-download-btn").addEventListener("click", handleExportDownload);
}

async function handleExportDownload() {
  const btn = document.getElementById("export-download-btn");
  const status = document.getElementById("export-status-select").value;
  const params = new URLSearchParams();
  if (status) params.set("status_filter", status);

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Preparing file…";

  try {
    const token = Auth.getToken();
    const response = await fetch(`${API_BASE_URL}/api/candidates/export?${params.toString()}`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (response.status === 401) {
      Auth.clearSession();
      window.location.href = "login.html";
      return;
    }

    if (!response.ok) {
      let message = `Export failed (${response.status})`;
      try {
        const payload = await response.json();
        message = extractErrorMessage(payload) || message;
      } catch (e) {
        /* response wasn't JSON (e.g. the file itself) - keep default message */
      }
      throw new Error(message);
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `Candidate_CRM_${status ? status : "All"}.xlsx`;

    const blob = await response.blob();
    triggerBlobDownload(blob, filename);
    showToast("Export downloaded.");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
