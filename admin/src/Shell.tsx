import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";

const LOGO = "https://www.klanvio.com/brand/logo-icon.png";

export function Shell() {
  const { email, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={LOGO} alt="" width={28} height={28} />
          <div>
            <strong>Klanvio</strong>
            <span>Administration</span>
          </div>
        </div>

        <nav className="nav">
          <p className="nav-group">Pilotage</p>
          <NavLink to="/" end>
            Tableau de bord
          </NavLink>
          <NavLink to="/users">Comptes</NavLink>

          <p className="nav-group">Contrôle</p>
          <NavLink to="/health">Santé</NavLink>
          <NavLink to="/audit">Journal</NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-email">{email}</div>
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
