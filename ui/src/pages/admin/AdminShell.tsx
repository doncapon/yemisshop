// src/pages/admin/AdminShell.tsx
import { NavLink, Outlet, useLocation } from 'react-router-dom';

export default function AdminShell() {
  const loc = useLocation();

  const tabs = [
    { to: '/admin', label: 'Overview', exact: true },            // index
    { to: '/admin/products', label: 'Products' },
    { to: '/admin/products/moderation', label: 'Moderation' },
    { to: '/admin/orders', label: 'Orders' },
    { to: '/admin/settings', label: 'Settings' },
  ];

  return (
    <div className="py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Admin</h1>

        {/* Tabs */}
        <nav className="mt-3 flex flex-wrap gap-2">
          {tabs.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.exact} // only true for index (/admin)
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-xl border text-sm ${
                  isActive
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white hover:bg-black/5'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Where section pages render */}
      <div className="rounded-2xl border bg-white shadow-sm p-4">
        <Outlet />
      </div>
    </div>
  );
}
