import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { apiRequest } from "./api";
import LoginPage from "./LoginPage.jsx";
import SearchPage from "./SearchPage.jsx";
import CreateUserPage from "./CreateUserPage.jsx";

export default function App() {
  const [username, setUsername] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    apiRequest("/api/auth/me")
      .then((data) => setUsername(data.username))
      .catch(() => setUsername(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;

  if (!username) {
    return <LoginPage onLoggedIn={setUsername} />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<SearchPage username={username} onLoggedOut={() => setUsername(null)} />}
      />
      <Route
        path="/create-user"
        element={<CreateUserPage onLoggedOut={() => setUsername(null)} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
