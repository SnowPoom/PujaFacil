"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type AccountStatus = "PENDIENTE" | "ACTIVA" | "SUSPENDIDA" | "CERRADA";
type UserRole =
  | "COMPRADOR"
  | "VENDEDOR"
  | "VERIFICADOR"
  | "ADMIN_SUBASTAS"
  | "AUDITOR";

interface AuthUser {
  id: string;
  nombreCompleto: string;
  email: string;
  roles: UserRole[];
  status: AccountStatus;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

/** Siempre visibles, autenticado o no */
const PUBLIC_NAV: { href: string; label: string }[] = [
  { href: "/", label: "Catálogo" },
  { href: "/subastas", label: "Subastas" },
];

/** Visibles sólo para visitantes */
const GUEST_NAV: { href: string; label: string }[] = [
  { href: "/iniciar-sesion", label: "Iniciar sesión" },
  { href: "/registro", label: "Registrarse" },
];

/** Visibles para cualquier usuario autenticado */
const AUTH_NAV: { href: string; label: string }[] = [
  { href: "/panel", label: "Panel" },
  { href: "/chat", label: "Chat" },
  { href: "/notificaciones", label: "Notificaciones" },
  { href: "/perfil", label: "Mi perfil" },
];

/** Condicionales según rol */
const ROLE_NAV: { role: UserRole; href: string; label: string }[] = [
  { role: "VENDEDOR", href: "/mis-articulos", label: "Mis artículos" },
  { role: "VENDEDOR", href: "/mis-subastas", label: "Mis subastas" },
  { role: "COMPRADOR", href: "/mis-ofertas", label: "Mis ofertas" },
  { role: "VERIFICADOR", href: "/verificacion", label: "Verificación" },
  { role: "ADMIN_SUBASTAS", href: "/admin", label: "Administración" },
  { role: "AUDITOR", href: "/auditoria", label: "Auditoría" },
];

/** Texto para estados de cuenta distintos a ACTIVA */
const STATUS_LABEL: Partial<Record<AccountStatus, string>> = {
  PENDIENTE: "Cuenta pendiente",
  SUSPENDIDA: "Cuenta suspendida",
  CERRADA: "Cuenta cerrada",
};

/* ------------------------------------------------------------------ */
/*  NavLink helper                                                      */
/* ------------------------------------------------------------------ */

function NavLink({
  href,
  label,
  pathname,
  onClick,
  disabled = false,
}: {
  href: string;
  label: string;
  pathname: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isActive =
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  if (disabled) return <span className="pf-header__link pf-header__link--disabled" aria-disabled="true" title="Disponible cuando se active tu cuenta">{label} · Pendiente</span>;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={[
        "pf-header__link",
        isActive ? "pf-header__link--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                              */
/* ------------------------------------------------------------------ */

export default function Header({ initialUser }: { initialUser: AuthUser | null }) {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [authLoading, setAuthLoading] = useState(false);
  const initialPath = useRef(pathname);
  const navigated = useRef(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  /* ---- Fetch current session ---- */
  useEffect(() => {
    // La primera sesión ya viene en el HTML; revalidar después de navegar.
    if (!navigated.current && pathname === initialPath.current) return;
    navigated.current = true;
    let cancelled = false;

    async function fetchMe() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "same-origin",
        });

        if (!res.ok) {
          // 401, 403, 404 → visitante
          if (!cancelled) setUser(null);
          return;
        }

        const json = await res.json();
        if (!cancelled && json?.ok && json?.data?.user) {
          setUser(json.data.user as AuthUser);
        } else if (!cancelled) {
          setUser(null);
        }
      } catch {
        // Error de red o JSON inválido → visitante, sin romper el render
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    fetchMe();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  /* ---- Logout ---- */
  const handleLogout = useCallback(async () => {
    setLogoutLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Fallo silencioso; limpiamos estado local igualmente
    } finally {
      setUser(null);
      setLogoutLoading(false);
      setMenuOpen(false);
      router.push("/");
    }
  }, [router]);

  /* ---- Close menu on route change (render-time sync, avoids set-state-in-effect) ---- */
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMenuOpen(false);
  }

  /* ---- Build nav items ---- */
  const authNavItems = user
    ? [
        ...AUTH_NAV.map((item) => ({ ...item, disabled: user.status !== "ACTIVA" && ["/chat", "/notificaciones"].includes(item.href) })),
        ...ROLE_NAV.filter((item) => user.roles.includes(item.role)).map((item) => ({ ...item, disabled: user.status !== "ACTIVA" })),
      ]
    : [];

  const closeMenu = () => setMenuOpen(false);

  /* ---- Account status badge ---- */
  const statusBadge =
    user && user.status !== "ACTIVA" ? (
      <Badge variant={user.status === "SUSPENDIDA" || user.status === "CERRADA" ? "error" : "accent"}>
        {STATUS_LABEL[user.status] ?? user.status}
      </Badge>
    ) : null;

  return (
    <>
      {/* Inline scoped styles — only structural/layout, NO palette overrides */}
      <style>{`
        .pf-header {
          background-color: var(--pf-primary);
          border-bottom: 3px solid var(--pf-accent);
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .pf-header__inner {
          max-width: var(--pf-max-w);
          margin-inline: auto;
          padding: 12px 24px;
          min-height: 60px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .pf-header__logo {
          font-family: var(--pf-font);
          font-size: 1.25rem;
          font-weight: 700;
          color: #FFFFFF;
          text-decoration: none;
          letter-spacing: -0.01em;
          flex-shrink: 0;
        }
        .pf-header__logo span {
          color: var(--pf-accent);
        }
        .pf-header__nav {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
          order: 3;
          flex-basis: 100%;
        }
        .pf-header__link {
          font-family: var(--pf-font);
          font-size: 0.875rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.85);
          text-decoration: none;
          padding: 6px 10px;
          border-radius: 8px;
          transition: background-color 0.15s ease, color 0.15s ease;
          white-space: nowrap;
        }
        .pf-header__link:hover {
          background-color: rgba(255, 255, 255, 0.1);
          color: #FFFFFF;
        }
        .pf-header__link--disabled { opacity: .65; cursor: help; }
        .pf-header__link:focus-visible {
          outline: 2px solid var(--pf-accent);
          outline-offset: 2px;
        }
        .pf-header__link--active {
          color: var(--pf-accent);
          font-weight: 700;
        }
        .pf-header__link--active:hover {
          background-color: rgba(198, 161, 91, 0.15);
          color: var(--pf-accent);
        }
        .pf-header__divider {
          width: 1px;
          height: 20px;
          background-color: rgba(255, 255, 255, 0.2);
          flex-shrink: 0;
        }
        .pf-header__user {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .pf-header__username {
          font-family: var(--pf-font);
          font-size: 0.8125rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          white-space: nowrap;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Logout button override for dark header context */
        .pf-header__logout {
          font-size: 0.8125rem;
          padding: 6px 14px;
          border-color: rgba(255, 255, 255, 0.4);
          color: rgba(255, 255, 255, 0.85);
        }
        .pf-header__logout:hover:not(:disabled) {
          background-color: rgba(255, 255, 255, 0.12);
          color: #FFFFFF;
          border-color: rgba(255, 255, 255, 0.7);
        }
        /* Hamburger button */
        .pf-header__hamburger {
          display: none;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 5px;
          width: 40px;
          height: 40px;
          border: none;
          background: transparent;
          cursor: pointer;
          border-radius: 8px;
          padding: 6px;
          flex-shrink: 0;
          transition: background-color 0.15s ease;
        }
        .pf-header__hamburger:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }
        .pf-header__hamburger:focus-visible {
          outline: 2px solid var(--pf-accent);
          outline-offset: 2px;
        }
        .pf-header__bar {
          display: block;
          width: 22px;
          height: 2px;
          background-color: #FFFFFF;
          border-radius: 2px;
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        /* Mobile menu */
        .pf-header__mobile-menu {
          display: none;
          background-color: var(--pf-primary-hover, #172E4C);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .pf-header__mobile-inner {
          max-width: var(--pf-max-w);
          margin-inline: auto;
          padding: 12px 24px 20px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pf-header__mobile-menu .pf-header__link {
          display: block;
          padding: 10px 12px;
        }
        .pf-header__mobile-section {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pf-header__mobile-user {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          flex-wrap: wrap;
        }
        @media (max-width: 900px) {
          .pf-header__hamburger {
            display: flex;
          }
          .pf-header__nav {
            display: none;
          }
          .pf-header__user {
            display: none;
          }
          .pf-header__mobile-menu {
            display: block;
          }
        }
        @media (max-width: 640px) {
          .pf-header__inner {
            padding: 0 16px;
          }
          .pf-header__mobile-inner {
            padding: 12px 16px 20px;
          }
        }
      `}</style>

      <header className="pf-header">
        {/* ── Top bar ── */}
        <div className="pf-header__inner">
          {/* Logo */}
          <Link href="/" className="pf-header__logo" aria-label="PujaFácil — Inicio">
            Puja<span>Fácil</span>
          </Link>

          {/* Desktop nav */}
          <nav className="pf-header__nav" aria-label="Navegación principal">
            {PUBLIC_NAV.map((item) => (
              <NavLink key={item.href} {...item} pathname={pathname} />
            ))}

            {!authLoading && (
              <>
                <span className="pf-header__divider" aria-hidden="true" />

                {user === null ? (
                  GUEST_NAV.map((item) => (
                    <NavLink key={item.href} {...item} pathname={pathname} />
                  ))
                ) : (
                  authNavItems.map((item) => (
                    <NavLink key={item.href} {...item} pathname={pathname} />
                  ))
                )}
              </>
            )}
          </nav>

          {/* Desktop user area */}
          {!authLoading && user !== null && (
            <div className="pf-header__user">
              {statusBadge}
              <span className="pf-header__username" title={user.nombreCompleto}>
                {user.nombreCompleto}
              </span>
              <Button
                variant="secondary"
                disabled={logoutLoading}
                onClick={handleLogout}
                className="pf-header__logout"
              >
                {logoutLoading ? "Saliendo…" : "Cerrar sesión"}
              </Button>
            </div>
          )}

          {/* Hamburger */}
          <button
            type="button"
            className="pf-header__hamburger"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            aria-controls="pf-mobile-menu"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span
              className="pf-header__bar"
              style={
                menuOpen
                  ? { transform: "translateY(7px) rotate(45deg)" }
                  : undefined
              }
            />
            <span
              className="pf-header__bar"
              style={menuOpen ? { opacity: 0 } : undefined}
            />
            <span
              className="pf-header__bar"
              style={
                menuOpen
                  ? { transform: "translateY(-7px) rotate(-45deg)" }
                  : undefined
              }
            />
          </button>
        </div>

        {/* ── Mobile menu ── */}
        {menuOpen && (
          <div id="pf-mobile-menu" className="pf-header__mobile-menu">
            <div className="pf-header__mobile-inner">
              {/* Public links */}
              {PUBLIC_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  pathname={pathname}
                  onClick={closeMenu}
                />
              ))}

              {/* Auth-dependent links */}
              {!authLoading && (
                <div className="pf-header__mobile-section">
                  {user === null ? (
                    GUEST_NAV.map((item) => (
                      <NavLink
                        key={item.href}
                        {...item}
                        pathname={pathname}
                        onClick={closeMenu}
                      />
                    ))
                  ) : (
                    <>
                      {authNavItems.map((item) => (
                        <NavLink
                          key={item.href}
                          {...item}
                          pathname={pathname}
                          onClick={closeMenu}
                        />
                      ))}

                      {/* User info + status + logout */}
                      <div className="pf-header__mobile-section">
                        <div className="pf-header__mobile-user">
                          <span
                            className="pf-header__username"
                            title={user.nombreCompleto}
                          >
                            {user.nombreCompleto}
                          </span>
                          {statusBadge}
                        </div>
                        <Button
                          variant="secondary"
                          disabled={logoutLoading}
                          onClick={handleLogout}
                          className="pf-header__logout"
                        >
                          {logoutLoading ? "Saliendo…" : "Cerrar sesión"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
}
