import { useState } from 'react'


export default function Register() {
const [email, setEmail] = useState('')
const [password, setPassword] = useState('')


const submit = (e: React.FormEvent) => {
e.preventDefault()
alert('Hook up /api/auth/register on the backend then wire here')
}


return (
<form onSubmit={submit} className="max-w-sm space-y-3">
<h1 className="text-xl font-semibold">Register</h1>
<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="border p-2 w-full" />
<input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="border p-2 w-full" />
<button type="submit" className="border px-4 py-2">Register</button>
</form>
)
}