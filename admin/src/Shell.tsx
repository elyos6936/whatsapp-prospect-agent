import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

export function Shell() {
  const { email, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Klanvio Ops</strong>
          <span>Hostinger · privé</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Vue d’ensemble
          </NavLink>
          <NavLink to="/users">Utilisateurs</NavLink>
          <NavLink to="/audit">Audit</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div>{email}</div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8, width: "100%" }}
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Déconnexion
          </button>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
