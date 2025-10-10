// src/App.tsx
import { Route, Routes, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar.tsx';
import Catalog from './pages/Catalog.tsx';
import ProductDetail from './pages/ProductDetail.tsx';
import Cart from './pages/Cart.tsx';
import Checkout from './pages/Checkout.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import AdminDashboard from './pages/AdminDashboard.tsx';
import SupplierDashboard from './pages/SupplierDashboard.tsx';
import ProtectedRoute from './components/ProtectedRoute.tsx';
import Verify from './pages/Verify.tsx';
import Profile from './pages/Profile.tsx';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import UserPersonalisedPage from './pages/UserPersonalisedPage.tsx';
import Footer from './components/Footer.tsx';
import Payment from './pages/Payment.tsx';
import PaymentCallback from './pages/PaymentCallback.tsx';
import Wishlist from './pages/Wishlist.tsx';
import Orders from './pages/Orders.tsx';

export default function App() {

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      {/* Page margins + centered main content */}
      <main className="w-full px-4 md:px-8 flex-1 bg-primary-700">
        <div className="max-w-7xl mx-auto"> {/* 👈 centered container */}
          <Routes>
            <Route path="/" element={<Catalog />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/payment" element={<Payment />} />
            <Route path="/payment-callback" element={<PaymentCallback />} />
            <Route path="/wishlist" element={<Wishlist />} />

            <Route
              path="/checkout"
              element={
                <ProtectedRoute roles={['SHOPPER', 'ADMIN', 'SUPPLIER']}>
                  <Checkout />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/*"
              element={
                <ProtectedRoute roles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute roles={['SHOPPER']}>
                  <UserPersonalisedPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/supplier/*"
              element={
                <ProtectedRoute roles={['SUPPLIER']}>
                  <SupplierDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <Footer />
    </div>
  );
}
