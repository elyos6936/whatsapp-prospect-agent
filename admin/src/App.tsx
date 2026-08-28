import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AuditPage } from "./AuditPage";
import { HealthPage } from "./HealthPage";
import { LoginPage } from "./LoginPage";
import { OverviewPage } from "./OverviewPage";
import { Shell } from "./Shell";
import { UserAccountManagementPage } from "./UserAccountManagementPage";
import { UserDetailPage } from "./UserDetailPage";
import { UserSubscriptionActionsPage } from "./UserSubscriptionActionsPage";
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
          <Route path="users/:id/subscription" element={<UserSubscriptionActionsPage />} />
          <Route path="users/:id/account-management" element={<UserAccountManagementPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="health" element={<HealthPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
