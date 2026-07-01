import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "./api";

const PAGE_SIZE = 25;

export default function SearchPage({ username, onLoggedOut }) {
  const [ranges, setRanges] = useState([]);
  const [q, setQ] = useState("");
  const [rangeCode, setRangeCode] = useState("");
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiRequest("/api/products/ranges").then((data) => setRanges(data.ranges)).catch(() => {});
  }, []);

  const fetchProducts = async (opts = {}) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      q: opts.q ?? q,
      rangeCode: opts.rangeCode ?? rangeCode,
      page: String(opts.page ?? page),
      pageSize: String(PAGE_SIZE),
    });
    try {
      const data = await apiRequest(`/api/products?${params.toString()}`);
      setProducts(data.products);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      if (err?.error === "Not authenticated" || err?.error?.includes("expired")) {
        onLoggedOut();
        return;
      }
      setError(err?.error || "Failed to load products.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchProducts({ page: 1 });
  };

  const handleRangeChange = (e) => {
    setRangeCode(e.target.value);
    fetchProducts({ page: 1, rangeCode: e.target.value });
  };

  const handleLogout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
    onLoggedOut();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="search-wrap">
      <header className="search-header">
        <h1>Jaguar NRP Listing</h1>
        <div className="header-right">
          <span>Signed in as {username}</span>
          <Link to="/create-user" className="logout-btn">Create user</Link>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search by item code, name, or color code..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={rangeCode} onChange={handleRangeChange}>
          <option value="">All ranges</option>
          {ranges.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button type="submit">Search</button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <div className="error">{error}</div>
      ) : (
        <>
          <p className="result-count">{total.toLocaleString()} products found</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Range</th>
                  <th>Color</th>
                  <th>Unit</th>
                  <th>SDP</th>
                  <th>NRP</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.itemCode}>
                    <td>{p.itemCode}</td>
                    <td>{p.itemName}</td>
                    <td>{p.rangeCode}</td>
                    <td>{p.colorCode}</td>
                    <td>{p.unitCode}</td>
                    <td>{p.sdp?.toLocaleString()}</td>
                    <td>{p.nrp?.toLocaleString()}</td>
                    <td>{p.price?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => fetchProducts({ page: page - 1 })}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => fetchProducts({ page: page + 1 })}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}
