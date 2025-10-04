import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'


export default function AdminDashboard() {
  const qc = useQueryClient()
  const cats = useQuery({ queryKey: ['cats'], queryFn: async () => (await api.get('/api/categories')).data })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: async () => (await api.get('/api/suppliers')).data })


  const addCat = useMutation({
  mutationFn: async (name: string) => (await api.post('/api/categories', { name })).data,
  onSuccess: () => qc.invalidateQueries({ queryKey: ['cats'] })
})


return (
  <div className="grid md:grid-cols-2 gap-6">
  <section>
  <h2 className="font-semibold mb-2">Categories</h2>
  <form onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget as any).name.value; if (v) addCat.mutate(v); (e.currentTarget as any).reset() }}>
  <input name="name" placeholder="New category" className="border p-2 mr-2" />
  <button className="border px-3 py-2">Add</button>
  </form>
  <ul className="mt-3 space-y-1">
  {cats.data?.map((c: any) => (<li key={c.id} className="border p-2">{c.name}</li>))}
  </ul>
  </section>


  <section>
  <h2 className="font-semibold mb-2">Suppliers</h2>
  <ul className="space-y-1">
  {suppliers.data?.map((s: any) => (
  <li key={s.id} className="border p-2">
  <div className="font-medium">{s.name} — {s.type}</div>
  <div className="text-sm opacity-70">WhatsApp: {s.whatsappPhone || 'n/a'}</div>
  </li>
  ))}
  </ul>
  </section>
  </div>
  )
}