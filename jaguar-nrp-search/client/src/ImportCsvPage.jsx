import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "./api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4100";

export default function ImportCsvPage({ onLoggedOut }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    setStatus(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/api/admin/import-csv`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw data;
      setStatus({
        type: "success",
        msg: `Imported/updated ${data.imported.toLocaleString()} products.${
          data.skipped ? ` Skipped ${data.skipped} unparseable row(s).` : ""
        }`,
      });
    } catch (err) {
      if (err?.error === "Not authenticated" || err?.error?.includes?.("expired")) {
        onLoggedOut();
        return;
      }
      setStatus({ type: "error", msg: err?.error || "Import failed." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-wrap">
      <header className="search-header">
        <h1>Import CSV</h1>
        <Link to="/" className="logout-btn">Back to search</Link>
      </header>

      <form className="login-card create-user-card" onSubmit={handleSubmit}>
        <p className="subtitle">
          Upload the latest Jaguar NRP price list. Existing items are matched
          and updated by Item Code, so it's safe to re-import at any time.
        </p>
        <label htmlFor="csv-file">CSV file</label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          required
        />
        <button type="submit" disabled={loading || !file}>
          {loading ? "Importing..." : "Import"}
        </button>
        {status && <div className={status.type}>{status.msg}</div>}
      </form>
    </div>
  );
}
