import { Routes, Route, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { apiRequest } from "../api";
import "../App.css";
import React from "react";

export default function AdminApp() {
  return (
    <div className="ck-root">
      <main className="ck-main">
        <Routes>
          <Route path="/" element={<AdminLogin />} />
          <Route path="/dashboard" element={<AdminDashboard />} />
        </Routes>
      </main>
    </div>
  );
}

function AdminLogin() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      const data = await apiRequest("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem("ck_admin_token", data.token);
      navigate("/admin/dashboard");
    } catch (err) {
      setStatus({ type: "error", msg: err?.error || "Login failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="ck-contact-form" onSubmit={handleSubmit} style={{ maxWidth: 340 }} role="form" aria-labelledby="adminLoginTitle">
      <h2 id="adminLoginTitle" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>Admin Login</h2>
      <div className="ck-form-row">
        <label htmlFor="admin-username" className="visually-hidden">Username</label>
        <input
          id="admin-username"
          name="username"
          type="text"
          placeholder="Username"
          value={form.username}
          onChange={handleChange}
          required
          aria-required="true"
        />
      </div>
      <div className="ck-form-row">
        <label htmlFor="admin-password" className="visually-hidden">Password</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
          aria-required="true"
        />
      </div>
      <button type="submit" disabled={loading} aria-busy={loading} aria-label="Login">
        {loading ? "Logging in..." : "Login"}
      </button>
      {status && (
        <div className={`ck-form-status ${status.type}`} aria-live="polite">{status.msg}</div>
      )}
    </form>
  );
}

function AdminDashboard() {
  const [inquiries, setInquiries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editModal, setEditModal] = useState({ open: false, inquiry: null });
  const [editForm, setEditForm] = useState({ name: "", email: "", location: "", message: "" });
  const [editStatus, setEditStatus] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const navigate = useNavigate();
  const token = localStorage.getItem("ck_admin_token");

  const fetchInquiries = async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(`/api/inquiries?page=${params.page || page}&pageSize=${params.pageSize || pageSize}&q=${encodeURIComponent(params.q ?? q)}`, { token });
      setInquiries(res.inquiries);
      setTotal(res.total);
      setPage(res.page);
      setPageSize(res.pageSize);
    } catch (err) {
      setError(err?.error || "Failed to fetch inquiries.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate("/admin");
      return;
    }
    fetchInquiries({ page: 1 });
    // eslint-disable-next-line
  }, [token, navigate]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchInquiries({ page: 1, q });
  };

  const handlePageChange = (newPage) => {
    fetchInquiries({ page: newPage });
  };

  const handlePageSizeChange = (e) => {
    fetchInquiries({ page: 1, pageSize: Number(e.target.value) });
  };

  const handleExport = () => {
    fetch(`${import.meta.env.VITE_API_URL || "http://localhost:4001"}/api/admin/export`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "inquiries.csv";
        a.click();
        window.URL.revokeObjectURL(url);
      });
  };

  const handleLogout = () => {
    localStorage.removeItem("ck_admin_token");
    navigate("/admin");
  };

  const openEditModal = (inquiry) => {
    setEditForm({
      name: inquiry.name,
      email: inquiry.email,
      location: inquiry.location,
      message: inquiry.message,
    });
    setEditStatus(null);
    setEditModal({ open: true, inquiry });
  };

  const closeEditModal = () => {
    setEditModal({ open: false, inquiry: null });
    setEditStatus(null);
    setEditLoading(false);
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditStatus(null);
    setEditLoading(true);
    try {
      const updated = await apiRequest(`/api/inquiries/${editModal.inquiry.id}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
        token,
      });
      setInquiries((prev) =>
        prev.map((inq) => (inq.id === updated.id ? updated : inq))
      );
      setEditStatus({ type: "success", msg: "Inquiry updated successfully." });
      setTimeout(closeEditModal, 1000);
    } catch (err) {
      setEditStatus({ type: "error", msg: err?.error || "Update failed." });
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this inquiry? This action cannot be undone.")) return;
    setDeleteStatus(null);
    setDeleteLoading(true);
    try {
      await apiRequest(`/api/inquiries/${id}`, {
        method: "DELETE",
        token,
      });
      setInquiries((prev) => prev.filter((inq) => inq.id !== id));
      setDeleteStatus({ type: "success", msg: "Inquiry deleted successfully." });
    } catch (err) {
      setDeleteStatus({ type: "error", msg: err?.error || "Delete failed." });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2>Admin Dashboard</h2>
        <button onClick={handleLogout} style={{ background: "#eee", color: "#222", borderRadius: 6, border: "none", padding: "8px 16px", cursor: "pointer" }}>Logout</button>
      </div>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search inquiries..."
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ padding: 6, borderRadius: 4, border: "1px solid #ccc", minWidth: 180 }}
        />
        <button type="submit" style={{ background: "#222", color: "#ffd700", border: "none", borderRadius: 4, padding: "6px 16px", cursor: "pointer" }}>Search</button>
        <select value={pageSize} onChange={handlePageSizeChange} style={{ marginLeft: 12, padding: 6, borderRadius: 4 }}>
          {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size} / page</option>)}
        </select>
      </form>
      {loading ? (
        <p>Loading inquiries...</p>
      ) : error ? (
        <div className="ck-form-status error">{error}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ck-admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Location</th>
                <th>Message</th>
                <th>Date</th>
                <th>Edit</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((inq) => (
                <tr key={inq.id}>
                  <td>{inq.id}</td>
                  <td>{inq.name}</td>
                  <td>{inq.email}</td>
                  <td>{inq.location}</td>
                  <td>{inq.message}</td>
                  <td>{new Date(inq.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => openEditModal(inq)} style={{ background: "#222", color: "#ffd700", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>Edit</button>
                  </td>
                  <td>
                    <button onClick={() => handleDelete(inq.id)} disabled={deleteLoading} style={{ background: "#b00020", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, margin: "16px 0" }}>
            <button onClick={() => handlePageChange(page - 1)} disabled={page === 1} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "#eee", color: "#222", cursor: page === 1 ? "not-allowed" : "pointer" }}>Prev</button>
            <span>Page {page} of {Math.ceil(total / pageSize) || 1}</span>
            <button onClick={() => handlePageChange(page + 1)} disabled={page * pageSize >= total} style={{ padding: "6px 14px", borderRadius: 4, border: "none", background: "#eee", color: "#222", cursor: page * pageSize >= total ? "not-allowed" : "pointer" }}>Next</button>
          </div>
        </div>
      )}
      {editModal.open && (
        <div className="ck-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="editInquiryTitle" tabIndex={-1}>
          <div className="ck-modal" style={{ background: '#fff', color: '#181c24', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', padding: '40px 36px 32px 36px', minWidth: 400, maxWidth: '98vw', position: 'relative' }}>
            <button
              onClick={closeEditModal}
              aria-label="Close Edit Modal"
              style={{ position: 'absolute', top: 18, right: 18, background: 'none', border: 'none', fontSize: 28, color: '#b00020', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}
            >
              ×
            </button>
            <h3 id="editInquiryTitle" style={{ marginTop: 0, marginBottom: 24, fontSize: '1.4rem', fontWeight: 800, color: '#C9B037', textAlign: 'center' }}>Edit Inquiry</h3>
            <form onSubmit={handleEditSubmit} style={{ minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }} role="form" aria-labelledby="editInquiryTitle">
              <div className="ck-form-row" style={{ gap: 12 }}>
                <label htmlFor="edit-name" className="visually-hidden">Name</label>
                <input
                  id="edit-name"
                  name="name"
                  type="text"
                  placeholder="Name"
                  value={editForm.name}
                  onChange={handleEditChange}
                  required
                  aria-required="true"
                  style={{ background: '#f8f8f8', color: '#181c24', border: '1.5px solid #C9B037', borderRadius: 8, fontSize: '1.08rem', padding: '10px 12px' }}
                />
                <label htmlFor="edit-email" className="visually-hidden">Email</label>
                <input
                  id="edit-email"
                  name="email"
                  type="email"
                  placeholder="Email"
                  value={editForm.email}
                  onChange={handleEditChange}
                  required
                  aria-required="true"
                  style={{ background: '#f8f8f8', color: '#181c24', border: '1.5px solid #C9B037', borderRadius: 8, fontSize: '1.08rem', padding: '10px 12px' }}
                />
              </div>
              <div className="ck-form-row" style={{ gap: 12 }}>
                <label htmlFor="edit-location" className="visually-hidden">Location</label>
                <input
                  id="edit-location"
                  name="location"
                  type="text"
                  placeholder="Location"
                  value={editForm.location}
                  onChange={handleEditChange}
                  required
                  aria-required="true"
                  style={{ background: '#f8f8f8', color: '#181c24', border: '1.5px solid #C9B037', borderRadius: 8, fontSize: '1.08rem', padding: '10px 12px' }}
                />
              </div>
              <div className="ck-form-row" style={{ gap: 12 }}>
                <label htmlFor="edit-message" className="visually-hidden">Message</label>
                <textarea
                  id="edit-message"
                  name="message"
                  placeholder="Message"
                  value={editForm.message}
                  onChange={handleEditChange}
                  required
                  aria-required="true"
                  rows={4}
                  style={{ background: '#f8f8f8', color: '#181c24', border: '1.5px solid #C9B037', borderRadius: 8, fontSize: '1.08rem', padding: '10px 12px', minHeight: 80 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
                <button type="submit" disabled={editLoading} aria-busy={editLoading} aria-label="Save Inquiry" style={{ background: '#C9B037', color: '#181c24', border: 'none', borderRadius: 8, padding: '10px 32px', fontWeight: 700, fontSize: '1.08rem', cursor: 'pointer', boxShadow: '0 2px 8px #C9B03733' }}>
                  {editLoading ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={closeEditModal} aria-label="Cancel Edit" style={{ background: '#eee', color: '#222', border: 'none', borderRadius: 8, padding: '10px 32px', fontWeight: 700, fontSize: '1.08rem', cursor: 'pointer' }}>Cancel</button>
              </div>
              {editStatus && (
                <div className={`ck-form-status ${editStatus.type}`} aria-live="polite" style={{ marginTop: 10 }}>{editStatus.msg}</div>
              )}
            </form>
          </div>
          <style>{`
            .ck-modal-overlay {
              position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
              background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 1000;
            }
            @media (max-width: 600px) {
              .ck-modal { min-width: 98vw !important; padding: 16px 2vw 12px 2vw !important; }
            }
          `}</style>
        </div>
      )}
      {deleteStatus && (
        <div className={`ck-form-status ${deleteStatus.type}`}>{deleteStatus.msg}</div>
      )}
    </div>
  );
} 