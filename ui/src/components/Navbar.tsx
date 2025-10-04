import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function Navbar() {
  const { token, role, userEmail, clear } = useAuthStore()
  const nav = useNavigate()

  const logout = () => {
    clear()
    nav('/')
  }

  return (
    <header className="w-full border-b bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center gap-4">
        <Link to="/" className="font-bold text-lg">YemiShop</Link>

        <nav className="flex gap-4">
          <NavLink to="/" end>Catalogue</NavLink>
          <NavLink to="/cart">Cart</NavLink>
          {role === 'ADMIN' && <NavLink to="/admin">Admin</NavLink>}
          {role === 'SUPPLIER' && <NavLink to="/supplier">Supplier</NavLink>}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!token ? (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Register</NavLink>
            </>
          ) : (
            <>
              <span className="text-sm opacity-70 hidden sm:inline">{userEmail}</span>
              <button className="text-sm border px-3 py-1 rounded" onClick={logout}>
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
