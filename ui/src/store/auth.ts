import { create } from 'zustand'


export type Role = 'ADMIN' | 'SUPPLIER' | 'SHOPPER'


interface AuthState {
token: string | null
role: Role | null
userEmail: string | null
setAuth: (token: string, role: Role, userEmail: string) => void
clear: () => void
}


export const useAuthStore = create<AuthState>((set) => ({
token: localStorage.getItem('token'),
role: (localStorage.getItem('role') as Role) || null,
userEmail: localStorage.getItem('userEmail'),
setAuth: (token, role, userEmail) => {
localStorage.setItem('token', token)
localStorage.setItem('role', role)
localStorage.setItem('userEmail', userEmail)
set({ token, role, userEmail })
},
clear: () => {
localStorage.removeItem('token')
localStorage.removeItem('role')
localStorage.removeItem('userEmail')
set({ token: null, role: null, userEmail: null })
},
}))