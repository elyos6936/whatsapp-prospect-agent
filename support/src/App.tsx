import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { InboxPage } from "./InboxPage";
import { LoginPage } from "./LoginPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { email, loading } = useAuth();
  if (loading) return <div className="loading">Chargement…</div>;
  if (!email) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <InboxPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
