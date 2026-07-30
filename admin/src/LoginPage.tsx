import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "./api";
import { useAuth } from "./auth";

const LOGO = "https://www.klanvio.com/brand/logo-icon.png";

export function LoginPage() {
  const { email, loading, login } = useAuth();
  const [mail, setMail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && email) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(mail, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img src={LOGO} alt="" width={28} height={28} />
          <h1>Administration</h1>
        </div>
        <p className="sub">Espace privé Klanvio — séparé de l’application</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={mail}
            onChange={(e) => setMail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
