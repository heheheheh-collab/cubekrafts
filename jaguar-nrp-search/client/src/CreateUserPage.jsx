import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "./api";

export default function CreateUserPage({ onLoggedOut }) {
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (form.password !== form.confirm) {
      setStatus({ type: "error", msg: "Passwords do not match." });
      return;
    }

    setLoading(true);
    try {
      const data = await apiRequest("/api/auth/create-user", {
        method: "POST",
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      setStatus({ type: "success", msg: `User "${data.username}" created successfully.` });
      setForm({ username: "", password: "", confirm: "" });
    } catch (err) {
      if (err?.error === "Not authenticated" || err?.error?.includes?.("expired")) {
        onLoggedOut();
        return;
      }
      setStatus({ type: "error", msg: err?.error || "Failed to create user." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-wrap">
      <header className="search-header">
        <h1>Create User</h1>
        <Link to="/" className="logout-btn">Back to search</Link>
      </header>

      <form className="login-card create-user-card" onSubmit={handleSubmit}>
        <label htmlFor="new-username">Username</label>
        <input
          id="new-username"
          name="username"
          type="text"
          autoComplete="off"
          value={form.username}
          onChange={handleChange}
          required
          minLength={3}
        />
        <label htmlFor="new-password">Password</label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={handleChange}
          required
          minLength={8}
        />
        <label htmlFor="new-password-confirm">Confirm password</label>
        <input
          id="new-password-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={handleChange}
          required
          minLength={8}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create user"}
        </button>
        {status && <div className={status.type}>{status.msg}</div>}
      </form>
    </div>
  );
}
