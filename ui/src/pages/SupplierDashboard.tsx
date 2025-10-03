import { useQuery } from '@tanstack/react-query'
import api from '../api/client'


export default function SupplierDashboard() {
const myProducts = useQuery({ queryKey: ['my-products'], queryFn: async () => (await api.get('/api/supplier/products')).data })


return (
<div>
<h1 className="text-xl font-semibold mb-3">My Products</h1>
<ul className="space-y-2">
{myProducts.data?.map((p: any) => (
<li key={p.id} className="border p-2 flex justify-between">
<div>
<div className="font-medium">{p.title}</div>
<div className="text-sm opacity-70">₦{(p.priceMinor/100).toFixed(2)}</div>
</div>
<span className="opacity-70">{p.status}</span>
</li>
))}
</ul>
</div>
)
}