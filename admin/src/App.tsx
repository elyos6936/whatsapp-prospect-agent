import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AuditPage } from "./AuditPage";
import { LoginPage } from "./LoginPage";
import { OverviewPage } from "./OverviewPage";
import { Shell } from "./Shell";
import { UserDetailPage } from "./UserDetailPage";
import { UsersPage } from "./UsersPage";

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
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
