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
    <header className="border-b">
    <div className="container mx-auto p-4 flex items-center gap-4">
    <Link to="/" className="font-bold">YemiShop</Link>
    <nav className="flex gap-3">
    <NavLink to="/">Catalogue</NavLink>
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
    <span className="text-sm opacity-70">{userEmail}</span>
    <button onClick={logout}>Logout</button>
    </>
    )}
    </div>
    </div>
    </header>
    )
}