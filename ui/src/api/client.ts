import axios from 'axios'
import { useAuthStore } from '../store/auth.ts'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  withCredentials: false,
});

// Attach Authorization header from localStorage (or your store) on each request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token'); // or read from your auth store
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});


export default api